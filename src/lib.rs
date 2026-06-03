pub mod dictionary;

use std::collections::{HashMap, HashSet};

pub use dictionary::{Dictionary, CUSTOM_DICTIONARY};

const DEFAULT_BEAM_WIDTH: usize = 8;

#[derive(Clone, Debug)]
pub struct LatinToHangulOptions {
    pub dictionary: Dictionary,
    pub beam_width: usize,
    pub enable_fallback_phones: bool,
}

impl Default for LatinToHangulOptions {
    fn default() -> Self {
        Self {
            dictionary: Dictionary::new(),
            beam_width: DEFAULT_BEAM_WIDTH,
            enable_fallback_phones: true,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Konglish {
    default_options: LatinToHangulOptions,
}

impl Konglish {
    pub fn new(default_options: LatinToHangulOptions) -> Self {
        Self { default_options }
    }

    pub fn latin_to_hangul(&self, input: &str, options: Option<&LatinToHangulOptions>) -> String {
        let merged = merge_options(&self.default_options, options);
        latin_to_hangul(input, Some(&merged))
    }
}

pub fn latin_to_hangul_default(input: &str) -> String {
    latin_to_hangul(input, None)
}

pub fn latin_to_hangul(input: &str, options: Option<&LatinToHangulOptions>) -> String {
    let full_key = input.trim().to_lowercase();

    if let Some(hit) = options
        .and_then(|o| o.dictionary.get(&full_key))
        .and_then(|v| v.first())
    {
        return hit.clone();
    }

    if let Some(hit) = CUSTOM_DICTIONARY.get(&full_key).and_then(|v| v.first()) {
        return hit.clone();
    }

    let resolved = resolve_options(options, 1);
    let tokens = tokenize_preserving_special_chars(input);
    transliterate_tokens(&tokens, &resolved)
        .into_iter()
        .next()
        .unwrap_or_else(|| input.to_string())
}

fn merge_options(
    base: &LatinToHangulOptions,
    override_options: Option<&LatinToHangulOptions>,
) -> LatinToHangulOptions {
    let Some(override_options) = override_options else {
        return base.clone();
    };

    let mut dictionary = base.dictionary.clone();
    dictionary.extend(override_options.dictionary.clone());

    LatinToHangulOptions {
        dictionary,
        beam_width: override_options.beam_width,
        enable_fallback_phones: override_options.enable_fallback_phones,
    }
}

#[derive(Clone, Debug)]
struct Cand {
    text: String,
    score: i32,
}

#[derive(Clone, Debug)]
enum Token {
    Word(String),
    Other(String),
}

#[derive(Clone, Debug)]
struct InternalOptions {
    limit: usize,
    beam_width: usize,
    enable_fallback_phones: bool,
    dictionary_override: Dictionary,
}

fn resolve_options(options: Option<&LatinToHangulOptions>, limit: usize) -> InternalOptions {
    let beam_width = options.map_or(DEFAULT_BEAM_WIDTH, |o| o.beam_width);
    InternalOptions {
        limit,
        beam_width: beam_width.max(limit).max(DEFAULT_BEAM_WIDTH),
        enable_fallback_phones: options.map_or(true, |o| o.enable_fallback_phones),
        dictionary_override: options.map(|o| o.dictionary.clone()).unwrap_or_default(),
    }
}

fn tokenize_preserving_special_chars(input: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut buf = String::new();
    let mut current_is_word: Option<bool> = None;

    for ch in input.chars() {
        let is_word = ch.is_ascii_alphabetic();
        match current_is_word {
            Some(prev) if prev == is_word => buf.push(ch),
            Some(prev) => {
                push_token(&mut tokens, prev, std::mem::take(&mut buf));
                buf.push(ch);
                current_is_word = Some(is_word);
            }
            None => {
                buf.push(ch);
                current_is_word = Some(is_word);
            }
        }
    }

    if let Some(is_word) = current_is_word {
        push_token(&mut tokens, is_word, buf);
    }

    tokens
}

fn push_token(tokens: &mut Vec<Token>, is_word: bool, text: String) {
    if is_word {
        tokens.push(Token::Word(text));
    } else {
        tokens.push(Token::Other(text));
    }
}

fn transliterate_tokens(tokens: &[Token], options: &InternalOptions) -> Vec<String> {
    let word_tokens: Vec<&str> = tokens
        .iter()
        .filter_map(|t| match t {
            Token::Word(s) => Some(s.as_str()),
            Token::Other(_) => None,
        })
        .collect();

    if word_tokens.is_empty() {
        return Vec::new();
    }

    let combined_words = word_tokens.join(" ");
    let candidates = build_word_candidates(&combined_words, options);
    candidates
        .into_iter()
        .map(|candidate| apply_candidate_to_tokens(tokens, &candidate))
        .collect()
}

fn apply_candidate_to_tokens(tokens: &[Token], candidate: &str) -> String {
    let cand_words: Vec<&str> = candidate.split(' ').collect();
    let mut cand_idx = 0;
    let mut out = String::new();

    for token in tokens {
        match token {
            Token::Word(original) => {
                if let Some(next) = cand_words.get(cand_idx) {
                    out.push_str(next);
                } else {
                    out.push_str(original);
                }
                cand_idx += 1;
            }
            Token::Other(text) => out.push_str(text),
        }
    }

    out
}

fn build_word_candidates(input: &str, options: &InternalOptions) -> Vec<String> {
    let text = normalize_input(input);
    if text.is_empty() {
        return Vec::new();
    }

    let words: Vec<&str> = text.split_whitespace().collect();
    let mut beam = vec![Cand {
        text: String::new(),
        score: 0,
    }];

    for (wi, word) in words.iter().enumerate() {
        let override_candidates = override_candidates(word, &options.dictionary_override)
            .into_iter()
            .enumerate()
            .map(|(i, text)| Cand {
                text,
                score: i as i32,
            });

        let phones = cmu_lookup_phones(word);

        let dict_candidates = phones
            .as_ref()
            .map(|p| {
                arpabet_to_ko_candidates(p, options.beam_width)
                    .into_iter()
                    .enumerate()
                    .map(|(i, text)| Cand {
                        text,
                        score: 100 + i as i32,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let fallback_candidates = if phones.is_none() && options.enable_fallback_phones {
            fallback_phones(word)
                .map(|p| {
                    arpabet_to_ko_candidates(&p, options.beam_width)
                        .into_iter()
                        .enumerate()
                        .map(|(i, text)| Cand {
                            text,
                            score: 200 + i as i32,
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let word_beam = take_top_k(
            dedupe_by_text(
                override_candidates
                    .chain(dict_candidates.into_iter())
                    .chain(fallback_candidates.into_iter())
                    .collect(),
            ),
            options.beam_width,
        );

        beam = combine_beams(&beam, &word_beam, options.beam_width);

        if wi != words.len() - 1 {
            for item in &mut beam {
                item.text.push(' ');
            }
        }
    }

    beam.sort_by_key(|x| x.score);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for item in beam {
        let s = item.text.trim().to_string();
        if s.is_empty() || !seen.insert(s.clone()) {
            continue;
        }
        out.push(s);
        if out.len() >= options.limit {
            break;
        }
    }

    out
}

fn override_candidates(word: &str, overrides: &Dictionary) -> Vec<String> {
    let key = word.to_lowercase();
    if let Some(hit) = overrides.get(&key) {
        if !hit.is_empty() {
            return hit.clone();
        }
    }

    CUSTOM_DICTIONARY.get(&key).cloned().unwrap_or_default()
}

fn cmu_lookup_phones(_word: &str) -> Option<Vec<String>> {
    None
}

fn fallback_phones(word: &str) -> Option<Vec<String>> {
    let w = word.to_lowercase();
    let mut phones = Vec::new();
    let chars: Vec<char> = w.chars().collect();
    let mut i = 0;

    if starts_with_pre_consonant(&w) {
        phones.extend(["P", "R", "IY"].into_iter().map(String::from));
        i = 3;
    }

    while i < chars.len() {
        let rest: String = chars[i..].iter().collect();

        if rest.starts_with("er") || rest.starts_with("ir") || rest.starts_with("ur") {
            phones.push("ER".to_string());
            i += 2;
            continue;
        }
        if rest.starts_with("ch") {
            phones.push("CH".to_string());
            i += 2;
            continue;
        }
        if rest.starts_with("sh") {
            phones.push("SH".to_string());
            i += 2;
            continue;
        }
        if rest.starts_with("th") {
            phones.push("TH".to_string());
            i += 2;
            continue;
        }
        if rest.starts_with("ng") {
            phones.push("NG".to_string());
            i += 2;
            continue;
        }
        if rest.starts_with("qu") {
            phones.push("K".to_string());
            phones.push("W".to_string());
            i += 2;
            continue;
        }

        let ch = chars[i];
        if matches!(ch, 'a' | 'e' | 'i' | 'o' | 'u' | 'y') {
            phones.push(vowel_to_arpabet(ch).to_string());
        } else if ch.is_ascii_lowercase() {
            phones.push(cons_to_arpabet(ch).to_string());
        }
        i += 1;
    }

    (!phones.is_empty()).then_some(phones)
}

fn starts_with_pre_consonant(w: &str) -> bool {
    let bytes = w.as_bytes();
    bytes.len() >= 4
        && &bytes[..3] == b"pre"
        && matches!(
            bytes[3] as char,
            'b' | 'c'
                | 'd'
                | 'f'
                | 'g'
                | 'h'
                | 'j'
                | 'k'
                | 'l'
                | 'm'
                | 'n'
                | 'p'
                | 'q'
                | 'r'
                | 's'
                | 't'
                | 'v'
                | 'w'
                | 'x'
                | 'y'
                | 'z'
        )
}

fn vowel_to_arpabet(ch: char) -> &'static str {
    match ch {
        'a' => "AE",
        'e' => "EH",
        'i' => "IY",
        'o' => "OW",
        'u' => "UW",
        'y' => "IY",
        _ => "AH",
    }
}

fn cons_to_arpabet(ch: char) -> &'static str {
    match ch {
        'b' => "B",
        'c' => "K",
        'd' => "D",
        'f' => "F",
        'g' => "G",
        'h' => "HH",
        'j' => "JH",
        'k' => "K",
        'l' => "L",
        'm' => "M",
        'n' => "N",
        'p' => "P",
        'q' => "K",
        'r' => "R",
        's' => "S",
        't' => "T",
        'v' => "V",
        'w' => "W",
        'x' => "K",
        'z' => "Z",
        _ => "HH",
    }
}

static VOWELS: &[&str] = &[
    "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW", "AX",
];

fn arpabet_to_ko_candidates(phones: &[String], limit: usize) -> Vec<String> {
    if phones.is_empty() {
        return Vec::new();
    }

    let syllables = syllabify_arpabet(phones);
    let mut beam = vec![Cand {
        text: String::new(),
        score: 0,
    }];

    for syllable in syllables {
        let syllable_beam = build_ko_syllable_candidates(&syllable, limit);
        beam = combine_beams(&beam, &syllable_beam, limit);
    }

    beam.sort_by_key(|x| x.score);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for item in beam {
        if seen.insert(item.text.clone()) {
            out.push(item.text);
        }
        if out.len() >= limit {
            break;
        }
    }

    out
}

#[derive(Clone, Debug)]
struct Syll {
    onset: Vec<String>,
    vowel: String,
    coda: Vec<String>,
}

fn syllabify_arpabet(phones: &[String]) -> Vec<Syll> {
    let mut out = Vec::new();
    let mut onset = Vec::new();
    let mut vowel: Option<String> = None;
    let mut coda = Vec::new();

    for phone in phones {
        if VOWELS.contains(&phone.as_str()) {
            if let Some(v) = vowel.take() {
                out.push(Syll {
                    onset,
                    vowel: v,
                    coda,
                });
                onset = Vec::new();
                coda = Vec::new();
            }
            vowel = Some(phone.clone());
        } else if vowel.is_none() {
            onset.push(phone.clone());
        } else {
            coda.push(phone.clone());
        }
    }

    if let Some(v) = vowel {
        out.push(Syll {
            onset,
            vowel: v,
            coda,
        });
    }

    if out.len() > 1 {
        for i in 0..out.len() - 1 {
            if !out[i].coda.is_empty() && out[i + 1].onset.is_empty() {
                if let Some(moved) = out[i].coda.pop() {
                    out[i + 1].onset.insert(0, moved);
                }
            }
        }
    }

    out
}

fn build_ko_syllable_candidates(syllable: &Syll, limit: usize) -> Vec<Cand> {
    let mut beam = vec![Cand {
        text: String::new(),
        score: 0,
    }];

    if syllable.onset.len() > 1 {
        for phone in &syllable.onset[..syllable.onset.len() - 1] {
            let prefix_beam: Vec<Cand> = cons_map(phone)
                .into_iter()
                .map(|x| Cand {
                    text: compose_hangul(x.cho, "ㅡ", ""),
                    score: x.score + 3,
                })
                .collect();
            beam = combine_beams(&beam, &prefix_beam, limit);
        }
    }

    let onset_candidates = syllable
        .onset
        .last()
        .map(|p| cons_map(p))
        .unwrap_or_else(|| {
            vec![ChoScore {
                cho: "ㅇ",
                score: 0,
            }]
        });
    let vowel_candidates = vowel_map(&syllable.vowel);
    let coda_candidates = syllable
        .coda
        .first()
        .map(|p| cons_to_jong_map(p))
        .unwrap_or_else(|| vec![JongScore { jong: "", score: 0 }]);

    let mut main = Vec::new();
    for onset in &onset_candidates {
        for vowel in &vowel_candidates {
            for coda in &coda_candidates {
                let jong = pick_jong(coda.jong, vowel.add_jong);
                main.push(Cand {
                    text: compose_hangul(onset.cho, vowel.jung, jong),
                    score: onset.score
                        + vowel.score
                        + coda.score
                        + i32::from(vowel.add_jong.is_some()),
                });
            }
        }
    }

    beam = combine_beams(&beam, &take_top_k(main, limit), limit);

    if syllable.coda.len() > 1 {
        for extra in &syllable.coda[1..] {
            let extra_beam: Vec<Cand> = cons_map(extra)
                .into_iter()
                .map(|x| Cand {
                    text: compose_hangul(x.cho, "ㅡ", ""),
                    score: x.score + 4,
                })
                .collect();
            beam = combine_beams(&beam, &extra_beam, limit);
        }
    }

    take_top_k(beam, limit)
}

#[derive(Clone, Copy)]
struct ChoScore {
    cho: &'static str,
    score: i32,
}

#[derive(Clone, Copy)]
struct JongScore {
    jong: &'static str,
    score: i32,
}

#[derive(Clone, Copy)]
struct VowelScore {
    jung: &'static str,
    add_jong: Option<&'static str>,
    score: i32,
}

fn cons_map(phone: &str) -> Vec<ChoScore> {
    match phone {
        "P" => vec![ChoScore {
            cho: "ㅍ",
            score: 0,
        }],
        "B" => vec![ChoScore {
            cho: "ㅂ",
            score: 0,
        }],
        "T" => vec![ChoScore {
            cho: "ㅌ",
            score: 0,
        }],
        "D" => vec![ChoScore {
            cho: "ㄷ",
            score: 0,
        }],
        "K" => vec![
            ChoScore {
                cho: "ㅋ",
                score: 0,
            },
            ChoScore {
                cho: "ㄱ",
                score: 1,
            },
        ],
        "G" => vec![
            ChoScore {
                cho: "ㄱ",
                score: 0,
            },
            ChoScore {
                cho: "ㅋ",
                score: 1,
            },
        ],
        "F" => vec![ChoScore {
            cho: "ㅍ",
            score: 0,
        }],
        "V" => vec![ChoScore {
            cho: "ㅂ",
            score: 0,
        }],
        "S" => vec![ChoScore {
            cho: "ㅅ",
            score: 0,
        }],
        "Z" => vec![ChoScore {
            cho: "ㅈ",
            score: 0,
        }],
        "JH" => vec![ChoScore {
            cho: "ㅈ",
            score: 0,
        }],
        "CH" => vec![ChoScore {
            cho: "ㅊ",
            score: 0,
        }],
        "SH" => vec![ChoScore {
            cho: "ㅅ",
            score: 0,
        }],
        "HH" => vec![ChoScore {
            cho: "ㅎ",
            score: 0,
        }],
        "M" => vec![ChoScore {
            cho: "ㅁ",
            score: 0,
        }],
        "N" => vec![ChoScore {
            cho: "ㄴ",
            score: 0,
        }],
        "NG" => vec![ChoScore {
            cho: "ㅇ",
            score: 0,
        }],
        "L" | "R" => vec![ChoScore {
            cho: "ㄹ",
            score: 0,
        }],
        "W" | "Y" => vec![ChoScore {
            cho: "ㅇ",
            score: 2,
        }],
        "TH" => vec![
            ChoScore {
                cho: "ㅅ",
                score: 0,
            },
            ChoScore {
                cho: "ㄷ",
                score: 2,
            },
        ],
        "DH" => vec![ChoScore {
            cho: "ㄷ",
            score: 0,
        }],
        _ => vec![ChoScore {
            cho: "ㅇ",
            score: 5,
        }],
    }
}

fn cons_to_jong_map(phone: &str) -> Vec<JongScore> {
    match phone {
        "P" | "B" | "F" | "V" => vec![JongScore {
            jong: "ㅂ",
            score: 0,
        }],
        "T" | "D" | "S" | "Z" | "JH" | "CH" => vec![JongScore {
            jong: "ㄷ",
            score: 0,
        }],
        "K" | "G" => vec![JongScore {
            jong: "ㄱ",
            score: 0,
        }],
        "M" => vec![JongScore {
            jong: "ㅁ",
            score: 0,
        }],
        "N" => vec![JongScore {
            jong: "ㄴ",
            score: 0,
        }],
        "NG" => vec![JongScore {
            jong: "ㅇ",
            score: 0,
        }],
        "L" | "R" => vec![JongScore {
            jong: "ㄹ",
            score: 0,
        }],
        "HH" => vec![JongScore {
            jong: "ㅎ",
            score: 0,
        }],
        _ => vec![JongScore { jong: "", score: 0 }],
    }
}

fn vowel_map(vowel: &str) -> Vec<VowelScore> {
    match vowel {
        "IY" | "IH" => vec![VowelScore {
            jung: "ㅣ",
            add_jong: None,
            score: 0,
        }],
        "EH" | "EY" => vec![VowelScore {
            jung: "ㅔ",
            add_jong: None,
            score: 0,
        }],
        "AE" => vec![VowelScore {
            jung: "ㅐ",
            add_jong: None,
            score: 0,
        }],
        "AA" => vec![VowelScore {
            jung: "ㅏ",
            add_jong: None,
            score: 0,
        }],
        "AH" => vec![VowelScore {
            jung: "ㅓ",
            add_jong: None,
            score: 0,
        }],
        "AO" => vec![
            VowelScore {
                jung: "ㅗ",
                add_jong: None,
                score: 0,
            },
            VowelScore {
                jung: "ㅓ",
                add_jong: None,
                score: 1,
            },
        ],
        "OW" => vec![VowelScore {
            jung: "ㅗ",
            add_jong: None,
            score: 0,
        }],
        "UH" => vec![
            VowelScore {
                jung: "ㅜ",
                add_jong: None,
                score: 0,
            },
            VowelScore {
                jung: "ㅓ",
                add_jong: None,
                score: 2,
            },
        ],
        "UW" => vec![VowelScore {
            jung: "ㅜ",
            add_jong: None,
            score: 0,
        }],
        "ER" => vec![
            VowelScore {
                jung: "ㅓ",
                add_jong: None,
                score: 0,
            },
            VowelScore {
                jung: "ㅓ",
                add_jong: Some("ㄹ"),
                score: 1,
            },
        ],
        "AY" | "AW" => vec![
            VowelScore {
                jung: "ㅏ",
                add_jong: None,
                score: 0,
            },
            VowelScore {
                jung: if vowel == "AY" { "ㅐ" } else { "ㅗ" },
                add_jong: None,
                score: 2,
            },
        ],
        "OY" => vec![VowelScore {
            jung: "ㅗ",
            add_jong: None,
            score: 0,
        }],
        _ => vec![VowelScore {
            jung: "ㅡ",
            add_jong: None,
            score: 5,
        }],
    }
}

static CHO: &[&str] = &[
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ",
    "ㅌ", "ㅍ", "ㅎ",
];
static JUNG: &[&str] = &[
    "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ",
    "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
];
static JONG: &[&str] = &[
    "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ",
    "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

fn compose_hangul(cho: &str, jung: &str, jong: &str) -> String {
    let ci = CHO.iter().position(|x| *x == cho).unwrap_or(11);
    let ji = JUNG.iter().position(|x| *x == jung).unwrap_or(18);
    let normalized_jong = normalize_jong(jong);
    let gi = JONG.iter().position(|x| *x == normalized_jong).unwrap_or(0);
    char::from_u32(0xac00 + ((ci * 21 + ji) * 28 + gi) as u32)
        .unwrap()
        .to_string()
}

fn normalize_jong(jong: &str) -> &str {
    match jong {
        "" => "",
        j if JONG.contains(&j) => j,
        "ㅋ" => "ㄱ",
        "ㅌ" => "ㄷ",
        "ㅍ" => "ㅂ",
        _ => "",
    }
}

fn pick_jong<'a>(first: &'a str, second: Option<&'a str>) -> &'a str {
    normalize_jong(if !first.is_empty() {
        first
    } else {
        second.unwrap_or("")
    })
}

fn normalize_input(input: &str) -> String {
    let chars: Vec<char> = input.to_lowercase().chars().collect();
    let mut out = String::new();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];
        if ch == '-' {
            let prev_is_alpha = i > 0 && chars[i - 1].is_ascii_lowercase();
            let next_is_alpha = i + 1 < chars.len() && chars[i + 1].is_ascii_lowercase();
            if prev_is_alpha && next_is_alpha {
                i += 1;
                continue;
            }
            out.push(' ');
        } else if ch == '_' || ch == '\'' {
            // Drop.
        } else if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch.is_whitespace() {
            out.push(ch);
        } else {
            out.push(' ');
        }
        i += 1;
    }

    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn dedupe_by_text(items: Vec<Cand>) -> Vec<Cand> {
    let mut best: HashMap<String, Cand> = HashMap::new();
    for item in items {
        match best.get(&item.text) {
            Some(prev) if prev.score <= item.score => {}
            _ => {
                best.insert(item.text.clone(), item);
            }
        }
    }
    best.into_values().collect()
}

fn combine_beams(left: &[Cand], right: &[Cand], limit: usize) -> Vec<Cand> {
    let mut combined = Vec::new();
    for a in left {
        for b in right {
            combined.push(Cand {
                text: format!("{}{}", a.text, b.text),
                score: a.score + b.score,
            });
        }
    }
    take_top_k(combined, limit)
}

fn take_top_k(mut items: Vec<Cand>, k: usize) -> Vec<Cand> {
    items.sort_by_key(|x| x.score);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for item in items {
        if !seen.insert(item.text.clone()) {
            continue;
        }
        out.push(item);
        if out.len() >= k {
            break;
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_pretender() {
        assert_eq!(latin_to_hangul_default("pretender"), "프리텐더");
    }

    #[test]
    fn preserves_special_chars() {
        assert_eq!(latin_to_hangul_default("(pretender!)"), "(프리텐더!)");
    }

    #[test]
    fn dictionary_override() {
        let mut dictionary = Dictionary::new();
        dictionary.insert("codex".to_string(), vec!["코덱스".to_string()]);
        let options = LatinToHangulOptions {
            dictionary,
            ..Default::default()
        };

        assert_eq!(latin_to_hangul("codex", Some(&options)), "코덱스");
    }

    #[test]
    fn konglish_merges_dictionary_override() {
        let mut dictionary = Dictionary::new();
        dictionary.insert("latte".to_string(), vec!["라떼".to_string()]);
        dictionary.insert("meetup".to_string(), vec!["밋업".to_string()]);

        let konglish = Konglish::new(LatinToHangulOptions {
            dictionary,
            ..Default::default()
        });

        let out = konglish.latin_to_hangul("latte meetup xylophone", None);
        assert!(out.starts_with("라떼 밋업"));
    }
}

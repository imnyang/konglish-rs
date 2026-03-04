import { dictionary as CMU } from "cmu-pronouncing-dictionary";
import { customDictionary } from "./dictionary";

type Cand = { text: string; score: number };
type Token = { type: "word" | "other"; text: string };

export type LatinToHangulOptions = {
  dictionary?: Record<string, string[]>;
  beamWidth?: number;
  enableFallbackPhones?: boolean;
};

type InternalOptions = {
  limit: number;
  beamWidth: number;
  enableFallbackPhones: boolean;
  dictionaryOverride?: Record<string, string[]>;
};

const DEFAULT_BEAM_WIDTH = 8;

export function latinToHangul(
  input: string,
  options?: LatinToHangulOptions,
): string {
  // 전체 입력을 사전에서 먼저 조회
  const fullKey = input.trim().toLowerCase();
  const userFullHit = options?.dictionary?.[fullKey];
  if (userFullHit && userFullHit.length > 0) return userFullHit[0];
  const builtInFullHit = customDictionary[fullKey as keyof typeof customDictionary];
  if (builtInFullHit && builtInFullHit.length > 0) return builtInFullHit[0];

  const resolved = resolveOptions(options, 1);
  const tokens = tokenizePreservingSpecialChars(input);
  const [best] = transliterateTokens(tokens, resolved);
  return best ?? input;
}

function tokenizePreservingSpecialChars(input: string): Token[] {
  const tokens: Token[] = [];
  const regex = /([a-zA-Z]+)|([^a-zA-Z]+)/g;
  while (true) {
    const match = regex.exec(input);
    if (!match) break;
    if (match[1]) tokens.push({ type: "word", text: match[1] });
    else if (match[2]) tokens.push({ type: "other", text: match[2] });
  }
  return tokens;
}

function resolveOptions(
  options: LatinToHangulOptions | undefined,
  limit: number,
): InternalOptions {
  const desiredBeam = options?.beamWidth ?? DEFAULT_BEAM_WIDTH;
  return {
    limit,
    beamWidth: Math.max(desiredBeam, limit, DEFAULT_BEAM_WIDTH),
    enableFallbackPhones: options?.enableFallbackPhones ?? true,
    dictionaryOverride: options?.dictionary,
  };
}

function transliterateTokens(
  tokens: Token[],
  options: InternalOptions,
): string[] {
  const wordTokens = tokens.filter((t) => t.type === "word");
  if (wordTokens.length === 0) return [];

  const combinedWords = wordTokens.map((t) => t.text).join(" ");
  const candidates = buildWordCandidates(combinedWords, options);
  if (candidates.length === 0) return [];

  return candidates.map((cand) => applyCandidateToTokens(tokens, cand));
}

function applyCandidateToTokens(tokens: Token[], candidate: string): string {
  const candWords = candidate.split(" ");
  let candIdx = 0;
  return tokens
    .map((token) => {
      if (token.type === "word") {
        const next = candWords[candIdx];
        candIdx += 1;
        return next ?? token.text;
      }
      return token.text;
    })
    .join("");
}

function buildWordCandidates(
  input: string,
  options: InternalOptions,
): string[] {
  const text = normalizeInput(input);
  if (!text) return [];

  const words = text.split(/\s+/).filter(Boolean);
  const { beamWidth, limit } = options;

  let beam: Cand[] = [{ text: "", score: 0 }];

  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];

    // Stage 1) Custom dictionary
    const override = overrideCandidates(w, options.dictionaryOverride).map(
      (s, i) => ({ text: s, score: i }),
    );

    // Stage 2) CMUdict
    const phones = cmuLookupPhones(w);
    const dictCands = phones
      ? arpabetToKoCandidates(phones, beamWidth).map((s, i) => ({
          text: s,
          score: 100 + i,
        }))
      : [];

    // Stage 3) Fallback phones (G2P-ish rules)
    const fb =
      phones || !options.enableFallbackPhones ? null : fallbackPhones(w);
    const fbCands = fb
      ? arpabetToKoCandidates(fb, beamWidth).map((s, i) => ({
          text: s,
          score: 200 + i,
        }))
      : [];

    const wordBeam = takeTopK(
      dedupeByText([...override, ...dictCands, ...fbCands]),
      beamWidth,
    );
    beam = combineBeams(beam, wordBeam, beamWidth);

    if (wi !== words.length - 1)
      beam = beam.map((x) => ({ text: `${x.text} `, score: x.score }));
  }

  beam.sort((a, b) => a.score - b.score);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of beam) {
    const s = x.text.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/* -------------------------------- Stage 1: Custom dictionary -------------------------------- */

function overrideCandidates(
  word: string,
  overrides?: Record<string, string[]>,
): string[] {
  const key = word.toLowerCase();
  const userHit = overrides?.[key];
  if (userHit && userHit.length > 0) return userHit.map(String);

  const builtIn = customDictionary[key as keyof typeof customDictionary];
  if (!builtIn || builtIn.length === 0) return [];
  return builtIn.map(String);
}

/* -------------------------------- Stage 2: CMUdict -------------------------------- */

function cmuLookupPhones(word: string): string[] | null {
  if (!CMU) return null;
  const key = word.toUpperCase();
  const raw = CMU[key] ?? CMU[`${key}(1)`] ?? CMU[`${key}(2)`];
  if (!raw || typeof raw !== "string") return null;
  return raw
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[0-9]/g, ""))
    .filter(Boolean);
}

/* -------------------------------- Stage 3: Fallback phones -------------------------------- */

function fallbackPhones(word: string): string[] | null {
  const w = word.toLowerCase();
  const phones: string[] = [];
  let i = 0;

  if (/^pre[bcdfghjklmnpqrstvwxyz]/.test(w)) {
    phones.push("P", "R", "IY");
    i = 3;
  }

  while (i < w.length) {
    const rest = w.slice(i);

    if (rest.startsWith("er")) { phones.push("ER"); i += 2; continue; }
    if (rest.startsWith("ir")) { phones.push("ER"); i += 2; continue; }
    if (rest.startsWith("ur")) { phones.push("ER"); i += 2; continue; }
    if (rest.startsWith("ch")) { phones.push("CH"); i += 2; continue; }
    if (rest.startsWith("sh")) { phones.push("SH"); i += 2; continue; }
    if (rest.startsWith("th")) { phones.push("TH"); i += 2; continue; }
    if (rest.startsWith("ng")) { phones.push("NG"); i += 2; continue; }
    if (rest.startsWith("qu")) { phones.push("K", "W"); i += 2; continue; }

    const c = rest[0];
    if ("aeiouy".includes(c)) phones.push(vowelToArpabet(c));
    else if (/[a-z]/.test(c)) phones.push(consToArpabet(c));
    i += 1;
  }

  return phones.length ? phones : null;
}

function vowelToArpabet(ch: string): string {
  switch (ch) {
    case "a": return "AE";
    case "e": return "EH";
    case "i": return "IY";
    case "o": return "OW";
    case "u": return "UW";
    case "y": return "IY";
    default: return "AH";
  }
}

function consToArpabet(ch: string): string {
  switch (ch) {
    case "b": return "B";
    case "c": return "K";
    case "d": return "D";
    case "f": return "F";
    case "g": return "G";
    case "h": return "HH";
    case "j": return "JH";
    case "k": return "K";
    case "l": return "L";
    case "m": return "M";
    case "n": return "N";
    case "p": return "P";
    case "q": return "K";
    case "r": return "R";
    case "s": return "S";
    case "t": return "T";
    case "v": return "V";
    case "w": return "W";
    case "x": return "K";
    case "z": return "Z";
    default: return "HH";
  }
}

/* -------------------------------- ARPAbet -> KO -------------------------------- */

const VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY",
  "IH", "IY", "OW", "OY", "UH", "UW", "AX",
]);

function arpabetToKoCandidates(phones: string[], limit: number): string[] {
  if (!phones.length) return [];
  const syllables = syllabifyArpabet(phones);

  let beam: Cand[] = [{ text: "", score: 0 }];
  for (const syl of syllables) {
    const sylBeam = buildKoSyllableCandidates(syl, limit);
    beam = combineBeams(beam, sylBeam, limit);
  }

  beam.sort((a, b) => a.score - b.score);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of beam) {
    if (seen.has(x.text)) continue;
    seen.add(x.text);
    out.push(x.text);
    if (out.length >= limit) break;
  }
  return out;
}

type Syll = { onset: string[]; vowel: string; coda: string[] };

function syllabifyArpabet(phones: string[]): Syll[] {
  const out: Syll[] = [];
  let onset: string[] = [];
  let vowel: string | null = null;
  let coda: string[] = [];

  const flush = () => {
    if (vowel) out.push({ onset, vowel, coda });
    onset = [];
    vowel = null;
    coda = [];
  };

  for (const p of phones) {
    if (VOWELS.has(p)) {
      if (vowel) flush();
      vowel = p;
    } else {
      if (!vowel) onset.push(p);
      else coda.push(p);
    }
  }
  flush();

  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i];
    const nxt = out[i + 1];
    if (cur.coda.length > 0 && nxt.onset.length === 0) {
      const moved = cur.coda.pop();
      if (moved) nxt.onset.unshift(moved);
    }
  }

  return out;
}

function buildKoSyllableCandidates(
  { onset, vowel, coda }: Syll,
  limit: number,
): Cand[] {
  let beam: Cand[] = [{ text: "", score: 0 }];

  if (onset.length > 1) {
    const prefix = onset.slice(0, onset.length - 1);
    for (const p of prefix) {
      const prefixBeam = consMap(p).map((x) => ({
        text: composeHangul(x.cho, "ㅡ", ""),
        score: x.score + 3,
      }));
      beam = combineBeams(beam, prefixBeam, limit);
    }
  }

  const mainOnset = onset.length === 0 ? null : onset[onset.length - 1];
  const onsetCands = mainOnset ? consMap(mainOnset) : [{ cho: "ㅇ", score: 0 }];
  const vowelCands = vowelMap(vowel);
  const codaFirst = coda.length ? coda[0] : null;
  const codaCands = codaFirst
    ? consToJongMap(codaFirst)
    : [{ jong: "", score: 0 }];

  const main: Cand[] = [];
  for (const o of onsetCands) {
    for (const v of vowelCands) {
      for (const cd of codaCands) {
        const jong = pickJong(cd.jong, v.addJong);
        main.push({
          text: composeHangul(o.cho, v.jung, jong),
          score: o.score + v.score + cd.score + (v.addJong ? 1 : 0),
        });
      }
    }
  }

  beam = combineBeams(beam, takeTopK(main, limit), limit);

  if (coda.length > 1) {
    for (const extra of coda.slice(1)) {
      const extraBeam = consMap(extra).map((x) => ({
        text: composeHangul(x.cho, "ㅡ", ""),
        score: 4 + x.score,
      }));
      beam = combineBeams(beam, extraBeam, limit);
    }
  }

  return takeTopK(beam, limit);
}

/* -------------------------------- Mapping tables -------------------------------- */

function consMap(p: string): Array<{ cho: string; score: number }> {
  switch (p) {
    case "P":  return [{ cho: "ㅍ", score: 0 }];
    case "B":  return [{ cho: "ㅂ", score: 0 }];
    case "T":  return [{ cho: "ㅌ", score: 0 }];
    case "D":  return [{ cho: "ㄷ", score: 0 }];
    case "K":  return [{ cho: "ㅋ", score: 0 }, { cho: "ㄱ", score: 1 }];
    case "G":  return [{ cho: "ㄱ", score: 0 }, { cho: "ㅋ", score: 1 }];
    case "F":  return [{ cho: "ㅍ", score: 0 }];
    case "V":  return [{ cho: "ㅂ", score: 0 }];
    case "S":  return [{ cho: "ㅅ", score: 0 }];
    case "Z":  return [{ cho: "ㅈ", score: 0 }];
    case "JH": return [{ cho: "ㅈ", score: 0 }];
    case "CH": return [{ cho: "ㅊ", score: 0 }];
    case "SH": return [{ cho: "ㅅ", score: 0 }];
    case "HH": return [{ cho: "ㅎ", score: 0 }];
    case "M":  return [{ cho: "ㅁ", score: 0 }];
    case "N":  return [{ cho: "ㄴ", score: 0 }];
    case "NG": return [{ cho: "ㅇ", score: 0 }];
    case "L":
    case "R":  return [{ cho: "ㄹ", score: 0 }];
    case "W":
    case "Y":  return [{ cho: "ㅇ", score: 2 }];
    case "TH": return [{ cho: "ㅅ", score: 0 }, { cho: "ㄷ", score: 2 }];
    case "DH": return [{ cho: "ㄷ", score: 0 }];
    default:   return [{ cho: "ㅇ", score: 5 }];
  }
}

function consToJongMap(p: string): Array<{ jong: string; score: number }> {
  const mk = (jong: string, score = 0) => ({ jong, score });
  switch (p) {
    case "P": case "B": case "F": case "V": return [mk("ㅂ")];
    case "T": case "D": case "S": case "Z": case "JH": case "CH": return [mk("ㄷ")];
    case "K": case "G": return [mk("ㄱ")];
    case "M":  return [mk("ㅁ")];
    case "N":  return [mk("ㄴ")];
    case "NG": return [mk("ㅇ")];
    case "L": case "R": return [mk("ㄹ")];
    case "HH": return [mk("ㅎ")];
    default:   return [mk("")];
  }
}

function vowelMap(
  v: string,
): Array<{ jung: string; addJong?: string; score: number }> {
  switch (v) {
    case "IY": return [{ jung: "ㅣ", score: 0 }];
    case "IH": return [{ jung: "ㅣ", score: 0 }];
    case "EH": return [{ jung: "ㅔ", score: 0 }];
    case "AE": return [{ jung: "ㅐ", score: 0 }];
    case "AA": return [{ jung: "ㅏ", score: 0 }];
    case "AH": return [{ jung: "ㅓ", score: 0 }];
    case "AO": return [{ jung: "ㅗ", score: 0 }, { jung: "ㅓ", score: 1 }];
    case "OW": return [{ jung: "ㅗ", score: 0 }];
    case "UH": return [{ jung: "ㅜ", score: 0 }, { jung: "ㅓ", score: 2 }];
    case "UW": return [{ jung: "ㅜ", score: 0 }];
    case "ER": return [{ jung: "ㅓ", score: 0 }, { jung: "ㅓ", addJong: "ㄹ", score: 1 }];
    case "EY": return [{ jung: "ㅔ", score: 0 }];
    case "AY": return [{ jung: "ㅏ", score: 0 }, { jung: "ㅐ", score: 2 }];
    case "AW": return [{ jung: "ㅏ", score: 0 }, { jung: "ㅗ", score: 2 }];
    case "OY": return [{ jung: "ㅗ", score: 0 }];
    default:   return [{ jung: "ㅡ", score: 5 }];
  }
}

/* -------------------------------- Hangul compose -------------------------------- */

const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"] as const;
const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"] as const;
const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"] as const;

const choIndex = new Map<string, number>(CHO.map((c, i) => [c, i]));
const jungIndex = new Map<string, number>(JUNG.map((c, i) => [c, i]));
const jongIndex = new Map<string, number>(JONG.map((c, i) => [c, i]));

function composeHangul(cho: string, jung: string, jong = ""): string {
  const ci = choIndex.get(cho) ?? choIndex.get("ㅇ") ?? 11;
  const ji = jungIndex.get(jung) ?? jungIndex.get("ㅡ") ?? 18;
  const gi = jongIndex.get(normalizeJong(jong)) ?? 0;
  return String.fromCharCode(0xac00 + (ci * 21 + ji) * 28 + gi);
}

function normalizeJong(j: string): string {
  if (!j) return "";
  if (jongIndex.has(j)) return j;
  if (j === "ㅋ") return "ㄱ";
  if (j === "ㅌ") return "ㄷ";
  if (j === "ㅍ") return "ㅂ";
  return "";
}

function pickJong(j1?: string, j2?: string): string {
  return normalizeJong(j1 || j2 || "");
}

/* -------------------------------- Beam + Utils -------------------------------- */

function normalizeInput(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/([a-z])[-]+([a-z])/g, "$1$2")
    .replace(/[^a-z0-9\s\-_'']/g, " ")
    .replace(/[_'']/g, "")
    .replace(/-/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dedupeByText(arr: Cand[]): Cand[] {
  const best = new Map<string, Cand>();
  for (const x of arr) {
    const prev = best.get(x.text);
    if (!prev || x.score < prev.score) best.set(x.text, x);
  }
  return [...best.values()];
}

function combineBeams(left: Cand[], right: Cand[], limit: number): Cand[] {
  const combined: Cand[] = [];
  for (const a of left) {
    for (const b of right) {
      combined.push({ text: a.text + b.text, score: a.score + b.score });
    }
  }
  return takeTopK(combined, limit);
}

function takeTopK(arr: Cand[], k: number): Cand[] {
  arr.sort((a, b) => a.score - b.score);
  const out: Cand[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    if (seen.has(x.text)) continue;
    seen.add(x.text);
    out.push(x);
    if (out.length >= k) break;
  }
  return out;
}

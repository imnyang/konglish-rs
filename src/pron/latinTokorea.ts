// latin-to-ko.js (ESM)
// npm i cmu-pronouncing-dictionary  (선택)
// - 설치되어 있으면 CMUdict로 ARPAbet을 얻고 → 한글 후보 생성
// - 없으면 간단 룰(tokenize+vowel split)로 fallback
import { dictionary as CMU } from "cmu-pronouncing-dictionary";
import { customDictionary } from "./dictionary";

type Cand = { text: string; score: number };
type CandidatesOptions = { limit?: number };

export function latinToKo(input: string): string {
  // 영어 단어와 비영어 부분을 분리하여 영어만 변환, 특수문자는 보존
  const tokens = tokenizePreservingSpecialChars(input);
  const result = tokens
    .map((token) => {
      if (token.type === "word") {
        const [best] = latinToKoCandidatesInternal(token.text, { limit: 1 });
        return best ?? token.text;
      }
      return token.text; // 특수문자/공백 등은 그대로
    })
    .join("");
  return result;
}

function tokenizePreservingSpecialChars(
  input: string,
): Array<{ type: "word" | "other"; text: string }> {
  const tokens: Array<{ type: "word" | "other"; text: string }> = [];
  const regex = /([a-zA-Z]+)|([^a-zA-Z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (match[1]) {
      tokens.push({ type: "word", text: match[1] });
    } else if (match[2]) {
      tokens.push({ type: "other", text: match[2] });
    }
  }
  return tokens;
}

export function latinToKoCandidates(
  input: string,
  { limit = 5 }: CandidatesOptions = {},
): string[] {
  // 특수문자 보존 버전 - 각 영어 단어를 개별 변환
  const tokens = tokenizePreservingSpecialChars(input);
  const wordTokens = tokens.filter((t) => t.type === "word");

  if (wordTokens.length === 0) return [];

  // 모든 단어를 하나의 문자열로 합쳐서 후보 생성
  const combinedWords = wordTokens.map((t) => t.text).join(" ");
  const candidates = latinToKoCandidatesInternal(combinedWords, { limit });

  // 특수문자를 포함한 결과 생성
  return candidates.map((cand) => {
    const candWords = cand.split(" ");
    let candIdx = 0;
    return tokens
      .map((token) => {
        if (token.type === "word" && candIdx < candWords.length) {
          return candWords[candIdx++];
        }
        return token.text;
      })
      .join("");
  });
}

function latinToKoCandidatesInternal(
  input: string,
  { limit = 5 }: CandidatesOptions = {},
): string[] {
  const text = normalizeInput(input);
  if (!text) return [];

  const words = text.split(/\s+/).filter(Boolean);

  let beam: Cand[] = [{ text: "", score: 0 }];

  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];

    // Stage 1) Override dictionary
    const override = overrideCandidates(w).map((s, i) => ({
      text: s,
      score: i,
    }));

    // Stage 2) CMUdict
    const phones = cmuLookupPhones(w);
    const dictCands = phones
      ? arpabetToKoCandidates(phones, Math.max(8, limit)).map((s, i) => ({
          text: s,
          score: 100 + i,
        }))
      : [];

    // Stage 3) Fallback phones (cheap G2P-ish rules)
    const fb = phones ? null : fallbackPhones(w);
    const fbCands = fb
      ? arpabetToKoCandidates(fb, Math.max(8, limit)).map((s, i) => ({
          text: s,
          score: 200 + i,
        }))
      : [];

    const wordBeam = takeTopK(
      dedupeByText([...override, ...dictCands, ...fbCands]),
      Math.max(8, limit),
    );
    beam = combineBeams(beam, wordBeam, Math.max(8, limit));

    if (wi !== words.length - 1)
      beam = beam.map((x) => ({ text: x.text + " ", score: x.score }));
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

/* -------------------------------- Stage 1: Override -------------------------------- */

function overrideCandidates(word: string): string[] {
  const key = word.toLowerCase();
  const hit = (customDictionary as any)[key];
  if (!hit) return [];
  if (Array.isArray(hit)) return hit.map(String);
  return [String(hit)];
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

// 검색 alias 목적의 저렴한 fallback. "0 후보 방지"용.
function fallbackPhones(word: string): string[] | null {
  const w = word.toLowerCase();
  const phones: string[] = [];
  let i = 0;

  // prefix heuristic: pre + C -> /pri/ 성향 (pretender, prevent, preview)
  if (/^pre[bcdfghjklmnpqrstvwxyz]/.test(w)) {
    phones.push("P", "R", "IY");
    i = 3;
  }

  while (i < w.length) {
    const rest = w.slice(i);

    // r-colored-ish
    if (rest.startsWith("er")) {
      phones.push("ER");
      i += 2;
      continue;
    }
    if (rest.startsWith("ir")) {
      phones.push("ER");
      i += 2;
      continue;
    }
    if (rest.startsWith("ur")) {
      phones.push("ER");
      i += 2;
      continue;
    }

    // digraphs
    if (rest.startsWith("ch")) {
      phones.push("CH");
      i += 2;
      continue;
    }
    if (rest.startsWith("sh")) {
      phones.push("SH");
      i += 2;
      continue;
    }
    if (rest.startsWith("th")) {
      phones.push("TH");
      i += 2;
      continue;
    }
    if (rest.startsWith("ng")) {
      phones.push("NG");
      i += 2;
      continue;
    }
    if (rest.startsWith("qu")) {
      phones.push("K", "W");
      i += 2;
      continue;
    }

    const c = rest[0];
    if ("aeiouy".includes(c)) phones.push(vowelToArpabet(c));
    else if (/[a-z]/.test(c)) phones.push(consToArpabet(c));

    i += 1;
  }

  return phones.length ? phones : null;
}

function vowelToArpabet(ch: string): string {
  switch (ch) {
    case "a":
      return "AE";
    case "e":
      return "EH";
    case "i":
      return "IY";
    case "o":
      return "OW";
    case "u":
      return "UW";
    case "y":
      return "IY";
    default:
      return "AH";
  }
}
function consToArpabet(ch: string): string {
  switch (ch) {
    case "b":
      return "B";
    case "c":
      return "K";
    case "d":
      return "D";
    case "f":
      return "F";
    case "g":
      return "G";
    case "h":
      return "HH";
    case "j":
      return "JH";
    case "k":
      return "K";
    case "l":
      return "L";
    case "m":
      return "M";
    case "n":
      return "N";
    case "p":
      return "P";
    case "q":
      return "K";
    case "r":
      return "R";
    case "s":
      return "S";
    case "t":
      return "T";
    case "v":
      return "V";
    case "w":
      return "W";
    case "x":
      return "K";
    case "z":
      return "Z";
    default:
      return "HH";
  }
}

/* -------------------------------- ARPAbet -> KO -------------------------------- */

const VOWELS = new Set([
  "AA",
  "AE",
  "AH",
  "AO",
  "AW",
  "AY",
  "EH",
  "ER",
  "EY",
  "IH",
  "IY",
  "OW",
  "OY",
  "UH",
  "UW",
  "AX",
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

  // ✅ 핵심: 다음 syllable onset이 비어있으면, 이전 coda의 마지막 자음을 1개 넘긴다
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

  // onset cluster: 앞 자음들은 'ㅡ'로 분절하고 마지막 자음만 실제 onset으로
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

  // 종성은 1개만(단순화). 나머지는 'ㅡ'로 풀어서 검색 폭만 확보
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

/* -------------------------------- mapping tables -------------------------------- */

function consMap(p: string): Array<{ cho: string; score: number }> {
  switch (p) {
    case "P":
      return [{ cho: "ㅍ", score: 0 }];
    case "B":
      return [{ cho: "ㅂ", score: 0 }];
    case "T":
      return [{ cho: "ㅌ", score: 0 }];
    case "D":
      return [{ cho: "ㄷ", score: 0 }];
    case "K":
      return [
        { cho: "ㅋ", score: 0 },
        { cho: "ㄱ", score: 1 },
      ];
    case "G":
      return [
        { cho: "ㄱ", score: 0 },
        { cho: "ㅋ", score: 1 },
      ];
    case "F":
      return [{ cho: "ㅍ", score: 0 }];
    case "V":
      return [{ cho: "ㅂ", score: 0 }];
    case "S":
      return [{ cho: "ㅅ", score: 0 }];
    case "Z":
      return [{ cho: "ㅈ", score: 0 }];
    case "JH":
      return [{ cho: "ㅈ", score: 0 }];
    case "CH":
      return [{ cho: "ㅊ", score: 0 }];
    case "SH":
      return [{ cho: "ㅅ", score: 0 }];
    case "HH":
      return [{ cho: "ㅎ", score: 0 }];
    case "M":
      return [{ cho: "ㅁ", score: 0 }];
    case "N":
      return [{ cho: "ㄴ", score: 0 }];
    case "NG":
      return [{ cho: "ㅇ", score: 0 }];
    case "L":
    case "R":
      return [{ cho: "ㄹ", score: 0 }];
    case "W":
    case "Y":
      return [{ cho: "ㅇ", score: 2 }]; // 대충 처리
    case "TH":
      return [
        { cho: "ㅅ", score: 0 },
        { cho: "ㄷ", score: 2 },
      ];
    case "DH":
      return [{ cho: "ㄷ", score: 0 }];
    default:
      return [{ cho: "ㅇ", score: 5 }];
  }
}

function consToJongMap(p: string): Array<{ jong: string; score: number }> {
  const mk = (jong: string, score = 0) => ({ jong, score });
  switch (p) {
    case "P":
    case "B":
    case "F":
    case "V":
      return [mk("ㅂ")];
    case "T":
    case "D":
    case "S":
    case "Z":
    case "JH":
    case "CH":
      return [mk("ㄷ")];
    case "K":
    case "G":
      return [mk("ㄱ")];
    case "M":
      return [mk("ㅁ")];
    case "N":
      return [mk("ㄴ")];
    case "NG":
      return [mk("ㅇ")];
    case "L":
    case "R":
      return [mk("ㄹ")];
    case "HH":
      return [mk("ㅎ")];
    default:
      return [mk("")];
  }
}

function vowelMap(
  v: string,
): Array<{ jung: string; addJong?: string; score: number }> {
  // 검색 alias 목적: 후보 1~2개만.
  switch (v) {
    case "IY":
      return [{ jung: "ㅣ", score: 0 }];
    case "IH":
      return [{ jung: "ㅣ", score: 0 }];
    case "EH":
      return [{ jung: "ㅔ", score: 0 }];
    case "AE":
      return [{ jung: "ㅐ", score: 0 }];
    case "AA":
      return [{ jung: "ㅏ", score: 0 }];
    case "AH":
      return [{ jung: "ㅓ", score: 0 }];
    case "AO":
      return [
        { jung: "ㅗ", score: 0 },
        { jung: "ㅓ", score: 1 },
      ];
    case "OW":
      return [{ jung: "ㅗ", score: 0 }];
    case "UH":
      return [
        { jung: "ㅜ", score: 0 },
        { jung: "ㅓ", score: 2 },
      ];
    case "UW":
      return [{ jung: "ㅜ", score: 0 }];
    case "ER":
      // "더" vs "덜" 같이 폭을 주면 검색 리콜이 좋아짐
      return [
        { jung: "ㅓ", score: 0 },
        { jung: "ㅓ", addJong: "ㄹ", score: 1 },
      ];
    case "EY":
      return [{ jung: "ㅔ", score: 0 }];
    case "AY":
      return [
        { jung: "ㅏ", score: 0 },
        { jung: "ㅐ", score: 2 },
      ];
    case "AW":
      return [
        { jung: "ㅏ", score: 0 },
        { jung: "ㅗ", score: 2 },
      ];
    case "OY":
      return [{ jung: "ㅗ", score: 0 }];
    default:
      return [{ jung: "ㅡ", score: 5 }];
  }
}

/* -------------------------------- Hangul compose -------------------------------- */

const CHO = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;
const JUNG = [
  "ㅏ",
  "ㅐ",
  "ㅑ",
  "ㅒ",
  "ㅓ",
  "ㅔ",
  "ㅕ",
  "ㅖ",
  "ㅗ",
  "ㅘ",
  "ㅙ",
  "ㅚ",
  "ㅛ",
  "ㅜ",
  "ㅝ",
  "ㅞ",
  "ㅟ",
  "ㅠ",
  "ㅡ",
  "ㅢ",
  "ㅣ",
] as const;
const JONG = [
  "",
  "ㄱ",
  "ㄲ",
  "ㄳ",
  "ㄴ",
  "ㄵ",
  "ㄶ",
  "ㄷ",
  "ㄹ",
  "ㄺ",
  "ㄻ",
  "ㄼ",
  "ㄽ",
  "ㄾ",
  "ㄿ",
  "ㅀ",
  "ㅁ",
  "ㅂ",
  "ㅄ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

const choIndex = new Map<string, number>(CHO.map((c, i) => [c, i]));
const jungIndex = new Map<string, number>(JUNG.map((c, i) => [c, i]));
const jongIndex = new Map<string, number>(JONG.map((c, i) => [c, i]));

function composeHangul(cho: string, jung: string, jong = ""): string {
  const ci = choIndex.get(cho) ?? choIndex.get("ㅇ")!;
  const ji = jungIndex.get(jung) ?? jungIndex.get("ㅡ")!;
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
  return (
    String(s)
      .toLowerCase()
      // 1) 단어 내부 하이픈: abc-def => abcdef
      .replace(/([a-z])[-]+([a-z])/g, "$1$2")
      // 2) 그 외 문자는 공백으로
      .replace(/[^a-z0-9\s\-_'’]/g, " ")
      // 3) apostrophe 제거
      .replace(/[_'’]/g, "")
      // 4) 남은 하이픈은 구분자 취급(공백)
      .replace(/-/g, " ")
      .trim()
      .replace(/\s+/g, " ")
  );
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

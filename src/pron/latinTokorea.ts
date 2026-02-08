import { customDictionary } from "./dictionary";

type Token = { type: "word" | "other"; text: string };

export type LatinToHangulOptions = {
  /**
   * 단어 사전
   * - key: 라틴 단어
   * - value: 후보 한글 발음 배열(첫 번째 사용)
   */
  dictionary?: Record<string, string[]>;

  // infer: 추론 함수, 성공 시 토큰, 실패 시 null
  infer?: (word: string) => Promise<string | null>;
};

const normalize = (s: string) => s.trim().toLowerCase();

function tokenizePreservingSpecialChars(input: string): Token[] {
  const tokens: Token[] = [];
  const regex = /([a-zA-Z]+)|([^a-zA-Z]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match[1]) tokens.push({ type: "word", text: match[1] });
    else if (match[2]) tokens.push({ type: "other", text: match[2] });
  }
  return tokens;
}

function mergeDict(user?: Record<string, string[]>): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = { ...customDictionary };
  if (!user) return out;

  for (const [k, v] of Object.entries(user)) {
    const key = normalize(k);
    if (!key) continue;
    if (!Array.isArray(v) || v.length === 0) continue;
    out[key] = v;
  }
  return out;
}

function dictLookup(dict: Record<string, readonly string[]>, word: string): string | null {
  const key = normalize(word);
  const v = dict[key];
  return v && v.length > 0 ? v[0] : null;
}


export function latinToHangul(input: string, options?: LatinToHangulOptions): string {
  const dict = mergeDict(options?.dictionary);
  const tokens = tokenizePreservingSpecialChars(input);

  let out = "";
  for (const t of tokens) {
    if (t.type === "other") {
      out += t.text;
      continue;
    }

    const hit = dictLookup(dict, t.text);
    out += hit ?? t.text;
  }
  return out;
}

export async function latinToHangulAsync(
  input: string,
  options?: LatinToHangulOptions,
): Promise<string> {
  const dict = mergeDict(options?.dictionary);
  const infer = options?.infer;
  const tokens = tokenizePreservingSpecialChars(input);

  // infer가 없으면 sync와 동일 동작
  if (!infer) return latinToHangul(input, options);

  let out = "";
  for (const t of tokens) {
    if (t.type === "other") {
      out += t.text;
      continue;
    }

    const hit = dictLookup(dict, t.text);
    if (hit) {
      out += hit;
      continue;
    }

    // dict에 없을 시 infer 함수 동작
    const pred = await infer(t.text);
    out += pred ?? t.text;
  }
  return out;
}

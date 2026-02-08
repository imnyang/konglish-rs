import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.resolve(ROOT, "src/pron/dictionary.json");
const OUT = path.resolve(ROOT, "src/pron/dictionary.generated.ts");

const normalize = (s) => String(s).trim().toLowerCase();

const json = JSON.parse(fs.readFileSync(SRC, "utf8"));

const dict = {};
for (const [k, v] of Object.entries(json ?? {})) {
  const key = normalize(k);
  if (!key) continue;

  if (Array.isArray(v)) {
    const arr = v.map(String).filter((x) => x.length > 0);
    if (arr.length) dict[key] = arr;
  } else if (typeof v === "string") {
    const s = v.trim();
    if (s) dict[key] = [s];
  }
}

const out = `/* AUTO-GENERATED. DO NOT EDIT */
export const DEFAULT_DICTIONARY: Record<string, readonly string[]> =
${JSON.stringify(dict, null, 2)} as const;
`;

fs.writeFileSync(OUT, out, "utf8");
console.log(`[dict] generated (${Object.keys(dict).length} entries)`);

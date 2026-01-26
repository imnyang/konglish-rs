/**
 * 두 사전 파일(dictionary.ts, customDictionaryPlus.ts)을 병합하여
 * customDictionary.ts 파일을 생성하는 스크립트
 *
 * - 키 이름 오름차순 정렬
 * - 같은 키가 두 파일에 있으면 배열을 합치고 중복 제거
 * - 각 배열 내 값의 순서는 유지 (먼저 나온 것 우선)
 */

// pnpm ts-node src/pron/script/mergeDictionaries.ts
// pnpm ts-node src/pron/script/mergeDictionaries.ts --dry-run

import * as fs from "fs";
import * as path from "path";
import { customDictionary as dictionaryA } from "../dictionary";
import { customDictionary as dictionaryB } from "./customDictionaryPlus";

const isDryRun = process.argv.includes("--dry-run");

function mergeDictionaries(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};

  // 모든 키 수집
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  // 키별로 병합
  for (const key of allKeys) {
    const valuesA = a[key] ?? [];
    const valuesB = b[key] ?? [];

    // 배열 합치고 중복 제거 (순서 유지)
    const combined: string[] = [];
    for (const v of [...valuesA, ...valuesB]) {
      if (!combined.includes(v)) {
        combined.push(v);
      }
    }
    merged[key] = combined;
  }

  // 키 이름 오름차순 정렬
  const sortedKeys = Object.keys(merged).sort((a, b) => a.localeCompare(b));
  const sorted: Record<string, string[]> = {};
  for (const key of sortedKeys) {
    sorted[key] = merged[key];
  }

  return sorted;
}

function generateFileContent(dict: Record<string, string[]>): string {
  const lines: string[] = [];
  lines.push("export const customDictionary: Record<string, string[]> = {");

  for (const [key, values] of Object.entries(dict)) {
    const valuesStr = values.map((v) => `"${v}"`).join(", ");
    lines.push(`  ${key}: [${valuesStr}],`);
  }

  lines.push("};");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  console.log("📚 사전 병합 시작...\n");

  const merged = mergeDictionaries(dictionaryA, dictionaryB);

  const keysA = Object.keys(dictionaryA).length;
  const keysB = Object.keys(dictionaryB).length;
  const keysMerged = Object.keys(merged).length;

  console.log(`📖 dictionary.ts: ${keysA}개 키`);
  console.log(`📖 customDictionaryPlus.ts: ${keysB}개 키`);
  console.log(`📖 병합 결과: ${keysMerged}개 키`);
  console.log(`📖 중복 키: ${keysA + keysB - keysMerged}개\n`);

  // 중복 키 목록 출력
  const duplicateKeys = Object.keys(dictionaryA).filter(
    (key) => key in dictionaryB,
  );
  if (duplicateKeys.length > 0) {
    console.log("🔄 중복 키 목록:");
    for (const key of duplicateKeys) {
      const valuesA = dictionaryA[key];
      const valuesB = dictionaryB[key];
      const mergedValues = merged[key];
      console.log(`  ${key}: [${valuesA}] + [${valuesB}] → [${mergedValues}]`);
    }
    console.log("");
  }

  const content = generateFileContent(merged);
  const outputPath = path.join(__dirname, "dictionary.ts");

  if (isDryRun) {
    console.log("🔍 [DRY-RUN] 생성될 파일 미리보기 (처음 30줄):\n");
    const previewLines = content.split("\n").slice(0, 30);
    console.log(previewLines.join("\n"));
    console.log("...\n");
    console.log(`🔍 [DRY-RUN] 파일이 생성되지 않았습니다: ${outputPath}`);
  } else {
    fs.writeFileSync(outputPath, content, "utf-8");
    console.log(`✅ 파일 생성 완료: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error("❌ 오류 발생:", error);
  process.exit(1);
});

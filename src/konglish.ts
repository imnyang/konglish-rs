import {
  type LatinToHangulOptions,
  latinToHangul,
} from "./pron/latinTokorea";

function mergeOptions(
  base?: LatinToHangulOptions,
  override?: LatinToHangulOptions,
): LatinToHangulOptions | undefined {
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Konglish - 라틴 문자 → 한국어 발음 변환기
 *
 * 기본 옵션을 주입한 뒤 인스턴스 단위로 재사용할 수 있습니다.
 */
export class Konglish {
  constructor(private readonly defaultOptions: LatinToHangulOptions = {}) {}

  latinToHangul(input: string, options?: LatinToHangulOptions): string {
    return latinToHangul(input, mergeOptions(this.defaultOptions, options));
  }

}

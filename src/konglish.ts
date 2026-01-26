import { type LatinToHangulOptions, latinToHangul } from "./pron/latinTokorea";

/**
 * Konglish - 라틴 문자 → 한국어 발음 변환기
 *
 * 기본 옵션을 주입한 뒤 인스턴스 단위로 재사용할 수 있습니다.
 */
export class Konglish {
  constructor(private readonly defaultOptions: LatinToHangulOptions = {}) {}

  latinToHangul(input: string, options?: LatinToHangulOptions): string {
    return latinToHangul(input, this.mergeBaseOptions(options));
  }

  private mergeBaseOptions(
    options?: LatinToHangulOptions,
  ): LatinToHangulOptions | undefined {
    if (!this.defaultOptions) return options;
    if (!options) return this.defaultOptions;
    return { ...this.defaultOptions, ...options };
  }
}

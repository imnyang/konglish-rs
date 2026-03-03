import {
  type LatinToHangulOptions,
  latinToHangul,
  latinToHangulAsync,
} from "./pron/latinTokorea";

export type KonglishAutoOptions = Omit<LatinToHangulOptions, "infer">;

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

  static auto(options: KonglishAutoOptions): Promise<KonglishAuto> {
    return KonglishAuto.create(options);
  }

  latinToHangul(input: string, options?: LatinToHangulOptions): string {
    return latinToHangul(input, mergeOptions(this.defaultOptions, options));
  }

  latinToHangulAsync(
    input: string,
    options?: LatinToHangulOptions,
  ): Promise<string> {
    return latinToHangulAsync(
      input,
      mergeOptions(this.defaultOptions, options),
    );
  }
}

export class KonglishAuto {
  private constructor(private readonly defaultOptions: LatinToHangulOptions) {}

  static async create(options: KonglishAutoOptions): Promise<KonglishAuto> {
    return new KonglishAuto(options);
  }

  async latinToHangul(
    input: string,
    options?: LatinToHangulOptions,
  ): Promise<string> {
    return latinToHangulAsync(input, mergeOptions(this.defaultOptions, options));
  }

  latinToHangulAsync(
    input: string,
    options?: LatinToHangulOptions,
  ): Promise<string> {
    return this.latinToHangul(input, options);
  }
}

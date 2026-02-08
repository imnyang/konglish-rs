import {
  type LatinToHangulOptions,
  latinToHangul,
  latinToHangulAsync,
} from "./pron/latinTokorea";
import { OnnxBeamEngine, type BeamEngineOptions } from "./pron/onnxBeamEngine";

/**
 * Konglish - 라틴 문자 → 한국어 발음 변환기
 *
 * 기본 옵션을 주입한 뒤 인스턴스 단위로 재사용할 수 있습니다.
 */
export class Konglish {
  private engineReady?: Promise<void>;

  constructor(
    private readonly defaultOptions: LatinToHangulOptions & {
      onnx?: BeamEngineOptions;
    } = {},
  ) {

    if (this.defaultOptions.onnx) {
      const engine = new OnnxBeamEngine(this.defaultOptions.onnx);

      this.engineReady = engine.init();

      this.defaultOptions = {
        ...this.defaultOptions,
        infer: async (word: string) => {
          await this.engineReady;
          return engine.predictWord(word);
        },
      };
    }
  }

  latinToHangul(input: string, options?: LatinToHangulOptions): string {
    return latinToHangul(input, this.mergeBaseOptions(options));
  }

  latinToHangulAsync(input: string, options?: LatinToHangulOptions): Promise<string> {
    return latinToHangulAsync(input, this.mergeBaseOptions(options));
  }

  private mergeBaseOptions(
    options?: LatinToHangulOptions,
  ): LatinToHangulOptions | undefined {
    if (!this.defaultOptions) return options;
    if (!options) return this.defaultOptions;
    return { ...this.defaultOptions, ...options };
  }
}

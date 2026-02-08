import { describe, test, expect } from "vitest";
import path from "node:path";
import { Konglish } from "./konglish";
import { OnnxBeamEngine } from "./pron/onnxBeamEngine";

describe("Konglish smoke", () => {
  test("sync vs async", async () => {
    const baseDir = path.resolve("model/onnx_export");
    const engine = new OnnxBeamEngine({ baseDir, beam: 3, maxOut: 64, alpha: 0.7, lowercase: true });

    const ready = engine.init();

    const k = new Konglish({
      dictionary: { latte: ["라떼"], meetup: ["밋업"] },
      infer: async (w: string) => {
        await ready;
        return engine.predictWord(w);
      },
    });

    const syncOut = k.latinToHangul("latte meetup xylophone");
    const asyncOut = await k.latinToHangulAsync("latte meetup xylophone");

    console.log(asyncOut)
    expect(syncOut.startsWith("라떼 밋업 xylophone")).toBe(true);
    expect(asyncOut.startsWith("라떼 밋업")).toBe(true);
  }, 20_000);
});

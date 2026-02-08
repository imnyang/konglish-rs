import * as fs from "node:fs";
import * as path from "node:path";
import * as ort from "onnxruntime-node";

type Vocab = {
  pad_id: number;
  sos_id: number;
  eos_id: number;
  itos?: string[];
  stoi?: Record<string, number>;
};

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function getUnkId(v: Vocab): number {
  const stoi = v.stoi ?? {};
  return stoi["<unk>"] ?? stoi["<UNK>"] ?? stoi.UNK ?? stoi["[UNK]"] ?? 0;
}

function encodeCharLevel(
  text: string,
  sv: Vocab,
  opts?: { lowercase?: boolean; addBosEos?: boolean },
): number[] {
  const stoi = sv.stoi ?? {};
  const unk = getUnkId(sv);

  let s = text.trim();
  if (opts?.lowercase) s = s.toLowerCase();

  const ids: number[] = [];
  for (const ch of s) ids.push(stoi[ch] ?? unk);

  if (opts?.addBosEos) return [sv.sos_id, ...ids, sv.eos_id];
  return ids;
}

function decodeCharLevel(ids: number[], tv: Vocab): string {
  const itos = tv.itos ?? [];
  return ids.map((i) => itos[i] ?? "").join("");
}

function tensorInt64(data: number[], dims: number[]): ort.Tensor {
  const arr = new BigInt64Array(data.map((x) => BigInt(x)));
  return new ort.Tensor("int64", arr, dims);
}

function logSoftmax(arr: Float32Array): Float32Array {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];

  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += Math.exp(arr[i] - m);
  const logZ = m + Math.log(sum);

  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] - logZ;
  return out;
}

function topK(
  logp: Float32Array,
  k: number,
): Array<{ idx: number; val: number }> {
  const best: Array<{ idx: number; val: number }> = [];
  for (let i = 0; i < logp.length; i++) {
    const v = logp[i];
    if (best.length < k) {
      best.push({ idx: i, val: v });
      if (best.length === k) best.sort((a, b) => b.val - a.val);
    } else if (v > best[best.length - 1].val) {
      best[best.length - 1] = { idx: i, val: v };
      best.sort((a, b) => b.val - a.val);
    }
  }
  return best;
}

function lengthPenalty(score: number, length: number, alpha: number): number {
  return score / length ** alpha;
}

type Beam = { toks: number[]; score: number; h: ort.Tensor };

export type BeamEngineOptions = {
  baseDir: string;
  beam?: number; // default 3
  maxOut?: number; // default 64
  alpha?: number; // default 0.7
  lowercase?: boolean; // default false
};

export class OnnxBeamEngine {
  private encSession: ort.InferenceSession | null = null;
  private decSession: ort.InferenceSession | null = null;
  private sv: Vocab | null = null;
  private tv: Vocab | null = null;

  constructor(private opts: BeamEngineOptions) {}

  async init(): Promise<void> {
    if (this.encSession && this.decSession && this.sv && this.tv) return;

    const baseDir = this.opts.baseDir;
    const encPath = path.join(baseDir, "encoder.onnx");
    const decPath = path.join(baseDir, "decoder_step.onnx");
    const svPath = path.join(baseDir, "sv.json");
    const tvPath = path.join(baseDir, "tv.json");

    this.sv = loadJson<Vocab>(svPath);
    this.tv = loadJson<Vocab>(tvPath);

    this.encSession = await ort.InferenceSession.create(encPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    this.decSession = await ort.InferenceSession.create(decPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
  }

  async predictWord(word: string): Promise<string | null> {
    await this.init();
    if (!this.encSession || !this.decSession || !this.sv || !this.tv)
      throw new Error("Engine not ready");

    const tv = this.tv;

    const srcText = word.trim();
    if (!srcText) return null;

    // encode char level input
    const srcIds = encodeCharLevel(srcText, this.sv, {
      lowercase: this.opts.lowercase ?? false,
      addBosEos: true,
    });

    if (srcIds.length === 0) return null;

    const B = 1;
    const T = srcIds.length;
    const srcTensor = tensorInt64(srcIds, [B, T]);

    // encoder
    const encOuts = await this.encSession.run({ src_ids: srcTensor });
    const enc_out = encOuts.enc_out as ort.Tensor;
    const h0 = encOuts.h0 as ort.Tensor;
    const enc_mask = encOuts.enc_mask as ort.Tensor;

    // beam search
    const beam = this.opts.beam ?? 3;
    const maxOut = this.opts.maxOut ?? 64;
    const alpha = this.opts.alpha ?? 0.7;

    let beams: Beam[] = [{ toks: [tv.sos_id], score: 0.0, h: h0 }];
    let finished: Array<{ toks: number[]; score: number }> = [];

    for (let step = 0; step < maxOut; step++) {
      const cand: Beam[] = [];

      for (const b of beams) {
        const last = b.toks[b.toks.length - 1];
        if (last === tv.eos_id) {
          finished.push({ toks: b.toks, score: b.score });
          continue;
        }

        const yTensor = tensorInt64([last], [B]);

        const decOuts = await this.decSession.run({
          y_t: yTensor,
          prev_h: b.h,
          enc_out,
          enc_mask,
        });

        const logits = decOuts.logits as ort.Tensor;
        const next_h = decOuts.next_h as ort.Tensor;

        const logp = logSoftmax(logits.data as Float32Array);
        const top = topK(logp, beam);

        for (const t of top) {
          cand.push({
            toks: [...b.toks, t.idx],
            score: b.score + t.val,
            h: next_h,
          });
        }
      }

      if (cand.length === 0) break;

      cand.sort((a, b) => {
        const la = lengthPenalty(a.score, a.toks.length, alpha);
        const lb = lengthPenalty(b.score, b.toks.length, alpha);
        return lb - la;
      });

      beams = cand.slice(0, beam);

      if (beams.every((b) => b.toks[b.toks.length - 1] === tv.eos_id)) {
        finished.push(...beams.map((b) => ({ toks: b.toks, score: b.score })));
        break;
      }
    }

    if (finished.length === 0)
      finished = beams.map((b) => ({ toks: b.toks, score: b.score }));

    finished.sort((a, b) => {
      const la = lengthPenalty(a.score, a.toks.length, alpha);
      const lb = lengthPenalty(b.score, b.toks.length, alpha);
      return lb - la;
    });

    const best = finished[0].toks;
    const cleaned = best.filter((id) => id !== tv.sos_id && id !== tv.eos_id);
    const out = decodeCharLevel(cleaned, tv);

    return out.trim() ? out : null;
  }
}

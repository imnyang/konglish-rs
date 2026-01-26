import { describe, expect, it } from "vitest";
import { latinToKo, latinToKoCandidates } from "./latinTokorea";

// pnpm test latinTokorea.spec.ts

describe("latinToKo", () => {
  it('pretender를 "프리텐더"로 변환해야 함', () => {
    expect(latinToKo("pretender")).toBe("프리텐더");
  });

  it("특수문자와 공백을 보존해야 함", () => {
    expect(latinToKo("(pretender!)")).toBe("(프리텐더!)");
  });

  it("사전 override 옵션을 적용할 수 있어야 함", () => {
    expect(
      latinToKo("codex", { dictionary: { codex: ["코덱스"] } }),
    ).toBe("코덱스");
  });
});

describe("latinToKoCandidates", () => {
  it('pretender 후보에 "프리텐더"가 포함되어야 함', () => {
    const candidates = latinToKoCandidates("pretender", { limit: 5 });
    expect(candidates).toContain("프리텐더");
  });

  it("후보에서도 특수문자를 보존해야 함", () => {
    const candidates = latinToKoCandidates("(pretender)");
    expect(candidates[0]).toBe("(프리텐더)");
  });
});

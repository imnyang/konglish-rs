import { latinToKo, latinToKoCandidates } from "./latinTokorea";

// pnpm test latinTokorea.spec.ts

describe("latinToKo", () => {
  it('pretender를 "프리텐더"로 변환해야 함', () => {
    expect(latinToKo("pretender")).toBe("프리텐더");
  });
});

describe("latinToKoCandidates", () => {
  it('pretender 후보에 "프리텐더"가 포함되어야 함', () => {
    const candidates = latinToKoCandidates("pretender", { limit: 5 });
    expect(candidates).toContain("프리텐더");
  });
});

describe("latinToKoCandidates", () => {
  it('pretender 후보에 "프리텐더"가 포함되어야 함', () => {
    expect(latinToKo("(pretender)")).toBe("(프리텐더)");
  });
});

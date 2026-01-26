import { describe, expect, it } from "vitest";
import { Konglish } from "./konglish";

describe("Konglish class", () => {
  it("기본 옵션을 활용해 변환할 수 있어야 함", () => {
    const konglish = new Konglish({
      dictionary: {
        latte: ["라떼"],
        meetup: ["밋업"],
      },
    });
    expect(konglish.latinToHangul("latte meetup")).toBe("라떼 밋업");
    expect(konglish.latinToHangul("simple lunch menu")).toBe(
      "심플 런치 메뉴",
    );
  });
});

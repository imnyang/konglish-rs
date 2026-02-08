import { describe, expect, test } from "vitest";
import { Konglish } from "./konglish";

describe("Konglish smoke", () => {
  test("sync vs async", async () => {
    const konglish = new Konglish({
      dictionary: { latte: ["라떼"], meetup: ["밋업"] },
    });

    const autoKonglish = await Konglish.auto({
      dictionary: { latte: ["라떼"], meetup: ["밋업"] },
    });

    const syncOut = konglish.latinToHangul("latte meetup xylophone");
    const asyncOut = await autoKonglish.latinToHangul("latte meetup xylophone");

    console.log(asyncOut);
    expect(syncOut.startsWith("라떼 밋업 xylophone")).toBe(true);
    expect(asyncOut.startsWith("라떼 밋업")).toBe(true);
  }, 20_000);
});

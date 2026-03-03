import { describe, expect, test } from "vitest";
import { Konglish } from "./konglish";

describe("Konglish smoke", () => {
  test("sync vs async", async () => {
    const konglish = new Konglish({
      dictionary: { latte: ["라떼"], meetup: ["밋업"] },
    });

    const syncOut = konglish.latinToHangul("latte meetup xylophone");
    const asyncOut = await konglish.latinToHangulAsync("latte meetup xylophone");

    expect(syncOut).toBe(asyncOut);
    expect(syncOut.startsWith("라떼 밋업 xylophone")).toBe(true);
  }, 20_000);
});

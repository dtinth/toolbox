import { describe, expect, it } from "vite-plus/test";
import { estimateBpm } from "./bpm.ts";

describe("estimateBpm", () => {
  it("recovers the tempo of perfectly periodic taps via the regression slope", () => {
    // 120 BPM = one tap every 500ms.
    const taps = [0, 500, 1000, 1500, 2000];
    const { bpm } = estimateBpm(taps);
    expect(bpm).toBeCloseTo(120, 6);
  });
});

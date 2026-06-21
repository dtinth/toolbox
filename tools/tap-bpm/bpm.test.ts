import { describe, expect, it } from "vite-plus/test";
import { estimateBpm } from "./bpm.ts";

describe("estimateBpm", () => {
  it("recovers the tempo of perfectly periodic taps via the regression slope", () => {
    // 120 BPM = one tap every 500ms.
    const taps = [0, 500, 1000, 1500, 2000];
    const { bpm } = estimateBpm(taps);
    expect(bpm).toBeCloseTo(120, 6);
  });

  it("is fully confident when taps are perfectly periodic", () => {
    // No residual scatter -> the slope is known exactly -> confidence 1.
    const { confidence } = estimateBpm([0, 500, 1000, 1500, 2000]);
    expect(confidence).toBe(1);
  });
});

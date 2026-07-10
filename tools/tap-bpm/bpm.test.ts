import { describe, expect, it } from "vite-plus/test";
import { estimateBpm } from "./bpm.ts";

// Oscillating +/-15ms jitter around a 500ms beat (not absorbed by the slope,
// so residual scatter is real).
const jitter = (i: number) => (i % 2 === 0 ? 15 : -15);
const tapsAt = (count: number) => Array.from({ length: count }, (_, i) => i * 500 + jitter(i));

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

  it("has no tempo with fewer than 2 taps", () => {
    expect(estimateBpm([]).bpm).toBeNull();
    expect(estimateBpm([1000]).bpm).toBeNull();
  });

  it("cannot estimate confidence from fewer than 3 taps", () => {
    const { bpm, confidence } = estimateBpm([0, 500]);
    expect(bpm).toBeCloseTo(120, 6);
    expect(confidence).toBeNull();
  });

  it("grows more confident as more consistent taps accrue", () => {
    // More samples -> more residual scatter observed -> higher confidence.
    const few = estimateBpm(tapsAt(4)).confidence!;
    const many = estimateBpm(tapsAt(16)).confidence!;

    expect(few).toBeGreaterThan(0);
    expect(few).toBeLessThan(1);
    expect(many).toBeGreaterThan(few);
  });
});

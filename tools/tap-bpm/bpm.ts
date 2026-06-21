export interface BpmEstimate {
  /** Beats per minute from the regression slope, or null with fewer than 2 taps. */
  bpm: number | null;
}

/**
 * Estimate tempo from tap timestamps (milliseconds, ascending) by least-squares
 * fitting timestamp against tap index: the slope is the inter-beat interval, far
 * steadier under jitter than averaging consecutive gaps.
 */
export function estimateBpm(taps: number[]): BpmEstimate {
  const n = taps.length;
  if (n < 2) return { bpm: null };

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += taps[i]!;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    sxx += dx * dx;
    sxy += dx * (taps[i]! - my);
  }

  const slope = sxy / sxx; // ms per beat
  if (slope <= 0) return { bpm: null };
  return { bpm: 60000 / slope };
}

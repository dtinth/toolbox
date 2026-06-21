export interface BpmEstimate {
  /** Beats per minute from the regression slope, or null with fewer than 2 taps. */
  bpm: number | null;
  /**
   * Probability that the true tempo lies within `toleranceBpm` of `bpm`, derived
   * from the standard error of the regression slope (normal approximation). Null
   * with fewer than 3 taps, where slope noise cannot be estimated.
   */
  confidence: number | null;
}

// Abramowitz & Stegun 7.1.26 — error function, max error ~1.5e-7.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Estimate tempo from tap timestamps (milliseconds, ascending) by least-squares
 * fitting timestamp against tap index: the slope is the inter-beat interval, far
 * steadier under jitter than averaging consecutive gaps. Also reports how
 * confident we are that the tempo is accurate to within `toleranceBpm`.
 */
export function estimateBpm(taps: number[], toleranceBpm = 0.5): BpmEstimate {
  const n = taps.length;
  if (n < 2) return { bpm: null, confidence: null };

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
  if (slope <= 0) return { bpm: null, confidence: null };
  const bpm = 60000 / slope;

  // Need >= 3 taps for a residual variance (df = n - 2).
  if (n < 3) return { bpm, confidence: null };

  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const residual = taps[i]! - (intercept + slope * i);
    sse += residual * residual;
  }
  const slopeStdErr = Math.sqrt(sse / (n - 2) / sxx); // ms/beat
  if (slopeStdErr === 0) return { bpm, confidence: 1 };

  // Delta method: BPM = 60000/slope, so d(BPM) = (60000/slope^2) d(slope).
  const bpmStdErr = (60000 / (slope * slope)) * slopeStdErr;
  const z = toleranceBpm / bpmStdErr;
  const confidence = erf(z / Math.SQRT2);
  return { bpm, confidence };
}

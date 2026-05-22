// Stability diagnostics for the closed-loop recommender.
//
// Drawn from Mariano & Frasca 2026 ("Optimal Control Synthesis of Closed-Loop
// Recommendation Systems over Social Networks"). Their framework warns that
// pure engagement-maximization without regularization leads to pathological
// dynamics: polarization, exposure concentration, unbounded drift.
//
// These metrics let us measure each pathology empirically. Run them against the
// impressions table to check whether the live system is already drifting.

/** Shannon entropy of a discrete distribution given category counts. */
export function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Normalised entropy in [0, 1] — divides by max entropy for K categories. */
export function normalizedEntropy(counts: number[], k: number): number {
  if (k <= 1) return 0;
  return shannonEntropy(counts) / Math.log2(k);
}

/** Cluster entropy: how diverse is a viewer's feed across topic clusters? */
export function clusterEntropy(clusterIds: Array<number | null>, k: number = 12): number {
  const counts = new Map<number, number>();
  let totalKnown = 0;
  for (const c of clusterIds) {
    if (c == null) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
    totalKnown++;
  }
  if (totalKnown === 0) return 0;
  return normalizedEntropy(Array.from(counts.values()), k);
}

/**
 * Gini coefficient measures concentration of exposure.
 * 0 = perfectly equal (every item shown the same amount); 1 = one item gets all impressions.
 */
export function giniCoefficient(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cumulativeArea = 0;
  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += sorted[i];
    cumulativeArea += cumulative;
  }
  return (n + 1 - (2 * cumulativeArea) / total) / n;
}

/** Jaccard similarity between two sets. 0 = disjoint, 1 = identical. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Jaccard distance = 1 - similarity */
export function jaccardDistance(a: Set<string>, b: Set<string>): number {
  return 1 - jaccardSimilarity(a, b);
}

/**
 * Trend slope: simple linear regression slope of values over their index.
 * Positive slope → metric increasing over time; negative → decreasing.
 */
export function trendSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Format a fraction as a small bar chart (10-char width). Useful for terminal output. */
export function bar(value: number, max: number = 1, width: number = 10): string {
  const filled = Math.round((value / max) * width);
  return "█".repeat(Math.max(0, Math.min(width, filled))) + "·".repeat(Math.max(0, width - filled));
}

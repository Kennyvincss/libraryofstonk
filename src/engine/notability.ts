/**
 * Notability engine.
 *
 * Turns raw market metrics into percentile-ranked features and a weighted
 * score. Percentiles (not raw values) keep the score robust to the heavy-tailed
 * distributions of meme markets and make weights interpretable.
 *
 * The score is used internally (layout, ordering, surprise weighting); it is
 * deliberately not shown to users as a number.
 */
import type { Market } from '../data/types';
import { notabilityWeights, type NotabilityFeature } from './config';

const DAY = 86_400_000;

export type FeatureVector = Record<NotabilityFeature, number>;

export function rawFeatures(m: Market, now: number, momentCount: number): FeatureVector {
  const activeDays = Math.max(1 / 24, (m.lastTradeAt - m.createdAt) / DAY);
  const avgDay = m.volumeLifetimeUsd / Math.max(1, activeDays);
  return {
    lifetimeVolume: Math.log1p(m.volumeLifetimeUsd),
    recentVolume: Math.log1p(m.volume7dUsd),
    traders: Math.log1p(m.traders),
    liquidity: Math.log1p(m.liquidityUsd),
    longevity: Math.log1p(activeDays) * (m.status === 'dead' ? 0.6 : 1),
    priceMove: Math.log(Math.max(1, m.athPriceUsd / Math.max(1e-18, m.launchPriceUsd))),
    tradeFrequency: Math.log1p(m.trades / Math.max(1, Math.min(activeDays, (now - m.createdAt) / DAY))),
    spike: Math.log1p(m.peakDayVolumeUsd / Math.max(1, avgDay)) + Math.log1p(m.peakDayVolumeUsd) * 0.15,
    growth: m.volume7dUsd > 0 ? Math.log1p((m.volume24hUsd * 7) / m.volume7dUsd) * Math.min(1, Math.log1p(m.volume24hUsd) / 10) : 0,
    historical: momentCount,
  };
}

/** Percentile rank (0..1) of each value in `values`, ties share rank. */
export function percentiles(values: Float64Array): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (values.some(Number.isNaN)) return percentilesSlow(values);
  // fast path: a native typed-array sort, then each value's tie range by binary search
  const sorted = Float64Array.from(values).sort();
  const lower = (v: number) => {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upper = (v: number) => {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };
  for (let i = 0; i < n; i++) {
    const v = values[i];
    out[i] = n > 1 ? (lower(v) + upper(v)) / 2 / (n - 1) : 1;
  }
  return out;
}

function percentilesSlow(values: Float64Array): Float64Array {
  const n = values.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
    const p = n > 1 ? (i + j) / 2 / (n - 1) : 1;
    for (let k = i; k <= j; k++) out[idx[k]] = p;
    i = j + 1;
  }
  return out;
}

export interface NotabilityResult {
  score: Float64Array;
  pct: Record<NotabilityFeature, Float64Array>;
  /** rank 0 = most notable */
  rank: Int32Array;
}

/**
 * `reuse`: an earlier result for the same markets, now and weights; only the
 * moment-dependent feature is recomputed (identical result, half the work).
 */
export function scoreMarkets(markets: Market[], now: number, momentCounts: Map<string, number>, weights = notabilityWeights, reuse?: NotabilityResult): NotabilityResult {
  const n = markets.length;
  const keys = Object.keys(weights) as NotabilityFeature[];
  const todo = reuse ? keys.filter((k) => k === 'historical' || !reuse.pct[k] || reuse.pct[k].length !== n) : keys;
  const raw = Object.fromEntries(todo.map((k) => [k, new Float64Array(n)])) as Record<NotabilityFeature, Float64Array>;
  markets.forEach((m, i) => {
    const f = rawFeatures(m, now, momentCounts.get(m.id) ?? 0);
    for (const k of todo) raw[k][i] = f[k];
  });
  const pct = Object.fromEntries(keys.map((k) => [k, todo.includes(k) ? percentiles(raw[k]) : reuse!.pct[k]])) as Record<NotabilityFeature, Float64Array>;
  const score = new Float64Array(n);
  const wsum = keys.reduce((s, k) => s + weights[k], 0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const k of keys) s += weights[k] * pct[k][i];
    // emphasise the top end: notability compounds
    score[i] = Math.pow(s / wsum, 1.6);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[b] - score[a]);
  const rank = new Int32Array(n);
  order.forEach((idx, r) => (rank[idx] = r));
  return { score, pct, rank };
}

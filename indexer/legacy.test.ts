import { describe, expect, test } from 'vitest';
import { fromRows, legacyCounts, toRows, type LegacyCache } from './legacy';

const D = 86_400_000;
const aug3 = Date.UTC(2026, 7, 3);
const sep6 = Date.UTC(2026, 8, 6);

describe('pre-LaunchLab launches', () => {
  const cache: LegacyCache = {
    pools: {
      a: { address: 'a', token: 'A', quoteMint: 'Q', createdAt: aug3 + 3600_000 },
      a2: { address: 'a2', token: 'A', quoteMint: 'Q2', createdAt: aug3 + 3 * D }, // same coin, second pool
      b: { address: 'b', token: 'B', quoteMint: 'Q', createdAt: aug3 + 3600_000 * 5 },
      c: { address: 'c', token: 'C', quoteMint: 'Q', createdAt: aug3 + 2 * D },
      d: { address: 'd', token: 'D', quoteMint: 'Q', createdAt: aug3 - 30 * D }, // before the era
      e: { address: 'e', token: 'E', quoteMint: 'Q' }, // undated
      f: { address: 'f', token: 'F', quoteMint: 'Q', createdAt: 0 }, // busy, deeper look pending
    },
  };

  test("counts each coin's first coin-vs-stock pool inside the era, per day", () => {
    const c = legacyCounts(cache, aug3, sep6);
    expect(c.total).toBe(3);
    expect(c.byDay).toEqual({ [String(aug3)]: 2, [String(aug3 + 2 * D)]: 1 });
    expect(c.pending).toBe(1);
    expect(c.busy).toBe(1);
  });

  test('compact cache rows round-trip', () => {
    expect(fromRows(toRows(cache))).toEqual(cache.pools);
  });
});

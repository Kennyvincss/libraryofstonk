import { describe, expect, test } from 'vitest';
import { fromRows, legacyCounts, toRows, type LegacyCache } from './legacy';

const D = 86_400_000;
const aug3 = Date.UTC(2026, 7, 3);
const sep6 = Date.UTC(2026, 8, 6);

describe('pre-LaunchLab launches', () => {
  const cache: LegacyCache = {
    pools: {
      a: { address: 'a', token: 'A', quoteMint: 'Q', createdAt: aug3 + 3600_000, launch: 1, signer: 'W' },
      b: { address: 'b', token: 'B', quoteMint: 'Q', createdAt: aug3 + 3600_000 * 5, launch: 1, signer: 'W' },
      c: { address: 'c', token: 'C', quoteMint: 'Q', createdAt: aug3 + 2 * D, launch: 0 },
      d: { address: 'd', token: 'D', quoteMint: 'Q', createdAt: aug3 - 30 * D, launch: 1 },
      e: { address: 'e', token: 'E', quoteMint: 'Q', createdAt: aug3 + 4 * D, sig: 'S' },
    },
  };

  test('counts only one-transaction launches inside the era, per day', () => {
    const c = legacyCounts(cache, aug3, sep6);
    expect(c.total).toBe(2);
    expect(c.byDay).toEqual({ [String(aug3)]: 2 });
    expect(c.pending).toBe(1);
    expect(c.topSigners).toEqual([['W', 2]]);
  });

  test('compact cache rows round-trip', () => {
    expect(fromRows(toRows(cache))).toEqual(cache.pools);
  });
});

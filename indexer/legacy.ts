/**
 * StonkFun's first era (Aug 3 – Sept 5, 2026), before launches moved to
 * Raydium LaunchLab: each coin was minted and paired one-sided against a
 * tokenized stock in a Raydium CLMM pool, in a single transaction.
 *
 * So the launches are exactly the stock-quoted CLMM pools whose creation
 * transaction also initialized the coin's mint. We enumerate every CLMM pool
 * holding a tracked stock mint (getProgramAccounts + memcmp), date each
 * pool by its oldest signature and check that one transaction's logs.
 * Results are cached; history is fixed, so later runs only top up.
 */
import { log } from './client';
import { b58decode, b58encode, creationTx, getAccounts, pool as mapLimit, programAccounts } from './helius';

export interface LegacyLayout {
  program: string;
  dataSize: number;
  /** offsets of the pool's two mints (CLMM sorts them, so either can be the stock) */
  offA: number;
  offB: number;
}

export interface LegacyPool {
  address: string;
  token: string;
  quoteMint: string;
  createdAt?: number;
  /** creation transaction signature (until checked) */
  sig?: string;
  /** 1 = launched in its creation tx, 0 = not, undefined = unchecked */
  launch?: 0 | 1;
  signer?: string;
}

export interface LegacyCache {
  layout?: LegacyLayout;
  pools: Record<string, LegacyPool>;
  enumeratedAt?: number;
}

const DAY = 86_400_000;

const findAll = (hay: Uint8Array, needle: Uint8Array): number[] => {
  const out: number[] = [];
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    out.push(i);
  }
  return out;
};

/** Learn the CLMM pool layout from pools GeckoTerminal lists as raydium-clmm. */
export async function learnClmmLayout(samples: { address: string; mint: string; quoteMint: string }[]): Promise<LegacyLayout | undefined> {
  const pick = samples.slice(0, 40);
  if (pick.length < 3) return undefined;
  const accs = await getAccounts(pick.map((s) => s.address));
  const votes = new Map<string, { l: LegacyLayout; n: number }>();
  accs.forEach((acc, i) => {
    if (!acc) return;
    const a = findAll(acc.data, b58decode(pick[i].mint));
    const b = findAll(acc.data, b58decode(pick[i].quoteMint));
    if (a.length !== 1 || b.length !== 1) return;
    const [offA, offB] = [a[0], b[0]].sort((x, y) => x - y);
    const key = `${acc.owner}:${acc.data.length}:${offA}:${offB}`;
    const v = votes.get(key) ?? { l: { program: acc.owner, dataSize: acc.data.length, offA, offB }, n: 0 };
    v.n++;
    votes.set(key, v);
  });
  const best = [...votes.values()].sort((x, y) => y.n - x.n)[0];
  if (!best || best.n < 3) return undefined;
  log(`legacy: CLMM layout ${best.l.program} · size ${best.l.dataSize} · mints @${best.l.offA}/@${best.l.offB} (${best.n} samples)`);
  return best.l;
}

/** Every CLMM pool pairing a tracked stock with a coin (not with another quote asset). */
export async function enumerateStockPools(l: LegacyLayout, stockMints: Set<string>, notCoins: Set<string>): Promise<LegacyPool[]> {
  const out = new Map<string, LegacyPool>();
  const lo = l.offA;
  const len = l.offB + 32 - lo;
  for (const stock of stockMints) {
    for (const off of [l.offA, l.offB]) {
      const rows = await programAccounts(l.program, { dataSize: l.dataSize, memcmp: { offset: off, bytes: stock }, slice: { offset: lo, length: len } });
      for (const r of rows) {
        const a = b58encode(r.data.subarray(0, 32));
        const b = b58encode(r.data.subarray(l.offB - lo, l.offB - lo + 32));
        const token = a === stock ? b : a;
        if (notCoins.has(token) || stockMints.has(token)) continue;
        out.set(r.pubkey, { address: r.pubkey, token, quoteMint: stock });
      }
    }
  }
  return [...out.values()];
}

/**
 * Date the pools, then check the creation transaction of those created in the
 * pre-LaunchLab window. Time-boxed; resumes on the next run.
 */
/** createdAt sentinel: busy pool whose oldest signature stayed out of reach */
const GAVE_UP = 1;

/** Date the pools by their oldest signature. Time-boxed; resumes on the next run. */
export async function classify(cache: LegacyCache, minutes: number) {
  const stopAt = Date.now() + minutes * 60_000;
  // undated first; busy pools (0) get one deeper look afterwards
  const todo = Object.values(cache.pools)
    .filter((p) => p.createdAt === undefined || p.createdAt === 0)
    .sort((a, b) => Number(a.createdAt === 0) - Number(b.createdAt === 0));
  let dated = 0;
  await mapLimit(todo, 6, async (p) => {
    if (Date.now() > stopAt) return;
    try {
      const deep = p.createdAt === 0;
      const c = await creationTx(p.address, deep ? 40 : 5);
      p.createdAt = c?.t ?? (deep ? GAVE_UP : 0);
      if (c) dated++;
    } catch (e) {
      log(`legacy: ${p.address}: ${(e as Error).message}`);
    }
  });
  log(`legacy: dated ${dated} of ${todo.length} pending pools`);
}

/** Each coin's first coin-vs-stock pool created in [from, to). */
export function legacyLaunches(cache: LegacyCache, from: number, to: number): LegacyPool[] {
  const first = new Map<string, LegacyPool>();
  for (const p of Object.values(cache.pools)) {
    if (!p.createdAt || p.createdAt === GAVE_UP || p.createdAt < from || p.createdAt >= to) continue;
    const cur = first.get(p.token);
    if (!cur || p.createdAt < cur.createdAt!) first.set(p.token, p);
  }
  return [...first.values()];
}

/** Launches per UTC day in [from, to). */
export function legacyCounts(cache: LegacyCache, from: number, to: number) {
  const byDay: Record<string, number> = {};
  const launches = legacyLaunches(cache, from, to);
  for (const p of launches) {
    const d = String(Math.floor(p.createdAt! / DAY) * DAY);
    byDay[d] = (byDay[d] ?? 0) + 1;
  }
  const pending = Object.values(cache.pools).filter((p) => p.createdAt === undefined || p.createdAt === 0).length;
  return { byDay, total: launches.length, pending };
}

// compact cache rows: [address, token, quote, createdSec (-1 undated), launch (-1 unchecked), sig, signer]
export type LegacyRow = [string, string, string, number, number, string, string];
export const toRows = (c: LegacyCache): LegacyRow[] =>
  Object.values(c.pools).map((p) => [p.address, p.token, p.quoteMint, p.createdAt === undefined ? -1 : Math.round(p.createdAt / 1000), p.launch ?? -1, p.sig ?? '', p.signer ?? '']);
export const fromRows = (rows: LegacyRow[]): Record<string, LegacyPool> =>
  Object.fromEntries(
    rows.map(([a, t, q, c, l, s, g]) => [a, { address: a, token: t, quoteMint: q, createdAt: c < 0 ? undefined : c * 1000, launch: l < 0 ? undefined : (l as 0 | 1), sig: s || undefined, signer: g || undefined }]),
  );

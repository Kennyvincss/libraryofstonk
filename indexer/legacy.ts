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
import { b58decode, b58encode, creationTx, getAccounts, pool as mapLimit, programAccounts, transactionLogs } from './helius';

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
export async function classify(cache: LegacyCache, from: number, to: number, minutes: number) {
  const stopAt = Date.now() + minutes * 60_000;
  const check = async (p: LegacyPool) => {
    const tx = await transactionLogs(p.sig!);
    if (!tx) {
      p.launch = 0;
      delete p.sig;
      return;
    }
    const mintInit = tx.logs.some((x) => /Instruction: InitializeMint/.test(x));
    const poolInit = tx.logs.some((x) => /Instruction: (CreatePool|OpenPosition)/.test(x));
    p.launch = mintInit && poolInit && tx.accounts.includes(p.token) ? 1 : 0;
    p.signer = tx.signers[0];
    delete p.sig;
  };
  // finish half-done pools first, then date + check the rest in one pass
  const todo = Object.values(cache.pools)
    .filter((p) => p.createdAt === undefined || (p.sig && p.launch === undefined))
    .sort((a, b) => Number(!!b.sig) - Number(!!a.sig));
  let dated = 0;
  let checked = 0;
  await mapLimit(todo, 6, async (p) => {
    if (Date.now() > stopAt) return;
    try {
      if (p.createdAt === undefined) {
        const c = await creationTx(p.address, 5);
        p.createdAt = c?.t ?? 0;
        if (c && c.t >= from - DAY && c.t < to + DAY) p.sig = c.signature;
        dated++;
      }
      if (p.sig && p.launch === undefined) {
        await check(p);
        checked++;
      }
    } catch (e) {
      log(`legacy: ${p.address}: ${(e as Error).message}`);
    }
  });
  log(`legacy: dated ${dated}, checked ${checked} creation transactions (${todo.length} pools were pending)`);
}

/** Launches per UTC day in [from, to). */
export function legacyCounts(cache: LegacyCache, from: number, to: number) {
  const byDay: Record<string, number> = {};
  let total = 0;
  const signers = new Map<string, number>();
  for (const p of Object.values(cache.pools)) {
    if (p.launch !== 1 || !p.createdAt || p.createdAt < from || p.createdAt >= to) continue;
    const d = String(Math.floor(p.createdAt / DAY) * DAY);
    byDay[d] = (byDay[d] ?? 0) + 1;
    total++;
    if (p.signer) signers.set(p.signer, (signers.get(p.signer) ?? 0) + 1);
  }
  const pending = Object.values(cache.pools).filter((p) => p.createdAt === undefined || (p.sig && p.launch === undefined)).length;
  return { byDay, total, pending, topSigners: [...signers].sort((a, b) => b[1] - a[1]).slice(0, 5) };
}

// compact cache rows: [address, token, quote, createdSec (-1 undated), launch (-1 unchecked), sig, signer]
export type LegacyRow = [string, string, string, number, number, string, string];
export const toRows = (c: LegacyCache): LegacyRow[] =>
  Object.values(c.pools).map((p) => [p.address, p.token, p.quoteMint, p.createdAt === undefined ? -1 : Math.round(p.createdAt / 1000), p.launch ?? -1, p.sig ?? '', p.signer ?? '']);
export const fromRows = (rows: LegacyRow[]): Record<string, LegacyPool> =>
  Object.fromEntries(
    rows.map(([a, t, q, c, l, s, g]) => [a, { address: a, token: t, quoteMint: q, createdAt: c < 0 ? undefined : c * 1000, launch: l < 0 ? undefined : (l as 0 | 1), sig: s || undefined, signer: g || undefined }]),
  );

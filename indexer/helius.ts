/**
 * Complete StonkFun market enumeration from chain state via Helius.
 *
 * GeckoTerminal only lists the busiest pools. With a Helius key the indexer:
 *  1. looks up the on-chain owner program of known StonkFun pools (the
 *     StonkFun bonding-curve program and Raydium LaunchLab),
 *  2. learns where each program stores the base and quote mints by matching
 *     known pools' account data against their known mints (no hardcoded layouts),
 *  3. enumerates every pool with getProgramAccounts (StonkFun program: all
 *     pools; LaunchLab: pools quoted in a tracked stock),
 *  4. finds each new pool's creation time (oldest signature) and token
 *     metadata (DAS getAssetBatch).
 *
 * Key: HELIUS_API_KEY (GitHub Actions secret). Never shipped to the site.
 */
import { log, sleep } from './client';

const RPC = () => `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;

export const heliusEnabled = () => Boolean(process.env.HELIUS_API_KEY);

// ── base58 ───────────────────────────────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}
export function b58encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = '1' + s;
  }
  return s;
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────
let calls = 0;
export const heliusCalls = () => calls;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    calls++;
    try {
      const res = await fetch(RPC(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(method === 'getProgramAccounts' ? 180_000 : 30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * 2 ** attempt + Math.random() * 500);
        continue;
      }
      const j = (await res.json()) as { result?: T; error?: { message: string } };
      if (j.error) throw new Error(`${method}: ${j.error.message}`);
      return j.result as T;
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`${method}: retries exhausted`);
}

interface AccountInfo {
  owner: string;
  data: [string, 'base64'];
}

export interface ProgramLayout {
  program: string;
  kind: 'stonkfun' | 'launchlab';
  dataSize: number;
  baseOff: number;
  quoteOff: number;
  /**
   * Shared launch programs (Raydium LaunchLab hosts many launchpads) mark each
   * pool with its platform. When learned, enumeration filters on these values.
   */
  platform?: { offset: number; values: string[] };
  /** program also hosts other launchpads' pools (never enumerate it unfiltered) */
  shared: boolean;
}

export interface ChainPool {
  address: string;
  program: 'stonkfun' | 'launchlab';
  baseMint: string;
  quoteMint: string;
  createdAt?: number;
}

const findAll = (hay: Uint8Array, needle: Uint8Array): number[] => {
  const out: number[] = [];
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    out.push(i);
  }
  return out;
};

/**
 * Learn pool layouts from known pools.
 *  positives: pools GeckoTerminal labels as StonkFun (with their mints)
 *  negatives: pools of other launchpads (used to find StonkFun's platform marker)
 */
export async function learnLayouts(
  positives: { address: string; mint: string; quoteMint: string }[],
  negatives: string[],
): Promise<ProgramLayout[]> {
  if (positives.length < 2) {
    log(`helius: not enough known StonkFun pools to learn the layout (${positives.length})`);
    return [];
  }
  const pos = positives.slice(0, 60);
  const neg = negatives.slice(0, 60);
  const res = await rpc<{ value: (AccountInfo | null)[] }>('getMultipleAccounts', [[...pos, ...neg.map((a) => ({ address: a }))].map((x) => x.address), { encoding: 'base64' }]);
  const posAcc = res.value.slice(0, pos.length);
  const negAcc = res.value.slice(pos.length);

  // group positives by owner program + agreeing (size, baseOff, quoteOff)
  const groups = new Map<string, { owner: string; size: number; baseOff: number; quoteOff: number; datas: Uint8Array[] }>();
  posAcc.forEach((acc, i) => {
    if (!acc) return;
    const data = Buffer.from(acc.data[0], 'base64');
    const bo = findAll(data, b58decode(pos[i].mint));
    const qo = findAll(data, b58decode(pos[i].quoteMint));
    if (bo.length !== 1 || qo.length !== 1) return;
    const key = `${acc.owner}:${data.length}:${bo[0]}:${qo[0]}`;
    const g = groups.get(key) ?? { owner: acc.owner, size: data.length, baseOff: bo[0], quoteOff: qo[0], datas: [] };
    g.datas.push(data);
    groups.set(key, g);
  });

  const layouts: ProgramLayout[] = [];
  for (const g of groups.values()) {
    if (g.datas.length < 2) continue;
    const negSame = negAcc.filter((a): a is AccountInfo => !!a && a.owner === g.owner).map((a) => Buffer.from(a.data[0], 'base64')).filter((d) => d.length === g.size);
    const shared = negSame.length > 0;
    let platform: ProgramLayout['platform'];
    if (shared) {
      // a 32-byte field whose few values cover every StonkFun pool and (almost) no other pool
      const skip = (o: number) => Math.abs(o - g.baseOff) < 32 || Math.abs(o - g.quoteOff) < 32;
      let best: { offset: number; values: string[]; score: number } | undefined;
      for (let o = 8; o + 32 <= g.size; o++) {
        if (skip(o)) continue;
        const vals = new Map<string, number>();
        for (const d of g.datas) {
          const v = b58encode(d.subarray(o, o + 32));
          vals.set(v, (vals.get(v) ?? 0) + 1);
        }
        if (vals.size > 3) continue;
        const values = [...vals.keys()];
        if (values.some((v) => /^1+$/.test(v))) continue; // all-zero field
        const negHits = negSame.filter((d) => vals.has(b58encode(d.subarray(o, o + 32)))).length;
        if (negHits > negSame.length * 0.1) continue;
        // overlapping windows also separate the sets; a real pubkey has no zero padding
        const zeros = g.datas[0].subarray(o, o + 32).reduce((n, b) => n + (b === 0 ? 1 : 0), 0);
        const score = vals.size * 10 + negHits + zeros / 100;
        if (!best || score < best.score) best = { offset: o, values, score };
      }
      if (best) platform = { offset: best.offset, values: best.values };
    }
    layouts.push({ program: g.owner, kind: platform || !shared ? 'stonkfun' : 'launchlab', dataSize: g.size, baseOff: g.baseOff, quoteOff: g.quoteOff, platform, shared });
    log(
      `helius: program ${g.owner} · pool size ${g.size} · base@${g.baseOff} quote@${g.quoteOff} · ${g.datas.length} StonkFun samples · ` +
        (shared ? (platform ? `shared with other launchpads (${negSame.length} negatives); StonkFun marker @${platform.offset} = ${platform.values.join(', ')}` : `shared with other launchpads (${negSame.length} negatives) and no StonkFun marker found — stock-quoted pools only`) : 'dedicated to StonkFun'),
    );
  }
  if (!layouts.length) log('helius: could not learn any StonkFun pool layout');
  return layouts;
}

/**
 * Pools of a program matching `memcmp` (platform marker or quote mint).
 * A shared program is never enumerated without a filter.
 */
export async function enumeratePools(l: ProgramLayout, memcmp?: { offset: number; bytes: string }): Promise<ChainPool[]> {
  if (l.shared && !memcmp) throw new Error('refusing to enumerate a shared launch program without a filter');
  const lo = Math.min(l.baseOff, l.quoteOff);
  const hi = Math.max(l.baseOff, l.quoteOff) + 32;
  const filters: unknown[] = [{ dataSize: l.dataSize }];
  if (memcmp) filters.push({ memcmp });
  const res = await rpc<{ pubkey: string; account: AccountInfo }[]>('getProgramAccounts', [
    l.program,
    { encoding: 'base64', dataSlice: { offset: lo, length: hi - lo }, filters },
  ]);
  return res.map((r) => {
    const d = Buffer.from(r.account.data[0], 'base64');
    return {
      address: r.pubkey,
      program: l.kind,
      baseMint: b58encode(d.subarray(l.baseOff - lo, l.baseOff - lo + 32)),
      quoteMint: b58encode(d.subarray(l.quoteOff - lo, l.quoteOff - lo + 32)),
    };
  });
}

/** Creation time = block time of the account's oldest signature (≤ 3 pages). */
export async function creationTime(address: string): Promise<number | undefined> {
  let before: string | undefined;
  let oldest: number | undefined;
  for (let page = 0; page < 3; page++) {
    const sigs = await rpc<{ signature: string; blockTime: number | null }[]>('getSignaturesForAddress', [address, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!sigs.length) break;
    const last = sigs[sigs.length - 1];
    if (last.blockTime) oldest = last.blockTime * 1000;
    if (sigs.length < 1000) return oldest;
    before = last.signature;
  }
  return oldest; // busy pool: best effort after 3,000 signatures
}

export interface TokenMeta {
  name?: string;
  symbol?: string;
  image?: string;
}

export async function tokenMetadata(mints: string[]): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  for (let i = 0; i < mints.length; i += 1000) {
    const res = await rpc<{ id: string; content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } } }[]>('getAssetBatch', { ids: mints.slice(i, i + 1000) });
    for (const a of res ?? []) {
      if (!a?.id) continue;
      out.set(a.id, { name: a.content?.metadata?.name?.trim() || undefined, symbol: a.content?.metadata?.symbol?.trim() || undefined, image: a.content?.links?.image || undefined });
    }
  }
  return out;
}

/** Run `fn` over items with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

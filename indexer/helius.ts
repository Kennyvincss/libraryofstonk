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
        await sleep(1000 * 2 ** attempt);
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
 * Learn each program's pool layout from known pools.
 * `samples` = known pool addresses with their token mint, quote mint and kind.
 */
export async function learnLayouts(samples: { address: string; mint: string; quoteMint: string; kind: 'stonkfun' | 'launchlab' }[]): Promise<ProgramLayout[]> {
  const layouts: ProgramLayout[] = [];
  for (const kind of ['stonkfun', 'launchlab'] as const) {
    const s = samples.filter((x) => x.kind === kind).slice(0, 25);
    if (s.length < 2) {
      log(`helius: not enough known ${kind} pools to learn its layout (${s.length})`);
      continue;
    }
    const res = await rpc<{ value: (AccountInfo | null)[] }>('getMultipleAccounts', [s.map((x) => x.address), { encoding: 'base64' }]);
    // votes: program → "size:baseOff:quoteOff" → count
    const votes = new Map<string, Map<string, number>>();
    res.value.forEach((acc, i) => {
      if (!acc) return;
      const data = Buffer.from(acc.data[0], 'base64');
      const bo = findAll(data, b58decode(s[i].mint));
      const qo = findAll(data, b58decode(s[i].quoteMint));
      if (bo.length !== 1 || qo.length !== 1) return;
      const key = `${data.length}:${bo[0]}:${qo[0]}`;
      const m = votes.get(acc.owner) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      votes.set(acc.owner, m);
    });
    let best: { program: string; key: string; n: number } | undefined;
    for (const [program, m] of votes) for (const [key, n] of m) if (!best || n > best.n) best = { program, key, n };
    if (!best || best.n < 2) {
      log(`helius: could not learn the ${kind} pool layout (owners: ${[...votes.keys()].join(', ') || 'none'})`);
      continue;
    }
    const [dataSize, baseOff, quoteOff] = best.key.split(':').map(Number);
    layouts.push({ program: best.program, kind, dataSize, baseOff, quoteOff });
    log(`helius: ${kind} program ${best.program} · pool size ${dataSize} · base@${baseOff} quote@${quoteOff} (${best.n}/${s.length} samples agree)`);
  }
  return layouts;
}

/** Every pool of a program (optionally only those quoted in `quoteMint`). */
export async function enumeratePools(l: ProgramLayout, quoteMint?: string): Promise<ChainPool[]> {
  const lo = Math.min(l.baseOff, l.quoteOff);
  const hi = Math.max(l.baseOff, l.quoteOff) + 32;
  const filters: unknown[] = [{ dataSize: l.dataSize }];
  if (quoteMint) filters.push({ memcmp: { offset: l.quoteOff, bytes: quoteMint } });
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

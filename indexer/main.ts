/**
 * STONKFUN ARCHIVE indexer.
 *
 *   npx tsx indexer/main.ts --out ./data-out
 *
 * Incremental: reads its previous output + cache from --out, spends a bounded
 * number of GeckoTerminal calls (INDEXER_MAX_CALLS, default 600 ≈ 23 min at
 * the free rate limit), and writes:
 *
 *   v1/meta.json  v1/markets.json  v1/ecosystem.json  v1/activity.json
 *   v1/bars/<pool>.json      daily OHLCV per market (also the history cache)
 *   cache/state.json         pools, quotes, tracked counts, fetch times
 *
 * Run it on a schedule (see .github/workflows/indexer.yml); every run extends
 * history and catches new launches.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetExhausted, Gecko, log } from './client';
import { buildArchive, groupByMint, type Tracked } from './build';
import { fetchPlatformVolume, type PlatformVolume } from './llama';
import { classify, enumerateStockPools, fromRows, learnClmmLayout, legacyCounts, toRows, type LegacyCache, type LegacyRow } from './legacy';
import { creationTime, enumeratePools, heliusCalls, heliusEnabled, learnLayouts, pool as mapLimit, tokenMetadata, type ChainPool, type ProgramLayout, type TokenMeta } from './helius';
import { NETWORK, num, parseOhlcv, poolToRecord, tokenMap, type GtList, type GtPool, type GtToken, type Ohlcv, type PoolRecord, type QuoteRef } from '../src/data/live/gecko';
import { CRYPTO_QUOTE_SPECS, EXCLUDED_MINTS, QUOTE_SPECS, specToQuote } from '../src/data/live/quotes';
import { STONKFUN, stonkFunMints } from '../src/data/live/stonkfun';
import type { QuoteAsset } from '../src/data/types';

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface State {
  version: 1;
  quotes: Record<string, { mint: string; priceUsd: number; verifiedAt: number }>;
  pools: Record<string, PoolRecord>;
  tracked: Tracked;
  history: Record<string, { fetchedAt: number }>;
  lastDeepDiscovery: Record<string, number>;
  lastShallowDiscovery?: Record<string, number>;
  /** next deep page of StonkFun's own pool list to visit */
  stonkfunPage?: number;
  cryptoPrices?: Record<string, number>;
  platform?: PlatformVolume;
  /** on-chain enumeration (Helius) */
  chain?: {
    layouts: ProgramLayout[];
    layoutsAt: number;
    pools: Record<string, ChainPool>;
    meta: Record<string, TokenMeta>;
    stats: Record<string, { priceUsd?: number; vol24?: number; mcapUsd?: number; fdvUsd?: number; reserveUsd?: number; observedAt: number }>;
    enumeratedAt?: number;
    /** pre-LaunchLab era: launches per day (from legacyCache) */
    legacy?: { byDay: Record<string, number>; total: number; countedAt: number; complete?: boolean };
    /** pre-LaunchLab CLMM pools (kept in cache/legacy-pools.json) */
    legacyCache?: LegacyCache;
  };
}

const args = process.argv.slice(2);
const OUT = args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : './data-out';
const BUDGET = Number(process.env.INDEXER_MAX_CALLS || 600);
const PAGES = Number(process.env.INDEXER_POOL_PAGES || 10);
/** quotes that get full (10-page) discovery per run; the rest get page 1 */
const DEEP_PER_RUN = Number(process.env.INDEXER_DEEP_QUOTES_PER_RUN || 3);
/** quotes whose busiest page is refreshed per run (rotating); new_pools covers launches every run */
const SHALLOW_PER_RUN = Number(process.env.INDEXER_SHALLOW_QUOTES_PER_RUN || 8);

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, JSON.stringify(data));
}

async function resolveQuotes(gt: Gecko, state: State, now: number): Promise<Map<string, QuoteRef & { priceUsd: number }>> {
  // 1) verify hints + cached mints in one multi call
  const candidates = new Map<string, string>(); // mint → symbol
  for (const s of QUOTE_SPECS) {
    const mint = state.quotes[s.symbol]?.mint ?? s.mint;
    if (mint) candidates.set(mint, s.symbol);
  }
  for (const c of CRYPTO_QUOTE_SPECS) candidates.set(c.mint!, c.symbol);
  state.cryptoPrices ??= {};
  const verified = new Map<string, { mint: string; priceUsd: number }>();
  const mints = [...candidates.keys()];
  for (let i = 0; i < mints.length; i += 30) {
    const res = await gt.get<{ data?: GtToken[] }>(`/networks/${NETWORK}/tokens/multi/${mints.slice(i, i + 30).join(',')}`);
    for (const t of res?.data ?? []) {
      const crypto = CRYPTO_QUOTE_SPECS.find((c) => c.mint === t.attributes.address);
      if (crypto) {
        state.cryptoPrices![crypto.symbol] = num(t.attributes.price_usd) ?? state.cryptoPrices![crypto.symbol] ?? 0;
        continue;
      }
      const sym = candidates.get(t.attributes.address);
      if (sym && t.attributes.symbol?.toLowerCase() === sym.toLowerCase()) verified.set(sym, { mint: t.attributes.address, priceUsd: num(t.attributes.price_usd) ?? 0 });
    }
  }
  // 2) search the rest by symbol (re-check unresolved at most daily)
  for (const s of QUOTE_SPECS) {
    if (verified.has(s.symbol)) continue;
    const prev = state.quotes[s.symbol];
    if (prev && now - prev.verifiedAt < DAY && !prev.mint) continue;
    const res = await gt.get<GtList<GtPool>>(`/search/pools?query=${encodeURIComponent(s.symbol)}&network=${NETWORK}&include=base_token,quote_token`);
    const toks = tokenMap(res?.included);
    const reserve = new Map<string, number>();
    for (const p of res?.data ?? []) {
      for (const rel of [p.relationships?.base_token, p.relationships?.quote_token]) {
        const id = rel?.data?.id?.split('_').slice(1).join('_');
        const t = id ? toks.get(id) : undefined;
        if (t && t.symbol === s.symbol) reserve.set(t.address, (reserve.get(t.address) ?? 0) + (num(p.attributes.reserve_in_usd) ?? 0));
      }
    }
    // prefer xStocks' "Xs…" vanity mints, then the most liquid
    const best = [...reserve].sort((a, b) => Number(b[0].startsWith('Xs')) - Number(a[0].startsWith('Xs')) || b[1] - a[1])[0];
    if (best) {
      const t = toks.get(best[0])!;
      verified.set(s.symbol, { mint: best[0], priceUsd: num(t.price_usd) ?? 0 });
      log(`resolved ${s.symbol} → ${best[0]}`);
    } else {
      state.quotes[s.symbol] = { mint: '', priceUsd: 0, verifiedAt: now };
      log(`could not resolve ${s.symbol}`);
    }
  }
  const out = new Map<string, QuoteRef & { priceUsd: number }>();
  for (const [sym, v] of verified) {
    state.quotes[sym] = { ...v, verifiedAt: now };
    out.set(v.mint, { symbol: sym, mint: v.mint, priceUsd: v.priceUsd });
  }
  return out;
}

const CRYPTO = { quotes: new Map(CRYPTO_QUOTE_SPECS.map((c) => [c.mint!, { symbol: c.symbol, mint: c.mint! }])), dexIds: STONKFUN.dexIds };

function ingest(state: State, list: GtList<GtPool> | null, quotes: Map<string, QuoteRef>, now: number): number {
  const toks = tokenMap(list?.included);
  let n = 0;
  for (const p of list?.data ?? []) {
    const r = poolToRecord(p, toks, quotes, EXCLUDED_MINTS, now, CRYPTO);
    if (!r) continue;
    const prev = state.pools[r.address];
    // keep token metadata if this response didn't include it
    state.pools[r.address] = prev && r.name === r.symbol && prev.name ? { ...r, name: prev.name, image: r.image ?? prev.image } : r;
    // tracked daily maxima of rolling-24h counts
    const day = String(Math.floor(now / DAY) * DAY);
    const t = (state.tracked[r.address] ??= {});
    const cur = t[day] ?? { traders: 0, trades: 0 };
    t[day] = { traders: Math.max(cur.traders, r.buyers24 ?? 0, r.sellers24 ?? 0), trades: Math.max(cur.trades, r.tx24 ?? 0) };
    n++;
  }
  return n;
}

const CHAIN_NEW_PER_RUN = Number(process.env.INDEXER_CHAIN_NEW_PER_RUN || 15000);
/** minutes of each run spent backfilling on-chain creation times (Helius has its own rate limit) */
const CHAIN_MINUTES = Number(process.env.INDEXER_CHAIN_MINUTES || 12);

/** Enumerate every StonkFun pool on-chain (Helius) and fill in metadata + creation times. */
async function chainPhase(state: State, gt: Gecko, stocks: Map<string, QuoteRef & { priceUsd: number }>, now: number) {
  const chain = (state.chain ??= { layouts: [], layoutsAt: 0, pools: {}, meta: {}, stats: {} });
  const stockMints = new Set(stocks.keys());
  // relearn weekly, or when the cached layouts predate shared-program detection
  if (!chain.layouts.length || now - chain.layoutsAt > 7 * DAY || chain.layouts.some((l) => l.shared === undefined)) {
    // StonkFun pools GeckoTerminal knows, spread across time (old and new)
    const known = Object.values(state.pools)
      .filter((p) => p.dexId === 'stonkfun')
      .sort((a, b) => a.createdAt - b.createdAt);
    const step = Math.max(1, Math.floor(known.length / 60));
    const positives = known.filter((_, i) => i % step === 0).map((p) => ({ address: p.address, mint: p.mint, quoteMint: p.quoteMint }));
    // other launchpads on the same infrastructure, as negatives
    const negatives: string[] = [];
    for (const dex of ['letsbonk-fun', 'raydium-launchlab']) {
      const res = await gt.get<GtList<GtPool>>(`/networks/${NETWORK}/dexes/${dex}/pools?page=1`);
      for (const p of res?.data ?? []) negatives.push(p.attributes.address);
    }
    const learned = await learnLayouts(positives, negatives);
    if (learned.length) {
      chain.layouts = learned;
      chain.layoutsAt = now;
      chain.pools = {}; // re-enumerate with the new filters
    }
  }
  const found: ChainPool[] = [];
  for (const l of chain.layouts) {
    if (l.platform) for (const v of l.platform.values) found.push(...(await enumeratePools(l, { offset: l.platform.offset, bytes: v })));
    else if (l.shared) for (const m of stockMints) found.push(...(await enumeratePools(l, { offset: l.quoteOff, bytes: m })));
    else found.push(...(await enumeratePools(l)));
  }
  // sanity: StonkFun is big, but not "every pool on a shared launch program" big
  const MAX_POOLS = Number(process.env.INDEXER_MAX_CHAIN_POOLS || 250_000);
  if (found.length > MAX_POOLS) {
    log(`helius: ${found.length} pools exceeds the sanity limit (${MAX_POOLS}); the filter is probably wrong — ignoring this enumeration`);
    chain.layoutsAt = 0;
    return;
  }
  for (const cp of found) chain.pools[cp.address] = { ...cp, createdAt: chain.pools[cp.address]?.createdAt };
  chain.enumeratedAt = now;
  log(`helius: ${found.length} StonkFun pools on-chain (${Object.keys(chain.pools).length} known)`);

  // pre-LaunchLab era (Aug 3 – Sept 5): one-transaction CLMM launches against a stock
  try {
    await legacyPhase(state, stockMints, now);
  } catch (e) {
    log(`legacy: failed: ${(e as Error).message}`);
  }

  // creation times for new pools
  const active = new Set(Object.entries(chain.stats).filter(([, v]) => (v.vol24 ?? 0) > 0).map(([m]) => m));
  const missing = Object.values(chain.pools)
    .filter((p) => !p.createdAt)
    .sort((a, b) => Number(active.has(b.baseMint)) - Number(active.has(a.baseMint)))
    .slice(0, CHAIN_NEW_PER_RUN);
  let done = 0;
  // creation-time backfill gets at most 40% of the run; the rest continues next run
  const stopAt = Date.now() + CHAIN_MINUTES * 60_000;
  await mapLimit(missing, 4, async (p) => {
    if (Date.now() > stopAt) return;
    try {
      p.createdAt = await creationTime(p.address);
    } catch (e) {
      log(`helius: creation time failed for ${p.address}: ${(e as Error).message}`);
    }
    if (++done % 500 === 0) log(`helius: creation times ${done}/${missing.length}`);
  });
  log(`helius: creation times found for ${done} of ${missing.length} new pools this run`);

  // token metadata (names, symbols, images)
  const tokenOf = (p: ChainPool) => (stockMints.has(p.baseMint) || CRYPTO.quotes.has(p.baseMint) ? p.quoteMint : p.baseMint);
  const legacyTokens = Object.values(chain.legacyCache?.pools ?? {}).filter((p) => p.launch === 1).map((p) => p.token);
  const needMeta = [...new Set([...legacyTokens, ...Object.values(chain.pools).map(tokenOf)])].filter((m) => !chain.meta[m]).slice(0, 20_000);
  if (needMeta.length) {
    const meta = await tokenMetadata(needMeta);
    for (const m of needMeta) chain.meta[m] = meta.get(m) ?? {};
    log(`helius: metadata for ${meta.size} of ${needMeta.length} new tokens`);
  }
}

const LEGACY_MINUTES = Number(process.env.INDEXER_LEGACY_MINUTES || 8);

async function legacyPhase(state: State, stockMints: Set<string>, now: number) {
  const chain = state.chain!;
  const cache = (chain.legacyCache ??= { pools: {} });
  if (!cache.layout) {
    const samples = Object.values(state.pools)
      .filter((p) => p.dexId === 'raydium-clmm' && stockMints.has(p.quoteMint))
      .map((p) => ({ address: p.address, mint: p.mint, quoteMint: p.quoteMint }));
    cache.layout = await learnClmmLayout(samples);
    if (!cache.layout) {
      log(`legacy: could not learn the CLMM pool layout (${samples.length} samples)`);
      return;
    }
  }
  // the set of pools is fixed for the era; re-enumerate weekly to catch anything missed
  if (!cache.enumeratedAt || now - cache.enumeratedAt > 7 * DAY) {
    const notCoins = new Set([...EXCLUDED_MINTS, ...CRYPTO.quotes.keys()]);
    const found = await enumerateStockPools(cache.layout, stockMints, notCoins);
    for (const p of found) cache.pools[p.address] ??= p;
    cache.enumeratedAt = now;
    log(`legacy: ${found.length} stock-quoted CLMM pools on-chain`);
  }
  await classify(cache, STONKFUN.launch, STONKFUN.launchlab, LEGACY_MINUTES);
  const c = legacyCounts(cache, STONKFUN.launch, STONKFUN.launchlab);
  chain.legacy = { byDay: c.byDay, total: c.total, countedAt: now, complete: c.pending === 0 && c.total > 0 };
  log(
    `legacy: ${c.total} launches Aug 3 – Sept 5 (one-transaction mint + CLMM pool)` +
      (c.pending ? `, ${c.pending} pools still to check` : '') +
      (c.topSigners.length ? ` · top signers ${c.topSigners.map(([w, n]) => `${w.slice(0, 6)}…×${n}`).join(', ')}` : ''),
  );
}

/** Legacy launches as pool records (GeckoTerminal's own record wins when it has one). */
function legacyRecords(state: State, stocks: Map<string, QuoteRef>, now: number): PoolRecord[] {
  const chain = state.chain;
  const cache = chain?.legacyCache;
  if (!cache) return [];
  const out: PoolRecord[] = [];
  for (const p of Object.values(cache.pools)) {
    if (p.launch !== 1 || !p.createdAt) continue;
    const q = stocks.get(p.quoteMint);
    if (!q) continue;
    const gt = state.pools[p.address];
    if (gt) {
      out.push({ ...gt, dexId: 'stonkfun-legacy' });
      continue;
    }
    const meta = chain!.meta[p.token] ?? {};
    const st = chain!.stats[p.token];
    const symbol = (meta.symbol || p.token.slice(0, 5)).replace(/^\$/, '');
    out.push({
      address: p.address,
      dexId: 'stonkfun-legacy',
      createdAt: p.createdAt,
      mint: p.token,
      symbol,
      name: meta.name || symbol,
      image: meta.image,
      quote: q.symbol,
      quoteMint: p.quoteMint,
      swapped: false,
      priceUsd: st?.priceUsd,
      fdvUsd: st?.fdvUsd,
      mcapUsd: st?.mcapUsd,
      reserveUsd: st?.reserveUsd,
      vol24: st?.vol24,
      observedAt: st?.observedAt ?? now,
    });
  }
  return out;
}

/** Token stats for chain-only markets from GeckoTerminal (30 tokens per call). */
async function chainStats(gt: Gecko, state: State, now: number, maxCalls: number) {
  const chain = state.chain;
  if (!chain) return;
  const known = new Set(Object.values(state.pools).map((p) => p.mint));
  const legacyTokens = Object.values(chain.legacyCache?.pools ?? {}).filter((p) => p.launch === 1).map((p) => p.token);
  const mints = [...new Set([...legacyTokens, ...Object.values(chain.pools).map((p) => p.baseMint)])].filter((m) => !known.has(m) && chain.meta[m] !== undefined);
  mints.sort((a, b) => (chain.stats[a]?.observedAt ?? 0) - (chain.stats[b]?.observedAt ?? 0));
  let calls = 0;
  for (let i = 0; i < mints.length && calls < maxCalls; i += 30) {
    const batch = mints.slice(i, i + 30);
    const res = await gt.get<{ data?: GtToken[] }>(`/networks/${NETWORK}/tokens/multi/${batch.join(',')}`);
    calls++;
    const attrs = new Map((res?.data ?? []).map((t) => [t.attributes.address, t.attributes as GtToken['attributes'] & Record<string, unknown>]));
    for (const m of batch) {
      const a = attrs.get(m);
      const vol = a?.volume_usd as Record<string, string> | undefined;
      chain.stats[m] = {
        priceUsd: num(a?.price_usd),
        vol24: num(vol?.h24) ?? 0,
        mcapUsd: num(a?.market_cap_usd),
        fdvUsd: num(a?.fdv_usd),
        reserveUsd: num(a?.total_reserve_in_usd),
        observedAt: now,
      };
    }
  }
  if (calls) log(`stats: refreshed ${Math.min(mints.length, calls * 30)} chain-only tokens`);
}

/** Every pool record: GeckoTerminal's, chain-only ones and pre-LaunchLab launches. */
function allRecords(state: State, stocks: Map<string, QuoteRef>, now: number): PoolRecord[] {
  const legacy = legacyRecords(state, stocks, now);
  const legacyAddr = new Set(legacy.map((r) => r.address));
  return [...Object.values(state.pools).filter((p) => !legacyAddr.has(p.address)), ...chainRecords(state, stocks, now), ...legacy];
}

/** Pool records for on-chain pools GeckoTerminal never listed. */
function chainRecords(state: State, stocks: Map<string, QuoteRef>, now: number): PoolRecord[] {
  const chain = state.chain;
  if (!chain) return [];
  const out: PoolRecord[] = [];
  for (const p of Object.values(chain.pools)) {
    if (state.pools[p.address] || !p.createdAt) continue;
    const swapped = stocks.has(p.baseMint) || CRYPTO.quotes.has(p.baseMint);
    const token = swapped ? p.quoteMint : p.baseMint;
    const qm = swapped ? p.baseMint : p.quoteMint;
    const q = stocks.get(qm) ?? CRYPTO.quotes.get(qm);
    if (!q || EXCLUDED_MINTS.has(token)) continue;
    const meta = chain.meta[token] ?? {};
    const st = chain.stats[token];
    const symbol = (meta.symbol || token.slice(0, 5)).replace(/^\$/, '');
    out.push({
      address: p.address,
      dexId: p.program === 'stonkfun' ? 'stonkfun' : 'raydium-launchlab',
      createdAt: p.createdAt,
      mint: token,
      symbol,
      name: meta.name || symbol,
      image: meta.image,
      quote: q.symbol,
      quoteMint: qm,
      swapped,
      priceUsd: st?.priceUsd,
      fdvUsd: st?.fdvUsd,
      mcapUsd: st?.mcapUsd,
      reserveUsd: st?.reserveUsd,
      vol24: st?.vol24,
      observedAt: st?.observedAt ?? now,
    });
  }
  return out;
}

// ── compact on-chain cache (kept out of state.json; each file well under GitHub's 100 MB) ──
type PoolRow = [string, 0 | 1, string, string, number]; // address, program(0 stonkfun/1 launchlab), base, quote, createdAt sec (0 = unknown)
async function loadChain(state: State) {
  if (!state.chain) return;
  const rows = await readJson<PoolRow[] | null>(join(OUT, 'cache', 'chain-pools.json'), null);
  if (rows) state.chain.pools = Object.fromEntries(rows.map(([a, k, b, q, t]) => [a, { address: a, program: k ? 'launchlab' : 'stonkfun', baseMint: b, quoteMint: q, createdAt: t ? t * 1000 : undefined }]));
  const meta = await readJson<Record<string, [string?, string?, string?]> | null>(join(OUT, 'cache', 'chain-meta.json'), null);
  if (meta) state.chain.meta = Object.fromEntries(Object.entries(meta).map(([m, [n, sy, im]]) => [m, { name: n || undefined, symbol: sy || undefined, image: im || undefined }]));
  const stats = await readJson<State['chain'] extends infer C ? (C extends { stats: infer S } ? S : never) : never>(join(OUT, 'cache', 'chain-stats.json'), {} as never);
  if (stats) state.chain.stats = stats;
  const legacy = await readJson<{ layout?: LegacyCache['layout']; enumeratedAt?: number; rows: LegacyRow[] } | null>(join(OUT, 'cache', 'legacy-pools.json'), null);
  if (legacy) state.chain.legacyCache = { layout: legacy.layout, enumeratedAt: legacy.enumeratedAt, pools: fromRows(legacy.rows) };
}
async function saveChain(state: State) {
  const c = state.chain;
  if (!c) return;
  const rows: PoolRow[] = Object.values(c.pools).map((p) => [p.address, p.program === 'launchlab' ? 1 : 0, p.baseMint, p.quoteMint, p.createdAt ? Math.round(p.createdAt / 1000) : 0]);
  await writeJson(join(OUT, 'cache', 'chain-pools.json'), rows);
  await writeJson(join(OUT, 'cache', 'chain-meta.json'), Object.fromEntries(Object.entries(c.meta).map(([m, v]) => [m, [v.name ?? '', v.symbol ?? '', v.image ?? '']])));
  await writeJson(join(OUT, 'cache', 'chain-stats.json'), c.stats);
  if (c.legacyCache) await writeJson(join(OUT, 'cache', 'legacy-pools.json'), { layout: c.legacyCache.layout, enumeratedAt: c.legacyCache.enumeratedAt, rows: toRows(c.legacyCache) });
}

async function main() {
  const now = Date.now();
  await mkdir(join(OUT, 'v1', 'bars'), { recursive: true });
  await mkdir(join(OUT, 'cache'), { recursive: true });
  const state = await readJson<State>(join(OUT, 'cache', 'state.json'), { version: 1, quotes: {}, pools: {}, tracked: {}, history: {}, lastDeepDiscovery: {} });
  await loadChain(state);
  state.lastDeepDiscovery ??= {};
  const gt = new Gecko(BUDGET);
  const seen = new Set<string>();

  // platform totals first: a separate API with its own rate limit
  const platform = await fetchPlatformVolume(now);
  if (platform) state.platform = platform;

  try {
    log(`run start · ${Object.keys(state.pools).length} known pools · budget ${BUDGET} calls`);
    const quotes = await resolveQuotes(gt, state, now);
    log(`quotes resolved: ${[...quotes.values()].map((q) => q.symbol).join(', ') || 'none'}`);
    const qref = new Map([...quotes].map(([k, v]) => [k, { symbol: v.symbol, mint: v.mint }]));

    // discovery: brand-new pools first, then every quote's pools by activity
    {
      const res = await gt.get<GtList<GtPool>>(`/networks/${NETWORK}/new_pools?include=base_token,quote_token,dex&page=1`);
      for (const p of res?.data ?? []) seen.add(p.attributes.address);
      ingest(state, res, qref, now);
    }
    // StonkFun's own pool list: busiest two pages every run, plus two deeper rotating pages
    {
      const deepPage = state.stonkfunPage ?? 3;
      let found = 0;
      for (const page of [1, 2, deepPage, deepPage + 1]) {
        const res = await gt.get<GtList<GtPool>>(`/networks/${NETWORK}/dexes/stonkfun/pools?include=base_token,quote_token,dex&sort=h24_volume_usd_desc&page=${page}`);
        for (const p of res?.data ?? []) seen.add(p.attributes.address);
        found += ingest(state, res, qref, now);
        if (page >= deepPage && (res?.data?.length ?? 0) < 20) {
          state.stonkfunPage = 3;
          break;
        }
        if (page === deepPage + 1) state.stonkfunPage = deepPage + 2 > PAGES ? 3 : deepPage + 2;
      }
      log(`stonkfun dex: ${found} pools in view`);
    }
    // the free API is tight (~10 calls/min from CI), so deep discovery rotates:
    // a few quotes get all pages each run, the rest just their busiest page
    state.lastShallowDiscovery ??= {};
    const byAge = (m: Record<string, number>) => [...quotes.values()].sort((a, b) => (m[a.symbol] ?? 0) - (m[b.symbol] ?? 0));
    const deepSet = new Set(byAge(state.lastDeepDiscovery).slice(0, DEEP_PER_RUN).map((q) => q.symbol));
    const shallowSet = new Set(byAge(state.lastShallowDiscovery).filter((q) => !deepSet.has(q.symbol)).slice(0, SHALLOW_PER_RUN).map((q) => q.symbol));
    for (const q of quotes.values()) {
      const deep = deepSet.has(q.symbol);
      if (!deep && !shallowSet.has(q.symbol)) continue;
      state.lastShallowDiscovery[q.symbol] = now;
      const pages = deep ? PAGES : 1;
      let found = 0;
      for (let page = 1; page <= pages; page++) {
        const res = await gt.get<GtList<GtPool>>(`/networks/${NETWORK}/tokens/${q.mint}/pools?include=base_token,quote_token,dex&sort=h24_volume_usd_desc&page=${page}`);
        for (const p of res?.data ?? []) seen.add(p.attributes.address);
        found += ingest(state, res, qref, now);
        if ((res?.data?.length ?? 0) < 20) break;
      }
      if (deep) state.lastDeepDiscovery[q.symbol] = now;
      log(`${q.symbol}: ${found} markets in view`);
    }

    // refresh known pools we didn't see this run (30 per call)
    const stale = Object.values(state.pools)
      .filter((p) => !seen.has(p.address) && now - p.observedAt > HOUR && (p.vol24 ?? 0) > 0)
      .sort((a, b) => (b.vol24 ?? 0) - (a.vol24 ?? 0));
    for (let i = 0; i < Math.min(stale.length, 90) && gt.remaining > 120; i += 30) {
      const ids = stale.slice(i, i + 30).map((p) => p.address);
      const res = await gt.get<GtList<GtPool>>(`/networks/${NETWORK}/pools/multi/${ids.join(',')}?include=base_token,quote_token,dex`);
      ingest(state, res, qref, now);
    }

    // complete enumeration from chain state when a Helius key is configured
    if (heliusEnabled()) {
      try {
        await chainPhase(state, gt, quotes, now);
        await chainStats(gt, state, now, Math.floor(gt.remaining * 0.4));
      } catch (e) {
        if (e instanceof BudgetExhausted) throw e;
        log(`helius phase failed: ${(e as Error).message}`);
      }
    }

    // history: new markets get full daily OHLCV, active ones a short top-up
    // one history per StonkFun token: its primary pool
    const stockSet = new Set(QUOTE_SPECS.map((s) => s.symbol));
    const all = allRecords(state, qref, now);
    const sf = stonkFunMints(all, stockSet);
    const pools = groupByMint(all.filter((p) => sf.has(p.mint))).map((g) => g.primary);
    const queue = [
      ...pools.filter((p) => !state.history[p.address]).sort((a, b) => (b.vol24 ?? 0) - (a.vol24 ?? 0)),
      ...pools
        .filter((p) => state.history[p.address] && (p.vol24 ?? 0) > 0 && now - state.history[p.address].fetchedAt > 6 * HOUR)
        .sort((a, b) => state.history[a.address].fetchedAt - state.history[b.address].fetchedAt),
    ];
    let fetched = 0;
    for (const p of queue) {
      if (gt.remaining < 2) break;
      const full = !state.history[p.address];
      const res = await gt.get(`/networks/${NETWORK}/pools/${p.address}/ohlcv/day?aggregate=1&limit=${full ? 1000 : 10}&currency=usd&token=${p.mint}`);
      if (!res) continue;
      const fresh = parseOhlcv(res);
      const file = join(OUT, 'v1', 'bars', `${p.address}.json`);
      const old = full ? [] : await readJson<Ohlcv[]>(file, []);
      const merged = new Map<number, Ohlcv>();
      for (const b of [...old, ...fresh]) merged.set(b[0], b);
      await writeJson(file, [...merged.values()].sort((a, b) => a[0] - b[0]).map((b) => b.map((x, i) => (i === 0 ? x : +x.toPrecision(6)))));
      state.history[p.address] = { fetchedAt: now };
      fetched++;
    }
    log(`history: fetched ${fetched} of ${queue.length} queued`);
  } catch (e) {
    if (!(e instanceof BudgetExhausted)) throw e;
    log('budget exhausted — writing what we have; the next run continues');
  }

  // build outputs
  const qrefAll = new Map(Object.entries(state.quotes).filter(([, v]) => v.mint).map(([sym, v]) => [v.mint, { symbol: sym, mint: v.mint }]));
  const records = allRecords(state, qrefAll, now);
  const bars = new Map<string, Ohlcv[]>();
  for (const r of records) {
    const f = join(OUT, 'v1', 'bars', `${r.address}.json`);
    if (existsSync(f)) bars.set(r.address, await readJson<Ohlcv[]>(f, []));
  }
  const quoteAssets: QuoteAsset[] = [
    ...QUOTE_SPECS.filter((s) => state.quotes[s.symbol]?.mint).map((s) => specToQuote(s, state.quotes[s.symbol].mint, state.quotes[s.symbol].priceUsd)),
    ...CRYPTO_QUOTE_SPECS.map((c) => specToQuote(c, c.mint!, state.cryptoPrices?.[c.symbol] ?? 0)),
  ];
  const fresh = Boolean(state.chain?.enumeratedAt && now - state.chain.enumeratedAt < 2 * DAY);
  const chainPools = fresh ? Object.values(state.chain!.pools) : [];
  const dated = chainPools.filter((p) => p.createdAt);
  const chainInfo = fresh
    ? {
        totalPools: chainPools.length,
        datedPools: dated.length,
        // exact launches per UTC day from on-chain creation times
        legacyTotal: state.chain!.legacy?.total ?? 0,
        legacyComplete: state.chain!.legacy?.complete ?? false,
        createdByDay: dated.reduce<Record<string, number>>((acc, p) => {
          const d = String(Math.floor(p.createdAt! / DAY) * DAY);
          acc[d] = (acc[d] ?? 0) + 1;
          return acc;
        }, { ...(state.chain!.legacy?.byDay ?? {}) }),
      }
    : undefined;
  const built = buildArchive(records, bars, state.tracked, quoteAssets, now, state.platform, chainInfo);

  // prune tracked days older than 400 days to bound state size
  const cutoff = now - 400 * DAY;
  for (const t of Object.values(state.tracked)) for (const d of Object.keys(t)) if (Number(d) < cutoff) delete t[d];

  await writeJson(join(OUT, 'v1', 'meta.json'), built.meta);
  await writeJson(join(OUT, 'v1', 'markets.json'), built.markets);
  await writeJson(join(OUT, 'v1', 'ecosystem.json'), built.ecosystem);
  await writeJson(join(OUT, 'v1', 'activity.json'), built.activity);
  await saveChain(state);
  await writeJson(join(OUT, 'cache', 'state.json'), { ...state, chain: state.chain ? { ...state.chain, pools: {}, meta: {}, stats: {}, legacyCache: undefined } : undefined });
  log(`helius calls this run: ${heliusCalls()}`);
  log(`done · ${built.markets.length} markets · ${bars.size} with history · ${gt.calls} API calls`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

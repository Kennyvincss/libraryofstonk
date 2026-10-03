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
import { NETWORK, num, parseOhlcv, poolToRecord, tokenMap, type GtList, type GtPool, type GtToken, type Ohlcv, type PoolRecord, type QuoteRef } from '../src/data/live/gecko';
import { EXCLUDED_MINTS, QUOTE_SPECS, specToQuote } from '../src/data/live/quotes';
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
  const verified = new Map<string, { mint: string; priceUsd: number }>();
  const mints = [...candidates.keys()];
  for (let i = 0; i < mints.length; i += 30) {
    const res = await gt.get<{ data?: GtToken[] }>(`/networks/${NETWORK}/tokens/multi/${mints.slice(i, i + 30).join(',')}`);
    for (const t of res?.data ?? []) {
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

function ingest(state: State, list: GtList<GtPool> | null, quotes: Map<string, QuoteRef>, now: number): number {
  const toks = tokenMap(list?.included);
  let n = 0;
  for (const p of list?.data ?? []) {
    const r = poolToRecord(p, toks, quotes, EXCLUDED_MINTS, now);
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

async function main() {
  const now = Date.now();
  await mkdir(join(OUT, 'v1', 'bars'), { recursive: true });
  await mkdir(join(OUT, 'cache'), { recursive: true });
  const state = await readJson<State>(join(OUT, 'cache', 'state.json'), { version: 1, quotes: {}, pools: {}, tracked: {}, history: {}, lastDeepDiscovery: {} });
  state.lastDeepDiscovery ??= {};
  const gt = new Gecko(BUDGET);
  const seen = new Set<string>();

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

    // history: new markets get full daily OHLCV, active ones a short top-up
    // one history per token: its primary pool
    const pools = groupByMint(Object.values(state.pools)).map((g) => g.primary);
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
  const records = Object.values(state.pools);
  const bars = new Map<string, Ohlcv[]>();
  for (const r of records) {
    const f = join(OUT, 'v1', 'bars', `${r.address}.json`);
    if (existsSync(f)) bars.set(r.address, await readJson<Ohlcv[]>(f, []));
  }
  const quoteAssets: QuoteAsset[] = QUOTE_SPECS.filter((s) => state.quotes[s.symbol]?.mint).map((s) => specToQuote(s, state.quotes[s.symbol].mint, state.quotes[s.symbol].priceUsd));
  const used = new Set(records.map((r) => r.quote));
  const built = buildArchive(records, bars, state.tracked, quoteAssets.filter((q) => used.has(q.symbol)), now);

  // prune tracked days older than 400 days to bound state size
  const cutoff = now - 400 * DAY;
  for (const t of Object.values(state.tracked)) for (const d of Object.keys(t)) if (Number(d) < cutoff) delete t[d];

  await writeJson(join(OUT, 'v1', 'meta.json'), built.meta);
  await writeJson(join(OUT, 'v1', 'markets.json'), built.markets);
  await writeJson(join(OUT, 'v1', 'ecosystem.json'), built.ecosystem);
  await writeJson(join(OUT, 'v1', 'activity.json'), built.activity);
  await writeJson(join(OUT, 'cache', 'state.json'), state);
  log(`done · ${built.markets.length} markets · ${bars.size} with history · ${gt.calls} API calls`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

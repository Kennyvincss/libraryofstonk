/**
 * Pure archive assembly: pool records + daily OHLCV + tracked counts →
 * the static dataset the site reads. No network here, so it is unit-testable.
 */
import type { EcosystemDay, Market, MarketStatus, QuoteAsset, SourceMeta } from '../src/data/types';
import type { Ohlcv, PoolRecord } from '../src/data/live/gecko';
import { scoreMarkets } from '../src/engine/notability';
import { STONKFUN, stonkFunMints } from '../src/data/live/stonkfun';

const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;

/** Per pool, per UTC day: the highest rolling-24h counts observed that day. */
export type Tracked = Record<string, Record<string, { traders: number; trades: number }>>;

export interface Activity {
  start: number;
  days: number;
  /** pool → [first day offset, vol day0, vol day1, …] (USD, rounded) */
  rows: Record<string, number[]>;
}

export interface BuiltArchive {
  meta: SourceMeta & { generatedAt: number; method: string[] };
  markets: Market[];
  ecosystem: EcosystemDay[];
  activity: Activity;
}

/**
 * A token can have several pools (bonding curve, then the AMM it graduates
 * to, sometimes more than one quote). One market per token: the busiest pool
 * is primary, volumes and counts are summed across its pools.
 */
export function groupByMint(records: PoolRecord[]): { primary: PoolRecord; pools: PoolRecord[] }[] {
  const by = new Map<string, PoolRecord[]>();
  for (const r of records) {
    const arr = by.get(r.mint) ?? [];
    arr.push(r);
    by.set(r.mint, arr);
  }
  const weight = (r: PoolRecord) => (r.vol24 ?? 0) + (r.reserveUsd ?? 0) * 0.5;
  return [...by.values()].map((pools) => {
    const sorted = [...pools].sort((a, b) => weight(b) - weight(a));
    return { primary: sorted[0], pools: sorted };
  });
}

function mergePools(g: { primary: PoolRecord; pools: PoolRecord[] }): PoolRecord {
  if (g.pools.length === 1) return g.primary;
  const sum = (f: (r: PoolRecord) => number | undefined) => g.pools.reduce((s, r) => s + (f(r) ?? 0), 0);
  return {
    ...g.primary,
    createdAt: Math.min(...g.pools.map((r) => r.createdAt)),
    vol24: sum((r) => r.vol24),
    tx24: sum((r) => r.tx24),
    buyers24: sum((r) => r.buyers24),
    sellers24: sum((r) => r.sellers24),
    reserveUsd: sum((r) => r.reserveUsd),
  };
}

/** Daily bars across a token's pools: prices from the primary, volume summed. */
function mergeBars(g: { primary: PoolRecord; pools: PoolRecord[] }, bars: Map<string, Ohlcv[]>): Ohlcv[] {
  const out = new Map<number, Ohlcv>();
  for (const r of g.pools) {
    const isPrimary = r === g.primary;
    for (const b of bars.get(r.address) ?? []) {
      const cur = out.get(b[0]);
      if (!cur) out.set(b[0], [...b] as Ohlcv);
      else if (isPrimary) out.set(b[0], [b[0], b[1], b[2], b[3], b[4], b[5] + cur[5]]);
      else cur[5] += b[5];
    }
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}

export function buildMarket(r: PoolRecord, bars: Ohlcv[], tracked: Tracked[string] | undefined, now: number): Market {
  const price = r.priceUsd ?? (bars.length ? bars[bars.length - 1][4] : 0);
  let ath = price;
  let athAt = now;
  let athIdx = -1;
  let vol = 0;
  let v7 = 0;
  let peakV = 0;
  let peakAt = r.createdAt;
  let lastActive = 0;
  bars.forEach((b, i) => {
    const [t, , h, , , v] = b;
    if (h > ath || athIdx < 0) {
      ath = Math.max(h, ath);
      athAt = t;
      athIdx = i;
    }
    vol += v;
    if (t >= now - 7 * DAY) v7 += v;
    if (v > peakV) [peakV, peakAt] = [v, t];
    if (v > 0) lastActive = t + DAY - 1;
  });
  if (price > ath) [ath, athAt] = [price, now];
  let postLow = ath;
  for (let i = Math.max(0, athIdx); i < bars.length; i++) postLow = Math.min(postLow, bars[i][3]);
  postLow = Math.min(postLow, price || postLow);

  const launch = bars.length ? bars[0][1] : price;
  const vol24 = r.vol24 ?? 0;
  const lastTradeAt = vol24 > 0 ? now : Math.min(now, lastActive || r.createdAt);

  // lifetime counts: sum of the per-day maxima observed since tracking began
  let traders = 0;
  let trades = 0;
  for (const d of Object.values(tracked ?? {})) {
    traders += d.traders;
    trades += d.trades;
  }
  const traders24h = Math.max(r.buyers24 ?? 0, r.sellers24 ?? 0);
  traders = Math.max(traders, traders24h);
  trades = Math.max(trades, r.tx24 ?? 0);

  let change24h = r.change24h;
  if (change24h === undefined && bars.length >= 2) change24h = bars[bars.length - 1][4] / bars[bars.length - 2][4] - 1;

  let status: MarketStatus = /launchlab|bonding|stonkfun/i.test(r.dexId ?? '') ? 'bonding' : 'graduated';
  if (now - lastTradeAt > 3 * DAY) status = 'dead';
  else if (Math.max(v7, vol24) < 40 && now - r.createdAt > 7 * DAY) status = 'dormant';

  return {
    id: r.address,
    mint: r.mint,
    ticker: r.symbol.replace(/^\$/, '').slice(0, 12),
    name: r.name,
    image: r.image,
    quote: r.quote,
    createdAt: r.createdAt,
    lastTradeAt,
    status,
    priceUsd: price,
    priceQuote: r.priceQuote ?? 0,
    launchPriceUsd: launch || price,
    athPriceUsd: ath,
    athAt,
    postAthLowUsd: postLow,
    change24h: Number.isFinite(change24h) ? (change24h as number) : 0,
    marketCapUsd: r.mcapUsd ?? r.fdvUsd ?? 0,
    liquidityUsd: r.reserveUsd ?? 0,
    volume24hUsd: vol24,
    volume7dUsd: Math.max(v7, vol24),
    volumeLifetimeUsd: Math.max(vol, v7, vol24),
    peakDayVolumeUsd: peakV,
    peakDayAt: peakAt,
    trades,
    trades24h: r.tx24 ?? 0,
    traders,
    traders24h,
  };
}

export interface Platform {
  source: string;
  url: string;
  daily: Record<string, number>;
  total24h?: number;
  total7d?: number;
  total30d?: number;
  totalAllTime?: number;
}

export function buildArchive(records: PoolRecord[], poolBars: Map<string, Ohlcv[]>, poolTracked: Tracked, quotes: QuoteAsset[], now: number, platform?: Platform | null): BuiltArchive {
  // StonkFun markets only: tokens with a StonkFun (or post-switch LaunchLab) pool
  const stockSet = new Set(quotes.filter((q) => q.kind !== 'crypto' && q.kind !== 'stable').map((q) => q.symbol));
  const sf = stonkFunMints(records, stockSet);
  const groups = groupByMint(records.filter((r) => sf.has(r.mint) && r.createdAt >= STONKFUN.stonkDeployed - DAY));
  // per token: tracked counts summed across its pools, bars merged, keyed by primary pool
  const tracked: Tracked = {};
  const bars = new Map<string, Ohlcv[]>();
  for (const g of groups) {
    const t: Tracked[string] = {};
    for (const r of g.pools)
      for (const [d, v] of Object.entries(poolTracked[r.address] ?? {})) {
        const cur = t[d] ?? { traders: 0, trades: 0 };
        t[d] = { traders: cur.traders + v.traders, trades: cur.trades + v.trades };
      }
    tracked[g.primary.address] = t;
    bars.set(g.primary.address, mergeBars(g, poolBars));
  }
  const markets = groups.map((g) => buildMarket(mergePools(g), bars.get(g.primary.address) ?? [], tracked[g.primary.address], now));
  const start = dayOf(Math.min(now, STONKFUN.stonkDeployed, ...markets.map((m) => m.createdAt)));
  const days = Math.max(1, Math.floor((dayOf(now) - start) / DAY) + 1);

  // ecosystem by day
  const eco: EcosystemDay[] = Array.from({ length: days }, (_, d) => ({ t: start + d * DAY, marketsCreated: 0, volumeUsd: 0, trades: 0, activeTraders: 0, activeMarkets: 0, marketReturn: 0 }));
  const retW = new Float64Array(days);
  const rows: Record<string, number[]> = {};
  for (const m of markets) {
    const ci = Math.floor((dayOf(m.createdAt) - start) / DAY);
    if (eco[ci]) eco[ci].marketsCreated++;
    const bs = bars.get(m.id) ?? [];
    if (bs.length) {
      const first = Math.floor((dayOf(bs[0][0]) - start) / DAY);
      const row = [Math.max(0, first)];
      for (const [t, o, , , c, v] of bs) {
        const di = Math.floor((dayOf(t) - start) / DAY);
        if (di < 0 || di >= days) continue;
        row[di - Math.max(0, first) + 1] = Math.round(v);
        const e = eco[di];
        e.volumeUsd += v;
        if (v > 0) e.activeMarkets++;
        if (t - m.createdAt > 3 * DAY && o > 0 && c > 0 && v > 0) {
          const w = Math.log1p(v);
          e.marketReturn! += w * Math.log(c / o);
          retW[di] += w;
        }
      }
      for (let i = 1; i < row.length; i++) row[i] ??= 0;
      rows[m.id] = row;
    }
    for (const [day, d] of Object.entries(tracked[m.id] ?? {})) {
      const di = Math.floor((Number(day) - start) / DAY);
      if (!eco[di]) continue;
      eco[di].trades += d.trades;
      eco[di].activeTraders += d.traders;
    }
  }
  eco.forEach((e, i) => (e.marketReturn = retW[i] > 0 ? e.marketReturn! / retW[i] : 0));
  // platform-wide daily volume is authoritative when we have it
  if (platform && Object.keys(platform.daily).length) for (const e of eco) e.volumeUsd = platform.daily[String(e.t)] ?? 0;

  // most notable first, exactly how the site will rank them
  const { rank } = scoreMarkets(markets, now, new Map());
  const order = markets.map((_, i) => i).sort((a, b) => rank[a] - rank[b]);
  const sorted = order.map((i) => markets[i]);

  return {
    meta: {
      kind: 'api',
      isDemo: false,
      label: 'StonkFun on Solana · via GeckoTerminal',
      archiveStart: start,
      archiveEnd: now,
      totalMarkets: sorted.length,
      quoteAssets: quotes.filter((q) => sorted.some((m) => m.quote === q.symbol)),
      generatedAt: now,
      coverage: 'partial',
      platform: platform
        ? { source: platform.source, url: platform.url, volume24h: platform.total24h, volume7d: platform.total7d, volume30d: platform.total30d, volumeAllTime: platform.totalAllTime }
        : undefined,
      method: [
        platform
          ? `Platform-wide daily and all-time volume come from ${platform.source} (${platform.url}).`
          : 'Platform-wide volume is the sum of tracked markets (no platform-level source was reachable).',
        'Individual markets are those GeckoTerminal currently lists, its busiest StonkFun pools, accumulated run after run. That is not every market ever launched, so counts are labelled “tracked”.',
        'Markets are tokens launched on StonkFun: GeckoTerminal indexes StonkFun’s bonding curve as its own exchange, and from Sept 6, 2026 StonkFun deploys through Raydium LaunchLab with stock-quoted pools. Each token’s graduated pools are merged into it.',
        'The archive starts on July 23, 2026, when the STONK platform token was deployed; StonkFun launched on August 3, 2026.',
        'Prices, liquidity, 24h volume and daily OHLCV come from GeckoTerminal.',
        'Lifetime traders and trades are the sum of the busiest rolling-24h counts observed each day since tracking began, so they undercount history before the first indexer run.',
      ],
    },
    markets: sorted,
    ecosystem: eco,
    activity: { start, days, rows },
  };
}

import type { DataSource } from '../source';
import type { ActivityEvent, Bar, EcosystemDay, Market, MarketPage, Snapshot, SourceMeta, Trade } from '../types';
import { GECKO_API, NETWORK, parseOhlcv, parseTrades, poolToRecord, tokenMap, type GtList, type GtPool, type Ohlcv } from './gecko';
import { CRYPTO_QUOTE_SPECS, EXCLUDED_MINTS } from './quotes';
import { STONKFUN, isStonkFunPool } from './stonkfun';

const CRYPTO = { quotes: new Map(CRYPTO_QUOTE_SPECS.map((c) => [c.mint!, { symbol: c.symbol, mint: c.mint! }])), dexIds: STONKFUN.dexIds };

const DAY = 86_400_000;

interface Activity {
  start: number;
  days: number;
  rows: Record<string, number[]>;
}

/**
 * Real data. The archive (markets, history, ecosystem) comes from the static
 * dataset the indexer publishes; charts, trades and the live feed come
 * straight from GeckoTerminal in the visitor's browser.
 */
export class LiveSource implements DataSource {
  private readonly base: string;
  private readonly gecko: string;
  private metaP?: Promise<SourceMeta>;
  private marketsP?: Promise<Market[]>;
  private activityP?: Promise<{ a: Activity; prefix: Map<string, Float64Array> }>;
  private byId = new Map<string, Market>();
  private seriesCache = new Map<string, Promise<Bar[]>>();

  constructor(opts: { dataUrl: string; geckoApi?: string }) {
    this.base = opts.dataUrl.replace(/\/$/, '');
    this.gecko = (opts.geckoApi || GECKO_API).replace(/\/$/, '');
  }

  private async json<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}/${path}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Archive dataset unavailable (${res.status} on ${path})`);
    return (await res.json()) as T;
  }

  private async gt<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.gecko}${path}`, { headers: { accept: 'application/json' } });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  meta(): Promise<SourceMeta> {
    this.metaP ??= this.json<SourceMeta>('meta.json').then((m) => ({ ...m, kind: 'api' as const, isDemo: false }));
    return this.metaP;
  }

  private markets(): Promise<Market[]> {
    this.marketsP ??= this.json<Market[]>('markets.json').then((ms) => {
      for (const m of ms) this.byId.set(m.id, m);
      return ms;
    });
    return this.marketsP;
  }

  async marketsPage(cursor?: string, limit = 5000): Promise<MarketPage> {
    const ms = await this.markets();
    const from = cursor ? Number(cursor) : 0;
    return { markets: ms.slice(from, from + limit), next: from + limit < ms.length ? String(from + limit) : undefined, total: ms.length };
  }

  async market(id: string) {
    await this.markets();
    return this.byId.get(id);
  }

  /**
   * Daily history from the dataset, with GeckoTerminal's hourly candles
   * spliced in where they exist (recent weeks) for detail.
   */
  series(id: string): Promise<Bar[]> {
    let p = this.seriesCache.get(id);
    if (!p) {
      p = (async () => {
        const m = await this.market(id);
        const toBar = ([t, o, h, l, c, v]: Ohlcv): Bar => ({ t, o, h, l, c, v, n: 0, newTraders: 0 });
        const daily = (await this.json<Ohlcv[]>(`bars/${encodeURIComponent(id)}.json`).catch(() => [] as Ohlcv[])).map(toBar);
        const hourlyRaw = m ? await this.gt<unknown>(`/networks/${NETWORK}/pools/${id}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=${m.mint}`) : null;
        const hourly = hourlyRaw ? parseOhlcv(hourlyRaw).map(toBar) : [];
        if (!hourly.length) return daily;
        const cut = hourly[0].t;
        return [...daily.filter((b) => b.t + DAY <= cut), ...hourly];
      })();
      this.seriesCache.set(id, p);
    }
    return p;
  }

  async trades(id: string, limit = 30): Promise<Trade[]> {
    const m = await this.market(id);
    if (!m) return [];
    const res = await this.gt<unknown>(`/networks/${NETWORK}/pools/${id}/trades`);
    return res ? parseTrades(res, m.mint).slice(0, limit) : [];
  }

  ecosystem(): Promise<EcosystemDay[]> {
    return this.json<EcosystemDay[]>('ecosystem.json');
  }

  async snapshot(at: number): Promise<Snapshot> {
    this.activityP ??= this.json<Activity>('activity.json').then((a) => {
      // prefix sums per market for O(1) trailing-7-day windows
      const prefix = new Map<string, Float64Array>();
      for (const [id, row] of Object.entries(a.rows)) {
        const p = new Float64Array(row.length);
        for (let i = 1; i < row.length; i++) p[i] = p[i - 1] + (row[i] || 0);
        prefix.set(id, p);
      }
      return { a, prefix };
    });
    const [{ a, prefix }, ms] = await Promise.all([this.activityP, this.markets()]);
    const di = Math.floor((at - a.start) / DAY);
    const activity = new Map<string, number>();
    for (const m of ms) {
      if (m.createdAt > at) continue;
      const row = a.rows[m.id];
      const p = prefix.get(m.id);
      if (!row || !p) {
        activity.set(m.id, 0);
        continue;
      }
      const first = row[0];
      // row index 1 = day `first`; window covers days di-6..di
      const hi = Math.min(p.length - 1, di - first + 1);
      const lo = Math.max(0, di - 6 - first);
      activity.set(m.id, hi > lo ? p[hi] - p[lo] : 0);
    }
    return { at, activity };
  }

  async moments() {
    return undefined; // detected by the engine from real data
  }

  /**
   * Real live feed, polled from GeckoTerminal:
   *  • new pools quoted in a tracked stock  → "New market launched"
   *  • the busiest markets every 30s          → volume / trader milestones, new highs
   */
  subscribe(onEvent: (e: ActivityEvent) => void): () => void {
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const last = new Map<string, { vol: number; traders: number; price: number }>();
    const seenPools = new Set<string>();
    let n = 0;
    const emit = (e: Omit<ActivityEvent, 'id' | 'simulated'>) => onEvent({ ...e, id: `live-${Date.now()}-${n++}`, simulated: false });
    const VOL_STEPS = [10_000, 50_000, 100_000, 250_000, 500_000, 1e6, 2.5e6, 5e6, 10e6];
    const TRADER_STEPS = [100, 250, 500, 1000, 2500, 5000, 10_000];
    const crossed = (steps: number[], a: number, b: number) => steps.filter((s) => a < s && b >= s).pop();

    const ready = Promise.all([this.meta(), this.markets()]);

    const pollNew = async () => {
      const [meta, ms] = await ready;
      if (stopped) return;
      const stocks = meta.quoteAssets.filter((q) => q.mint && q.kind !== 'crypto' && q.kind !== 'stable');
      const quotes = new Map(stocks.map((q) => [q.mint!, { symbol: q.symbol, mint: q.mint! }]));
      const stockSet = new Set(stocks.map((q) => q.symbol));
      for (const m of ms) seenPools.add(m.id);
      const res = await this.gt<GtList<GtPool>>(`/networks/${NETWORK}/new_pools?include=base_token,quote_token,dex&page=1`);
      const toks = tokenMap(res?.included);
      for (const p of res?.data ?? []) {
        const r = poolToRecord(p, toks, quotes, EXCLUDED_MINTS, Date.now(), CRYPTO);
        if (!r || seenPools.has(r.address) || !isStonkFunPool(r, stockSet)) continue;
        seenPools.add(r.address);
        emit({ t: r.createdAt, kind: 'launch', marketId: this.byId.has(r.address) ? r.address : undefined, ticker: r.symbol, quote: r.quote, text: `New market launched: $${r.symbol} / ${r.quote}` });
      }
      if (!stopped) timers.push(setTimeout(pollNew, 60_000));
    };

    const pollTop = async () => {
      const [meta, ms] = await ready;
      if (stopped) return;
      const quotes = new Map(meta.quoteAssets.filter((q) => q.mint && q.kind !== 'crypto' && q.kind !== 'stable').map((q) => [q.mint!, { symbol: q.symbol, mint: q.mint! }]));
      const top = ms
        .filter((m) => m.status !== 'dead')
        .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
        .slice(0, 30);
      const res = top.length ? await this.gt<GtList<GtPool>>(`/networks/${NETWORK}/pools/multi/${top.map((m) => m.id).join(',')}?include=base_token,quote_token`) : null;
      const toks = tokenMap(res?.included);
      for (const p of res?.data ?? []) {
        const r = poolToRecord(p, toks, quotes, EXCLUDED_MINTS, Date.now(), CRYPTO);
        if (!r) continue;
        const m = this.byId.get(r.address);
        const now = { vol: r.vol24 ?? 0, traders: Math.max(r.buyers24 ?? 0, r.sellers24 ?? 0), price: r.priceUsd ?? 0 };
        const prev = last.get(r.address) ?? (m ? { vol: m.volume24hUsd, traders: m.traders24h, price: m.priceUsd } : undefined);
        last.set(r.address, now);
        if (!prev) continue;
        const base = { t: Date.now(), marketId: m ? r.address : undefined, ticker: r.symbol, quote: r.quote };
        const v = crossed(VOL_STEPS, prev.vol, now.vol);
        if (v) emit({ ...base, kind: 'volume-milestone', text: `$${r.symbol} crossed ${fmt(v)} in 24h volume` });
        const tr = crossed(TRADER_STEPS, prev.traders, now.traders);
        if (tr) emit({ ...base, kind: 'traders-milestone', text: `${tr.toLocaleString('en-US')} traders entered $${r.symbol} today` });
        if (m && now.price > m.athPriceUsd * 1.0001 && prev.price <= m.athPriceUsd) emit({ ...base, kind: 'ath', text: `$${r.symbol} printed a new all-time high` });
        if (prev.vol > 0 && now.vol > prev.vol * 1.5 && now.vol - prev.vol > 20_000) emit({ ...base, kind: 'unusual', text: `Unusual activity on $${r.symbol} / ${r.quote}: +${fmt(now.vol - prev.vol)} volume in minutes` });
      }
      if (!stopped) timers.push(setTimeout(pollTop, 30_000));
    };

    timers.push(setTimeout(pollNew, 1500), setTimeout(pollTop, 4000));
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
    };
  }
}

function fmt(v: number) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}


import type { DataSource } from '../source';
import type { ActivityEvent, Bar, EcosystemDay, Market, MarketPage, QuoteAsset, Snapshot, SourceMeta, Trade } from '../types';
import { rng } from './rng';

const DAY = 86_400_000;

interface InitResult {
  markets: Market[];
  ecosystem: EcosystemDay[];
  quotes: QuoteAsset[];
}

/**
 * Demo data source. Everything it returns is SIMULATED and flagged as such
 * (meta.isDemo, event.simulated). Swap for HttpSource via VITE_DATA_SOURCE=api.
 */
export class DemoSource implements DataSource {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private ready: Promise<InitResult>;
  private byId = new Map<string, Market>();
  private seriesCache = new Map<string, Promise<Bar[]>>();
  private readonly start: number;
  private readonly now: number;

  constructor(start: number) {
    this.start = start;
    this.now = Date.now();
    this.worker = new Worker(new URL('./demo.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.result);
    };
    this.ready = this.call<InitResult>({ type: 'init', start: this.start, now: this.now }).then((r) => {
      for (const m of r.markets) this.byId.set(m.id, m);
      return r;
    });
  }

  private call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  async meta(): Promise<SourceMeta> {
    const r = await this.ready;
    return {
      kind: 'demo',
      isDemo: true,
      label: 'Simulated demo data',
      archiveStart: this.start,
      archiveEnd: this.now,
      totalMarkets: r.markets.length,
      quoteAssets: r.quotes,
    };
  }

  async marketsPage(cursor?: string, limit = 2000): Promise<MarketPage> {
    const r = await this.ready;
    const from = cursor ? Number(cursor) : 0;
    const markets = r.markets.slice(from, from + limit);
    const next = from + limit < r.markets.length ? String(from + limit) : undefined;
    return { markets, next, total: r.markets.length };
  }

  async market(id: string) {
    await this.ready;
    return this.byId.get(id);
  }

  series(id: string): Promise<Bar[]> {
    let p = this.seriesCache.get(id);
    if (!p) {
      p = this.ready.then(() => this.call<Bar[]>({ type: 'series', marketId: id }));
      this.seriesCache.set(id, p);
      if (this.seriesCache.size > 60) this.seriesCache.delete(this.seriesCache.keys().next().value!);
    }
    return p;
  }

  async trades(id: string, limit = 30): Promise<Trade[]> {
    await this.ready;
    return this.call<Trade[]>({ type: 'trades', marketId: id, limit });
  }

  async ecosystem() {
    return (await this.ready).ecosystem;
  }

  async snapshot(at: number): Promise<Snapshot> {
    await this.ready;
    const { markets } = await this.ready;
    const vals = await this.call<Float32Array>({ type: 'snapshot', at });
    const activity = new Map<string, number>();
    for (let i = 0; i < vals.length; i++) if (vals[i] >= 0) activity.set(markets[i].id, vals[i]);
    return { at, activity };
  }

  async moments() {
    return undefined; // let the engine detect them from the simulated series
  }

  /**
   * Simulated live feed. Events are derived from markets that are actually
   * active in the demo world, and every event is flagged `simulated: true`.
   */
  subscribe(onEvent: (e: ActivityEvent) => void): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const r = rng((Date.now() & 0xffffffff) >>> 0);
    let n = 0;
    const tick = async () => {
      const { markets } = await this.ready;
      if (stopped) return;
      const live = markets.filter((m) => m.status !== 'dead' && Date.now() - m.lastTradeAt < 2 * DAY);
      const pool = live.length ? live : markets;
      const m = r.weighted(pool.slice(0, 600), (x) => Math.sqrt(x.volume24hUsd + 50));
      const fresh = [...pool].sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
      const kinds = ['launch', 'volume-milestone', 'traders-milestone', 'unusual', 'ath', 'whale', 'graduated'] as const;
      const kind = r.weighted(kinds, (k) => ({ launch: 4, 'volume-milestone': 3, 'traders-milestone': 2, unusual: 1.5, ath: 1.5, whale: 1.2, graduated: 0.6 })[k]);
      const target = kind === 'launch' ? r.pick(fresh) : m;
      const vol = roundNice(Math.max(10_000, target.volumeLifetimeUsd * r.range(0.4, 0.95)));
      const text = {
        launch: `New market launched: $${target.ticker} / ${target.quote}`,
        'volume-milestone': `$${target.ticker} crossed ${fmtUsd(vol)} volume`,
        'traders-milestone': `${roundNice(Math.max(50, target.traders * r.range(0.3, 0.9))).toLocaleString()} traders entered $${target.ticker}`,
        unusual: `Unusual activity detected on $${target.ticker} / ${target.quote}`,
        ath: `$${target.ticker} printed a new all-time high`,
        whale: `Whale-sized buy on $${target.ticker} (${fmtUsd(roundNice((target.largestTradeUsd || 5000) * r.range(0.3, 1)))})`,
        graduated: `$${target.ticker} graduated from its bonding curve`,
      }[kind];
      onEvent({ id: `sim-${Date.now()}-${n++}`, t: Date.now(), kind, marketId: target.id, ticker: target.ticker, quote: target.quote, text, simulated: true });
      timer = setTimeout(tick, r.range(2600, 6500));
    };
    timer = setTimeout(tick, 900);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}

function roundNice(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.round(v / p) * p;
}

function fmtUsd(v: number) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

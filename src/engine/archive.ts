/**
 * The Archive: one immutable, query-able view over everything we know.
 *
 * Built from raw source data (markets + ecosystem days [+ curated moments]).
 * Pure TypeScript with no DOM dependencies, so the exact same code can run
 * server-side inside an indexer to precompute notability, badges and moments.
 */
import type { EcosystemDay, Market, Moment, QuoteAsset, SourceMeta } from '../data/types';
import { awardBadges, type BadgeAward, type BadgeId } from './badges';
import { applyCuration } from './curation';
import { detectMoments } from './moments';
import { knownMoments } from './history';
import { scoreMarkets, type NotabilityResult } from './notability';
import { nameKeywords } from './text';
import { fmtDuration, fmtMultiple, fmtNum, fmtPct, fmtUsd, fmtAgo } from '../lib/format';
import { hashString } from '../lib/hash';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type VisualKind = 'legendary' | 'unusual' | 'high-volume' | 'historical' | 'crashed' | 'active' | 'quiet';

export interface Reason {
  label: string;
  value: string;
  strength: number;
}

export interface Narrative {
  key: string;
  count: number;
  volumeUsd: number;
  quotes: string[];
}

export type ExploreTab = 'trending' | 'new' | 'most-traded' | 'movers' | 'legendary' | 'unusual' | 'historical' | 'random';

export interface PeriodSummary {
  start: number;
  end: number;
  marketsCreated: number;
  volumeUsd: number;
  notable: number;
  moments: Moment[];
  cumulativeMarkets: number;
}

export interface SearchResult {
  markets: Market[];
  moments: Moment[];
  narratives: Narrative[];
  quotes: QuoteAsset[];
  dates: { label: string; t: number }[];
}

export class Archive {
  readonly meta: SourceMeta;
  readonly markets: Market[];
  readonly byId: Map<string, Market>;
  readonly idx: Map<string, number>;
  readonly quotes: Map<string, QuoteAsset>;
  readonly ecosystem: EcosystemDay[];
  readonly now: number;
  readonly notability: NotabilityResult;
  readonly badges: Map<string, BadgeAward[]>;
  moments: Moment[];
  /** approved moments, newest first */
  readonly publicMoments: Moment[];
  readonly momentsByMarket: Map<string, Moment[]>;
  readonly kind: VisualKind[];
  readonly interest: Float64Array;
  readonly narratives: Narrative[];
  private readonly kwIndex: Map<string, number[]>;
  private readonly quoteShare: Map<string, number>;
  private readonly byRank: number[];

  constructor(meta: SourceMeta, markets: Market[], ecosystem: EcosystemDay[], sourceMoments?: Moment[]) {
    this.meta = meta;
    this.markets = markets;
    this.ecosystem = ecosystem;
    this.now = meta.archiveEnd;
    this.byId = new Map(markets.map((m) => [m.id, m]));
    this.idx = new Map(markets.map((m, i) => [m.id, i]));
    this.quotes = new Map(meta.quoteAssets.map((q) => [q.symbol, q]));
    // markets may reference quotes the meta forgot — synthesise neutral ones
    for (const m of markets) {
      if (!this.quotes.has(m.quote))
        this.quotes.set(m.quote, { symbol: m.quote, name: m.quote, kind: 'crypto', underlying: m.quote, priceUsd: m.priceUsd / Math.max(1e-18, m.priceQuote), hue: hashString(m.quote) % 360 });
    }
    this.quoteShare = new Map();
    for (const m of markets) this.quoteShare.set(m.quote, (this.quoteShare.get(m.quote) ?? 0) + 1 / markets.length);

    // pass 1: notability without history → detect moments → pass 2 with history
    const first = scoreMarkets(markets, this.now, new Map());
    const detected = sourceMoments ?? detectMoments({ markets, ecosystem, score: (i) => first.score[i], start: meta.archiveStart });
    const curated = meta.isDemo ? [] : knownMoments(markets, meta.archiveStart, meta.archiveEnd, (id) => first.score[this.idx.get(id) ?? 0] ?? 0);
    this.moments = applyCuration([...curated, ...detected.filter((d) => !curated.some((c) => c.id === d.id))]);
    if (meta.coverage === 'partial') this.moments = this.moments.filter((m) => !(m.kind === 'milestone' && m.key.endsWith('-markets')));
    this.publicMoments = this.moments.filter((m) => m.status === 'approved').sort((a, b) => b.start - a.start);
    this.momentsByMarket = new Map();
    const counts = new Map<string, number>();
    for (const mo of this.publicMoments) {
      for (const id of mo.marketIds) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        const arr = this.momentsByMarket.get(id) ?? [];
        arr.push(mo);
        this.momentsByMarket.set(id, arr);
      }
    }
    this.notability = scoreMarkets(markets, this.now, counts);
    this.byRank = Array.from({ length: markets.length }, (_, i) => i).sort((a, b) => this.notability.rank[a] - this.notability.rank[b]);
    this.badges = awardBadges(markets, this.notability.rank, this.now);

    // keyword index → narratives
    this.kwIndex = new Map();
    markets.forEach((m, i) => {
      for (const k of nameKeywords(m)) {
        let arr = this.kwIndex.get(k);
        if (!arr) this.kwIndex.set(k, (arr = []));
        arr.push(i);
      }
    });
    this.narratives = [...this.kwIndex]
      .filter(([, v]) => v.length >= 12)
      .map(([key, v]) => {
        const qc = new Map<string, number>();
        let vol = 0;
        for (const i of v) {
          qc.set(markets[i].quote, (qc.get(markets[i].quote) ?? 0) + 1);
          vol += markets[i].volumeLifetimeUsd;
        }
        return { key, count: v.length, volumeUsd: vol, quotes: [...qc].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q]) => q) };
      })
      .sort((a, b) => b.volumeUsd - a.volumeUsd);

    this.interest = new Float64Array(markets.length);
    markets.forEach((_, i) => (this.interest[i] = this.reasonsAt(i).slice(0, 3).reduce((s, r) => s + r.strength, 0)));
    this.kind = markets.map((m, i) => this.classify(m, i));
  }

  /** "tracked" when the market list isn't every market ever launched */
  get tracked(): string {
    // with an on-chain enumeration the totals are exact even while dates backfill
    return this.meta.coverage === 'partial' && !this.meta.chain ? 'tracked ' : '';
  }
  /** false for days whose launch counts aren't available (pre-LaunchLab era not yet counted) */
  launchesKnown(t: number): boolean {
    const c = this.meta.chain;
    return !c || c.legacyCounted || !c.launchlabFrom || t >= c.launchlabFrom - 86_400_000;
  }
  /** every market ever launched (may exceed the markets loaded into the universe) */
  get marketCount(): number {
    return Math.max(this.meta.totalMarkets, this.markets.length);
  }
  /** markets created in [start, end): from daily on-chain counts when available */
  launchesBetween(start: number, end: number): number {
    const fromDays = this.ecosystem.filter((d) => d.t >= start && d.t < end).reduce((s, d) => s + d.marketsCreated, 0);
    const fromMarkets = this.markets.reduce((s, m) => s + (m.createdAt >= start && m.createdAt < end ? 1 : 0), 0);
    return Math.max(fromDays, fromMarkets);
  }
  /** platform-wide volume: authoritative source if present, else the daily series, else market totals */
  get totalVolume(): number {
    const eco = this.ecosystem.reduce((s, d) => s + d.volumeUsd, 0);
    return Math.max(this.meta.platform?.volumeAllTime ?? 0, eco, this.markets.reduce((s, m) => s + m.volumeLifetimeUsd, 0));
  }

  // ── basics ─────────────────────────────────────────────────────────────────
  score(id: string): number {
    const i = this.idx.get(id);
    return i === undefined ? 0 : this.notability.score[i];
  }
  rank(id: string): number {
    const i = this.idx.get(id);
    return i === undefined ? Infinity : this.notability.rank[i];
  }
  badgesOf(id: string): BadgeAward[] {
    return this.badges.get(id) ?? [];
  }
  hasBadge(id: string, b: BadgeId) {
    return this.badgesOf(id).some((x) => x.id === b);
  }
  kindOf(id: string): VisualKind {
    const i = this.idx.get(id);
    return i === undefined ? 'quiet' : this.kind[i];
  }
  quoteOf(m: Market): QuoteAsset {
    return this.quotes.get(m.quote)!;
  }
  moment(id: string) {
    return this.moments.find((m) => m.id === id);
  }
  /** Markets ordered most-notable first. */
  ranked(limit = Infinity): Market[] {
    return this.byRank.slice(0, limit).map((i) => this.markets[i]);
  }

  private classify(m: Market, i: number): VisualKind {
    const pct = this.notability.pct;
    if (this.hasBadge(m.id, 'legendary')) return 'legendary';
    if (m.status === 'dead') return pct.lifetimeVolume[i] > 0.75 && m.postAthLowUsd / m.athPriceUsd < 0.15 ? 'crashed' : 'quiet';
    if (this.interest[i] >= 1.6 && pct.spike[i] > 0.9) return 'unusual';
    if (this.now - m.createdAt > 75 * DAY && m.volume7dUsd > 500) return 'historical';
    if (pct.lifetimeVolume[i] > 0.93) return 'high-volume';
    if (m.volume24hUsd > 50) return 'active';
    return 'quiet';
  }

  // ── discovery ──────────────────────────────────────────────────────────────
  /** Measurable reasons a market is interesting, strongest first. */
  reasons(id: string): Reason[] {
    const i = this.idx.get(id);
    return i === undefined ? [] : this.reasonsAt(i);
  }

  private reasonsAt(i: number): Reason[] {
    const m = this.markets[i];
    const pct = this.notability.pct;
    const out: Reason[] = [];
    const mult = m.athPriceUsd / m.launchPriceUsd;
    if (mult >= 8) out.push({ label: 'peak move', value: fmtPct(mult - 1, 0), strength: Math.min(1.5, Math.log10(mult) / 1.6) });
    if (pct.lifetimeVolume[i] >= 0.96) out.push({ label: 'lifetime volume', value: fmtUsd(m.volumeLifetimeUsd), strength: (pct.lifetimeVolume[i] - 0.9) * 10 });
    if (pct.traders[i] >= 0.96) out.push({ label: 'traders', value: fmtNum(m.traders), strength: (pct.traders[i] - 0.9) * 9 });
    const share = this.quoteShare.get(m.quote) ?? 1;
    if (share < 0.03 && m.volumeLifetimeUsd > 20_000) out.push({ label: 'unusual pair', value: `one of ${(share * 100).toFixed(1)}% on ${m.quote}`, strength: 0.6 + (0.03 - share) * 20 });
    const activeDays = Math.max(1 / 24, (m.lastTradeAt - m.createdAt) / DAY);
    const conc = m.peakDayVolumeUsd / Math.max(1, m.volumeLifetimeUsd);
    if (pct.spike[i] >= 0.97 && activeDays > 3) out.push({ label: 'activity spike', value: `${Math.round(conc * 100)}% of volume in one day`, strength: (pct.spike[i] - 0.9) * 8 });
    if (m.status !== 'dead' && m.volume24hUsd >= 20_000 && m.volume24hUsd > (3 * m.volume7dUsd) / 7)
      out.push({ label: 'rapid growth', value: `24h volume ${fmtMultiple((m.volume24hUsd * 7) / Math.max(1, m.volume7dUsd))} its weekly pace`, strength: Math.min(1.3, Math.log10((m.volume24hUsd * 7) / Math.max(1, m.volume7dUsd)) * 1.5) });
    if (m.status !== 'dead' && activeDays >= 60 && m.volume7dUsd > 300) out.push({ label: 'longevity', value: `trading for ${fmtDuration(this.now - m.createdAt)}`, strength: Math.min(1.2, activeDays / 150) });
    if (m.status === 'dead' && m.volumeLifetimeUsd > 250_000 && activeDays < 4) out.push({ label: 'brief & loud', value: `${fmtUsd(m.volumeLifetimeUsd)} in ${fmtDuration(activeDays * DAY)}`, strength: Math.min(1.2, Math.log10(m.volumeLifetimeUsd) - 4.6) });
    if ((m.largestTradeUsd ?? 0) > 25_000) out.push({ label: 'whale trade', value: fmtUsd(m.largestTradeUsd!), strength: Math.min(1, Math.log10(m.largestTradeUsd!) - 4) });
    return out.sort((a, b) => b.strength - a.strength);
  }

  /** "WHAT THE FUCK IS THIS?" — strange, measurable outliers. */
  oddities(limit = 18, seed = 'today'): Market[] {
    const pool = this.byInterest(600).filter((m) => !this.hasBadge(m.id, 'legendary'));
    const perQuote = new Map<string, number>();
    const picked: Market[] = [];
    const r = seeded(seed);
    // walk the pool in a lightly shuffled order so the section feels fresh
    const order = pool.map((m, i) => [m, i + r() * 40] as const).sort((a, b) => a[1] - b[1]);
    for (const [m] of order) {
      const n = perQuote.get(m.quote) ?? 0;
      if (n >= 3) continue;
      perQuote.set(m.quote, n + 1);
      picked.push(m);
      if (picked.length >= limit) break;
    }
    return picked;
  }

  byInterest(limit: number): Market[] {
    return Array.from({ length: this.markets.length }, (_, i) => i)
      .sort((a, b) => this.interest[b] - this.interest[a])
      .slice(0, limit)
      .map((i) => this.markets[i]);
  }

  /** Weighted pick that favours interesting & notable markets. */
  surprise(exclude: Set<string> = new Set(), rand: () => number = Math.random): Market {
    const pool = this.byRank.slice(0, 2500).filter((i) => !exclude.has(this.markets[i].id));
    const w = pool.map((i) => Math.pow(this.interest[i] + 2.5 * this.notability.score[i] + 0.05, 2));
    const total = w.reduce((s, x) => s + x, 0);
    let x = rand() * total;
    for (let k = 0; k < pool.length; k++) {
      x -= w[k];
      if (x <= 0) return this.markets[pool[k]];
    }
    return this.markets[pool[0] ?? 0];
  }

  /** The same market for everyone on a given UTC day. */
  dailyPick(day = Math.floor(Date.now() / DAY)): Market {
    const pool = this.byInterest(150);
    return pool[hashString(`daily-${day}`) % pool.length];
  }

  /** Rarely-seen markets: notable but obscure. */
  hidden(limit = 12): Market[] {
    return this.byRank
      .slice(200, 3000)
      .map((i) => this.markets[i])
      .filter((m) => (this.quoteShare.get(m.quote) ?? 1) < 0.04 || this.reasons(m.id).length >= 3)
      .slice(0, limit);
  }

  explore(tab: ExploreTab, limit = 48, seed = 'x'): Market[] {
    const M = this.markets;
    const alive = (m: Market) => m.status !== 'dead';
    switch (tab) {
      case 'trending': {
        const heat = (m: Market) => m.volume24hUsd * (1 + Math.min(4, (m.volume24hUsd * 7) / Math.max(1, m.volume7dUsd)));
        return M.filter((m) => alive(m) && m.volume24hUsd > 0)
          .sort((a, b) => heat(b) - heat(a))
          .slice(0, limit);
      }
      case 'new':
        return M.filter((m) => m.volumeLifetimeUsd > 1_500).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
      case 'most-traded':
        return [...M].sort((a, b) => b.trades - a.trades).slice(0, limit);
      case 'movers':
        return M.filter((m) => alive(m) && m.volume24hUsd >= 5_000).sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, limit);
      case 'legendary':
        return this.ranked(limit);
      case 'unusual':
        return this.byInterest(limit);
      case 'historical': {
        const ids = new Set<string>();
        for (const mo of [...this.publicMoments].sort((a, b) => a.start - b.start)) if (mo.topMarketId) ids.add(mo.topMarketId);
        const old = this.ranked(3000).filter((m) => this.now - m.createdAt > 60 * DAY).sort((a, b) => a.createdAt - b.createdAt);
        for (const m of old) ids.add(m.id);
        return [...ids].slice(0, limit).map((id) => this.byId.get(id)!).filter(Boolean);
      }
      case 'random': {
        const r = seeded(seed);
        const seen = new Set<string>();
        const out: Market[] = [];
        for (let k = 0; k < limit * 4 && out.length < limit; k++) {
          const m = this.surprise(seen, r);
          if (!seen.has(m.id)) out.push(m);
          seen.add(m.id);
        }
        return out;
      }
    }
  }

  legends(): Market[] {
    return this.markets.filter((m) => this.hasBadge(m.id, 'legendary')).sort((a, b) => this.rank(a.id) - this.rank(b.id));
  }

  withBadge(b: BadgeId, limit = 24): Market[] {
    return this.markets
      .filter((m) => this.hasBadge(m.id, b))
      .sort((a, b2) => this.rank(a.id) - this.rank(b2.id))
      .slice(0, limit);
  }

  // ── connections ────────────────────────────────────────────────────────────
  narrativesOf(m: Market): Narrative[] {
    const ks = new Set(nameKeywords(m));
    return this.narratives.filter((n) => ks.has(n.key));
  }

  narrativeMarkets(key: string, limit = 60): Market[] {
    return (this.kwIndex.get(key) ?? [])
      .slice()
      .sort((a, b) => this.notability.rank[a] - this.notability.rank[b])
      .slice(0, limit)
      .map((i) => this.markets[i]);
  }

  quoteMarkets(symbol: string, limit = 60): Market[] {
    const out: Market[] = [];
    for (const i of this.byRank) {
      if (this.markets[i].quote === symbol) out.push(this.markets[i]);
      if (out.length >= limit) break;
    }
    return out;
  }

  related(id: string) {
    const i = this.idx.get(id);
    if (i === undefined) return undefined;
    const m = this.markets[i];
    const top = (pred: (x: Market) => boolean, n = 8) => {
      const out: Market[] = [];
      for (const j of this.byRank) {
        const x = this.markets[j];
        if (x.id !== id && pred(x)) out.push(x);
        if (out.length >= n) break;
      }
      return out;
    };
    const sameQuote = top((x) => x.quote === m.quote);
    const samePeriod = top((x) => Math.abs(x.createdAt - m.createdAt) < 12 * HOUR);
    const narratives = this.narrativesOf(m)
      .slice(0, 3)
      .map((n) => ({ narrative: n, markets: this.narrativeMarkets(n.key, 9).filter((x) => x.id !== id).slice(0, 8) }));
    const moments = this.momentsByMarket.get(id) ?? [];
    return { market: m, sameQuote, samePeriod, narratives, similar: this.similar(i, 8), moments };
  }

  private behavior(i: number): number[] {
    const m = this.markets[i];
    return [
      Math.log10(Math.max(1, m.athPriceUsd / m.launchPriceUsd)),
      Math.log10(1 + (m.athAt - m.createdAt) / HOUR) * 0.8,
      (m.postAthLowUsd / m.athPriceUsd) * 1.5,
      Math.log10(1 + (m.lastTradeAt - m.createdAt) / DAY) * 0.8,
      Math.log10(1 + m.volumeLifetimeUsd) * 0.35,
      m.status === 'dead' ? 0.6 : 0,
    ];
  }

  private similar(i: number, n: number): Market[] {
    const v = this.behavior(i);
    const scored: [number, number][] = [];
    for (const j of this.byRank.slice(0, 5000)) {
      if (j === i) continue;
      const w = this.behavior(j);
      let d = 0;
      for (let k = 0; k < v.length; k++) d += (v[k] - w[k]) ** 2;
      scored.push([d, j]);
    }
    return scored
      .sort((a, b) => a[0] - b[0])
      .slice(0, n)
      .map(([, j]) => this.markets[j]);
  }

  // ── time travel ────────────────────────────────────────────────────────────
  period(start: number, end: number): PeriodSummary {
    let created = 0;
    let loaded = 0;
    let notable = 0;
    let cumulative = 0;
    const notableCut = Math.max(50, this.markets.length * 0.03);
    this.markets.forEach((m, i) => {
      if (m.createdAt < end) loaded++;
      if (m.createdAt >= start && m.createdAt < end) {
        if (this.notability.rank[i] < notableCut || this.badges.has(m.id)) notable++;
      }
    });
    const volumeUsd = this.ecosystem.filter((d) => d.t >= start && d.t < end).reduce((s, d) => s + d.volumeUsd, 0);
    const moments = this.publicMoments.filter((mo) => mo.start < end && mo.end >= start && mo.kind !== 'milestone');
    created = this.launchesBetween(start, end);
    cumulative = Math.max(loaded, this.launchesBetween(this.meta.archiveStart - 86_400_000, end));
    return { start, end, marketsCreated: created, volumeUsd, notable, moments, cumulativeMarkets: cumulative };
  }

  // ── search ─────────────────────────────────────────────────────────────────
  search(raw: string, limit = 12): SearchResult {
    const q = raw.trim().replace(/^\$/, '').toLowerCase();
    const empty: SearchResult = { markets: [], moments: [], narratives: [], quotes: [], dates: [] };
    if (!q) return empty;
    const [left, right] = q.split(/\s*\/\s*/);
    const scored: [number, number][] = [];
    this.markets.forEach((m, i) => {
      const t = m.ticker.toLowerCase();
      const n = m.name.toLowerCase();
      let s = 0;
      if (right !== undefined && left) {
        if (t.startsWith(left) && m.quote.toLowerCase().startsWith(right)) s = 90;
      } else if (t === q) s = 100;
      else if (t.startsWith(q)) s = 70;
      else if (n.split(' ').some((w) => w.startsWith(q))) s = 55;
      else if (n.includes(q)) s = 40;
      else if (m.quote.toLowerCase().startsWith(q)) s = 20;
      else if (q.length >= 6 && (m.id.toLowerCase().startsWith(q) || m.mint.toLowerCase().startsWith(q))) s = 95;
      if (s > 0) scored.push([s + this.notability.score[i] * 40, i]);
    });
    const markets = scored
      .sort((a, b) => b[0] - a[0])
      .slice(0, limit)
      .map(([, i]) => this.markets[i]);
    const moments = this.publicMoments.filter((mo) => mo.title.toLowerCase().includes(q) || mo.key.toLowerCase().includes(q) || mo.tagline.toLowerCase().includes(q)).slice(0, 6);
    const narratives = this.narratives.filter((nar) => nar.key.startsWith(q) || (q.length >= 3 && nar.key.includes(q))).slice(0, 6);
    const quotes = [...this.quotes.values()].filter((x) => x.symbol.toLowerCase().startsWith(q) || x.underlying.toLowerCase().startsWith(q) || x.name.toLowerCase().includes(q));
    return { markets, moments, narratives, quotes, dates: parseDates(raw, this.meta.archiveStart, this.now) };
  }

  /** Human sentence for "created" lines. */
  ago(t: number) {
    return fmtAgo(t, this.now);
  }
}

function seeded(seed: string) {
  let s = hashString(seed) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Understands "2026-09-14", "sep 14", "september 2026", "sep". */
export function parseDates(raw: string, min: number, max: number): { label: string; t: number }[] {
  const q = raw.trim().toLowerCase();
  const out: { label: string; t: number }[] = [];
  const iso = q.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  const year = new Date(max).getUTCFullYear();
  const push = (t: number, label: string) => {
    if (t >= min - 31 * DAY && t <= max) out.push({ t: Math.max(min, t), label });
  };
  if (iso) {
    const t = Date.UTC(+iso[1], +iso[2] - 1, iso[3] ? +iso[3] : 1);
    push(t, iso[3] ? new Date(t).toUTCString().slice(5, 16) : `${MONTH_NAMES[+iso[2] - 1].toUpperCase()} ${iso[1]}`);
    return out;
  }
  const mm = q.match(/^([a-z]{3,9})\.?\s*(\d{1,2})?(?:,?\s*(\d{4}))?$/);
  if (mm) {
    const mi = MONTH_NAMES.findIndex((n) => mm[1].startsWith(n) && n.startsWith(mm[1].slice(0, 3)));
    if (mi >= 0) {
      const y = mm[3] ? +mm[3] : year;
      const day = mm[2] && +mm[2] <= 31 ? +mm[2] : undefined;
      const t = Date.UTC(y, mi, day ?? 1);
      push(t, day ? new Date(t).toUTCString().slice(5, 16) : `${MONTH_NAMES[mi].toUpperCase()} ${y}`);
    }
  }
  return out;
}

/**
 * DEMO DATA SIMULATION
 * ────────────────────
 * Generates a deterministic, *clearly synthetic* StonkFun-like world so the
 * archive can be developed and demoed without an indexer. Nothing here is
 * presented as real: SourceMeta.isDemo = true and the UI labels it.
 *
 * The model is deliberately "physics, not stories":
 *   • an adoption curve drives how many markets launch per day
 *   • attention shocks (narratives) temporarily spike launches around a keyword
 *   • two ecosystem-wide drawdowns move every market's price & volume
 *   • every market follows a seeded lifecycle (rise → peak → fate)
 * Moments, legends and badges are NOT authored here — the engine detects them
 * from the resulting time series exactly as it would from chain data.
 *
 * Days are seeded independently so the past stays stable as "now" advances.
 */
import type { Bar, EcosystemDay, Market, MarketStatus, QuoteAsset, Trade } from '../types';
import { DEMO_QUOTES, THEMES, genericBlurb, genericName, tickerFor, type Theme } from './catalog';
import { fakeAddress, hash2, hashString, rng } from './rng';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const SUPPLY = 1_000_000_000;
const GRADUATION_MCAP = 65_000;
const HOURLY_WINDOW_H = 72;

type Fate = 'die' | 'fade' | 'survive' | 'wave';

export interface MarketParams {
  seed: number;
  createdAt: number;
  quote: string;
  theme?: string;
  q: number;
  peakMult: number;
  tpH: number;
  fate: Fate;
  floor: number;
  tauH: number;
  waveAtH: number;
  waveMult: number;
  launchUsd: number;
  avgTrade: number;
  beta: number;
  sigma: number;
}

interface Shock {
  theme: Theme;
  center: number; // ms
  durH: number;
  ratePerDay: number;
  quote: string;
}

export interface SimWorld {
  seed: number;
  start: number;
  now: number;
  quotes: QuoteAsset[];
  markets: Market[];
  byId: Map<string, Market>;
  params: Map<string, MarketParams>;
  /** weekly USD volume per market, indexed from `start` */
  weekly: Map<string, Float32Array>;
  weeks: number;
  ecosystem: EcosystemDay[];
  macro: Macro;
}

type Macro = ReturnType<typeof buildMacro>;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function adoption(day: number) {
  // slow early months → a step-change in adoption around day ~195 (mid July)
  return 0.08 + 0.92 * sigmoid((day - 195) / 9);
}

/** Global market factor (price) and volume multiplier per day index. */
function buildMacro(seed: number, days: number) {
  const r = rng(hash2(seed, 777));
  const crashes = [
    { day: Math.round(r.range(96, 112)), depth: r.range(0.3, 0.4), recDays: r.range(12, 20) },
    { day: Math.round(r.range(232, 244)), depth: r.range(0.35, 0.45), recDays: r.range(9, 15) },
  ];
  const G = new Float64Array(days + 2);
  const VM = new Float64Array(days + 2);
  let walk = 0;
  for (let d = 0; d < days + 2; d++) {
    walk += 0.012 * r.normal() + 0.0008;
    let f = Math.exp(walk);
    let vm = 1;
    for (const c of crashes) {
      const dd = d - c.day;
      if (dd >= 0) {
        const hit = dd < 2 ? dd / 2 : Math.exp(-(dd - 2) / c.recDays);
        f *= 1 - c.depth * hit;
        if (dd < 3) vm *= 1 + 2.4 * Math.exp(-dd / 1.2); // panic volume
        else if (dd < c.recDays) vm *= 0.6; // the lull
        else if (dd < c.recDays * 2) vm *= 1.35; // relief rally
      }
    }
    G[d] = f;
    VM[d] = vm;
  }
  return { G, VM };
}

function buildShocks(seed: number, start: number, days: number): Shock[] {
  const r = rng(hash2(seed, 4242));
  const pool = [...THEMES];
  const shocks: Shock[] = [];
  let d = r.range(14, 24);
  let i = 0;
  while (d < days + 60) {
    const theme = pool.splice(Math.floor(r() * pool.length), 1)[0] ?? THEMES[i % THEMES.length];
    if (pool.length === 0) pool.push(...THEMES.filter((t) => t.key !== theme.key));
    shocks.push({
      theme,
      center: start + d * DAY + r.range(0, DAY),
      durH: r.range(20, 84),
      ratePerDay: Math.exp(r.range(Math.log(35), Math.log(160))) * (0.25 + adoption(d)),
      quote: r.pick(theme.quotes),
    });
    d += r.range(9, 19) * (1.1 - 0.4 * adoption(d));
    i++;
  }
  return shocks;
}

function shockRate(s: Shock, t0: number, t1: number) {
  const a = s.center - (s.durH * HOUR) / 2;
  const b = s.center + (s.durH * HOUR) / 2;
  const overlap = Math.max(0, Math.min(t1, b) - Math.max(t0, a));
  return (s.ratePerDay * overlap) / DAY / Math.max(0.5, s.durH / 24);
}

function pickQuote(r: ReturnType<typeof rng>, bias?: string) {
  if (bias && r.chance(0.75)) return bias;
  return r.weighted(DEMO_QUOTES, (q) => q.weight).symbol;
}

function makeParams(seed: number, createdAt: number, quote: string, theme: Theme | undefined, boost: number): MarketParams {
  const r = rng(hash2(seed, 0x51ab));
  // heavy-tailed "attention quality"
  const q = Math.min(700, Math.pow(1 - r() * 0.99999, -1 / 1.3)) * boost;
  const peakMult = Math.max(1.03, Math.exp(0.25 + 0.75 * Math.log(q) * r.range(0.4, 1.1) + 0.6 * r.normal()));
  const slow = r.chance(0.07);
  const tpH = slow ? r.range(72, 24 * 50) : Math.exp(r.range(Math.log(0.4), Math.log(60)));
  const surviveBias = Math.min(0.5, 0.04 + Math.log10(q) * 0.12);
  const u = r();
  const fate: Fate = u < surviveBias * 0.25 ? 'wave' : u < surviveBias ? 'survive' : u < surviveBias + 0.3 ? 'fade' : 'die';
  const floor = fate === 'die' ? r.range(0.02, 0.14) : fate === 'fade' ? r.range(0.12, 0.45) : r.range(0.4, 0.9);
  const tauH = fate === 'die' ? r.range(4, 40) : fate === 'fade' ? r.range(48, 480) : r.range(48, 300);
  return {
    seed,
    createdAt,
    quote,
    theme: theme?.key,
    q,
    peakMult,
    tpH,
    fate,
    floor,
    tauH,
    waveAtH: r.range(24 * 8, 24 * 70),
    waveMult: r.range(1.3, 4.5),
    launchUsd: r.range(4_200, 6_500) / SUPPLY,
    avgTrade: Math.exp(r.range(Math.log(25), Math.log(160)) + (r.chance(0.04) ? r.range(1.2, 2.4) : 0)),
    beta: r.range(0.4, 1.4),
    sigma: r.range(0.03, 0.08),
  };
}

function targetMult(p: MarketParams, h: number): number {
  let m: number;
  if (h <= p.tpH) {
    m = 1 + (p.peakMult - 1) * Math.pow(h / p.tpH, 1.6);
  } else {
    const k = Math.exp(-(h - p.tpH) / p.tauH);
    m = p.peakMult * (p.floor + (1 - p.floor) * k);
  }
  if (p.fate === 'wave' && h > p.waveAtH) {
    const w = (h - p.waveAtH) / 72;
    const bump = w < 1 ? w : Math.exp(-(w - 1) / 6);
    m *= 1 + (p.waveMult * p.peakMult / Math.max(m, 1e-9) - 1) * bump * 0.9;
  }
  return m;
}

function activity(p: MarketParams, h: number): number {
  let a: number;
  if (h <= p.tpH) a = 0.25 + 0.75 * Math.pow(h / p.tpH, 0.8);
  else {
    const since = h - p.tpH;
    if (p.fate === 'die') a = Math.exp(-since / (p.tauH * 0.8));
    else if (p.fate === 'fade') a = 0.015 + 0.985 * Math.exp(-since / (p.tauH * 0.5));
    else a = 0.025 + 0.975 * Math.exp(-since / (p.tauH * 0.35));
    if (p.fate === 'survive' || p.fate === 'wave') a *= Math.exp(-since / (24 * 70));
  }
  if (p.fate === 'wave' && h > p.waveAtH) {
    const w = (h - p.waveAtH) / 72;
    a += (w < 1 ? w : Math.exp(-(w - 1) / 3)) * 0.8;
  }
  return a;
}

/**
 * Run one market's lifecycle. Hourly bars for the first 72h (where the
 * action is), then daily bars aligned to UTC midnight.
 */
export function simulateBars(p: MarketParams, world: Pick<SimWorld, 'start' | 'now'>, macro: Macro): Bar[] {
  const r = rng(hash2(p.seed, 99));
  const bars: Bar[] = [];
  const v0 = 38 * p.q * Math.sqrt(p.peakMult);
  const createdDay = Math.floor((p.createdAt - world.start) / DAY);
  const g0 = macro.G[Math.max(0, createdDay)] || 1;
  let noise = 0;
  let prev = p.launchUsd;
  let t = p.createdAt;
  let tradersSoFar = 0;
  while (t < world.now) {
    const age = (t - p.createdAt) / HOUR;
    let next: number;
    if (age < HOURLY_WINDOW_H) next = t + HOUR;
    else next = (Math.floor(t / DAY) + 1) * DAY;
    next = Math.min(next, world.now);
    const dtH = (next - t) / HOUR;
    if (dtH <= 0) break;
    const hMid = age + dtH / 2;
    const day = Math.min(macro.G.length - 1, Math.max(0, Math.floor((t - world.start) / DAY)));
    const gf = Math.pow((macro.G[day] || 1) / g0, p.beta);
    const keep = Math.exp(-dtH / 36);
    noise = noise * keep + p.sigma * Math.sqrt(dtH) * r.normal() * (age < HOURLY_WINDOW_H ? 1 : 0.6);
    const c = Math.max(1e-12, p.launchUsd * targetMult(p, hMid) * Math.exp(noise) * gf);
    const o = prev;
    const wig = Math.abs(r.normal()) * p.sigma * Math.sqrt(dtH) * 0.6;
    const h = Math.max(o, c) * Math.exp(wig);
    const l = Math.min(o, c) * Math.exp(-wig * 0.8);
    const act = activity(p, hMid);
    const vol = v0 * act * dtH * (macro.VM[day] || 1) * Math.exp(0.35 * r.normal()) * (1 + 2.5 * Math.abs(Math.log(c / o)));
    if (p.fate === 'die' && act * v0 < 1.5 && age > p.tpH + 12) break; // the market went silent
    const n = Math.max(vol > 1 ? 1 : 0, Math.round(vol / p.avgTrade));
    const novelty = 0.08 + 0.55 * Math.exp(-age / 96);
    const nt = Math.round(n * novelty * (tradersSoFar < 20 ? 1.6 : 1));
    tradersSoFar += nt;
    bars.push({ t, o, h, l, c, v: vol, n, newTraders: nt });
    prev = c;
    t = next;
  }
  return bars;
}


/** Recent fills synthesised from the tail of a market's bars. Demo only. */
export function simulateTrades(p: MarketParams, bars: Bar[], limit: number): Trade[] {
  const r = rng(hash2(p.seed, 31337));
  const out: Trade[] = [];
  for (let i = bars.length - 1; i >= 0 && out.length < limit; i--) {
    const b = bars[i];
    const k = Math.min(b.n, limit - out.length, 6);
    const span = i + 1 < bars.length ? bars[i + 1].t - b.t : HOUR;
    for (let j = 0; j < k; j++) {
      const usd = p.avgTrade * Math.exp(0.9 * r.normal());
      out.push({
        t: b.t + span * (1 - (j + 1) / (k + 1)),
        side: r.chance(b.c >= b.o ? 0.58 : 0.42) ? 'buy' : 'sell',
        usd,
        priceUsd: b.l + (b.h - b.l) * r(),
        wallet: fakeAddress(r, 44),
        signature: fakeAddress(r, 64),
      });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}

function summarize(id: string, mint: string, name: string, ticker: string, description: string, creator: string, p: MarketParams, bars: Bar[], quote: QuoteAsset, now: number): Market {
  let ath = p.launchUsd;
  let athAt = p.createdAt;
  let athIdx = -1;
  let trades = 0;
  let traders = 0;
  let volume = 0;
  let maxMcap = 0;
  let v24 = 0;
  let v7 = 0;
  let n24 = 0;
  let t24 = 0;
  const dayVol = new Map<number, number>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.h > ath) {
      ath = b.h;
      athAt = b.t;
      athIdx = i;
    }
    trades += b.n;
    traders += b.newTraders;
    volume += b.v;
    maxMcap = Math.max(maxMcap, b.h * SUPPLY);
    const end = i + 1 < bars.length ? bars[i + 1].t : now;
    const span = Math.max(1, end - b.t);
    const f24 = Math.max(0, Math.min(1, (end - (now - DAY)) / span));
    const f7 = Math.max(0, Math.min(1, (end - (now - 7 * DAY)) / span));
    v24 += b.v * f24;
    n24 += b.n * f24;
    t24 += Math.round(b.n * 0.55 * f24);
    v7 += b.v * f7;
    const dk = Math.floor(b.t / DAY);
    dayVol.set(dk, (dayVol.get(dk) || 0) + b.v);
  }
  let peakDayVol = 0;
  let peakDayAt = p.createdAt;
  for (const [k, v] of dayVol) {
    if (v > peakDayVol) {
      peakDayVol = v;
      peakDayAt = k * DAY;
    }
  }
  let postLow = ath;
  for (let i = Math.max(0, athIdx); i < bars.length; i++) postLow = Math.min(postLow, bars[i].l);
  const last = bars[bars.length - 1];
  const price = last ? last.c : p.launchUsd;
  // price 24h ago
  let p24 = p.launchUsd;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].t <= now - DAY) {
      p24 = bars[i].c;
      break;
    }
  }
  const lastTradeAt = last ? Math.min(now, last.t + (bars.length > HOURLY_WINDOW_H ? DAY * 0.6 : HOUR * 0.6)) : p.createdAt;
  const graduated = maxMcap >= GRADUATION_MCAP;
  const silentFor = now - lastTradeAt;
  let status: MarketStatus = graduated ? 'graduated' : 'bonding';
  if (silentFor > 3 * DAY) status = 'dead';
  else if (v7 < 40 && now - p.createdAt > 7 * DAY) status = 'dormant';
  const mcap = price * SUPPLY;
  const r = rng(hash2(p.seed, 5));
  const holdRatio = p.fate === 'die' ? 0.12 : p.fate === 'fade' ? 0.28 : 0.46;
  return {
    id,
    mint,
    ticker,
    name,
    description,
    quote: quote.symbol,
    creator,
    createdAt: p.createdAt,
    lastTradeAt,
    status,
    bondingProgress: Math.min(1, maxMcap / GRADUATION_MCAP),
    priceUsd: price,
    priceQuote: price / quote.priceUsd,
    launchPriceUsd: p.launchUsd,
    athPriceUsd: ath,
    athAt,
    postAthLowUsd: postLow,
    change24h: status === 'dead' ? 0 : price / p24 - 1,
    marketCapUsd: mcap,
    liquidityUsd: status === 'dead' ? mcap * 0.02 : graduated ? mcap * r.range(0.1, 0.2) : mcap * r.range(0.25, 0.4),
    volume24hUsd: v24,
    volume7dUsd: v7,
    volumeLifetimeUsd: volume,
    peakDayVolumeUsd: peakDayVol,
    peakDayAt,
    trades,
    trades24h: Math.round(n24),
    traders: Math.max(1, traders),
    traders24h: Math.min(traders, t24),
    holders: Math.max(1, Math.round(traders * holdRatio)),
    largestTradeUsd: p.avgTrade * Math.exp(2.2 + 0.4 * r.normal()) * Math.pow(p.q, 0.25),
  };
}

export function buildWorld(seed: number, start: number, now: number): SimWorld {
  const days = Math.ceil((now - start) / DAY);
  const macro = buildMacro(seed, days);
  const shocks = buildShocks(seed, start, days);
  const quoteBy = new Map(DEMO_QUOTES.map((q) => [q.symbol, q]));
  const weeks = Math.ceil((now - start) / WEEK) + 1;

  const markets: Market[] = [];
  const params = new Map<string, MarketParams>();
  const weekly = new Map<string, Float32Array>();
  const eco: EcosystemDay[] = Array.from({ length: days }, (_, d) => ({
    t: start + d * DAY,
    marketsCreated: 0,
    volumeUsd: 0,
    trades: 0,
    activeTraders: 0,
    activeMarkets: 0,
    marketReturn: 0,
  }));
  const retW = new Float64Array(days);

  for (let d = 0; d < days; d++) {
    const t0 = start + d * DAY;
    const t1 = Math.min(now, t0 + DAY);
    const r = rng(hash2(seed, d + 1));
    const weekday = new Date(t0).getUTCDay();
    const base = (6 + 72 * adoption(d)) * (weekday === 0 || weekday === 6 ? 0.8 : 1.05) * ((t1 - t0) / DAY);
    const live = shocks.filter((s) => shockRate(s, t0, t1) > 0);
    const launches: { theme?: Theme; quoteBias?: string; t: number; boost: number }[] = [];
    for (let i = r.poisson(base); i > 0; i--) {
      const theme = r.chance(0.32) ? r.pick(THEMES) : undefined;
      launches.push({ theme, quoteBias: theme && r.chance(0.5) ? r.pick(theme.quotes) : undefined, t: r.range(t0, t1), boost: 1 });
    }
    for (const s of live) {
      const a = Math.max(t0, s.center - (s.durH * HOUR) / 2);
      const b = Math.min(t1, s.center + (s.durH * HOUR) / 2);
      const n = r.poisson(shockRate(s, t0, t1));
      for (let i = 0; i < n; i++) {
        // launches cluster toward the middle of the shock window
        const u = (r() + r() + r()) / 3;
        launches.push({ theme: s.theme, quoteBias: s.quote, t: a + (b - a) * u, boost: r.range(1.1, 2.6) });
      }
      // the flagship that kicked it off
      const opening = s.center - (s.durH * HOUR) / 2;
      if (opening >= t0 && opening < t1) launches.push({ theme: s.theme, quoteBias: s.quote, t: opening + HOUR, boost: r.range(40, 160) });
    }

    launches.sort((x, y) => x.t - y.t);
    launches.forEach((l, i) => {
      if (l.t >= now) return;
      const mseed = hash2(seed, d * 100_003 + i + 17);
      const mr = rng(mseed);
      const quote = pickQuote(mr, l.quoteBias);
      const name = l.theme ? mr.pick(l.theme.names) : genericName(mr);
      const ticker = tickerFor(name, mr);
      const description = l.theme ? mr.pick(l.theme.blurbs) : genericBlurb(mr);
      const id = fakeAddress(mr, 44);
      const mint = fakeAddress(mr, 44);
      const creator = fakeAddress(mr, 44);
      const p = makeParams(mseed, l.t, quote, l.theme, l.boost);
      const bars = simulateBars(p, { start, now }, macro);
      const m = summarize(id, mint, name, ticker, description, creator, p, bars, quoteBy.get(quote)!, now);
      markets.push(m);
      params.set(id, p);
      const wk = new Float32Array(weeks);
      const touched = new Set<number>();
      for (const b of bars) {
        wk[Math.min(weeks - 1, Math.floor((b.t - start) / WEEK))] += b.v;
        const di = Math.floor((b.t - start) / DAY);
        const e = eco[di];
        if (!e) continue;
        e.volumeUsd += b.v;
        e.trades += b.n;
        e.activeTraders += Math.round(b.n * 0.45);
        if (b.t - p.createdAt > 3 * DAY && b.o > 0) {
          // log-volume weights: the common (macro) move dominates, not one whale market
          const wgt = Math.log1p(b.v);
          e.marketReturn! += wgt * Math.log(b.c / b.o);
          retW[di] += wgt;
        }
        if (!touched.has(di)) {
          touched.add(di);
          e.activeMarkets++;
        }
      }
      weekly.set(id, wk);
      const ce = eco[Math.floor((l.t - start) / DAY)];
      if (ce) ce.marketsCreated++;
    });
  }

  eco.forEach((e, i) => (e.marketReturn = retW[i] > 0 ? e.marketReturn! / retW[i] : 0));

  return {
    seed,
    start,
    now,
    quotes: DEMO_QUOTES.map(({ weight: _w, ...q }) => q),
    markets,
    byId: new Map(markets.map((m) => [m.id, m])),
    params,
    weekly,
    weeks,
    ecosystem: eco,
    macro,
  };
}

export const DEMO_SEED = hashString('stonkfun-archive/demo/v1');

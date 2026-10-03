/**
 * Story extraction — turns a market's bars into chapters:
 * BORN → EARLY ACTIVITY → EXPLOSION → PEAK → COLLAPSE / SURVIVAL / COMEBACK → TODAY.
 * Chapters only appear when the data supports them.
 */
import type { Bar, Market } from '../data/types';
import { fmtDuration, fmtMultiple, fmtNum, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { supplyOf } from './stories';

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type ChapterId = 'born' | 'early' | 'explosion' | 'peak' | 'collapse' | 'survival' | 'comeback' | 'today';

export interface Chapter {
  id: ChapterId;
  label: string;
  t: number;
  headline: string;
  facts: { k: string; v: string }[];
  /** bar index range this chapter covers, for highlighting on the chart */
  range: [number, number];
  tone: 'neutral' | 'up' | 'down' | 'gold';
}

const barEnd = (bars: Bar[], i: number, now: number) => (i + 1 < bars.length ? bars[i + 1].t : now);

export function buildStory(m: Market, bars: Bar[], now = Date.now()): Chapter[] {
  if (bars.length === 0) return [];
  const ch: Chapter[] = [];
  const launch = bars[0].o;
  // circulating supply implied by the current market cap (1B is the launchpad default)
  const supply = supplyOf(m);
  // real-data sources may only provide volume, not per-trade counts
  const hasCounts = bars.some((b) => b.n > 0 || b.newTraders > 0);

  ch.push({
    id: 'born',
    label: 'BORN',
    t: m.createdAt,
    headline: `$${m.ticker} appeared on StonkFun, paired against ${m.quote}.`,
    facts: [
      { k: 'Launch price', v: fmtPrice(launch) },
      { k: 'Launch market cap', v: fmtUsd(m.launchPriceUsd * supply) },
    ],
    range: [0, 0],
    tone: 'neutral',
  });

  // early activity: first 6 hours
  let ei = 0;
  let ev = 0;
  let en = 0;
  let et = 0;
  while (ei < bars.length && bars[ei].t < m.createdAt + 6 * HOUR) {
    ev += bars[ei].v;
    en += bars[ei].n;
    et += bars[ei].newTraders;
    ei++;
  }
  ei = Math.max(1, ei);
  const earlyClose = bars[ei - 1].c;
  ch.push({
    id: 'early',
    label: 'EARLY ACTIVITY',
    t: bars[Math.min(ei - 1, bars.length - 1)].t,
    headline: ev <= 0 ? 'A quiet start — almost nobody noticed.' : hasCounts ? `The first six hours: ${fmtNum(et)} wallets showed up and moved ${fmtUsd(ev)}.` : `Its first trading window moved ${fmtUsd(ev)}.`,
    facts: [
      hasCounts ? { k: 'Trades', v: fmtNum(en) } : { k: 'Volume', v: fmtUsd(ev) },
      { k: 'Price vs launch', v: fmtPct(earlyClose / launch - 1, 0) },
    ],
    range: [0, ei - 1],
    tone: earlyClose >= launch ? 'up' : 'down',
  });

  // peak
  let ai = 0;
  for (let i = 0; i < bars.length; i++) if (bars[i].h > bars[ai].h) ai = i;
  const ath = bars[ai].h;
  const mult = ath / launch;

  // explosion: strongest volume-weighted up-move before the peak
  if (mult >= 3 && ai > 0) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i <= ai; i++) {
      const r = Math.log(bars[i].c / bars[i].o);
      const s = r * Math.log1p(bars[i].v);
      if (r > 0 && s > bestScore) [best, bestScore] = [i, s];
    }
    if (best >= 0) {
      // widen to the surrounding run of up-bars
      let a = best;
      let b = best;
      while (a > 0 && bars[a - 1].c > bars[a - 1].o) a--;
      while (b < ai && bars[b + 1].c > bars[b + 1].o) b++;
      const gain = bars[b].c / bars[a].o;
      const span = barEnd(bars, b, now) - bars[a].t;
      const vol = bars.slice(a, b + 1).reduce((s, x) => s + x.v, 0);
      ch.push({
        id: 'explosion',
        label: 'EXPLOSION',
        t: bars[a].t,
        headline: `It went ${fmtMultiple(gain)} in ${fmtDuration(span)}. ${fmtUsd(vol)} changed hands.`,
        facts: [
          { k: 'Move', v: fmtPct(gain - 1, 0) },
          hasCounts ? { k: 'New traders', v: fmtNum(bars.slice(a, b + 1).reduce((s, x) => s + x.newTraders, 0)) } : { k: 'Volume', v: fmtUsd(vol) },
        ],
        range: [a, b],
        tone: 'up',
      });
    }
  }

  ch.push({
    id: 'peak',
    label: 'PEAK',
    t: bars[ai].t,
    headline: `All-time high at ${fmtPrice(ath)} — ${fmtMultiple(mult)} its launch price, ${fmtDuration(Math.max(HOUR, bars[ai].t - m.createdAt))} after birth.`,
    facts: [
      { k: 'Peak market cap', v: fmtUsd(ath * supply) },
      { k: 'Peak move', v: fmtPct(mult - 1, 0) },
    ],
    range: [ai, ai],
    tone: 'gold',
  });

  // after the peak
  let li = ai;
  for (let i = ai; i < bars.length; i++) if (bars[i].l < bars[li].l) li = i;
  const low = bars[li].l;
  const draw = low / ath - 1;
  const alive = m.status !== 'dead';
  const ageAfterPeak = now - bars[ai].t;
  if (draw <= -0.6) {
    // how long until -50% and -90%
    let half = -1;
    let ninety = -1;
    for (let i = ai; i < bars.length; i++) {
      if (half < 0 && bars[i].l <= ath * 0.5) half = i;
      if (ninety < 0 && bars[i].l <= ath * 0.1) ninety = i;
    }
    const facts = [{ k: 'Drawdown', v: fmtPct(draw, 0) }];
    if (half >= 0) facts.push({ k: 'Halved in', v: fmtDuration(Math.max(HOUR, bars[half].t - bars[ai].t)) });
    if (ninety >= 0) facts.push({ k: '−90% in', v: fmtDuration(Math.max(HOUR, bars[ninety].t - bars[ai].t)) });
    ch.push({
      id: 'collapse',
      label: 'COLLAPSE',
      t: bars[Math.max(ai, half)].t,
      headline: draw <= -0.9 ? 'Then gravity won. The chart became a cliff.' : 'Then the sell-off came, and kept coming.',
      facts,
      range: [ai, li],
      tone: 'down',
    });
  }
  // comeback: later high ≥ 2× the post-peak trough
  if (li < bars.length - 1) {
    let ri = li;
    for (let i = li; i < bars.length; i++) if (bars[i].h > bars[ri].h) ri = i;
    if (bars[ri].h >= low * 2 && ri > li) {
      ch.push({
        id: 'comeback',
        label: 'COMEBACK',
        t: bars[ri].t,
        headline: `From the bottom it rallied ${fmtMultiple(bars[ri].h / low)}${bars[ri].h >= ath ? ' — to a new all-time high' : ''}.`,
        facts: [
          { k: 'From trough', v: fmtPct(bars[ri].h / low - 1, 0) },
          { k: 'vs. ATH', v: fmtPct(bars[ri].h / ath - 1, 0) },
        ],
        range: [li, ri],
        tone: 'up',
      });
    }
  }
  if (alive && ageAfterPeak > 21 * DAY && m.volume7dUsd > 100) {
    ch.push({
      id: 'survival',
      label: 'SURVIVAL',
      t: bars[Math.min(bars.length - 1, Math.max(ai + 1, li))].t,
      headline: `Most markets fade within days. $${m.ticker} is still trading ${fmtDuration(now - m.createdAt)} later.`,
      facts: [
        { k: 'Volume, last 7d', v: fmtUsd(m.volume7dUsd) },
        { k: 'Holders', v: m.holders ? fmtNum(m.holders) : '—' },
      ],
      range: [li, bars.length - 1],
      tone: 'up',
    });
  }

  const last = bars[bars.length - 1];
  ch.push({
    id: 'today',
    label: m.status === 'dead' ? 'TODAY · SILENT' : 'TODAY',
    t: m.status === 'dead' ? m.lastTradeAt : now,
    headline:
      m.status === 'dead'
        ? `No trades since ${new Date(m.lastTradeAt).toUTCString().slice(5, 16)}. A fossil in the archive.`
        : `Trading at ${fmtPrice(last.c)}, ${fmtPct(last.c / ath - 1, 0)} from its peak.`,
    facts: [
      { k: 'vs. launch', v: fmtPct(last.c / launch - 1, 0) },
      { k: 'Lifetime volume', v: fmtUsd(m.volumeLifetimeUsd) },
    ],
    range: [bars.length - 1, bars.length - 1],
    tone: m.status === 'dead' ? 'down' : 'neutral',
  });

  return ch.sort((a, b) => order(a.id) - order(b.id));
}

const ORDER: ChapterId[] = ['born', 'early', 'explosion', 'peak', 'collapse', 'comeback', 'survival', 'today'];
const order = (id: ChapterId) => ORDER.indexOf(id);

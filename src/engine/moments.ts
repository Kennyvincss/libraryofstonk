/**
 * Moment detection.
 *
 * A Moment is a measurable anomaly in StonkFun activity. The detector never
 * invents events; each Moment carries the evidence that triggered it:
 *
 *  narrative     keyword bursts in market names vs. that keyword's trailing baseline
 *  quote-rush    launch bursts against one quote asset vs. its baseline
 *  volume-spike  ecosystem daily volume z-score vs. trailing window
 *  crash         ecosystem activity-weighted return z-score (multi-day)
 *  recovery      rebound from a detected crash trough
 *  launch        one market accounting for a large share of a day's volume
 *  milestone     cumulative market-count / volume thresholds
 *
 * Overlapping bursts (e.g. "gpu" and "goblin" from "GPU Goblin" markets) are
 * merged by member overlap. Output moments are `candidate` until they pass the
 * auto-approve confidence or are approved through curation (engine/curation.ts).
 */
import type { EcosystemDay, Market, Moment, MomentKind } from '../data/types';
import { momentRules as R } from './config';
import { nameKeywords } from './text';
import { hashString } from '../lib/hash';
import { fmtDate, fmtDateShort, fmtDuration, fmtMultiple, fmtNum, fmtPct, fmtUsd } from '../lib/format';

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Burst {
  kind: 'narrative' | 'quote-rush';
  key: string;
  start: number;
  end: number;
  members: Set<number>;
  intensity: number;
  keys: Map<string, number>; // contributing keys → member count
  quotes: Map<string, number>;
}

function bursts(markets: Market[], start: number, keyOf: (m: Market) => string[], kind: Burst['kind'], rule: { minMarkets: number; minRatio: number }): Burst[] {
  const bucketMs = R.bucketHours * HOUR;
  const nb = Math.max(1, Math.ceil((Math.max(...markets.map((m) => m.createdAt)) - start) / bucketMs) + 1);
  const index = new Map<string, number[]>();
  markets.forEach((m, i) => {
    for (const k of keyOf(m)) {
      let arr = index.get(k);
      if (!arr) index.set(k, (arr = []));
      arr.push(i);
    }
  });
  const baseBuckets = Math.round((R.baselineDays * 24) / R.bucketHours);
  const out: Burst[] = [];
  for (const [key, idxs] of index) {
    if (idxs.length < rule.minMarkets) continue;
    const counts = new Float64Array(nb);
    for (const i of idxs) counts[Math.floor((markets[i].createdAt - start) / bucketMs)]++;
    // prefix sums for fast trailing means
    const pre = new Float64Array(nb + 1);
    for (let b = 0; b < nb; b++) pre[b + 1] = pre[b] + counts[b];
    const base = (b: number) => {
      const hi = Math.max(0, b - 2);
      const lo = Math.max(0, hi - baseBuckets);
      return hi > lo ? (pre[hi] - pre[lo]) / (hi - lo) : 0;
    };
    let b = 0;
    while (b < nb) {
      const bl = base(b);
      if (counts[b] >= 3 && counts[b] >= rule.minRatio * (bl + 0.5)) {
        const ws = b;
        const baseline = bl;
        let we = b;
        let gap = 0;
        let j = b + 1;
        while (j < nb && gap <= 1) {
          if (counts[j] >= 3 && counts[j] >= rule.minRatio * 0.6 * (baseline + 0.5)) {
            we = j;
            gap = 0;
          } else gap++;
          j++;
        }
        const total = pre[we + 1] - pre[ws];
        const expected = (baseline + 0.5) * (we - ws + 1);
        if (total >= rule.minMarkets) {
          const t0 = start + ws * bucketMs;
          const t1 = start + (we + 1) * bucketMs;
          const members = new Set(idxs.filter((i) => markets[i].createdAt >= t0 && markets[i].createdAt < t1));
          const quotes = new Map<string, number>();
          for (const i of members) quotes.set(markets[i].quote, (quotes.get(markets[i].quote) ?? 0) + 1);
          out.push({ kind, key, start: t0, end: t1, members, intensity: total / expected, keys: new Map([[key, members.size]]), quotes });
        }
        b = we + 1;
      } else b++;
    }
  }
  return out;
}

function overlap(a: Set<number>, b: Set<number>) {
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return { jaccard: inter / (a.size + b.size - inter), coef: inter / Math.min(a.size, b.size) };
}

function mergeBursts(list: Burst[]): Burst[] {
  const sorted = [...list].sort((a, b) => b.members.size - a.members.size);
  const groups: Burst[] = [];
  for (const b of sorted) {
    const g = groups.find((g) => {
      if (b.start > g.end + DAY || b.end < g.start - DAY) return false;
      const o = overlap(g.members, b.members);
      return o.jaccard >= R.mergeJaccard || o.coef >= 0.6;
    });
    if (!g) {
      groups.push({ ...b, members: new Set(b.members), keys: new Map(b.keys), quotes: new Map(b.quotes) });
      continue;
    }
    for (const x of b.members) g.members.add(x);
    g.start = Math.min(g.start, b.start);
    g.end = Math.max(g.end, b.end);
    g.intensity = Math.max(g.intensity, b.intensity);
    for (const [k, v] of b.keys) g.keys.set(k, Math.max(g.keys.get(k) ?? 0, v));
    if (b.kind === 'narrative' && g.kind === 'quote-rush') {
      g.kind = 'narrative';
      g.key = b.key;
    }
  }
  // the defining key is the narrative keyword shared by the most members
  for (const g of groups) {
    if (g.kind === 'narrative') {
      let best = g.key;
      let bestN = -1;
      for (const [k, n] of g.keys) if (n > bestN && !g.quotes.has(k)) [best, bestN] = [k, n];
      g.key = best;
    }
    g.quotes = new Map();
  }
  return groups;
}

const NARRATIVE_TITLES = ['THE {K} CRAZE', '{K} FEVER', 'THE GREAT {K} RUSH', 'THE {K} STAMPEDE', '{K} SEASON', 'THE {K} MANIA', 'NIGHT OF THE {K}'];

function pickTitle(templates: string[], key: string, k: string) {
  return templates[hashString(key) % templates.length].replace('{K}', k);
}

function zscore(values: number[], i: number, trailing: number) {
  const lo = Math.max(0, i - trailing);
  const win = values.slice(lo, i);
  if (win.length < 7) return 0;
  const mean = win.reduce((s, v) => s + v, 0) / win.length;
  const sd = Math.sqrt(win.reduce((s, v) => s + (v - mean) ** 2, 0) / win.length) || 1e-9;
  return (values[i] - mean) / sd;
}

export interface DetectInput {
  markets: Market[];
  ecosystem: EcosystemDay[];
  score: (i: number) => number;
  start: number;
}

export function detectMoments({ markets, ecosystem, score, start }: DetectInput): Moment[] {
  if (markets.length === 0) return [];
  const moments: Moment[] = [];

  const finish = (kind: MomentKind, key: string, t0: number, t1: number, memberIdx: number[], title: string, tagline: string, confidence: number, intensity: number, evidence: string[], volumeOverride?: number): Moment => {
    const members = memberIdx.map((i) => markets[i]);
    const sorted = [...memberIdx].sort((a, b) => score(b) - score(a));
    const top = sorted[0] !== undefined ? markets[sorted[0]] : undefined;
    return {
      id: `${kind}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date(t0).toISOString().slice(0, 10)}`,
      kind,
      title,
      tagline,
      start: t0,
      end: t1,
      key,
      marketIds: sorted.map((i) => markets[i].id),
      topMarketId: top?.id,
      stats: {
        marketsCreated: members.filter((m) => m.createdAt >= t0 && m.createdAt <= t1).length,
        volumeUsd: volumeOverride ?? members.reduce((s, m) => s + m.volumeLifetimeUsd, 0),
        traders: members.reduce((s, m) => s + m.traders, 0),
        trades: members.reduce((s, m) => s + m.trades, 0),
        intensity,
      },
      confidence: Math.max(0, Math.min(1, confidence)),
      status: confidence >= R.autoApproveConfidence ? 'approved' : 'candidate',
      origin: 'detected',
      evidence,
    };
  };

  // ── narratives & quote rushes ────────────────────────────────────────────
  const quoteSet = new Set(markets.map((m) => m.quote.toLowerCase()));
  const nar = bursts(markets, start, (m) => nameKeywords(m).filter((k) => !quoteSet.has(k)), 'narrative', R.narrative);
  const qr = bursts(markets, start, (m) => [m.quote], 'quote-rush', R.quoteRush);
  for (const g of mergeBursts([...nar, ...qr])) {
    const idx = [...g.members].filter((i) => markets[i].createdAt >= g.start && markets[i].createdAt < g.end);
    if (idx.length < Math.min(R.narrative.minMarkets, R.quoteRush.minMarkets)) continue;
    const t0 = Math.min(...idx.map((i) => markets[i].createdAt));
    const t1 = Math.max(...idx.map((i) => markets[i].createdAt));
    const qc = new Map<string, number>();
    for (const i of idx) qc.set(markets[i].quote, (qc.get(markets[i].quote) ?? 0) + 1);
    const [domQuote, domN] = [...qc].sort((a, b) => b[1] - a[1])[0];
    const dur = fmtDuration(Math.max(6 * HOUR, t1 - t0));
    const K = g.key.toUpperCase();
    const conf = (1 - Math.exp(-(g.intensity - 1) / 5)) * Math.min(1, Math.sqrt(idx.length / 30));
    const ev = [`${idx.length} markets in ${dur}`, `${fmtMultiple(g.intensity)} the trailing ${R.baselineDays}-day pace`, `${Math.round((domN / idx.length) * 100)}% quoted in ${domQuote}`];
    if (g.keys.size > 1) ev.push(`keywords: ${[...g.keys.keys()].slice(0, 5).join(', ')}`);
    if (g.kind === 'narrative') {
      moments.push(
        finish('narrative', g.key, t0, t1, idx, pickTitle(NARRATIVE_TITLES, g.key, K),
          `For ${dur}, StonkFun went wild around ${K}-themed markets — ${fmtNum(idx.length)} launched, ${fmtMultiple(g.intensity)} the usual pace, mostly against ${domQuote}.`,
          conf, g.intensity, ev),
      );
    } else {
      moments.push(
        finish('quote-rush', g.key, t0, t1, idx, `THE ${g.key} RUSH`,
          `${fmtNum(idx.length)} markets launched against ${g.key} in ${dur} — ${fmtMultiple(g.intensity)} its normal rate.`,
          conf * 0.95, g.intensity, ev),
      );
    }
  }

  // ── ecosystem-level anomalies ────────────────────────────────────────────
  const days = ecosystem;
  const logVol = days.map((d) => Math.log1p(d.volumeUsd));
  const rawRet = days.map((d) => d.marketReturn ?? 0);
  // excess return vs. the trailing 30-day drift (meme markets bleed by default)
  const ret = rawRet.map((r, i) => {
    const w = rawRet.slice(Math.max(0, i - 30), i);
    return w.length ? r - w.reduce((s, v) => s + v, 0) / w.length : 0;
  });
  const membersByPeak = (t0: number, t1: number, limit = 80) =>
    markets
      .map((m, i) => [m, i] as const)
      .filter(([m]) => m.peakDayAt >= t0 && m.peakDayAt < t1)
      .sort((a, b) => b[0].peakDayVolumeUsd - a[0].peakDayVolumeUsd)
      .slice(0, limit)
      .map(([, i]) => i);
  const windowVolume = (i0: number, i1: number) => days.slice(i0, i1 + 1).reduce((s, d) => s + d.volumeUsd, 0);

  // crashes
  const W = R.crash.windowDays;
  const cum: number[] = ret.map((_, i) => (i >= W - 1 ? ret.slice(i - W + 1, i + 1).reduce((s, v) => s + v, 0) : 0));
  const crashWindows: [number, number][] = [];
  for (let i = W; i < days.length; i++) {
    const z = zscore(cum, i, R.crash.trailingDays);
    if (z <= R.crash.maxZ && cum[i] < -0.15) {
      if (crashWindows.length && i - crashWindows[crashWindows.length - 1][1] <= W) {
        crashWindows[crashWindows.length - 1][1] = i;
        continue;
      }
      crashWindows.push([i - W + 1, i]);
    }
  }
  for (const [c0, c1] of crashWindows) {
    // walk to the trough
    let level = 0;
    let trough = 0;
    let troughDay = c1;
    for (let i = c0; i < Math.min(days.length, c1 + 7); i++) {
      level += ret[i];
      if (level < trough) [trough, troughDay] = [level, i];
    }
    const t0 = days[c0].t;
    const t1 = days[troughDay].t + DAY;
    const depth = Math.exp(trough) - 1;
    const z = zscore(cum, c1, R.crash.trailingDays);
    const month = new Date(t0).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase();
    moments.push(
      finish('crash', 'ecosystem', t0, t1, membersByPeak(t0 - 3 * DAY, t1), `THE ${month} CAPITULATION`,
        `Between ${fmtDate(t0, { year: false })} and ${fmtDate(t1, { year: false })}, activity-weighted prices across StonkFun fell ${Math.round(-depth * 100)}% beyond their usual drift. Volume spiked as holders ran for the exits.`,
        Math.min(1, -z / 5), -z, [`${W}-day return z-score ${z.toFixed(1)}`, `trough ${fmtPct(depth, 0)} on ${fmtDateShort(days[troughDay].t)}`], windowVolume(c0, troughDay)),
    );
    // recovery
    let lvl = 0;
    let peak = 0;
    let peakDay = troughDay;
    for (let i = troughDay + 1; i < Math.min(days.length, troughDay + R.recovery.lookaheadDays); i++) {
      lvl += ret[i];
      if (lvl > peak) [peak, peakDay] = [lvl, i];
    }
    const recW = R.recovery.windowDays;
    const cumR = ret.map((_, i) => (i >= recW - 1 ? ret.slice(i - recW + 1, i + 1).reduce((s, v) => s + v, 0) : 0));
    let bestZ = 0;
    for (let i = troughDay + 1; i <= peakDay; i++) bestZ = Math.max(bestZ, zscore(cumR, i, R.crash.trailingDays + 15));
    if (peak > 0.06 && bestZ >= R.recovery.minZ) {
      const r0 = days[troughDay].t;
      const r1 = days[peakDay].t + DAY;
      moments.push(
        finish('recovery', 'ecosystem', r0, r1, membersByPeak(r0, r1), `THE ${month} COMEBACK`,
          `After the ${month.charAt(0) + month.slice(1).toLowerCase()} capitulation, StonkFun clawed back ${fmtPct(Math.exp(peak) - 1, 0)} in ${fmtDuration(r1 - r0)}.`,
          Math.min(1, bestZ / 4), bestZ, [`rebound ${fmtPct(Math.exp(peak) - 1, 0)} from trough`, `${recW}-day return z-score ${bestZ.toFixed(1)}`], windowVolume(troughDay, peakDay)),
      );
    }
  }

  // volume spikes (not already explained by a crash)
  const inCrash = (i: number) => crashWindows.some(([a, b]) => i >= a - 1 && i <= b + 3);
  for (let i = 7; i < days.length; i++) {
    const z = zscore(logVol, i, R.volumeSpike.trailingDays);
    if (z < R.volumeSpike.minZ || inCrash(i)) continue;
    let j = i;
    while (j + 1 < days.length && zscore(logVol, j + 1, R.volumeSpike.trailingDays + (j + 1 - i)) >= R.volumeSpike.minZ * 0.7) j++;
    const lo = Math.max(0, i - R.volumeSpike.trailingDays);
    const trailing = days.slice(lo, i).reduce((s, d) => s + d.volumeUsd, 0) / Math.max(1, i - lo);
    const peakV = Math.max(...days.slice(i, j + 1).map((d) => d.volumeUsd));
    const ratio = peakV / Math.max(1, trailing);
    const t0 = days[i].t;
    const t1 = days[j].t + DAY;
    moments.push(
      finish('volume-spike', 'ecosystem', t0, t1, membersByPeak(t0, t1), `THE ${fmtDateShort(t0)} FRENZY`,
        `StonkFun traded ${fmtUsd(peakV)} in a single day — ${fmtMultiple(ratio)} the trailing ${R.volumeSpike.trailingDays}-day average.`,
        Math.min(1, z / 5), ratio, [`daily volume z-score ${z.toFixed(1)}`, `${fmtMultiple(ratio)} trailing average`], windowVolume(i, j)),
    );
    i = j + 2;
  }

  // single-market launches that dominated a day
  const dayIdx = (t: number) => Math.floor((t - start) / DAY);
  const launchByDay = new Map<number, Moment>();
  markets.forEach((m, i) => {
    const d = days[dayIdx(m.peakDayAt)];
    if (!d || d.volumeUsd <= 0) return;
    const share = m.peakDayVolumeUsd / d.volumeUsd;
    if (share < R.launch.minShareOfDay || m.peakDayVolumeUsd < R.launch.minDayVolumeUsd) return;
    if ((m.peakDayAt - m.createdAt) / DAY > 3) return;
    const prev = launchByDay.get(dayIdx(m.peakDayAt));
    if (prev && prev.stats.intensity >= share) return;
    const related = markets
      .map((x, j) => [x, j] as const)
      .filter(([x]) => Math.abs(x.createdAt - m.createdAt) < 2 * DAY && x.quote === m.quote && x.id !== m.id)
      .sort((a, b) => score(b[1]) - score(a[1]))
      .slice(0, 30)
      .map(([, j]) => j);
    const mo = finish('launch', m.ticker, m.createdAt, m.peakDayAt + DAY, [i, ...related], `THE $${m.ticker} EVENT`,
      `On ${fmtDate(m.peakDayAt, { year: false })}, $${m.ticker} / ${m.quote} alone made up ${Math.round(share * 100)}% of all StonkFun volume — ${fmtUsd(m.peakDayVolumeUsd)} in one day.`,
      Math.min(1, share * 1.8), share, [`${Math.round(share * 100)}% of the day's ecosystem volume`, `${fmtUsd(m.peakDayVolumeUsd)} peak-day volume`], m.peakDayVolumeUsd);
    mo.topMarketId = m.id;
    mo.marketIds = [m.id, ...mo.marketIds.filter((x) => x !== m.id)];
    launchByDay.set(dayIdx(m.peakDayAt), mo);
  });
  moments.push(...launchByDay.values());

  // milestones
  const byCreated = markets.map((m, i) => [m, i] as const).sort((a, b) => a[0].createdAt - b[0].createdAt);
  for (const n of R.milestones.markets) {
    if (byCreated.length < n) break;
    const [m, i] = byCreated[n - 1];
    const sameDay = byCreated.filter(([x]) => Math.abs(x.createdAt - m.createdAt) < DAY / 2).map(([, j]) => j);
    const mo = finish('milestone', `${n}-markets`, m.createdAt, m.createdAt + HOUR, [i, ...sameDay.filter((j) => j !== i)], `${n.toLocaleString('en-US')} MARKETS`,
      `Market #${n.toLocaleString('en-US')} was born on ${fmtDate(m.createdAt)}: $${m.ticker} / ${m.quote}.`, 1, 1, [`cumulative market count crossed ${n.toLocaleString('en-US')}`]);
    mo.topMarketId = m.id;
    moments.push(mo);
  }
  let cv = 0;
  let vi = 0;
  for (let d = 0; d < days.length && vi < R.milestones.volumeUsd.length; d++) {
    cv += days[d].volumeUsd;
    while (vi < R.milestones.volumeUsd.length && cv >= R.milestones.volumeUsd[vi]) {
      const t = days[d].t;
      moments.push(
        finish('milestone', `${R.milestones.volumeUsd[vi]}-volume`, t, t + DAY, membersByPeak(t, t + DAY, 40), `${fmtUsd(R.milestones.volumeUsd[vi], 0)} TRADED`,
          `On ${fmtDate(t)}, cumulative StonkFun volume crossed ${fmtUsd(R.milestones.volumeUsd[vi], 0)}.`, 1, 1, [`cumulative volume ${fmtUsd(cv)}`], days[d].volumeUsd),
      );
      vi++;
    }
  }

  const unique = new Map<string, Moment>();
  for (const m of moments) if (!unique.has(m.id) || unique.get(m.id)!.confidence < m.confidence) unique.set(m.id, m);
  return [...unique.values()].sort((a, b) => b.start - a.start);
}

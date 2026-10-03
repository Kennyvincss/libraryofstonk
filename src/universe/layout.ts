/**
 * Universe layout.
 *
 *  • every quote asset is a galaxy (NVDAx, SPYx, SOL…), sized by market count
 *  • inside a galaxy, generic markets form a spiral core — most notable at the centre
 *  • narratives (keywords with a detected moment or a large following) form
 *    satellite clumps; a narrative sits at the same angle in every galaxy, so
 *    "GPU" clumps line up across NVDAx, QQQx, … — a visible cross-galaxy thread
 *
 * Positions are deterministic, so a market is always in the same place.
 */
import type { Archive, VisualKind } from '../engine/archive';
import { hashString, unit } from '../lib/hash';
import { nameKeywords } from '../engine/text';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface UNode {
  i: number; // index into archive.markets
  id: string;
  x: number;
  y: number;
  r: number;
  hue: number;
  kind: VisualKind;
  rank: number;
  score: number;
  createdAt: number;
  ticker: string;
  quote: string;
  narrative?: string;
  galaxy: number;
}

export interface UCluster {
  id: string;
  type: 'galaxy' | 'narrative';
  label: string;
  sub: string;
  x: number;
  y: number;
  r: number;
  hue: number;
  count: number;
  galaxy: number;
}

export interface UniverseLayout {
  nodes: UNode[];
  clusters: UCluster[];
  radius: number;
  byNarrative: Map<string, number[]>;
}

export function nodeRadius(vol: number, traders: number, score: number) {
  return Math.min(16, (0.8 + 1.15 * Math.log10(1 + vol / 300) + 0.35 * Math.log10(1 + traders / 100)) * (0.65 + 0.9 * score));
}

export function layoutUniverse(a: Archive): UniverseLayout {
  const markets = a.markets;
  // primary narrative: prefer keywords that defined a public moment
  const momentKeys = new Set(a.publicMoments.filter((m) => m.kind === 'narrative').map((m) => m.key));
  const bigNarr = new Map(a.narratives.filter((n) => n.count >= 40).map((n) => [n.key, n.count]));
  const primary = markets.map((m) => {
    const ks = nameKeywords(m);
    const mk = ks.find((k) => momentKeys.has(k));
    if (mk) return mk;
    let best: string | undefined;
    let bn = 0;
    for (const k of ks) {
      const c = bigNarr.get(k) ?? 0;
      if (c > bn) [best, bn] = [k, c];
    }
    return best;
  });

  const byQuote = new Map<string, number[]>();
  markets.forEach((m, i) => {
    const arr = byQuote.get(m.quote) ?? [];
    arr.push(i);
    byQuote.set(m.quote, arr);
  });
  const galaxies = [...byQuote].sort((x, y) => y[1].length - x[1].length);

  const nodes: UNode[] = [];
  const clusters: UCluster[] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  const SP = 5.2; // phyllotaxis spacing (world units)

  galaxies.forEach(([quote, idxs], gi) => {
    const q = a.quotes.get(quote)!;
    const rankOf = (i: number) => a.notability.rank[i];
    // split core vs narrative clumps
    const clumps = new Map<string, number[]>();
    const core: number[] = [];
    for (const i of idxs) {
      const k = primary[i];
      if (k) {
        const arr = clumps.get(k) ?? [];
        arr.push(i);
        clumps.set(k, arr);
      } else core.push(i);
    }
    for (const [k, arr] of clumps) {
      if (arr.length < 6) {
        core.push(...arr);
        clumps.delete(k);
      }
    }
    core.sort((x, y) => rankOf(x) - rankOf(y));
    const coreR = SP * Math.sqrt(core.length + 1) * 1.05;
    const local: { i: number; x: number; y: number; narrative?: string }[] = [];
    const arms = 2 + (hashString(quote) % 3);
    core.forEach((i, k) => {
      const rr = coreR * Math.sqrt((k + 0.5) / core.length);
      const arm = k % arms;
      const jitter = (unit(markets[i].id) - 0.5) * 0.9;
      const theta = (arm * 2 * Math.PI) / arms + rr * 0.016 + jitter * (0.4 + rr / coreR) + k * GOLDEN * 0.04;
      local.push({ i, x: Math.cos(theta) * rr, y: Math.sin(theta) * rr });
    });
    let extent = coreR;
    const clumpList = [...clumps].sort((x, y) => y[1].length - x[1].length);
    const used: { a: number; r: number; d: number }[] = [];
    for (const [k, arr] of clumpList) {
      arr.sort((x, y) => rankOf(x) - rankOf(y));
      const cr = SP * Math.sqrt(arr.length + 1) * 1.1;
      let ang = unit(`narr-${k}`) * Math.PI * 2;
      let d = coreR + cr + 26;
      // nudge outward until it doesn't overlap a previous clump
      for (let tries = 0; tries < 40; tries++) {
        const cx = Math.cos(ang) * d;
        const cy = Math.sin(ang) * d;
        const hit = used.some((u) => Math.hypot(Math.cos(u.a) * u.d - cx, Math.sin(u.a) * u.d - cy) < u.r + cr + 14);
        if (!hit) break;
        if (tries % 2) d += cr * 0.5;
        else ang += 0.35;
      }
      used.push({ a: ang, r: cr, d });
      const cx = Math.cos(ang) * d;
      const cy = Math.sin(ang) * d;
      arr.forEach((i, kk) => {
        const rr = cr * Math.sqrt((kk + 0.5) / arr.length);
        const th = kk * GOLDEN;
        local.push({ i, x: cx + Math.cos(th) * rr, y: cy + Math.sin(th) * rr, narrative: k });
      });
      extent = Math.max(extent, d + cr);
      clusters.push({ id: `${quote}:${k}`, type: 'narrative', label: k.toUpperCase(), sub: `${arr.length} in ${quote}`, x: cx, y: cy, r: cr, hue: q.hue, count: arr.length, galaxy: gi });
    }

    // pack galaxies on a golden spiral without overlaps
    let gx = 0;
    let gy = 0;
    if (gi > 0) {
      const ang0 = gi * GOLDEN * 2.1;
      for (let d = 200; d < 20000; d += 30) {
        const x = Math.cos(ang0 + d * 0.0009) * d;
        const y = Math.sin(ang0 + d * 0.0009) * d * 0.78;
        if (!placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + extent + 90)) {
          gx = x;
          gy = y;
          break;
        }
      }
    }
    placed.push({ x: gx, y: gy, r: extent });
    for (const c of clusters) if (c.galaxy === gi && c.type === 'narrative') {
      c.x += gx;
      c.y += gy;
    }
    clusters.push({ id: quote, type: 'galaxy', label: quote, sub: `${idxs.length.toLocaleString('en-US')} markets · ${q.name}`, x: gx, y: gy, r: extent, hue: q.hue, count: idxs.length, galaxy: gi });

    for (const p of local) {
      const m = markets[p.i];
      nodes.push({
        i: p.i,
        id: m.id,
        x: gx + p.x,
        y: gy + p.y,
        r: nodeRadius(m.volumeLifetimeUsd, m.traders, a.notability.score[p.i]),
        hue: q.hue,
        kind: a.kind[p.i],
        rank: a.notability.rank[p.i],
        score: a.notability.score[p.i],
        createdAt: m.createdAt,
        ticker: m.ticker,
        quote: m.quote,
        narrative: p.narrative ?? primary[p.i],
        galaxy: gi,
      });
    }
  });

  const radius = Math.max(...placed.map((p) => Math.hypot(p.x, p.y) + p.r));
  const byNarrative = new Map<string, number[]>();
  nodes.forEach((n, k) => {
    if (!n.narrative) return;
    const arr = byNarrative.get(n.narrative) ?? [];
    arr.push(k);
    byNarrative.set(n.narrative, arr);
  });
  for (const arr of byNarrative.values()) arr.sort((x, y) => nodes[x].rank - nodes[y].rank);
  return { nodes, clusters, radius, byNarrative };
}

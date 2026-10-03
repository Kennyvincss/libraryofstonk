import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Archive } from '../engine/archive';
import type { Market } from '../data/types';

export interface WebLeaf {
  id: string;
  label: string;
  hue: number;
  href: string;
  size: number;
  gold?: boolean;
}
export interface WebHub {
  id: string;
  label: string;
  sub: string;
  hue: number;
  href?: string;
  leaves: WebLeaf[];
}
export interface WebGraph {
  center: { label: string; sub: string; hue: number };
  hubs: WebHub[];
}

/** A clickable radial web: centre → hubs (shared traits) → markets. */
export function ConnectionWeb({ graph }: { graph: WebGraph }) {
  const nav = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [hot, setHot] = useState<string | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(Math.max(300, e[0].contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const small = W < 640;
  const H = small ? 560 : 620;
  const cx = W / 2;
  const cy = H / 2;
  const R1 = Math.min(W, H) * (small ? 0.24 : 0.25);
  const R2 = Math.min(W * 0.47, H * 0.46);
  const n = graph.hubs.length;

  const hubs = graph.hubs.map((h, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const spread = Math.min((Math.PI * 2) / n, 1.2) * 0.85;
    const leaves = h.leaves.map((l, j) => {
      const la = a + (h.leaves.length > 1 ? (j / (h.leaves.length - 1) - 0.5) * spread : 0);
      const rr = R2 - (j % 2) * (small ? 26 : 38);
      return { ...l, x: cx + Math.cos(la) * rr, y: cy + Math.sin(la) * rr, a: la };
    });
    return { ...h, x: cx + Math.cos(a) * R1, y: cy + Math.sin(a) * R1, a, leaves };
  });

  return (
    <div className="web" ref={wrap}>
      <svg width={W} height={H} role="img" aria-label="Market connections">
        <defs>
          <radialGradient id="web-core">
            <stop offset="0%" stopColor={`hsl(${graph.center.hue},100%,80%)`} />
            <stop offset="100%" stopColor={`hsla(${graph.center.hue},100%,50%,0)`} />
          </radialGradient>
        </defs>
        {hubs.map((h, i) => (
          <g key={h.id} className={`web-branch ${hot && hot !== h.id ? 'dim' : ''}`} style={{ animationDelay: `${i * 0.06}s` }}>
            <path d={`M${cx},${cy} Q${(cx + h.x) / 2 + Math.sin(h.a) * 20},${(cy + h.y) / 2 - Math.cos(h.a) * 20} ${h.x},${h.y}`} className="web-edge hub" stroke={`hsla(${h.hue},100%,70%,0.55)`} />
            {h.leaves.map((l) => (
              <path key={l.id} d={`M${h.x},${h.y} L${l.x},${l.y}`} className="web-edge" stroke={`hsla(${h.hue},100%,70%,0.3)`} />
            ))}
          </g>
        ))}
        <circle cx={cx} cy={cy} r={small ? 60 : 78} fill="url(#web-core)" opacity="0.35" className="web-core-glow" />
        {hubs.map((h, i) => (
          <g key={h.id} className={`web-branch ${hot && hot !== h.id ? 'dim' : ''}`} style={{ animationDelay: `${i * 0.06 + 0.1}s` }} onPointerEnter={() => setHot(h.id)} onPointerLeave={() => setHot(null)}>
            {h.leaves.map((l) => (
              <g key={l.id} className="web-leaf" onClick={() => nav(l.href)} tabIndex={0} role="link" aria-label={l.label} onKeyDown={(e) => e.key === 'Enter' && nav(l.href)}>
                <circle cx={l.x} cy={l.y} r={l.size + 6} className="hit" />
                <circle cx={l.x} cy={l.y} r={l.size} fill={l.gold ? '#ffd772' : `hsl(${l.hue},100%,72%)`} className="leaf-dot" />
                <text x={l.x + (Math.cos(l.a) >= 0 ? l.size + 5 : -l.size - 5)} y={l.y + 4} textAnchor={Math.cos(l.a) >= 0 ? 'start' : 'end'}>
                  {l.label}
                </text>
              </g>
            ))}
            <g className={`web-hub ${h.href ? 'link' : ''}`} onClick={() => h.href && nav(h.href)} tabIndex={h.href ? 0 : -1} role={h.href ? 'link' : undefined} onKeyDown={(e) => e.key === 'Enter' && h.href && nav(h.href)}>
              <rect x={h.x - hubW(h.label) / 2} y={h.y - 15} width={hubW(h.label)} height={30} rx={15} style={{ stroke: `hsl(${h.hue},100%,70%)` }} />
              <text x={h.x} y={h.y + 1} textAnchor="middle" className="hub-label">
                {h.label}
              </text>
              <text x={h.x} y={h.y + 28} textAnchor="middle" className="hub-sub">
                {h.sub}
              </text>
            </g>
          </g>
        ))}
        <g className="web-center">
          <circle cx={cx} cy={cy} r={small ? 34 : 42} style={{ stroke: `hsl(${graph.center.hue},100%,70%)` }} />
          <text x={cx} y={cy + 2} textAnchor="middle" className="center-label">
            {graph.center.label}
          </text>
          <text x={cx} y={cy + (small ? 50 : 60)} textAnchor="middle" className="hub-sub">
            {graph.center.sub}
          </text>
        </g>
      </svg>
    </div>
  );
}

const hubW = (s: string) => Math.max(64, s.length * 8.2 + 26);

const leafOf = (a: Archive, m: Market): WebLeaf => ({
  id: m.id,
  label: `$${m.ticker}`,
  hue: a.quoteOf(m).hue,
  href: `/market/${m.id}`,
  size: Math.max(3, Math.min(9, 2 + Math.log10(1 + m.volumeLifetimeUsd / 1000) * 1.6)),
  gold: a.hasBadge(m.id, 'legendary'),
});

export function marketGraph(a: Archive, id: string): WebGraph | undefined {
  const rel = a.related(id);
  if (!rel) return undefined;
  const m = rel.market;
  const q = a.quoteOf(m);
  const hubs: WebHub[] = [];
  hubs.push({ id: 'quote', label: m.quote, sub: 'same quote asset', hue: q.hue, href: `/c/quote/${encodeURIComponent(m.quote)}`, leaves: rel.sameQuote.slice(0, 5).map((x) => leafOf(a, x)) });
  for (const nr of rel.narratives.slice(0, 2)) hubs.push({ id: `n-${nr.narrative.key}`, label: `#${nr.narrative.key.toUpperCase()}`, sub: 'same narrative', hue: (q.hue + 140) % 360, href: `/c/narrative/${encodeURIComponent(nr.narrative.key)}`, leaves: nr.markets.slice(0, 5).map((x) => leafOf(a, x)) });
  for (const mo of rel.moments.slice(0, 1))
    hubs.push({
      id: `mo-${mo.id}`,
      label: mo.title.length > 22 ? `${mo.title.slice(0, 21)}…` : mo.title,
      sub: 'same moment',
      hue: 52,
      href: `/moments/${mo.id}`,
      leaves: mo.marketIds
        .filter((x) => x !== id)
        .slice(0, 5)
        .map((x) => leafOf(a, a.byId.get(x)!)),
    });
  if (rel.samePeriod.length) hubs.push({ id: 'period', label: 'BORN SAME DAY', sub: 'similar creation period', hue: 200, leaves: rel.samePeriod.slice(0, 4).map((x) => leafOf(a, x)) });
  if (rel.similar.length) hubs.push({ id: 'similar', label: 'TRADES ALIKE', sub: 'similar behaviour', hue: 312, leaves: rel.similar.slice(0, 5).map((x) => leafOf(a, x)) });
  return { center: { label: `$${m.ticker}`, sub: `${m.ticker} / ${m.quote}`, hue: q.hue }, hubs: hubs.filter((h) => h.leaves.length) };
}

export function quoteGraph(a: Archive, symbol: string): WebGraph | undefined {
  const q = a.quotes.get(symbol);
  if (!q) return undefined;
  const markets = a.quoteMarkets(symbol, 4000);
  const counts = new Map<string, Market[]>();
  for (const m of markets) for (const nr of a.narrativesOf(m)) counts.set(nr.key, [...(counts.get(nr.key) ?? []), m]);
  const hubs: WebHub[] = [...counts]
    .filter(([, v]) => v.length >= 4)
    .sort((x, y) => y[1].length - x[1].length)
    .slice(0, 5)
    .map(([k, v]) => ({ id: k, label: `#${k.toUpperCase()}`, sub: `${v.length} markets`, hue: (q.hue + 120) % 360, href: `/c/narrative/${encodeURIComponent(k)}`, leaves: v.slice(0, 5).map((m) => leafOf(a, m)) }));
  hubs.unshift({ id: 'top', label: 'MOST NOTABLE', sub: 'top markets', hue: 46, leaves: markets.slice(0, 5).map((m) => leafOf(a, m)) });
  return { center: { label: symbol, sub: q.name, hue: q.hue }, hubs };
}

export function narrativeGraph(a: Archive, key: string): WebGraph | undefined {
  const markets = a.narrativeMarkets(key, 2000);
  if (!markets.length) return undefined;
  const byQuote = new Map<string, Market[]>();
  for (const m of markets) byQuote.set(m.quote, [...(byQuote.get(m.quote) ?? []), m]);
  const hubs: WebHub[] = [...byQuote]
    .sort((x, y) => y[1].length - x[1].length)
    .slice(0, 6)
    .map(([qs, v]) => {
      const q = a.quotes.get(qs)!;
      return { id: qs, label: qs, sub: `${v.length} markets`, hue: q.hue, href: `/c/quote/${encodeURIComponent(qs)}`, leaves: v.slice(0, 5).map((m) => leafOf(a, m)) };
    });
  return { center: { label: `#${key.toUpperCase()}`, sub: `${markets.length} markets`, hue: 96 }, hubs };
}

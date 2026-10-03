import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Market } from '../data/types';
import { useArchive } from '../hooks/archive';

/** Packed bubbles — a visual cluster of a set of markets. */
export function BubbleField({ markets, metric }: { markets: Market[]; metric: (m: Market) => number }) {
  const { archive } = useArchive();
  const nav = useNavigate();
  const [hot, setHot] = useState<string | null>(null);
  const W = 1000;
  const H = 300;
  const circles = useMemo(() => {
    const vals = markets.map((m) => Math.max(0, metric(m)));
    const max = Math.max(...vals, 1);
    const items = markets
      .map((m, i) => ({ m, r: 9 + Math.sqrt(vals[i] / max) * 52 }))
      .sort((a, b) => b.r - a.r);
    const placed: { m: Market; r: number; x: number; y: number }[] = [];
    for (const it of items) {
      let ok = false;
      for (let k = 0; k < 2400 && !ok; k++) {
        const a = k * 0.37;
        const d = k * 0.55;
        const x = W / 2 + Math.cos(a) * d * 1.9;
        const y = H / 2 + Math.sin(a) * d * 0.62;
        if (x - it.r < 4 || x + it.r > W - 4 || y - it.r < 4 || y + it.r > H - 4) continue;
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + it.r + 3)) {
          placed.push({ ...it, x, y });
          ok = true;
        }
      }
    }
    return placed;
  }, [markets, metric]);
  return (
    <svg className="bubbles" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Market cluster">
      {circles.map(({ m, r, x, y }, i) => {
        const hue = archive.quoteOf(m).hue;
        const legend = archive.hasBadge(m.id, 'legendary');
        return (
          <g key={m.id} className={`bubble ${hot && hot !== m.id ? 'dim' : ''}`} style={{ animationDelay: `${i * 0.02}s` }} onPointerEnter={() => setHot(m.id)} onPointerLeave={() => setHot(null)} onClick={() => nav(`/market/${m.id}`)} role="link" aria-label={`$${m.ticker}`}>
            <circle cx={x} cy={y} r={r} fill={`hsla(${hue},90%,55%,0.16)`} stroke={legend ? '#ffd772' : `hsla(${hue},100%,70%,0.7)`} strokeWidth={legend ? 2 : 1} />
            <circle cx={x} cy={y} r={Math.max(2, r * 0.18)} fill={`hsl(${hue},100%,78%)`} />
            {r > 20 && (
              <text x={x} y={y + r * 0.45 + 4} textAnchor="middle" style={{ fontSize: Math.min(14, r * 0.34) }}>
                ${m.ticker}
              </text>
            )}
            <title>
              ${m.ticker} / {m.quote}
            </title>
          </g>
        );
      })}
    </svg>
  );
}

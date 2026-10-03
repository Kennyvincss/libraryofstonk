import { useMemo } from 'react';
import { useArchive } from '../hooks/archive';

/** A tiny static star map of a set of markets, using their universe positions. */
export function MiniConstellation({ ids, w = 320, h = 160 }: { ids: string[]; w?: number; h?: number }) {
  const { layout } = useArchive();
  const pts = useMemo(() => {
    const set = new Set(ids);
    const ns = layout.nodes.filter((n) => set.has(n.id));
    if (!ns.length) return [];
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((w - 30) / Math.max(40, x1 - x0), (h - 30) / Math.max(40, y1 - y0));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const p = ns
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((n) => ({ x: w / 2 + (n.x - cx) * s, y: h / 2 + (n.y - cy) * s, r: Math.max(0.8, Math.min(5, n.r * 0.55)), hue: n.hue, gold: n.kind === 'legendary' }));
    return p;
  }, [ids, layout, w, h]);
  const edges = useMemo(() => {
    const e: [number, number][] = [];
    for (let i = 1; i < Math.min(pts.length, 70); i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < i; j++) {
        const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
        if (d < bd) [bd, best] = [d, j];
      }
      e.push([i, best]);
    }
    return e;
  }, [pts]);
  return (
    <svg className="mini-const" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {edges.map(([a, b], i) => (
        <line key={i} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} />
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.gold ? '#ffd772' : `hsl(${p.hue},100%,75%)`} style={{ animationDelay: `${(i % 17) * 0.23}s` }} />
      ))}
    </svg>
  );
}

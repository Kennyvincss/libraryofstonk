import { useEffect, useRef, useState } from 'react';
import { useSeries } from '../hooks/archive';
import type { Bar } from '../data/types';

/** Lazy sparkline: fetches the series only once the card scrolls into view. */
export function Sparkline({ id, w = 160, h = 40, hue = 90 }: { id: string; w?: number; h?: number; hue?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setSeen(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const bars = useSeries(id, seen);
  const d = bars && bars.length > 1 ? path(bars, w, h) : null;
  return (
    <svg ref={ref} className="spark" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {d ? (
        <>
          <defs>
            <linearGradient id={`spk-${id.slice(0, 10)}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={`hsla(${hue},100%,65%,0.35)`} />
              <stop offset="100%" stopColor={`hsla(${hue},100%,65%,0)`} />
            </linearGradient>
          </defs>
          <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#spk-${id.slice(0, 10)})`} />
          <path d={d} fill="none" stroke={`hsl(${hue},100%,70%)`} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <line x1="0" x2={w} y1={h * 0.7} y2={h * 0.7} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
      )}
    </svg>
  );
}

function path(bars: Bar[], w: number, h: number) {
  const t0 = bars[0].t;
  const t1 = bars[bars.length - 1].t || t0 + 1;
  const ys = bars.map((b) => Math.log(Math.max(1e-18, b.c)));
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  // log-time on x so the launch drama and the long tail both stay visible
  const lx = (t: number) => Math.log1p((t - t0) / 3_600_000) / Math.log1p((t1 - t0) / 3_600_000 || 1);
  return bars.map((b, i) => `${i ? 'L' : 'M'}${(lx(b.t) * w).toFixed(1)},${(h - 2 - ((ys[i] - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join(' ');
}

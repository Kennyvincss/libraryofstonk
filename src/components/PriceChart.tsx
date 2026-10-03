import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '../data/types';
import type { Chapter } from '../engine/story';
import { fmtDateShort, fmtDateTime, fmtNum, fmtPrice, fmtUsd } from '../lib/format';

const HOUR = 3_600_000;
const RANGES = [
  ['life', 'Lifetime'],
  ['launch', 'First 72h'],
  ['30d', '30D'],
  ['7d', '7D'],
] as const;
type Range = (typeof RANGES)[number][0];

export function PriceChart({ bars, chapters, active, onActive, hue, now }: { bars: Bar[]; chapters: Chapter[]; active: number | null; onActive: (i: number | null) => void; hue: number; now: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  const [range, setRange] = useState<Range>('life');
  const [log, setLog] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(Math.max(280, e[0].contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const H = W < 600 ? 240 : 320;
  const VH = 54;
  const PAD = { l: 8, r: 64, t: 40, b: 22 };

  const view = useMemo(() => {
    if (!bars.length) return { from: 0, to: 0 };
    const t0 = bars[0].t;
    const tEnd = now;
    let from = 0;
    let to = bars.length - 1;
    if (range === 'launch') {
      const k = bars.findIndex((b) => b.t > t0 + 72 * HOUR);
      to = k === -1 ? bars.length - 1 : Math.max(0, k - 1);
    }
    if (range === '30d' || range === '7d') {
      const span = (range === '30d' ? 30 : 7) * 24 * HOUR;
      const k = bars.findIndex((b) => b.t >= tEnd - span);
      from = k === -1 ? bars.length - 1 : k;
    }
    if (to < from) to = from;
    return { from, to };
  }, [bars, range, now]);

  const slice = bars.slice(view.from, view.to + 1);
  const geom = useMemo(() => {
    if (slice.length === 0) return null;
    const tA = slice[0].t;
    const tB = Math.max(tA + HOUR, view.to + 1 < bars.length ? bars[view.to + 1].t : Math.min(now, slice[slice.length - 1].t + 24 * HOUR));
    const tr = (v: number) => (log ? Math.log(Math.max(1e-18, v)) : v);
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of slice) {
      lo = Math.min(lo, tr(b.l));
      hi = Math.max(hi, tr(b.h));
    }
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    const padY = (hi - lo) * 0.08;
    lo -= padY;
    hi += padY;
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b - VH;
    // lifetime view: log-time axis so the launch frenzy and the long tail both get room
    const logTime = range === 'life' && tB - tA > 10 * 24 * HOUR;
    const spanH = (tB - tA) / HOUR;
    const f = (t: number) => (logTime ? Math.log1p(Math.max(0, t - tA) / HOUR) / Math.log1p(spanH) : (t - tA) / (tB - tA));
    const x = (t: number) => PAD.l + f(t) * plotW;
    const nTicks = W < 600 ? 3 : 6;
    const xTicks = Array.from({ length: nTicks }, (_, i) => {
      const g = i / (nTicks - 1);
      const t = logTime ? tA + Math.expm1(g * Math.log1p(spanH)) * HOUR : tA + g * (tB - tA);
      return { t, x: PAD.l + g * plotW };
    });
    const y = (v: number) => PAD.t + (1 - (tr(v) - lo) / (hi - lo)) * plotH;
    const vmax = Math.max(...slice.map((b) => b.v / Math.max(1, ((nextT(bars, view.from + slice.indexOf(b), now) - b.t) / HOUR))), 1);
    const ticks = Array.from({ length: 4 }, (_, i) => {
      const f = i / 3;
      const tv = lo + (hi - lo) * (1 - f);
      return { y: PAD.t + f * plotH, v: log ? Math.exp(tv) : tv };
    });
    return { x, y, tA, tB, plotW, plotH, vmax, ticks, xTicks, logTime };
  }, [slice, W, H, log, bars, view, now, range]);

  if (!geom || slice.length === 0) return <div className="chart-empty">No trades recorded.</div>;
  const { x, y, plotH, vmax, ticks, xTicks, logTime } = geom;
  let lastLabelX = -999;
  let stack = 0;
  const line = slice.map((b, i) => `${i ? 'L' : 'M'}${x(b.t + 0.5 * (nextT(bars, view.from + i, now) - b.t)).toFixed(1)},${y(b.c).toFixed(1)}`).join(' ');
  const baseY = PAD.t + plotH;
  const area = `${line} L${x(slice[slice.length - 1].t).toFixed(1)},${baseY} L${PAD.l},${baseY} Z`;
  const activeCh = active !== null ? chapters[active] : null;
  const hb = hover !== null ? bars[hover] : null;

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = view.from;
    let bd = Infinity;
    for (let i = view.from; i <= view.to; i++) {
      const d = Math.abs(x(bars[i].t) - px);
      if (d < bd) [bd, best] = [d, i];
    }
    setHover(best);
  };

  return (
    <div className="chart" ref={wrap}>
      <div className="chart-bar">
        <div className="seg">
          {RANGES.map(([k, l]) => (
            <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>
              {l}
            </button>
          ))}
        </div>
        <button className={`seg-one ${log ? 'on' : ''}`} onClick={() => setLog((v) => !v)} title="Logarithmic price scale — memes move in multiples">
          LOG
        </button>
      </div>
      <svg width={W} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="chart-svg" role="img" aria-label="Price and volume history">
        <defs>
          <linearGradient id="pc-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={`hsla(${hue},100%,65%,0.32)`} />
            <stop offset="100%" stopColor={`hsla(${hue},100%,65%,0)`} />
          </linearGradient>
        </defs>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={tk.y} y2={tk.y} className="grid" />
            <text x={W - PAD.r + 6} y={tk.y + 4} className="axis">
              {fmtPrice(tk.v)}
            </text>
          </g>
        ))}
        {activeCh && activeCh.range[1] >= view.from && activeCh.range[0] <= view.to && (
          <rect
            className={`ch-band tone-${activeCh.tone}`}
            x={x(bars[Math.max(view.from, activeCh.range[0])].t) - 2}
            width={Math.max(4, x(nextT(bars, Math.min(view.to, activeCh.range[1]), now)) - x(bars[Math.max(view.from, activeCh.range[0])].t) + 4)}
            y={PAD.t}
            height={H - PAD.t - PAD.b}
          />
        )}
        <path d={area} fill="url(#pc-area)" />
        <path d={line} fill="none" stroke={`hsl(${hue},100%,70%)`} strokeWidth="1.8" strokeLinejoin="round" />
        {slice.map((b, i) => {
          const gi = view.from + i;
          const x0 = x(b.t);
          const x1 = x(nextT(bars, gi, now));
          const rate = b.v / Math.max(1, (nextT(bars, gi, now) - b.t) / HOUR);
          const vh = Math.sqrt(rate / vmax) * (VH - 6);
          return <rect key={gi} x={x0} width={Math.max(0.8, x1 - x0 - 0.6)} y={H - PAD.b - vh} height={vh} className={b.c >= b.o ? 'vol up' : 'vol down'} />;
        })}
        {chapters.map((c, i) => {
          // anchor each chapter at its own moment in time
          let k = c.range[0];
          for (let j = c.range[0]; j < bars.length && bars[j].t <= c.t; j++) k = j;
          if (k < view.from || k > view.to) return null;
          const b = bars[k];
          const cx = x(b.t + 0.5 * (nextT(bars, k, now) - b.t));
          const cy = c.id === 'peak' ? y(b.h) : y(b.c);
          stack = cx - lastLabelX < 52 ? stack + 1 : 0;
          lastLabelX = cx;
          return (
            <g key={c.id} className={`ch-dot tone-${c.tone} ${active === i ? 'on' : ''}`} onPointerEnter={() => onActive(i)} onPointerLeave={() => onActive(null)}>
              <circle cx={cx} cy={cy} r={active === i ? 7 : 5} />
              {stack > 0 && <line x1={cx} x2={cx} y1={cy - 7} y2={cy - 11 - stack * 13} className="ch-stem" />}
              <text x={cx} y={cy - 11 - stack * 13} textAnchor="middle">
                {c.label.split(' ')[0]}
              </text>
            </g>
          );
        })}
        {hb && (
          <g className="crosshair">
            <line x1={x(hb.t)} x2={x(hb.t)} y1={PAD.t} y2={H - PAD.b} />
            <circle cx={x(hb.t + 0.5 * (nextT(bars, hover!, now) - hb.t))} cy={y(hb.c)} r="4" />
          </g>
        )}
        {xTicks.map((tk, i) => (
          <text key={i} x={tk.x} y={H - 6} className="axis" textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
            {tk.t - geom.tA < 3 * 24 * HOUR && i > 0 ? `+${Math.round((tk.t - geom.tA) / HOUR)}h` : fmtDateShort(tk.t)}
          </text>
        ))}
        {logTime && (
          <text x={W - PAD.r + 6} y={H - 6} className="axis">
            log time
          </text>
        )}
      </svg>
      {hb && (
        <div className="chart-tip" style={{ left: Math.min(W - 190, Math.max(0, x(hb.t) + 12)) }}>
          <div>{fmtDateTime(hb.t)}</div>
          <div>
            <span>Close</span> <b>{fmtPrice(hb.c)}</b>
          </div>
          <div>
            <span>Volume</span> <b>{fmtUsd(hb.v)}</b>
          </div>
          <div>
            <span>Trades</span> <b>{fmtNum(hb.n)}</b>
          </div>
          <div>
            <span>New wallets</span> <b>{fmtNum(hb.newTraders)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function nextT(bars: Bar[], i: number, now: number) {
  return i + 1 < bars.length ? bars[i + 1].t : Math.min(now, bars[i].t + 24 * HOUR);
}

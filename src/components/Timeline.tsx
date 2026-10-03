import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { fmtDate, fmtNum, fmtUsd, monthLabel } from '../lib/format';
import { MOMENT_KIND } from './MomentCard';

const DAY = 86_400_000;

/**
 * Time travel. `value === null` means "now / live".
 * Dragging scrubs through history; the universe re-renders as it was.
 */
export function Timeline({ value, onChange }: { value: number | null; onChange: (t: number | null) => void }) {
  const { archive } = useArchive();
  const start = archive.meta.archiveStart;
  const end = archive.now;
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [playing, setPlaying] = useState(false);
  const t = value ?? end;
  const pos = (x: number) => (x - start) / (end - start);

  const hist = useMemo(() => {
    const days = archive.ecosystem;
    const max = Math.max(...days.map((d) => d.volumeUsd), 1);
    return days.map((d) => ({ x: pos(d.t), h: Math.sqrt(d.volumeUsd / max) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive]);

  const months = useMemo(() => {
    const out: { t: number; label: string; year?: number }[] = [];
    const d = new Date(start);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    for (;;) {
      const mt = Date.UTC(y, m, 1);
      if (mt > end) break;
      if (mt >= start) out.push({ t: mt, label: monthLabel(m), year: m === 0 || out.length === 0 ? y : undefined });
      m++;
      if (m > 11) [m, y] = [0, y + 1];
    }
    return out;
  }, [start, end]);

  const marks = useMemo(() => archive.publicMoments.filter((m) => m.kind !== 'milestone').slice(0, 80), [archive]);

  const setFromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const nt = start + f * (end - start);
    onChange(f > 0.995 ? null : nt);
  };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const cur = value ?? start;
      const next = cur + 2 * DAY;
      if (next >= end) {
        setPlaying(false);
        onChange(null);
      } else onChange(next);
    }, 110);
    return () => clearInterval(id);
  }, [playing, value, start, end, onChange]);

  const mStart = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1);
  const mEnd = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1);
  const period = useMemo(() => archive.period(mStart, mEnd), [archive, mStart, mEnd]);
  const existing = useMemo(() => archive.markets.reduce((s, m) => s + (m.createdAt <= t ? 1 : 0), 0), [archive, t]);
  const monthName = new Date(t).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

  return (
    <div className="timeline">
      <div className="tl-summary">
        <div className="tl-when">
          <span className="tl-month">{monthName}</span>
          <span className="tl-day">{value === null ? 'LIVE · now' : fmtDate(t)}</span>
        </div>
        <div className="tl-stats">
          <div>
            <b>{fmtNum(period.marketsCreated)}</b> markets
          </div>
          <div>
            <b>{fmtUsd(period.volumeUsd)}</b> volume
          </div>
          <div>
            <b>{fmtNum(period.notable)}</b> notable markets
          </div>
          <div>
            <b>{period.moments.length}</b> major moments
          </div>
        </div>
        <div className="tl-existing">{fmtNum(existing)} markets existed</div>
        {period.moments[0] && (
          <Link to={`/moments/${period.moments[0].id}`} className="tl-moment">
            {MOMENT_KIND[period.moments[0].kind].glyph} {period.moments[0].title} →
          </Link>
        )}
      </div>
      <div className="tl-row">
        <button className="tl-play" onClick={() => (playing ? setPlaying(false) : (value === null && onChange(start), setPlaying(true)))} aria-label={playing ? 'Pause' : 'Play history'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div
          className={`tl-track ${drag ? 'drag' : ''}`}
          ref={track}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setDrag(true);
            setPlaying(false);
            setFromX(e.clientX);
          }}
          onPointerMove={(e) => drag && setFromX(e.clientX)}
          onPointerUp={() => setDrag(false)}
          onPointerCancel={() => setDrag(false)}
          role="slider"
          aria-label="Travel through StonkFun history"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={t}
          aria-valuetext={value === null ? 'Now' : fmtDate(t)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') onChange(Math.max(start, t - (e.shiftKey ? 30 : 3) * DAY));
            if (e.key === 'ArrowRight') {
              const n = t + (e.shiftKey ? 30 : 3) * DAY;
              onChange(n >= end ? null : n);
            }
          }}
        >
          <svg className="tl-hist" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden>
            {hist.map((b, i) => (
              <rect key={i} x={b.x * 1000} y={40 - b.h * 38} width={Math.max(1, 1000 / hist.length - 0.6)} height={b.h * 38} className={b.x <= pos(t) ? 'past' : ''} />
            ))}
          </svg>
          {marks.map((m) => (
            <span key={m.id} className={`tl-mark mk-${m.kind}`} style={{ left: `${pos(m.start) * 100}%` }} title={`${m.title} — ${fmtDate(m.start)}`} />
          ))}
          <div className="tl-fill" style={{ width: `${pos(t) * 100}%` }} />
          <div className="tl-handle" style={{ left: `${pos(t) * 100}%` }}>
            <span />
          </div>
          <div className="tl-months">
            {months.map((m) => (
              <span key={m.t} style={{ left: `${pos(m.t) * 100}%` }}>
                {m.year ? <em>{m.year}</em> : null}
                {m.label}
              </span>
            ))}
          </div>
        </div>
        <button className={`tl-now ${value === null ? 'on' : ''}`} onClick={() => (setPlaying(false), onChange(null))}>
          NOW
        </button>
      </div>
    </div>
  );
}

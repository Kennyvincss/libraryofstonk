import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { fmtDate, fmtNum, fmtUsd, monthLabel } from '../lib/format';
import { MOMENT_KIND } from './MomentCard';
import { buildDayIndex, dayHeadline, dayLine } from '../engine/narration';
import { narrator } from '../lib/narrator';
import { useVoice } from '../hooks/useVoice';

const DAY = 86_400_000;
/** how long each day is held during playback at 1× */
export const DAY_HOLD_MS = 5000;
const SPEEDS = [1, 2, 4, 10] as const;
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;

/**
 * Time travel. `value === null` means "now / live".
 * Dragging scrubs through history; the universe re-renders as it was.
 */
export function Timeline({ value, onChange, onCaption }: { value: number | null; onChange: (t: number | null) => void; onCaption?: (line: string | null) => void }) {
  const { archive } = useArchive();
  const start = archive.meta.archiveStart;
  const end = archive.now;
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const voice = useVoice();
  const facts = useMemo(() => buildDayIndex(archive), [archive]);
  // callbacks via refs: a parent re-render must not restart the current day
  const cbs = useRef({ onChange, onCaption });
  cbs.current = { onChange, onCaption };
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

  // playback: one day per beat. Each day is held for DAY_HOLD_MS / speed and,
  // when the voice is on at 1–2×, until the narrator has finished its line.
  const day = dayOf(t);
  const firstDay = dayOf(start);
  const lastDay = dayOf(end);
  useEffect(() => {
    if (!playing) return;
    let alive = true;
    let timeUp = false;
    const waitVoice = voice.on && speed <= 2;
    let spoken = !waitVoice;
    const f = facts.get(day);
    const advance = () => {
      if (!alive || !timeUp || !spoken) return;
      const next = day + DAY;
      if (next > lastDay) {
        setPlaying(false);
        cbs.current.onCaption?.(null);
        cbs.current.onChange(null);
      } else cbs.current.onChange(next + DAY / 2);
    };
    const line = f ? (speed <= 2 ? dayLine(archive, f) : dayHeadline(f)) : null;
    cbs.current.onCaption?.(line);
    if (voice.on && line) {
      narrator.speak(line, () => {
        spoken = true;
        advance();
      });
    } else spoken = true;
    const h = setTimeout(() => {
      timeUp = true;
      advance();
    }, DAY_HOLD_MS / speed);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [playing, day, speed, voice.on, facts, archive, lastDay]);

  const play = () => {
    if (playing) {
      setPlaying(false);
      narrator.stop();
      onCaption?.(null);
      return;
    }
    if (value === null || day >= lastDay) onChange(firstDay + DAY / 2);
    else onChange(day + DAY / 2);
    setPlaying(true);
  };
  const step = (dir: 1 | -1) => {
    const next = Math.max(firstDay, Math.min(lastDay, day + dir * DAY));
    onChange(next + DAY / 2);
  };

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
            <b>{fmtNum(period.marketsCreated)}</b> {archive.tracked}launches
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
        <div className="tl-existing">{fmtNum(existing)} {archive.tracked}markets existed</div>
        {period.moments[0] && (
          <Link to={`/moments/${period.moments[0].id}`} className="tl-moment">
            {MOMENT_KIND[period.moments[0].kind].glyph} {period.moments[0].title} →
          </Link>
        )}
      </div>
      <div className="tl-row">
        <div className="tl-transport">
          <button className="tl-step" onClick={() => step(-1)} aria-label="Previous day" title="Previous day">
            ◀
          </button>
          <button className={`tl-play ${playing ? 'on' : ''}`} onClick={play} aria-label={playing ? 'Pause' : 'Play history'} title={`Play history (${DAY_HOLD_MS / 1000 / speed}s per day)`}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="tl-step" onClick={() => step(1)} aria-label="Next day" title="Next day">
            ▶
          </button>
        </div>
        <div
          className={`tl-track ${drag ? 'drag' : ''}`}
          ref={track}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setDrag(true);
            if (playing) {
              setPlaying(false);
              narrator.stop();
              onCaption?.(null);
            }
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
        <button className="tl-speed" onClick={() => setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length])} title="Playback speed">
          {speed}×<em>{DAY_HOLD_MS / 1000 / speed}s/day</em>
        </button>
        {voice.supported && (
          <button className={`tl-voice ${voice.on ? 'on' : ''}`} onClick={voice.toggle} aria-label={voice.on ? 'Mute voiceover' : 'Turn on voiceover'} title={voice.on ? 'Voiceover on' : 'Voiceover off'}>
            {voice.on ? '🔊' : '🔇'}
          </button>
        )}
        <button className={`tl-now ${value === null ? 'on' : ''}`} onClick={() => (setPlaying(false), narrator.stop(), onCaption?.(null), onChange(null))}>
          NOW
        </button>
      </div>
    </div>
  );
}

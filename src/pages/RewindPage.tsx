import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Universe } from '../universe/Universe';
import { useArchive } from '../hooks/archive';
import { MOMENT_KIND } from '../components/MomentCard';
import type { Moment } from '../data/types';
import { fmtDate, fmtNum, fmtUsd } from '../lib/format';
import { narrator } from '../lib/narrator';
import { sceneLine } from '../engine/narration';
import { useVoice } from '../hooks/useVoice';
import { ShareButton, StoryCallout, StoryImage } from '../components/Story';

const DAY = 86_400_000;
const SCENE_MS = 7000;

interface Scene {
  id: string;
  at: number;
  eyebrow: string;
  title: string;
  body: string;
  stats: { k: string; v: string }[];
  highlight: string[] | null;
  moment?: Moment;
  kind: 'intro' | 'moment' | 'outro';
}

/**
 * REWIND — a playable film of StonkFun history. Each scene time-travels the
 * universe to a detected moment and lights up its markets. Scenes are built
 * from the archive's approved moments, so the film grows with the data.
 */
export function RewindPage() {
  const { archive, source } = useArchive();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const scenes = useMemo<Scene[]>(() => {
    const start = archive.meta.archiveStart;
    const first = archive.launchesBetween(start - DAY, start + 14 * DAY);
    const moments = archive.publicMoments
      .filter((m) => m.kind !== 'milestone' || /markets$/.test(m.key) || m.origin === 'curated')
      .slice()
      .sort((a, b) => a.start - b.start);
    const total = archive.totalVolume;
    return [
      {
        id: 'intro',
        kind: 'intro',
        at: start + 14 * DAY,
        eyebrow: fmtDate(start),
        title: 'IN THE BEGINNING',
        body: `The archive begins on ${fmtDate(start)}. In its first two weeks, ${fmtNum(first)} ${archive.tracked}markets appeared — tokens priced in stocks, ETFs and crypto. Nobody knew what was coming.`,
        stats: [],
        highlight: null,
      },
      ...moments.map<Scene>((mo, n) => ({
        id: mo.id,
        kind: 'moment',
        at: Math.max(mo.end, mo.start + DAY),
        eyebrow: `Moment ${n + 1} · ${MOMENT_KIND[mo.kind].label} · ${fmtDate(mo.start)}`,
        title: mo.title,
        body: mo.body ?? mo.tagline,
        stats: mo.kind === 'runner' || mo.kind === 'news' ? [] : [
          { k: 'Markets', v: fmtNum(mo.marketIds.length) },
          { k: 'Volume', v: fmtUsd(mo.stats.volumeUsd) },
          { k: 'Traders', v: fmtNum(mo.stats.traders) },
        ],
        highlight: mo.marketIds.slice(0, 300),
        moment: mo,
      })),
      {
        id: 'outro',
        kind: 'outro',
        at: archive.now,
        eyebrow: 'Today',
        title: 'AND IT KEEPS GOING',
        body: `${fmtNum(archive.marketCount)} ${archive.tracked}markets, ${fmtUsd(total)} traded, ${archive.publicMoments.length} moments — and the next one is already forming somewhere in the universe.`,
        stats: [],
        highlight: null,
      },
    ];
  }, [archive]);

  const startAt = Math.max(0, scenes.findIndex((s) => s.id === params.get('from')));
  const [idx, setIdx] = useState(startAt);
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [activity, setActivity] = useState<{ at: number; map: Map<string, number> } | null>(null);
  const cache = useRef(new Map<number, Map<string, number>>());
  const scene = scenes[idx];
  const voice = useVoice();
  // true once the narrator has finished this scene's line (or voice is off)
  const spokenRef = useRef(true);
  // browsers only allow speech after the visitor has interacted with the page
  const [needsTap, setNeedsTap] = useState(() => !(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive);
  const [speakNonce, setSpeakNonce] = useState(0);
  useEffect(() => {
    if (!needsTap) return;
    const on = () => {
      setNeedsTap(false);
      setSpeakNonce((n) => n + 1);
    };
    window.addEventListener('pointerdown', on, { once: true });
    window.addEventListener('keydown', on, { once: true });
    return () => {
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
    };
  }, [needsTap]);

  // voiceover: narrate each scene while playing; pausing silences it,
  // resuming re-reads the current scene
  useEffect(() => {
    if (!playing || !voice.on) {
      narrator.stop();
      spokenRef.current = true;
      return;
    }
    spokenRef.current = false;
    narrator.speak(sceneLine(scene.kind, scene.title, scene.body, scene.moment), () => {
      spokenRef.current = true;
    });
  }, [scene, playing, voice.on, speakNonce]);

  const go = useCallback(
    (i: number) => {
      setIdx(Math.max(0, Math.min(scenes.length - 1, i)));
      setElapsed(0);
    },
    [scenes.length],
  );

  // time-travel the universe for each scene (snapshots cached)
  useEffect(() => {
    let alive = true;
    const at = scene.at;
    const hit = cache.current.get(at);
    if (hit) setActivity({ at, map: hit });
    else
      source.snapshot(at).then((s) => {
        cache.current.set(at, s.activity);
        if (alive) setActivity({ at, map: s.activity });
      });
    // prefetch the next scene
    const next = scenes[idx + 1];
    if (next && !cache.current.has(next.at)) source.snapshot(next.at).then((s) => cache.current.set(next.at, s.activity));
    return () => {
      alive = false;
    };
  }, [scene, scenes, idx, source]);

  // the clock
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const n = elapsedRef.current + (now - last);
      last = now;
      if (n < SCENE_MS) setElapsed(n);
      else if (!spokenRef.current) setElapsed(SCENE_MS); // hold until the narrator finishes
      else if (idx < scenes.length - 1) go(idx + 1);
      else {
        setElapsed(SCENE_MS);
        setPlaying(false);
      }
    }, 50);
    return () => clearInterval(id);
  }, [playing, idx, scenes.length, go]);

  // pause when the tab is hidden
  useEffect(() => {
    const on = () => document.visibilityState === 'hidden' && setPlaying(false);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight' || e.key === 'l') go(idx + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'j') go(elapsed > 1500 ? idx : idx - 1);
      else if (e.key === 'Escape') nav('/universe');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, idx, elapsed, nav]);

  const ended = idx === scenes.length - 1 && elapsed >= SCENE_MS;
  const progress = Math.min(1, elapsed / SCENE_MS);

  return (
    <div className="rewind">
      <Universe mode="focus" highlight={scene.highlight} fitHighlight activity={activity} fitKey={scene.highlight ? undefined : scene.id} initialZoom={1.1} />
      <div className="rw-vignette" aria-hidden />

      <div className="rw-top">
        <div className="rw-brand">
          <span className="rw-rec" /> REWIND <em>· the history of StonkFun</em>
        </div>
        <div className="row gap">
          {needsTap && voice.on && (
            <button
              className="btn dice sm"
              onClick={() => {
                setNeedsTap(false);
                setPlaying(true);
                setSpeakNonce((n) => n + 1);
              }}
            >
              🔊 Click to hear the narration
            </button>
          )}
          <button className="btn ghost sm" onClick={() => nav('/universe')}>
            Skip ⏭
          </button>
        </div>
      </div>

      <div className={`rw-caption ${scene.moment ? `rk-${scene.moment.kind}` : ''}`} key={scene.id}>
        <div className="rw-eyebrow">{scene.eyebrow}</div>
        <h1 className="rw-title">{scene.title}</h1>
        {scene.moment && <ShareButton id={scene.moment.id} className="btn ghost xs rw-share" />}
        {scene.moment?.image && <StoryImage src={scene.moment.image} alt={scene.title} />}
        <p className="rw-body">{scene.body}</p>
        {scene.moment?.callout && <StoryCallout c={scene.moment.callout} />}
        {scene.stats.length > 0 && (
          <dl className="rw-stats">
            {scene.stats.map((s) => (
              <div key={s.k}>
                <dt>{s.k}</dt>
                <dd>{s.v}</dd>
              </div>
            ))}
          </dl>
        )}
        {scene.moment && (
          <Link to={`/moments/${scene.moment.id}`} className="btn ghost sm" onClick={() => setPlaying(false)}>
            Explore this moment →
          </Link>
        )}
        {scene.kind === 'outro' && (
          <div className="row gap">
            <Link to="/universe" className="btn primary">
              Enter the universe
            </Link>
            <button className="btn ghost" onClick={() => (go(0), setPlaying(true))}>
              ↺ Watch again
            </button>
          </div>
        )}
      </div>

      <div className="rw-player">
        <div className="rw-segments" role="tablist" aria-label="Scenes">
          {scenes.map((s, i) => (
            <button key={s.id} className={`rw-seg ${i < idx ? 'done' : ''} ${i === idx ? 'on' : ''}`} onClick={() => go(i)} title={s.title} aria-label={`Scene ${i + 1}: ${s.title}`}>
              <i style={{ width: i < idx ? '100%' : i === idx ? `${progress * 100}%` : 0 }} />
            </button>
          ))}
        </div>
        <div className="rw-controls">
          <button onClick={() => go(0)} aria-label="Restart" title="Restart">
            ⏮
          </button>
          <button onClick={() => go(elapsed > 1500 ? idx : idx - 1)} aria-label="Previous scene" title="Previous (←)">
            ◀◀
          </button>
          <button
            className="rw-play"
            onClick={() => {
              if (ended) {
                go(0);
                setPlaying(true);
              } else setPlaying((p) => !p);
            }}
            aria-label={playing ? 'Pause' : 'Play'}
            title="Play / pause (space)"
          >
            {playing && !ended ? '❚❚' : '▶'}
          </button>
          <button onClick={() => go(idx + 1)} aria-label="Next scene" title="Next (→)" disabled={idx === scenes.length - 1}>
            ▶▶
          </button>
          <button onClick={() => go(scenes.length - 1)} aria-label="Skip to the end" title="Skip to the end">
            ⏭
          </button>
          <button
            onClick={() => {
              if (scenes.length > 3) {
                let j = idx;
                while (j === idx) j = 1 + Math.floor(Math.random() * (scenes.length - 2));
                go(j);
                setPlaying(true);
              }
            }}
            aria-label="Shuffle"
            title="Random moment"
          >
            ⤨
          </button>
          {scene.moment && (
            <Link to={`/moments/${scene.moment.id}`} onClick={() => setPlaying(false)} className="rw-open" aria-label="Open this moment" title="Open this moment">
              +
            </Link>
          )}
          {voice.supported && (
            <button className={voice.on ? 'rw-voice on' : 'rw-voice'} onClick={voice.toggle} aria-label={voice.on ? 'Mute voiceover' : 'Turn on voiceover'} title={voice.on ? 'Voiceover on' : 'Voiceover off'}>
              {voice.on ? '🔊' : '🔇'}
            </button>
          )}
          <span className="rw-count">
            {String(idx + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
          </span>
          <span className="rw-date">{fmtDate(scene.at)}</span>
        </div>
      </div>
    </div>
  );
}

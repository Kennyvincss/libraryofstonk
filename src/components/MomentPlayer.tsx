import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Moment } from '../data/types';
import { narrator } from '../lib/narrator';
import { sceneLine } from '../engine/narration';
import { useVoice } from '../hooks/useVoice';
import { useMusic, useSoundtrack } from '../hooks/useMusic';
import { soundtrack } from '../lib/soundtrack';
import { fmtDate } from '../lib/format';

const SCENE_MS = 9000;

/**
 * Plays the moments like the Rewind: each one is narrated, then the page moves
 * on to the next. Playing state survives navigation through `?play=1`.
 */
export function MomentPlayer({ mo, order }: { mo: Moment; order: Moment[] }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [playing, setPlaying] = useState(params.get('play') === '1');
  const [elapsed, setElapsed] = useState(0);
  const voice = useVoice();
  const music = useMusic();
  useSoundtrack(playing && music.on);
  // a hit on every new moment while playing
  useEffect(() => {
    if (playing) soundtrack.accent(0.8);
  }, [mo.id, playing]);
  const spokenRef = useRef(true);
  const i = order.findIndex((m) => m.id === mo.id);
  const go = (j: number, play = playing) => {
    const next = order[(j + order.length) % order.length];
    if (next) nav(`/moments/${encodeURIComponent(next.id)}${play ? '?play=1' : ''}`);
  };

  // narrate while playing
  useEffect(() => {
    const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
    if (!playing || !voice.on || !activated) {
      narrator.stop();
      spokenRef.current = true;
      return;
    }
    spokenRef.current = false;
    narrator.speak(sceneLine('moment', mo.title, mo.body ?? mo.tagline, mo), () => {
      spokenRef.current = true;
    });
  }, [mo, playing, voice.on]);

  // the clock: advance once the scene time has passed and the narrator is done
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const n = elapsedRef.current + (now - last);
      last = now;
      if (n < SCENE_MS || !spokenRef.current) setElapsed(Math.min(n, SCENE_MS));
      else if (i < order.length - 1) goRef.current(i + 1, true);
      else setPlaying(false);
    }, 50);
    return () => clearInterval(id);
  }, [playing, i, order.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight' || e.key === 'l') goRef.current(i + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'j') goRef.current(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i]);

  useEffect(() => {
    const on = () => document.visibilityState === 'hidden' && setPlaying(false);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // portalled: the page wrapper animates with a transform, which would pin a fixed bar to it
  return createPortal(
    <div className="rw-player mo-player">
      <div className="mo-progress">
        <i style={{ width: `${(elapsed / SCENE_MS) * 100}%` }} />
      </div>
      <div className="rw-controls">
        <button onClick={() => go(i - 1)} aria-label="Previous moment" title="Previous (←)" disabled={i <= 0}>
          ◀◀
        </button>
        <button className="rw-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => go(i + 1)} aria-label="Next moment" title="Next (→)" disabled={i >= order.length - 1}>
          ▶▶
        </button>
        <button
          onClick={() => {
            if (order.length < 2) return;
            let j = i;
            while (j === i) j = Math.floor(Math.random() * order.length);
            go(j);
          }}
          aria-label="Shuffle"
          title="Random moment"
        >
          ⤨
        </button>
{music.supported && (
          <button className={`rw-voice rw-music ${music.on ? 'on' : ''}`} onClick={music.toggle} aria-label={music.on ? 'Mute soundtrack' : 'Turn on soundtrack'} title={music.on ? 'Soundtrack on' : 'Soundtrack off'}>
            {music.on ? '♪' : <s>♪</s>}
          </button>
        )}
        {voice.supported && (
          <button className={voice.on ? 'rw-voice on' : 'rw-voice'} onClick={voice.toggle} aria-label={voice.on ? 'Mute voiceover' : 'Turn on voiceover'} title={voice.on ? 'Voiceover on' : 'Voiceover off'}>
            {voice.on ? '🔊' : '🔇'}
          </button>
        )}
        <span className="rw-count">
          {String(i + 1).padStart(2, '0')} / {String(order.length).padStart(2, '0')}
        </span>
        <Link to={`/?from=${encodeURIComponent(mo.id)}`} className="mo-player-rewind" onClick={() => narrator.stop()}>
          Play from here in the rewind
        </Link>
        <span className="rw-date">{fmtDate(mo.start)}</span>
      </div>
    </div>,
    document.body,
  );
}

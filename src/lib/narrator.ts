/**
 * Voiceover via the browser's built-in speech engine (Web Speech API).
 * No audio files, no API keys. Lines are queued one at a time: speaking a new
 * line cancels the previous one, and `onEnd` fires when a line finishes (or is
 * cut off), which lets players wait for the narrator before moving on.
 */
type Listener = (speaking: boolean) => void;

const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
let voice: SpeechSynthesisVoice | null = null;
let current: SpeechSynthesisUtterance | null = null;
const listeners = new Set<Listener>();
/** lines cut off by stop()/a newer line — their onEnd must not fire */
const cancelled = new WeakSet<SpeechSynthesisUtterance>();

const PREFERRED = [/Google UK English Male/i, /Daniel/i, /Microsoft Guy/i, /Google US English/i, /Alex/i, /Samantha/i, /Microsoft (Aria|Jenny)/i];

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  // on-device voices start instantly; network voices (e.g. "Google UK English")
  // add a noticeable delay before every line, so they are a last resort
  const local = voices.filter((v) => v.localService);
  for (const pool of [local, voices]) {
    for (const re of PREFERRED) {
      const v = pool.find((x) => re.test(x.name));
      if (v) return (voice = v);
    }
    const d = pool.find((v) => v.default) ?? pool[0];
    if (d) return (voice = d);
  }
  voice = null;
}
if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
  // warm the speech engine on the first interaction so the first real line starts at once
  const warm = () => {
    window.removeEventListener('pointerdown', warm);
    window.removeEventListener('keydown', warm);
    // after this tick, so a player that speaks in response to the same tap goes first
    setTimeout(() => {
      if (current || synth.speaking || synth.pending) return;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    }, 0);
  };
  window.addEventListener('pointerdown', warm);
  window.addEventListener('keydown', warm);
}

function emit(s: boolean) {
  for (const l of listeners) l(s);
}

export const narrator = {
  supported: Boolean(synth),

  /** `onStart` fires when audio actually begins (or at once if it never reports it). */
  speak(text: string, onEnd?: () => void, onStart?: () => void) {
    if (!synth) {
      onStart?.();
      onEnd?.();
      return;
    }
    // cancel only when something is queued: Chrome stalls a line spoken straight after cancel()
    if (current || synth.speaking || synth.pending) this.stop();
    if (synth.paused) synth.resume();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.04;
    u.pitch = 0.95;
    u.lang = voice?.lang ?? 'en-US';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (current === u) {
        current = null;
        emit(false);
      }
      if (!cancelled.has(u)) onEnd?.();
    };
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      onStart?.();
    };
    u.onstart = begin;
    u.onend = () => (begin(), finish());
    u.onerror = () => (begin(), finish());
    // engines that never report onstart (or are blocked) must not hold the scene
    setTimeout(begin, 1200);
    current = u;
    emit(true);
    synth.speak(u);
    // Some engines never fire onend when blocked (no user gesture yet);
    // fall back to an estimate so playback can never stall.
    const words = text.split(/\s+/).length;
    setTimeout(finish, 1500 + words * 520);
  },

  stop() {
    if (!synth) return;
    const had = current;
    if (had) cancelled.add(had);
    current = null;
    synth.cancel();
    if (had) emit(false);
  },

  get speaking() {
    return current !== null;
  },

  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

// ── speakable formatting ─────────────────────────────────────────────────────
const ORD = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function sayDate(t: number, withYear = false) {
  const d = new Date(t);
  const m = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${m} ${ORD(d.getUTCDate())}${withYear ? `, ${d.getUTCFullYear()}` : ''}`;
}

export function sayUsd(v: number) {
  if (v >= 1e9) return `${trim(v / 1e9)} billion dollars`;
  if (v >= 1e6) return `${trim(v / 1e6)} million dollars`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} thousand dollars`;
  return `${Math.round(v)} dollars`;
}

export function sayNum(v: number) {
  if (v >= 1e6) return `${trim(v / 1e6)} million`;
  if (v >= 1e4) return `${Math.round(v / 1e3)} thousand`;
  return Math.round(v).toLocaleString('en-US');
}

function trim(x: number) {
  return x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, '');
}

/** Quote symbols read better as their underlying name ("NVDAx" → "Nvidia"). */
export function sayQuote(symbol: string, name?: string) {
  if (!name) return symbol;
  return name.replace(/\s*\(tokenized\)/i, '').replace(/ ETF$/, '');
}

/** Turn display copy (×, %, $, tickers) into something a voice reads well. */
export function speakable(text: string) {
  return text
    .replace(/\$(\d[\d,.]*)([KMB])\b/g, (_, n, u) => `${n} ${{ K: 'thousand', M: 'million', B: 'billion' }[u as 'K' | 'M' | 'B']} dollars`)
    .replace(/\$([A-Z][A-Z0-9]+)/g, '$1')
    .replace(/(\d)×/g, '$1 times')
    .replace(/[“”"]/g, '')
    .replace(/\s*—\s*/g, ', ');
}

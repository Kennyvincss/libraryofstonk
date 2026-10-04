/**
 * Cinematic soundtrack, synthesized live with the Web Audio API — no audio
 * files, nothing licensed. A slow minor progression on detuned string pads,
 * a sub drone, a pulsing low ostinato and a high shimmer, all through a
 * generated hall reverb. It ducks under the narrator, and `accent()` adds a
 * deep boom for scene changes.
 *
 * Several players can want music at once (rewind, timeline, moments), so
 * playback is reference-counted: `acquire()` returns a release function.
 */
import { narrator } from './narrator';

const BPM = 76;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS_PER_CHORD = 2;

// A minor: Am – F – C – G – Am – F – Dm – E (MIDI note numbers, low voicing)
const PROGRESSION: number[][] = [
  [45, 52, 57, 60, 64],
  [41, 48, 53, 57, 60],
  [48, 55, 60, 64, 67],
  [43, 50, 55, 59, 62],
  [45, 52, 57, 60, 64],
  [41, 48, 53, 57, 60],
  [38, 45, 50, 53, 57],
  [40, 47, 52, 56, 59],
];

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

class Soundtrack {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private wet!: GainNode;
  private holders = new Set<symbol>();
  private timer: number | null = null;
  private nextBar = 0;
  private bar = 0;
  private live: AudioScheduledSourceNode[] = [];
  private enabled = true;

  readonly supported = typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);

  constructor() {
    if (!this.supported) return;
    // ducking under the voiceover
    narrator.subscribe((speaking) => this.duck(speaking));
    // browsers start audio suspended until the visitor interacts
    const unlock = () => {
      if (this.ctx?.state === 'suspended' && this.holders.size) void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on && this.holders.size) this.start();
    else if (!on) this.stop();
  }

  /** Ask for music; returns the release function. */
  acquire(): () => void {
    const id = Symbol('holder');
    this.holders.add(id);
    if (this.enabled) this.start();
    return () => {
      this.holders.delete(id);
      if (!this.holders.size) this.stop();
    };
  }

  /** A cinematic hit: sub boom + noise swell. */
  accent(strength = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.timer || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.02;
    // sub boom with a pitch drop
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(92, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 1.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * strength, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g).connect(this.music);
    g.connect(this.wet);
    o.start(t);
    o.stop(t + 2.7);
    // airy noise swell into the hit
    const n = ctx.createBufferSource();
    n.buffer = this.noise(1.6);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 1.2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.09 * strength, t + 0.9);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    n.connect(f).connect(ng).connect(this.wet);
    n.start(t);
    this.track(o, n);
  }

  // ── engine ────────────────────────────────────────────────────────────────
  private init() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 1;
    this.music.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.5);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    this.wet.connect(this.reverb).connect(this.master);
  }

  private start() {
    if (!this.supported) return;
    this.init();
    const ctx = this.ctx!;
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.timer) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(narrator.speaking ? 0.28 : 0.5, now + 2.5);
    this.nextBar = now + 0.1;
    this.bar = 0;
    this.timer = window.setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  private stop() {
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 1.8);
    const live = this.live;
    this.live = [];
    for (const s of live) {
      try {
        s.stop(now + 2);
      } catch {
        /* already stopped */
      }
    }
  }

  private duck(speaking: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(speaking ? 0.28 : 0.5, now + (speaking ? 0.4 : 1.6));
  }

  /** schedule bars up to ~1s ahead */
  private schedule() {
    const ctx = this.ctx!;
    while (this.nextBar < ctx.currentTime + 1) {
      const chord = PROGRESSION[Math.floor(this.bar / BARS_PER_CHORD) % PROGRESSION.length];
      const t = this.nextBar;
      if (this.bar % BARS_PER_CHORD === 0) this.pad(chord, t, BAR * BARS_PER_CHORD);
      this.ostinato(chord[0] + 12, t);
      this.shimmer(chord, t);
      this.nextBar += BAR;
      this.bar++;
    }
    // forget finished sources
    if (this.live.length > 200) this.live = this.live.slice(-120);
  }

  private track(...s: AudioScheduledSourceNode[]) {
    this.live.push(...s);
  }

  /** detuned saw string pad + sub drone, long swells */
  private pad(chord: number[], t: number, dur: number) {
    const ctx = this.ctx!;
    const end = t + dur + 1.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(380, t);
    filter.frequency.linearRampToValueAtTime(1100, t + dur * 0.55);
    filter.frequency.linearRampToValueAtTime(500, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 2.2);
    g.gain.setValueAtTime(0.07, t + dur - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, end);
    filter.connect(g);
    g.connect(this.music);
    g.connect(this.wet);
    for (const m of chord.slice(1)) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(filter);
        o.start(t);
        o.stop(end);
        this.track(o);
      }
    }
    // sub drone on the root
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = hz(chord[0] - 12);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.16, t + 1.5);
    sg.gain.setValueAtTime(0.16, t + dur - 0.3);
    sg.gain.linearRampToValueAtTime(0.0001, end);
    sub.connect(sg).connect(this.music);
    sub.start(t);
    sub.stop(end);
    this.track(sub);
  }

  /** low pulsing eighth notes, the heartbeat under everything */
  private ostinato(root: number, t: number) {
    const ctx = this.ctx!;
    for (let i = 0; i < 8; i++) {
      const st = t + i * (BEAT / 2);
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = hz(i % 4 === 3 ? root + 7 : root);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, st);
      f.frequency.exponentialRampToValueAtTime(160, st + 0.22);
      const accentBeat = i % 2 === 0 ? 1 : 0.6;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.045 * accentBeat, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.3);
      o.connect(f).connect(g).connect(this.music);
      o.start(st);
      o.stop(st + 0.32);
      this.track(o);
    }
  }

  /** sparse bell-like notes high up, mostly reverb */
  private shimmer(chord: number[], t: number) {
    const ctx = this.ctx!;
    for (let i = 0; i < 4; i++) {
      if (Math.random() < 0.45) continue;
      const st = t + i * BEAT + Math.random() * 0.05;
      const m = chord[1 + Math.floor(Math.random() * (chord.length - 1))] + 24;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = hz(m);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.022, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 2.2);
      o.connect(g);
      g.connect(this.wet);
      o.start(st);
      o.stop(st + 2.3);
      this.track(o);
    }
  }

  private noise(seconds: number) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    return b;
  }
}

export const soundtrack = new Soundtrack();

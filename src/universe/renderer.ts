/**
 * Canvas 2D universe renderer.
 *
 * Designed for tens of thousands of nodes without DOM elements:
 *   • pre-rendered glow sprites per hue (drawImage is the fast path)
 *   • level-of-detail: only the top-N notable markets get full glows at a
 *     given zoom; the long tail is drawn as 1px dust until you zoom in
 *   • viewport culling + a uniform spatial grid for hover hit-testing
 *   • per-node display radius/alpha lerp toward targets, so filters, time
 *     travel and highlights animate smoothly instead of popping
 */
import type { UCluster, UNode, UniverseLayout } from './layout';

export type UniverseMode = 'ambient' | 'full' | 'focus';

export interface Camera {
  x: number;
  y: number;
  z: number;
}

interface Listeners {
  hover?: (node: UNode | null, sx: number, sy: number) => void;
  click?: (node: UNode) => void;
  camera?: (cam: Camera) => void;
}

const KIND_HUE: Partial<Record<UNode['kind'], number>> = {
  legendary: 46,
  crashed: 0,
  unusual: 312,
  historical: 30,
};

const TAU = Math.PI * 2;
const NEWBORN_MS = 3 * 86_400_000;
const CELL = 48;

function makeGlow(hue: number, sat: number, light: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const S = 64;
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `hsla(${hue},100%,97%,1)`);
  grd.addColorStop(0.1, `hsla(${hue},${sat}%,${light + 18}%,0.95)`);
  grd.addColorStop(0.22, `hsla(${hue},${sat}%,${light}%,0.45)`);
  grd.addColorStop(0.5, `hsla(${hue},${sat}%,${light - 10}%,0.1)`);
  grd.addColorStop(1, `hsla(${hue},${sat}%,${light - 20}%,0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return c;
}

function makeNebula(hue: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const S = 256;
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `hsla(${hue},90%,60%,0.22)`);
  grd.addColorStop(0.35, `hsla(${(hue + 30) % 360},80%,45%,0.1)`);
  grd.addColorStop(0.7, `hsla(${(hue + 60) % 360},70%,35%,0.035)`);
  grd.addColorStop(1, `hsla(${hue},70%,30%,0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return c;
}

export class UniverseRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private raf = 0;
  private running = false;
  private t0 = performance.now();
  private last = performance.now();

  private layout: UniverseLayout = { nodes: [], clusters: [], radius: 1000, byNarrative: new Map() };
  private grid = new Map<number, number[]>();
  private dispR = new Float32Array(0);
  private dispA = new Float32Array(0);
  private targR = new Float32Array(0);
  private targA = new Float32Array(0);
  /** during time travel: markets actually trading at that date */
  private live = new Uint8Array(0);
  private drawOrder: number[] = [];
  private stars: { x: number; y: number; s: number; p: number; tw: number }[] = [];
  private glow = new Map<string, HTMLCanvasElement>();
  private nebula = new Map<number, HTMLCanvasElement>();

  cam: Camera = { x: 0, y: 0, z: 0.4 };
  private goal: Camera | null = null;
  private vel = { x: 0, y: 0 };
  private hover = -1;
  private hoverLinks: number[] = [];
  private highlight: Uint8Array | null = null;
  private highlightEdges: [number, number][] = [];
  private filter: Uint8Array | null = null;
  private activity: { at: number; map: Map<string, number> } | null = null;
  private pulses: { k: number; t: number; color: string }[] = [];
  private mode: UniverseMode;
  private lastInteraction = 0;
  private listeners: Listeners = {};
  private isMobile: boolean;
  private dragging: { x: number; y: number; moved: number; cx: number; cy: number } | null = null;
  private pinch: { d: number; z: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private visible = true;
  private io?: IntersectionObserver;
  private ro?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, mode: UniverseMode) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.mode = mode;
    this.isMobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 720;
    this.resize();
    this.makeStars();
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver((e) => {
      this.visible = e[0]?.isIntersecting ?? true;
      if (this.visible) this.start();
    });
    this.io.observe(canvas);
    document.addEventListener('visibilitychange', this.onVis);
    this.start();
  }

  on(l: Listeners) {
    this.listeners = { ...this.listeners, ...l };
  }

  setMode(mode: UniverseMode) {
    this.mode = mode;
  }

  setLayout(layout: UniverseLayout) {
    this.layout = layout;
    const n = layout.nodes.length;
    const prevR = this.dispR;
    this.dispR = new Float32Array(n);
    this.dispA = new Float32Array(n);
    this.targR = new Float32Array(n);
    this.targA = new Float32Array(n);
    this.live = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      this.dispR[k] = prevR.length === n ? prevR[k] : 0;
      this.dispA[k] = 0;
    }
    // draw least notable first so the stars of the show sit on top
    this.drawOrder = Array.from({ length: n }, (_, k) => k).sort((a, b) => layout.nodes[b].rank - layout.nodes[a].rank);
    this.grid.clear();
    layout.nodes.forEach((nd, k) => {
      const key = this.cellKey(Math.floor(nd.x / CELL), Math.floor(nd.y / CELL));
      const arr = this.grid.get(key);
      if (arr) arr.push(k);
      else this.grid.set(key, [k]);
    });
    this.highlight = null;
    this.filter = null;
    this.hover = -1;
    this.computeTargets();
  }

  /** Fit the whole universe (or a radius around a point) into view. */
  fit(instant = false, pad = 1) {
    const R = this.layout.radius || 1000;
    const z = (Math.min(this.w, this.h) / (2 * R)) * 1.08 * pad;
    const cam = { x: 0, y: 0, z };
    if (instant) this.cam = cam;
    else this.goal = cam;
  }

  flyTo(x: number, y: number, z: number, instant = false) {
    const cam = { x, y, z: Math.max(0.05, Math.min(8, z)) };
    if (instant) this.cam = cam;
    else this.goal = cam;
    this.lastInteraction = performance.now();
  }

  focusNode(id: string, z = 3.2) {
    const nd = this.layout.nodes.find((n) => n.id === id);
    if (nd) this.flyTo(nd.x, nd.y, z);
  }

  focusCluster(id: string) {
    const c = this.layout.clusters.find((x) => x.id === id);
    if (c) this.flyTo(c.x, c.y, Math.min(this.w, this.h) / (2.4 * c.r + 40));
  }

  /** Dim everything except these market ids and draw a constellation. */
  setHighlight(ids: string[] | null, fitTo = false) {
    if (!ids || ids.length === 0) {
      this.highlight = null;
      this.highlightEdges = [];
      this.computeTargets();
      return;
    }
    const set = new Set(ids);
    const hl = new Uint8Array(this.layout.nodes.length);
    const members: number[] = [];
    this.layout.nodes.forEach((n, k) => {
      if (set.has(n.id)) {
        hl[k] = 1;
        members.push(k);
      }
    });
    this.highlight = hl;
    // greedy nearest-neighbour tree in creation order → a constellation
    const ordered = members.sort((a, b) => this.layout.nodes[a].createdAt - this.layout.nodes[b].createdAt).slice(0, 260);
    const edges: [number, number][] = [];
    for (let i = 1; i < ordered.length; i++) {
      const a = this.layout.nodes[ordered[i]];
      let best = -1;
      let bd = Infinity;
      for (let j = 0; j < i; j++) {
        const b = this.layout.nodes[ordered[j]];
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (d < bd) [bd, best] = [d, ordered[j]];
      }
      if (best >= 0) edges.push([ordered[i], best]);
    }
    this.highlightEdges = edges;
    this.computeTargets();
    if (fitTo && members.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const k of members) {
        const n = this.layout.nodes[k];
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
      const span = Math.max(maxX - minX, maxY - minY, 120);
      const z = (Math.min(this.w, this.h) / span) * 0.78;
      // in focus mode a title sits on the left: nudge the constellation right
      const shift = this.mode === 'focus' && this.w > 900 ? (this.w * 0.16) / z : 0;
      this.flyTo((minX + maxX) / 2 - shift, (minY + maxY) / 2, z);
    }
  }

  /** Show only nodes passing the predicate (others become faint dust). */
  setFilter(pred: ((n: UNode) => boolean) | null) {
    if (!pred) this.filter = null;
    else {
      const f = new Uint8Array(this.layout.nodes.length);
      this.layout.nodes.forEach((n, k) => (f[k] = pred(n) ? 1 : 0));
      this.filter = f;
    }
    this.computeTargets();
  }

  /** Time travel: per-market trailing activity at a moment in history. */
  setActivity(at: number | null, map: Map<string, number> | null) {
    this.activity = at !== null && map ? { at, map } : null;
    this.computeTargets();
  }

  pulse(id: string, color = '#73adc6') {
    const k = this.layout.nodes.findIndex((n) => n.id === id);
    if (k >= 0) this.pulses.push({ k, t: performance.now(), color });
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.io?.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.unbind();
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private onVis = () => {
    if (document.visibilityState === 'visible') this.start();
  };

  private start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      if (!this.visible || document.visibilityState !== 'visible') {
        this.running = false;
        return;
      }
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 2);
    const firstSize = this.w === 0;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (firstSize && this.layout.nodes.length) this.fit(true);
  }

  private makeStars() {
    const n = this.isMobile ? 220 : 520;
    this.stars = Array.from({ length: n }, () => ({
      x: Math.random(),
      y: Math.random(),
      s: Math.random() < 0.08 ? 1.6 : Math.random() < 0.4 ? 1 : 0.6,
      p: 0.02 + Math.random() * 0.08,
      tw: Math.random() * TAU,
    }));
  }

  private cellKey(cx: number, cy: number) {
    return (cx + 2048) * 4096 + (cy + 2048);
  }

  private computeTargets() {
    const nodes = this.layout.nodes;
    const act = this.activity;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      this.live[k] = 0;
      let r = n.r;
      let a = n.kind === 'quiet' ? 0.5 : n.kind === 'crashed' ? 0.55 : 1;
      if (act) {
        if (n.createdAt > act.at) {
          r = 0;
          a = 0;
        } else {
          const v = act.map.get(n.id) ?? 0;
          const live = v > 25;
          this.live[k] = live ? 1 : 0;
          r = live ? Math.min(18, (0.7 + 1.25 * Math.log10(1 + v / 150)) * (0.7 + 0.8 * n.score)) : n.r * 0.35;
          a = live ? 1 : 0.18;
        }
      }
      if (this.filter && !this.filter[k]) {
        a *= 0.07;
        r *= 0.6;
      }
      if (this.highlight) {
        if (this.highlight[k]) {
          a = Math.max(a, 0.9);
          r = Math.max(r, 1.6);
        } else {
          a *= 0.08;
          r *= 0.7;
        }
      }
      this.targR[k] = r;
      this.targA[k] = a;
    }
  }

  private toScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.z + this.w / 2, (y - this.cam.y) * this.cam.z + this.h / 2];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.cam.z + this.cam.x, (sy - this.h / 2) / this.cam.z + this.cam.y];
  }

  private lodLimit() {
    const base = this.isMobile ? 500 : 1100;
    return Math.max(base * 0.6, base * Math.pow(this.cam.z / 0.35, 1.5));
  }

  private pick(sx: number, sy: number): number {
    const [wx, wy] = this.toWorld(sx, sy);
    const reach = Math.max(10 / this.cam.z, 6);
    const c0x = Math.floor((wx - reach) / CELL);
    const c1x = Math.floor((wx + reach) / CELL);
    const c0y = Math.floor((wy - reach) / CELL);
    const c1y = Math.floor((wy + reach) / CELL);
    const lim = this.lodLimit();
    let best = -1;
    let bestD = Infinity;
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cy = c0y; cy <= c1y; cy++) {
        const arr = this.grid.get(this.cellKey(cx, cy));
        if (!arr) continue;
        for (const k of arr) {
          if (this.dispA[k] < 0.3) continue;
          const n = this.layout.nodes[k];
          if (n.rank > lim && this.cam.z < 1.2) continue;
          const d = Math.hypot(n.x - wx, n.y - wy);
          const hitR = Math.max(this.dispR[k] * 1.3, 7 / this.cam.z);
          if (d < hitR && d - this.dispR[k] < bestD) {
            bestD = d - this.dispR[k];
            best = k;
          }
        }
      }
    return best;
  }

  private setHover(k: number, sx: number, sy: number) {
    if (k !== this.hover) {
      this.hover = k;
      this.hoverLinks = [];
      if (k >= 0) {
        const n = this.layout.nodes[k];
        if (n.narrative) {
          const peers = this.layout.byNarrative.get(n.narrative) ?? [];
          this.hoverLinks = peers.filter((p) => p !== k).slice(0, 14);
        }
      }
      this.canvas.style.cursor = k >= 0 ? 'pointer' : this.dragging ? 'grabbing' : 'grab';
    }
    this.listeners.hover?.(k >= 0 ? this.layout.nodes[k] : null, sx, sy);
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    const base = this.goal ?? this.cam;
    const z = Math.max(0.05, Math.min(8, base.z * factor));
    // keep the world point under the cursor fixed
    const nx = wx - (sx - this.w / 2) / z;
    const ny = wy - (sy - this.h / 2) / z;
    this.goal = { x: nx, y: ny, z };
    this.lastInteraction = performance.now();
  }

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onWheel = (e: WheelEvent) => {
    // on the homepage the wheel scrolls the page; pinch / ctrl+wheel zooms
    if (this.mode === 'ambient' && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const [sx, sy] = this.local(e);
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    this.zoomAt(sx, sy, f);
  };

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = this.local(e);
    this.pointers.set(e.pointerId, { x: sx, y: sy });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
      this.dragging = null;
      return;
    }
    this.dragging = { x: sx, y: sy, moved: 0, cx: this.cam.x, cy: this.cam.y };
    this.goal = null;
    this.vel = { x: 0, y: 0 };
    this.lastInteraction = performance.now();
    this.canvas.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent) => {
    const [sx, sy] = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: sx, y: sy });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z = Math.max(0.05, Math.min(8, this.pinch.z * (d / this.pinch.d)));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const [wx, wy] = this.toWorld(mx, my);
      this.cam = { x: wx - (mx - this.w / 2) / z, y: wy - (my - this.h / 2) / z, z };
      this.goal = null;
      this.lastInteraction = performance.now();
      return;
    }
    if (this.dragging) {
      const dx = sx - this.dragging.x;
      const dy = sy - this.dragging.y;
      this.dragging.moved = Math.max(this.dragging.moved, Math.hypot(dx, dy));
      const nx = this.dragging.cx - dx / this.cam.z;
      const ny = this.dragging.cy - dy / this.cam.z;
      this.vel = { x: (nx - this.cam.x) * 0.9, y: (ny - this.cam.y) * 0.9 };
      this.cam.x = nx;
      this.cam.y = ny;
      this.lastInteraction = performance.now();
      if (this.dragging.moved > 4) this.setHover(-1, sx, sy);
      return;
    }
    if (e.pointerType === 'mouse') this.setHover(this.pick(sx, sy), sx, sy);
  };

  private onUp = (e: PointerEvent) => {
    const [sx, sy] = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.dragging = null;
      return;
    }
    const d = this.dragging;
    this.dragging = null;
    this.canvas.style.cursor = this.hover >= 0 ? 'pointer' : 'grab';
    if (d && d.moved < 6) {
      const k = this.pick(sx, sy);
      if (k >= 0) {
        if (e.pointerType !== 'mouse' && this.hover !== k) {
          // touch: first tap previews, second tap opens
          this.setHover(k, sx, sy);
          return;
        }
        this.listeners.click?.(this.layout.nodes[k]);
        return;
      }
      if (e.pointerType !== 'mouse') this.setHover(-1, sx, sy);
      const c = this.clusterAt(sx, sy);
      if (c) this.focusCluster(c.id);
    }
  };

  private onLeave = () => {
    if (!this.dragging) this.setHover(-1, 0, 0);
  };

  private onDbl = (e: MouseEvent) => {
    const [sx, sy] = this.local(e);
    this.zoomAt(sx, sy, 2.2);
  };

  private clusterAt(sx: number, sy: number): UCluster | undefined {
    const [wx, wy] = this.toWorld(sx, sy);
    if (this.cam.z > 1.4) return undefined;
    return this.layout.clusters.filter((c) => c.type === 'galaxy').find((c) => Math.hypot(c.x - wx, c.y - wy) < c.r * 0.5);
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('dblclick', this.onDbl);
    c.style.touchAction = 'none';
    c.style.cursor = 'grab';
  }

  private unbind() {
    const c = this.canvas;
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('dblclick', this.onDbl);
  }

  private glowFor(hue: number, kind: UNode['kind']): HTMLCanvasElement {
    const h = Math.round((KIND_HUE[kind] ?? hue) / 10) * 10;
    const sat = kind === 'crashed' ? 55 : kind === 'quiet' ? 45 : 100;
    const light = kind === 'crashed' ? 50 : kind === 'legendary' ? 64 : 62;
    const key = `${h}-${sat}-${light}`;
    let g = this.glow.get(key);
    if (!g) {
      g = makeGlow(h, sat, light);
      this.glow.set(key, g);
    }
    return g;
  }

  private nebulaFor(hue: number) {
    const h = Math.round(hue / 10) * 10;
    let n = this.nebula.get(h);
    if (!n) {
      n = makeNebula(h);
      this.nebula.set(h, n);
    }
    return n;
  }

  private frame(now: number) {
    const dt = Math.min(64, now - this.last);
    this.last = now;
    const t = (now - this.t0) / 1000;
    const ctx = this.ctx;
    const { w, h } = this;

    // camera motion
    if (this.goal) {
      const k = 1 - Math.pow(0.0025, dt / 1000);
      const lz = Math.log(this.cam.z) + (Math.log(this.goal.z) - Math.log(this.cam.z)) * k;
      this.cam.x += (this.goal.x - this.cam.x) * k;
      this.cam.y += (this.goal.y - this.cam.y) * k;
      this.cam.z = Math.exp(lz);
      if (Math.abs(this.goal.x - this.cam.x) * this.cam.z < 0.3 && Math.abs(this.goal.y - this.cam.y) * this.cam.z < 0.3 && Math.abs(this.goal.z / this.cam.z - 1) < 0.002) this.goal = null;
      this.listeners.camera?.(this.cam);
    } else if (!this.dragging && (Math.abs(this.vel.x) > 0.01 || Math.abs(this.vel.y) > 0.01)) {
      this.cam.x += this.vel.x;
      this.cam.y += this.vel.y;
      this.vel.x *= 0.9;
      this.vel.y *= 0.9;
    }
    const idle = now - this.lastInteraction > 7000;
    if (this.mode === 'ambient' && idle && !this.dragging) {
      // the universe drifts on its own when nobody is touching it
      this.cam.x += Math.sin(t * 0.05) * 0.06 / Math.max(0.3, this.cam.z);
      this.cam.y += Math.cos(t * 0.037) * 0.045 / Math.max(0.3, this.cam.z);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a1215';
    ctx.fillRect(0, 0, w, h);

    // parallax starfield
    for (const s of this.stars) {
      const px = (((s.x * w - this.cam.x * s.p * this.cam.z * 0.4) % w) + w) % w;
      const py = (((s.y * h - this.cam.y * s.p * this.cam.z * 0.4) % h) + h) % h;
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.9 + s.tw));
      ctx.fillStyle = '#cfe0e6';
      ctx.fillRect(px, py, s.s, s.s);
    }

    ctx.globalCompositeOperation = 'lighter';
    // nebulae
    const z = this.cam.z;
    for (const c of this.layout.clusters) {
      const [sx, sy] = this.toScreen(c.x, c.y);
      const R = c.r * z * (c.type === 'galaxy' ? 2.3 : 2.1);
      if (sx + R < 0 || sx - R > w || sy + R < 0 || sy - R > h) continue;
      if (c.type === 'narrative' && z < 0.5) continue;
      const fadeDeep = Math.max(0.12, Math.min(1, 1.5 - z * 0.35));
      ctx.globalAlpha = (c.type === 'galaxy' ? (this.highlight ? 0.45 : 0.95) : Math.min(0.7, (z - 0.5) * 1.2)) * fadeDeep;
      ctx.drawImage(this.nebulaFor(c.hue), sx - R, sy - R, R * 2, R * 2);
    }

    // highlight constellation
    const nodes = this.layout.nodes;
    if (this.highlightEdges.length) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(115, 173, 198,0.35)';
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const [a, b] of this.highlightEdges) {
        const [ax, ay] = this.toScreen(nodes[a].x, nodes[a].y);
        const [bx, by] = this.toScreen(nodes[b].x, nodes[b].y);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.globalAlpha = 0.6 + 0.2 * Math.sin(t * 2);
      ctx.stroke();
    }

    // hover links
    if (this.hover >= 0 && this.hoverLinks.length) {
      const n = nodes[this.hover];
      const [ax, ay] = this.toScreen(n.x, n.y);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -t * 18;
      ctx.strokeStyle = `hsla(${n.hue},100%,70%,0.55)`;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (const k of this.hoverLinks) {
        const [bx, by] = this.toScreen(nodes[k].x, nodes[k].y);
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) / 2 + (ay - by) * 0.15, (ay + by) / 2 + (bx - ax) * 0.15, bx, by);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // nodes
    const lim = this.lodLimit();
    const lerp = 1 - Math.pow(0.004, dt / 1000);
    const margin = 40;
    for (const k of this.drawOrder) {
      const n = nodes[k];
      this.dispR[k] += (this.targR[k] - this.dispR[k]) * lerp;
      this.dispA[k] += (this.targA[k] - this.dispA[k]) * lerp;
      const a = this.dispA[k];
      if (a < 0.01) continue;
      const sx = (n.x - this.cam.x) * z + w / 2;
      const sy = (n.y - this.cam.y) * z + h / 2;
      if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) continue;
      const rr = this.dispR[k] * z;
      if (this.activity) {
        // time travel: markets born in the last few days flash as they appear
        const age = this.activity.at - n.createdAt;
        if (age >= 0 && age < NEWBORN_MS) {
          const f = age / NEWBORN_MS;
          ctx.globalAlpha = (1 - f) * 0.9;
          ctx.strokeStyle = '#5ee7ff';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, 2.5 + f * 12 + rr, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1 - f;
          ctx.fillStyle = '#e8fbff';
          ctx.fillRect(sx - 1.2, sy - 1.2, 2.4, 2.4);
        }
      }
      const full = n.rank < lim || (this.highlight && this.highlight[k]) || rr > 2.2 || (this.activity !== null && this.live[k] === 1);
      if (!full) {
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = `hsl(${n.hue},70%,75%)`;
        const d = Math.max(0.8, Math.min(1.6, rr));
        ctx.fillRect(sx - d / 2, sy - d / 2, d, d);
        continue;
      }
      let alpha = a;
      if (n.kind === 'unusual') alpha *= 0.75 + 0.25 * Math.sin(t * 7 + k);
      const pulse = n.kind === 'high-volume' || n.kind === 'legendary' ? 1 + 0.08 * Math.sin(t * 2.2 + k * 0.7) : 1;
      const lit = this.highlight !== null && this.highlight[k] === 1;
      // halo grows sub-linearly so deep zoom shows crisp stars, not fog
      const S = Math.max(lit ? 11 : this.activity && this.live[k] ? 6 : 3, Math.min(rr * 5.2, rr * 2.2 + 16) * pulse);
      ctx.globalAlpha = Math.min(1, alpha) * (rr > 6 ? 0.8 : 1);
      ctx.drawImage(this.glowFor(n.hue, n.kind), sx - S / 2, sy - S / 2, S, S);
      if (lit && rr < 6) {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = 'rgba(115, 173, 198,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(5, rr * 1.8), 0, TAU);
        ctx.stroke();
      }
      if (rr > 3.5) {
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = n.kind === 'legendary' ? '#fff3c4' : n.kind === 'crashed' ? '#ffb3b3' : `hsl(${n.hue},100%,88%)`;
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 0.42, 0, TAU);
        ctx.fill();
      }

      if (rr > 2.4 && alpha > 0.3) this.decorate(n, k, sx, sy, rr, t, alpha);
    }

    // pulses (live events)
    ctx.globalCompositeOperation = 'lighter';
    this.pulses = this.pulses.filter((p) => now - p.t < 2400);
    for (const p of this.pulses) {
      const n = nodes[p.k];
      const [sx, sy] = this.toScreen(n.x, n.y);
      const age = (now - p.t) / 2400;
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2 * (1 - age) + 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 4 + age * 46, 0, TAU);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    this.drawLabels(t);

    // hover ring
    if (this.hover >= 0) {
      const n = nodes[this.hover];
      const [sx, sy] = this.toScreen(n.x, n.y);
      const R = Math.max(7, this.dispR[this.hover] * z * 1.5);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 3]);
      ctx.lineDashOffset = t * 10;
      ctx.beginPath();
      ctx.arc(sx, sy, R + 3 + Math.sin(t * 5) * 1.2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private decorate(n: UNode, k: number, sx: number, sy: number, rr: number, t: number, alpha: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, alpha) * 0.9;
    switch (n.kind) {
      case 'legendary': {
        ctx.strokeStyle = 'rgba(255,207,90,0.9)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -t * 12;
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 1.9, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        // four-point flare
        ctx.strokeStyle = 'rgba(255,230,160,0.55)';
        ctx.lineWidth = 1;
        const L = rr * (3.2 + 0.4 * Math.sin(t * 1.7 + k));
        ctx.beginPath();
        ctx.moveTo(sx - L, sy);
        ctx.lineTo(sx + L, sy);
        ctx.moveTo(sx, sy - L);
        ctx.lineTo(sx, sy + L);
        ctx.stroke();
        break;
      }
      case 'crashed': {
        ctx.strokeStyle = 'rgba(255,90,90,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 1.5, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - rr * 0.9, sy - rr * 0.9);
        ctx.lineTo(sx + rr * 0.9, sy + rr * 0.9);
        ctx.stroke();
        break;
      }
      case 'historical': {
        ctx.strokeStyle = 'rgba(255,170,80,0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rr * 2.2, rr * 1.1, 0.4, 0, TAU);
        ctx.stroke();
        const a = t * 0.9 + k;
        const ox = Math.cos(a) * rr * 2.2;
        const oy = Math.sin(a) * rr * 1.1;
        ctx.fillStyle = 'rgba(255,200,120,0.9)';
        ctx.beginPath();
        ctx.arc(sx + ox * Math.cos(0.4) - oy * Math.sin(0.4), sy + ox * Math.sin(0.4) + oy * Math.cos(0.4), 1.4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'unusual': {
        ctx.strokeStyle = 'rgba(255,79,200,0.6)';
        ctx.lineWidth = 1;
        const s = rr * 1.8;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(t * 0.8 + k);
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
        break;
      }
      case 'high-volume': {
        ctx.strokeStyle = `hsla(${n.hue},100%,70%,${0.25 + 0.2 * Math.sin(t * 2 + k)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, rr * (1.6 + 0.3 * ((t * 0.6 + k * 0.13) % 1)), 0, TAU);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private drawLabels(t: number) {
    const ctx = this.ctx;
    const z = this.cam.z;
    const { w, h } = this;
    // galaxy labels fade out as you dive in
    const ga = Math.max(0, Math.min(1, (1.25 - z) / 0.6));
    if (ga > 0.02) {
      ctx.textAlign = 'center';
      for (const c of this.layout.clusters) {
        if (c.type !== 'galaxy') continue;
        const [sx, sy] = this.toScreen(c.x, c.y);
        const ly = sy + c.r * z + 18;
        if (sx < -100 || sx > w + 100 || ly < -40 || ly > h + 40) continue;
        const big = c.count > 400;
        ctx.globalAlpha = ga * (this.highlight ? 0.45 : 0.95);
        ctx.font = `700 ${big ? 13 : 11}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = `hsl(${c.hue},100%,80%)`;
        ctx.fillText(c.label, sx, ly);
        ctx.globalAlpha = ga * 0.55;
        ctx.font = `500 9.5px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#a9bcc2';
        ctx.fillText(`${c.count.toLocaleString('en-US')} MARKETS`, sx, ly + 14);
      }
    }
    // narrative labels in the mid-zoom band
    const na = Math.max(0, Math.min(1, (z - 0.65) / 0.4)) * Math.max(0, Math.min(1, (3.2 - z) / 0.8));
    if (na > 0.02) {
      ctx.textAlign = 'center';
      ctx.font = `600 10px "JetBrains Mono", monospace`;
      for (const c of this.layout.clusters) {
        if (c.type !== 'narrative' || c.count < 10) continue;
        const [sx, sy] = this.toScreen(c.x, c.y);
        if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue;
        ctx.globalAlpha = na * (this.highlight ? 0.3 : 0.7);
        ctx.fillStyle = `hsl(${c.hue},90%,82%)`;
        ctx.fillText(`#${c.label}`, sx, sy - c.r * z - 8);
      }
    }
    // node labels — top visible markets, collision-avoided
    if (z < 0.55 && !this.highlight) return;
    const occupied = new Set<number>();
    const maxLabels = this.isMobile ? 14 : 34;
    let drawn = 0;
    ctx.textAlign = 'left';
    ctx.font = `600 10.5px "JetBrains Mono", monospace`;
    const nodes = this.layout.nodes;
    for (let o = this.drawOrder.length - 1; o >= 0 && drawn < maxLabels; o--) {
      const k = this.drawOrder[o];
      if (this.dispA[k] < 0.5) continue;
      const n = nodes[k];
      const rr = this.dispR[k] * z;
      if (rr < (this.highlight && this.highlight[k] ? 1.5 : 3.2)) continue;
      const [sx, sy] = this.toScreen(n.x, n.y);
      if (sx < 0 || sx > w - 60 || sy < 12 || sy > h - 10) continue;
      const gx = Math.floor((sx + rr + 4) / 70);
      const gy = Math.floor(sy / 16);
      const key = gx * 10000 + gy;
      if (occupied.has(key) || occupied.has(key + 1) || occupied.has(key - 10000)) continue;
      occupied.add(key);
      drawn++;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = n.kind === 'legendary' ? '#ffd772' : n.kind === 'crashed' ? '#ff8a8a' : '#e4eef1';
      ctx.fillText(`$${n.ticker}`, sx + rr + 4, sy + 3.5);
    }
    void t;
  }
}

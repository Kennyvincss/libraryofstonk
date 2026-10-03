/// <reference lib="webworker" />
/**
 * The demo "backend". Runs the simulation off the main thread and answers
 * the same questions a real indexer would.
 */
import { buildWorld, DEMO_SEED, simulateBars, simulateTrades, type SimWorld } from './simulate';

let world: SimWorld | undefined;
const WEEK = 7 * 86_400_000;

type Req =
  | { id: number; type: 'init'; start: number; now: number }
  | { id: number; type: 'series'; marketId: string }
  | { id: number; type: 'trades'; marketId: string; limit: number }
  | { id: number; type: 'snapshot'; at: number };

self.onmessage = (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    switch (req.type) {
      case 'init': {
        world = buildWorld(DEMO_SEED, req.start, req.now);
        const order = [...world.markets].sort((a, b) => b.volumeLifetimeUsd - a.volumeLifetimeUsd);
        post(req.id, { markets: order, ecosystem: world.ecosystem, quotes: world.quotes });
        break;
      }
      case 'series': {
        const w = need();
        const p = w.params.get(req.marketId);
        post(req.id, p ? simulateBars(p, w, w.macro) : []);
        break;
      }
      case 'trades': {
        const w = need();
        const p = w.params.get(req.marketId);
        post(req.id, p ? simulateTrades(p, simulateBars(p, w, w.macro), req.limit) : []);
        break;
      }
      case 'snapshot': {
        const w = need();
        const pos = (req.at - w.start) / WEEK;
        const wi = Math.max(0, Math.min(w.weeks - 1, Math.floor(pos)));
        const frac = pos - Math.floor(pos);
        const ids: string[] = [];
        const vals: number[] = [];
        for (const m of w.markets) {
          if (m.createdAt > req.at) continue;
          const wk = w.weekly.get(m.id)!;
          // trailing 7d ≈ blend of the current and previous week buckets
          const v = wk[wi] * frac + (wi > 0 ? wk[wi - 1] : 0) * (1 - frac);
          ids.push(m.id);
          vals.push(v);
        }
        post(req.id, { ids, vals });
        break;
      }
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: req.id, error: String(e) });
  }
};

function need(): SimWorld {
  if (!world) throw new Error('demo world not initialised');
  return world;
}

function post(id: number, result: unknown) {
  (self as unknown as Worker).postMessage({ id, result });
}

/** Rate-limited, retrying GeckoTerminal client for the indexer (Node 20+). */
import { GECKO_API } from '../src/data/live/gecko';

export class Gecko {
  calls = 0;
  private last = 0;
  constructor(
    private readonly budget: number,
    private readonly minIntervalMs = Number(process.env.INDEXER_MIN_INTERVAL_MS || 2200),
    private readonly base = process.env.GECKO_API || GECKO_API,
  ) {}

  get remaining() {
    return this.budget - this.calls;
  }

  async get<T = unknown>(path: string): Promise<T | null> {
    if (this.calls >= this.budget) throw new BudgetExhausted();
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.calls++;
      let res: Response;
      try {
        res = await fetch(`${this.base}${path}`, { headers: { accept: 'application/json' } });
      } catch (e) {
        log(`network error on ${path}: ${(e as Error).message}`);
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 429) {
        log(`rate limited on ${path}, backing off`);
        await sleep(61_000);
        continue;
      }
      if (res.status >= 500) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        log(`HTTP ${res.status} on ${path}`);
        return null;
      }
      return (await res.json()) as T;
    }
    log(`giving up on ${path}`);
    return null;
  }
}

export class BudgetExhausted extends Error {
  constructor() {
    super('API call budget exhausted for this run');
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

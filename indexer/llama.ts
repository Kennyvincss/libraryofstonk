/**
 * Platform-wide StonkFun volume from DefiLlama (free, no key).
 * https://defillama.com/protocol/stonkfun
 *
 * GeckoTerminal can only list the busiest pools, so per-market coverage is
 * partial; DefiLlama's protocol series is the authoritative daily total.
 */
import { log, sleep } from './client';

export interface PlatformVolume {
  source: string;
  url: string;
  /** UTC day (ms) → USD volume */
  daily: Record<string, number>;
  total24h?: number;
  total7d?: number;
  total30d?: number;
  totalAllTime?: number;
  fetchedAt: number;
}

const BASE = process.env.LLAMA_API || 'https://api.llama.fi';
const SLUG = process.env.LLAMA_SLUG || 'stonkfun';

export async function fetchPlatformVolume(now: number): Promise<PlatformVolume | null> {
  const url = `${BASE}/summary/dexs/${SLUG}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=dailyVolume`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 404) {
        log(`DefiLlama: no dex summary for "${SLUG}"`);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        totalDataChart?: [number, number][];
        total24h?: number;
        total7d?: number;
        total30d?: number;
        totalAllTime?: number;
      };
      const daily: Record<string, number> = {};
      for (const row of j.totalDataChart ?? []) {
        const [ts, v] = row;
        if (Number.isFinite(ts) && Number.isFinite(v)) daily[String(Math.floor((ts * 1000) / 86_400_000) * 86_400_000)] = v;
      }
      log(`DefiLlama: ${Object.keys(daily).length} days of StonkFun volume, all-time ${Math.round(j.totalAllTime ?? 0).toLocaleString('en-US')}`);
      return { source: 'DefiLlama', url: `https://defillama.com/protocol/${SLUG}`, daily, total24h: j.total24h, total7d: j.total7d, total30d: j.total30d, totalAllTime: j.totalAllTime, fetchedAt: now };
    } catch (e) {
      log(`DefiLlama attempt ${attempt + 1} failed: ${(e as Error).message}`);
      await sleep(3000 * (attempt + 1));
    }
  }
  return null;
}

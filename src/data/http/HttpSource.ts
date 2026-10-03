import type { DataSource } from '../source';
import type { ActivityEvent, Bar, EcosystemDay, Market, MarketPage, Moment, Resolution, Snapshot, SourceMeta, Trade } from '../types';

/**
 * Data source backed by a StonkFun archive indexer.
 * The REST contract is documented in docs/DATA_ARCHITECTURE.md.
 *
 * Configure with:
 *   VITE_DATA_SOURCE=api
 *   VITE_ARCHIVE_API_URL=https://…/v1
 *   VITE_ARCHIVE_LIVE_URL=https://…/v1/activity/stream   (optional SSE)
 */
export class HttpSource implements DataSource {
  private readonly base: string;
  private readonly liveUrl: string;
  private readonly pollMs: number;

  constructor(opts: { baseUrl: string; liveUrl?: string; pollMs?: number }) {
    if (!opts.baseUrl) throw new Error('HttpSource: VITE_ARCHIVE_API_URL is not configured');
    this.base = opts.baseUrl;
    this.liveUrl = opts.liveUrl || '';
    this.pollMs = opts.pollMs || 8000;
  }

  private async get<T>(path: string, allow404 = false): Promise<T | undefined> {
    const res = await fetch(`${this.base}${path}`, { headers: { accept: 'application/json' } });
    if (allow404 && res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Archive API ${res.status} on ${path}`);
    return (await res.json()) as T;
  }

  async meta(): Promise<SourceMeta> {
    const m = (await this.get<Omit<SourceMeta, 'kind' | 'isDemo'> & { isDemo?: boolean }>('/meta'))!;
    return { ...m, kind: 'api', isDemo: Boolean(m.isDemo) };
  }

  async marketsPage(cursor?: string, limit = 2000): Promise<MarketPage> {
    const q = new URLSearchParams({ limit: String(limit), order: 'notability' });
    if (cursor) q.set('cursor', cursor);
    return (await this.get<MarketPage>(`/markets?${q}`))!;
  }

  market(id: string) {
    return this.get<Market>(`/markets/${encodeURIComponent(id)}`, true);
  }

  async series(id: string, resolution: Resolution): Promise<Bar[]> {
    return (await this.get<Bar[]>(`/markets/${encodeURIComponent(id)}/bars?resolution=${resolution}`)) ?? [];
  }

  async trades(id: string, limit = 30): Promise<Trade[]> {
    return (await this.get<Trade[]>(`/markets/${encodeURIComponent(id)}/trades?limit=${limit}`, true)) ?? [];
  }

  async ecosystem(): Promise<EcosystemDay[]> {
    return (await this.get<EcosystemDay[]>('/ecosystem/daily')) ?? [];
  }

  async snapshot(at: number): Promise<Snapshot> {
    const r = (await this.get<{ at: number; activity: Record<string, number> }>(`/snapshot?at=${at}`))!;
    return { at: r.at, activity: new Map(Object.entries(r.activity)) };
  }

  async moments(): Promise<Moment[] | undefined> {
    return this.get<Moment[]>('/moments?status=approved', true);
  }

  subscribe(onEvent: (e: ActivityEvent) => void): () => void {
    const tag = (e: ActivityEvent) => onEvent({ ...e, simulated: Boolean(e.simulated) });
    if (this.liveUrl && typeof EventSource !== 'undefined') {
      const es = new EventSource(this.liveUrl);
      es.onmessage = (ev) => {
        try {
          tag(JSON.parse(ev.data) as ActivityEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      return () => es.close();
    }
    let since = Date.now();
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const events = (await this.get<ActivityEvent[]>(`/activity?since=${since}`, true)) ?? [];
        for (const e of events.sort((a, b) => a.t - b.t)) {
          since = Math.max(since, e.t);
          tag(e);
        }
      } catch {
        /* transient — retry next tick */
      }
      if (!stopped) timer = setTimeout(poll, this.pollMs);
    };
    let timer = setTimeout(poll, 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}

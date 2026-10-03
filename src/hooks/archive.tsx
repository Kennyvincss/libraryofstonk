import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getDataSource, type DataSource } from '../data';
import type { ActivityEvent, Bar, Market } from '../data/types';
import { Archive } from '../engine/archive';
import { layoutUniverse, type UniverseLayout } from '../universe/layout';

/** Hard cap on markets held client-side; deeper markets are fetched on demand. */
const MAX_CLIENT_MARKETS = 60_000;

interface ArchiveState {
  status: 'loading' | 'ready' | 'error';
  progress: string;
  archive?: Archive;
  layout?: UniverseLayout;
  error?: string;
  source: DataSource;
}

const Ctx = createContext<ArchiveState | null>(null);

export function ArchiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ArchiveState>(() => ({ status: 'loading', progress: 'Opening the archive…', source: getDataSource() }));

  useEffect(() => {
    let cancelled = false;
    const source = state.source;
    const step = (progress: string) => !cancelled && setState((s) => ({ ...s, progress }));
    (async () => {
      try {
        step('Charting the universe…');
        const meta = await source.meta();
        const markets: Market[] = [];
        let cursor: string | undefined;
        do {
          const page = await source.marketsPage(cursor, 5000);
          markets.push(...page.markets);
          cursor = page.next;
          step(`Mapping ${markets.length.toLocaleString('en-US')} markets…`);
        } while (cursor && markets.length < MAX_CLIENT_MARKETS);
        step('Reading the ecosystem’s pulse…');
        const [ecosystem, moments] = await Promise.all([source.ecosystem(), source.moments?.() ?? Promise.resolve(undefined)]);
        step('Detecting moments…');
        await new Promise((r) => setTimeout(r, 0));
        const archive = new Archive(meta, markets, ecosystem, moments);
        const layout = layoutUniverse(archive);
        if (!cancelled) setState((s) => ({ ...s, status: 'ready', archive, layout, progress: '' }));
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : String(e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.source]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useArchiveState() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useArchiveState outside ArchiveProvider');
  return s;
}

/** For components rendered only once the archive is ready. */
export function useArchive(): { archive: Archive; layout: UniverseLayout; source: DataSource } {
  const s = useArchiveState();
  if (!s.archive || !s.layout) throw new Error('archive not ready');
  return { archive: s.archive, layout: s.layout, source: s.source };
}

export function useSeries(id: string | undefined, enabled = true) {
  const { source } = useArchiveState();
  const [bars, setBars] = useState<Bar[] | undefined>();
  useEffect(() => {
    if (!id || !enabled) return;
    let alive = true;
    setBars(undefined);
    source.series(id, '1h').then((b) => alive && setBars(b), () => alive && setBars([]));
    return () => {
      alive = false;
    };
  }, [id, enabled, source]);
  return bars;
}

// ── live activity ────────────────────────────────────────────────────────────
interface LiveState {
  events: ActivityEvent[];
  listen: (fn: (e: ActivityEvent) => void) => () => void;
}
const LiveCtx = createContext<LiveState>({ events: [], listen: () => () => {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const { source, status } = useArchiveState();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const listeners = useRef(new Set<(e: ActivityEvent) => void>());
  useEffect(() => {
    if (status !== 'ready') return;
    return source.subscribe((e) => {
      setEvents((prev) => [e, ...prev].slice(0, 40));
      for (const l of listeners.current) l(e);
    });
  }, [source, status]);
  const listen = (fn: (e: ActivityEvent) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  };
  return <LiveCtx.Provider value={{ events, listen }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);

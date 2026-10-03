import type {
  ActivityEvent,
  Bar,
  EcosystemDay,
  Market,
  MarketPage,
  Moment,
  Resolution,
  Snapshot,
  SourceMeta,
  Trade,
} from './types';

/**
 * Everything the archive needs from the outside world.
 *
 * Implementations:
 *  - DemoSource  (src/data/demo)  — deterministic simulation, labelled as demo.
 *  - HttpSource  (src/data/http)  — any indexer implementing docs/DATA_ARCHITECTURE.md.
 *
 * To plug in a new backend (a Helius webhook pipeline, a Dune/Flipside query
 * layer, a Raydium LaunchLab indexer…), implement this interface and register
 * it in src/data/index.ts. No UI changes required.
 */
export interface DataSource {
  meta(): Promise<SourceMeta>;

  /**
   * Markets ordered by importance (most notable first) so the universe can
   * render the brightest stars immediately and stream the long tail later.
   */
  marketsPage(cursor?: string, limit?: number): Promise<MarketPage>;

  market(id: string): Promise<Market | undefined>;

  series(id: string, resolution: Resolution): Promise<Bar[]>;

  /** Recent trades. Optional — not every backend indexes individual fills. */
  trades?(id: string, limit?: number): Promise<Trade[]>;

  ecosystem(): Promise<EcosystemDay[]>;

  /** Universe state at a given time (trailing-7d activity per market). */
  snapshot(at: number): Promise<Snapshot>;

  /**
   * Curated moments, if the backend stores them. When this returns
   * undefined, the archive runs the client-side moment detector instead.
   */
  moments?(): Promise<Moment[] | undefined>;

  /** Subscribe to live activity. Returns an unsubscribe function. */
  subscribe(onEvent: (e: ActivityEvent) => void): () => void;
}

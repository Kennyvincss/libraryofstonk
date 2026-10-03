/**
 * Domain model for the StonkFun Archive.
 *
 * These types are the contract between the UI and any data source. A source
 * (demo simulation, HTTP indexer, …) only has to produce these shapes — the UI
 * and the notability / moment engines never know where data came from.
 *
 * All monetary values are in USD unless suffixed with `Quote`.
 * All timestamps are unix milliseconds (UTC).
 */

export type QuoteKind = 'xstock' | 'etf' | 'crypto' | 'stable' | 'pre-ipo';

export interface QuoteAsset {
  /** Symbol as shown on StonkFun, e.g. "NVDAx" */
  symbol: string;
  /** Human name, e.g. "NVIDIA (tokenized)" */
  name: string;
  kind: QuoteKind;
  /** The underlying the quote tracks, e.g. "NVDA" */
  underlying: string;
  /** SPL mint address of the quote asset */
  mint?: string;
  /** Last known USD price of one unit of the quote asset */
  priceUsd: number;
  /** Brand-neutral hue (0–360) used to tint its galaxy in the universe */
  hue: number;
}

export type MarketStatus = 'bonding' | 'graduated' | 'dormant' | 'dead';

/**
 * Summary of one StonkFun market (a token paired against a quote asset).
 * This is what the universe, cards and search operate on — it must stay
 * cheap enough to hold tens of thousands in memory.
 */
export interface Market {
  /** Stable id. For real data: the pool / bonding-curve address. */
  id: string;
  /** Token mint address */
  mint: string;
  ticker: string;
  name: string;
  /** Free-text description or metadata from the token's URI, if any */
  description?: string;
  image?: string;
  quote: string; // QuoteAsset.symbol
  creator?: string;
  createdAt: number;
  /** Timestamp of the most recent trade */
  lastTradeAt: number;
  status: MarketStatus;
  /** 0..1 progress along the bonding curve (1 = graduated) */
  bondingProgress?: number;

  priceUsd: number;
  priceQuote: number;
  launchPriceUsd: number;
  athPriceUsd: number;
  athAt: number;
  /** Lowest price seen after the ATH */
  postAthLowUsd: number;
  change24h: number; // fraction, 0.12 = +12%
  marketCapUsd: number;
  liquidityUsd: number;

  volume24hUsd: number;
  volume7dUsd: number;
  volumeLifetimeUsd: number;
  /** Peak single-day volume and when it happened */
  peakDayVolumeUsd: number;
  peakDayAt: number;

  trades: number;
  trades24h: number;
  /** Unique wallets that ever traded */
  traders: number;
  traders24h: number;
  /** Current holders, where the source can provide it */
  holders?: number;
  /** Largest single trade in USD, where available */
  largestTradeUsd?: number;
}

/** OHLCV bar. `t` is the bar open time. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** USD volume in this bar */
  v: number;
  /** trade count in this bar */
  n: number;
  /** wallets that traded for the first time in this bar */
  newTraders: number;
}

export type Resolution = '1h' | '1d';

export interface Trade {
  t: number;
  side: 'buy' | 'sell';
  usd: number;
  priceUsd: number;
  wallet: string;
  signature: string;
}

/** Ecosystem-wide aggregate for one UTC day. */
export interface EcosystemDay {
  t: number;
  marketsCreated: number;
  volumeUsd: number;
  trades: number;
  activeTraders: number;
  /** Markets with ≥1 trade that day */
  activeMarkets: number;
  /**
   * Activity-weighted (log-volume) mean log-return of established markets (age > 3d) that
   * day. Lets the engine detect ecosystem-wide crashes and recoveries.
   */
  marketReturn?: number;
}

/**
 * A snapshot of the universe at a point in time — powers time travel.
 * `activity` holds each visible market's trailing-7-day USD volume at `at`.
 */
export interface Snapshot {
  at: number;
  activity: Map<string, number>;
}

export type MomentKind =
  | 'narrative' // a burst of markets sharing a keyword
  | 'quote-rush' // a burst of markets launched against one quote asset
  | 'volume-spike' // ecosystem-wide volume anomaly
  | 'crash' // ecosystem-wide drawdown
  | 'recovery' // ecosystem rebound after a crash
  | 'launch' // a single market whose launch dominated the ecosystem
  | 'milestone'; // cumulative threshold crossed

export type MomentStatus = 'candidate' | 'approved' | 'hidden';

export interface MomentStats {
  marketsCreated: number;
  volumeUsd: number;
  traders: number;
  trades: number;
  /** Ratio of activity vs. the trailing baseline that triggered detection */
  intensity: number;
}

export interface Moment {
  id: string;
  kind: MomentKind;
  title: string;
  tagline: string;
  start: number;
  end: number;
  /** The keyword / quote / metric that defines it */
  key: string;
  marketIds: string[];
  topMarketId?: string;
  stats: MomentStats;
  /** Detection confidence 0..1 */
  confidence: number;
  status: MomentStatus;
  /** 'detected' = produced by the engine, 'curated' = edited by a human */
  origin: 'detected' | 'curated';
  /** Short machine-readable explanation of why it was flagged */
  evidence: string[];
}

export type ActivityKind =
  | 'launch'
  | 'volume-milestone'
  | 'traders-milestone'
  | 'unusual'
  | 'graduated'
  | 'ath'
  | 'whale';

export interface ActivityEvent {
  id: string;
  t: number;
  kind: ActivityKind;
  marketId?: string;
  ticker?: string;
  quote?: string;
  text: string;
  /** true when the event comes from a simulation rather than chain data */
  simulated: boolean;
}

export interface SourceMeta {
  kind: 'demo' | 'api';
  /** Must be true whenever any number shown is not real chain data */
  isDemo: boolean;
  label: string;
  archiveStart: number;
  archiveEnd: number;
  /** Total markets the source knows about (may exceed what is loaded) */
  totalMarkets: number;
  quoteAssets: QuoteAsset[];
  /** when the dataset was built (real-data sources) */
  generatedAt?: number;
  /** plain-language notes on how numbers are derived */
  method?: string[];
  /** authoritative platform-wide totals (e.g. DefiLlama), when available */
  platform?: { source: string; url: string; volume24h?: number; volume7d?: number; volume30d?: number; volumeAllTime?: number };
  /**
   * 'partial' = the market list is not every market ever launched (e.g. only
   * the busiest pools are discoverable); the UI says "tracked".
   */
  coverage?: 'complete' | 'partial';
  /** on-chain enumeration: exact market count and how many have launch dates yet */
  chain?: { totalMarkets: number; datedMarkets: number };
}

/** Progressive loading tiers for the universe. */
export interface MarketPage {
  markets: Market[];
  /** Opaque cursor; undefined when exhausted */
  next?: string;
  total: number;
}

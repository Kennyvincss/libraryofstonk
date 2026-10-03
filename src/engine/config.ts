/**
 * Tunable knobs for the notability engine, badges and moment detector.
 * Everything that decides "what is interesting" lives here so it can be
 * reviewed and adjusted without touching UI code.
 */
export const notabilityWeights = {
  lifetimeVolume: 0.26,
  recentVolume: 0.1,
  traders: 0.18,
  liquidity: 0.06,
  longevity: 0.1,
  priceMove: 0.12,
  tradeFrequency: 0.06,
  spike: 0.04,
  growth: 0.03,
  /** bonus for markets that belong to a detected moment */
  historical: 0.05,
};

export type NotabilityFeature = keyof typeof notabilityWeights;

export const badgeRules = {
  legendary: { topFraction: 0.004, minVolumeUsd: 2_000_000, minTraders: 5_000 },
  mooned: { minPeakMultiple: 50 },
  diedFast: { maxHoursToPeak: 48, maxLifeDays: 7, maxPostPeakRetain: 0.1, minVolumeUsd: 50_000 },
  whaleMagnet: { minLargestTradeUsd: 25_000, topAvgTradeFraction: 0.01, minTrades: 200 },
  viral: { minTraders: 2_000, maxDaysToPeakVolume: 2 },
  experimental: { maxQuoteShare: 0.015 },
  mostTraded: { topN: 12 },
  oldestSurvivor: { topN: 12, minVolume7dUsd: 1_000, minAgeDays: 45 },
};

export const momentRules = {
  /** bucket width used to look for bursts */
  bucketHours: 12,
  /** trailing window used as the "normal" baseline */
  baselineDays: 14,
  narrative: { minMarkets: 10, minRatio: 4 },
  quoteRush: { minMarkets: 14, minRatio: 3 },
  /** merge two bursts if their member sets overlap at least this much */
  mergeJaccard: 0.35,
  volumeSpike: { minZ: 2.6, trailingDays: 21 },
  crash: { windowDays: 3, maxZ: -2.4, trailingDays: 30 },
  recovery: { windowDays: 6, minZ: 2.0, lookaheadDays: 30 },
  launch: { minShareOfDay: 0.22, minDayVolumeUsd: 750_000 },
  milestones: {
    markets: [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000],
    volumeUsd: [10e6, 50e6, 100e6, 250e6, 500e6, 1e9, 2.5e9, 5e9, 10e9],
  },
  /** detected moments at/above this confidence are shown without review */
  autoApproveConfidence: 0.55,
};

/** Runner stories: coins whose launch became a Moment. */
export const storyRules = {
  maxRunners: 40,
  /** a runner traded at least this much over its life… */
  minVolumeUsd: 50_000,
  /** …with at least this many distinct traders */
  minTraders: 150,
  /** price multiple from launch worth mentioning */
  minPeakMultiple: 2,
  /** market caps above this multiple of pool liquidity are treated as mispriced */
  maxMcapToLiquidity: 1000,
  /** copycats counted for this many days after a launch */
  copycatDays: 14,
};

/** Words that never define a narrative on their own. */
export const STOPWORDS = new Set(
  'the a an of and or to in on for with by at is it this that be are was coin token inu sol x the of my your our just only not no yes'.split(' '),
);

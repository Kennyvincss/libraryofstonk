/**
 * Documented platform events. Unlike detected moments these come from public
 * reporting, not from the data, so they're marked `origin: 'curated'` and only
 * added to real-data archives (never to the simulated demo).
 */
import type { Market, Moment } from '../data/types';
import { STONKFUN } from '../data/live/stonkfun';

const DAY = 86_400_000;

interface KnownEvent {
  id: string;
  at: number;
  title: string;
  tagline: string;
  /** the longer story shown on the card */
  body: string;
  source: string;
  sourceUrl?: string;
  /** which markets belong to it */
  members: (markets: Market[]) => Market[];
}

const createdWithin = (from: number, days: number) => (ms: Market[]) => ms.filter((m) => m.createdAt >= from && m.createdAt < from + days * DAY);

export const KNOWN_EVENTS: KnownEvent[] = [
  {
    id: 'curated-stonk-deployed-2026-07-23',
    at: STONKFUN.stonkDeployed,
    title: 'STONK IS BORN',
    tagline: 'STONK, the platform token, was deployed in a pool quoted in SPYx, priced in index units rather than dollars.',
    body: 'Eleven days before the launchpad opened, STONK went live in a pool quoted in SPYx, the tokenized S&P 500 ETF. The platform token was priced in index units rather than dollars, setting the pattern for everything that launched after it.',
    source: 'Platform token deployment, July 23, 2026',
    members: (ms) => ms.filter((m) => m.ticker.toUpperCase() === STONKFUN.platformTokenSymbol),
  },
  {
    id: 'curated-stonkfun-launch-2026-08-03',
    at: STONKFUN.launch,
    title: 'STONKFUN OPENS',
    tagline: 'StonkFun officially launched: anyone could now create a coin priced in tokenized stocks.',
    body: 'StonkFun officially launched on Solana. Anyone could now create a coin and pair it with a tokenized stock such as NVDAx or SPYx instead of SOL, so every chart was also a bet against a share price.',
    source: 'Official launch, August 3, 2026',
    members: createdWithin(STONKFUN.launch, 3),
  },
  {
    id: 'curated-launchlab-switch-2026-09-06',
    at: STONKFUN.launchlab,
    title: 'THE LAUNCHLAB SWITCH',
    tagline: 'New StonkFun deployments moved to Raydium LaunchLab, with graduated liquidity flowing on to Raydium and Jupiter.',
    body: 'StonkFun moved new deployments to Raydium LaunchLab. Coins now launched on a LaunchLab bonding curve, still quoted in tokenized stocks, and graduated into Raydium pools routed by Jupiter.',
    source: 'Reported September 6, 2026 (The Block)',
    members: createdWithin(STONKFUN.launchlab, 3),
  },
];

export function knownMoments(markets: Market[], start: number, end: number, score: (id: string) => number): Moment[] {
  return KNOWN_EVENTS.filter((e) => e.at >= start - DAY && e.at <= end).map((e) => {
    const ms = e.members(markets).sort((a, b) => score(b.id) - score(a.id));
    return {
      id: e.id,
      kind: 'news',
      title: e.title,
      tagline: e.tagline,
      body: e.body,
      sourceUrl: e.sourceUrl,
      image: ms[0]?.image,
      start: e.at,
      end: e.at + DAY,
      key: e.id,
      marketIds: ms.map((m) => m.id),
      topMarketId: ms[0]?.id,
      stats: {
        marketsCreated: ms.filter((m) => m.createdAt >= e.at && m.createdAt < e.at + 3 * DAY).length,
        volumeUsd: ms.reduce((s, m) => s + m.volumeLifetimeUsd, 0),
        traders: ms.reduce((s, m) => s + m.traders, 0),
        trades: ms.reduce((s, m) => s + m.trades, 0),
        intensity: 1,
      },
      confidence: 1,
      status: 'approved',
      origin: 'curated',
      evidence: [e.source],
    } satisfies Moment;
  });
}

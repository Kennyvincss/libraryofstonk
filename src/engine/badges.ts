/**
 * Achievement badges — awarded only from measurable thresholds in
 * engine/config.ts. Each award carries the evidence that earned it.
 */
import type { Market } from '../data/types';
import { badgeRules } from './config';
import { fmtMultiple, fmtNum, fmtUsd } from '../lib/format';

export type BadgeId = 'legendary' | 'mooned' | 'died-fast' | 'whale-magnet' | 'viral' | 'experimental' | 'most-traded' | 'oldest-survivor';

export const BADGES: Record<BadgeId, { emoji: string; label: string; rule: string }> = {
  legendary: { emoji: '🏆', label: 'Legendary', rule: `Top ${badgeRules.legendary.topFraction * 100}% notability, ≥ ${fmtUsd(badgeRules.legendary.minVolumeUsd)} volume and ≥ ${fmtNum(badgeRules.legendary.minTraders)} traders` },
  mooned: { emoji: '🚀', label: 'Mooned', rule: `Peaked ≥ ${badgeRules.mooned.minPeakMultiple}× its launch price` },
  'died-fast': { emoji: '💀', label: 'Died Fast', rule: `Peaked within ${badgeRules.diedFast.maxHoursToPeak}h, lost ≥ ${(1 - badgeRules.diedFast.maxPostPeakRetain) * 100}% and went silent within ${badgeRules.diedFast.maxLifeDays} days (≥ ${fmtUsd(badgeRules.diedFast.minVolumeUsd)} traded)` },
  'whale-magnet': { emoji: '🐋', label: 'Whale Magnet', rule: `A single trade ≥ ${fmtUsd(badgeRules.whaleMagnet.minLargestTradeUsd)}, or top ${badgeRules.whaleMagnet.topAvgTradeFraction * 100}% average trade size` },
  viral: { emoji: '🔥', label: 'Viral', rule: `≥ ${fmtNum(badgeRules.viral.minTraders)} traders with peak volume inside ${badgeRules.viral.maxDaysToPeakVolume} days of launch` },
  experimental: { emoji: '🧪', label: 'Experimental', rule: `Quoted in an asset used by < ${badgeRules.experimental.maxQuoteShare * 100}% of markets` },
  'most-traded': { emoji: '👑', label: 'Most Traded', rule: `Top ${badgeRules.mostTraded.topN} markets by lifetime trade count` },
  'oldest-survivor': { emoji: '🗿', label: 'Oldest Survivor', rule: `Among the ${badgeRules.oldestSurvivor.topN} oldest markets still trading ≥ ${fmtUsd(badgeRules.oldestSurvivor.minVolume7dUsd)}/week` },
};

export interface BadgeAward {
  id: BadgeId;
  evidence: string;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export function awardBadges(markets: Market[], rank: Int32Array, now: number): Map<string, BadgeAward[]> {
  const out = new Map<string, BadgeAward[]>();
  const add = (m: Market, id: BadgeId, evidence: string) => {
    const arr = out.get(m.id) ?? [];
    arr.push({ id, evidence });
    out.set(m.id, arr);
  };
  const n = markets.length;
  const quoteCount = new Map<string, number>();
  for (const m of markets) quoteCount.set(m.quote, (quoteCount.get(m.quote) ?? 0) + 1);

  const legendaryCut = Math.max(3, Math.round(n * badgeRules.legendary.topFraction));
  const avgTrade = markets.map((m) => (m.trades >= badgeRules.whaleMagnet.minTrades ? m.volumeLifetimeUsd / m.trades : 0));
  const avgSorted = [...avgTrade].sort((a, b) => b - a);
  const avgCut = avgSorted[Math.max(0, Math.floor(n * badgeRules.whaleMagnet.topAvgTradeFraction) - 1)] || Infinity;

  markets.forEach((m, i) => {
    const mult = m.athPriceUsd / m.launchPriceUsd;
    const L = badgeRules.legendary;
    if (rank[i] < legendaryCut && m.volumeLifetimeUsd >= L.minVolumeUsd && m.traders >= L.minTraders)
      add(m, 'legendary', `#${rank[i] + 1} most notable · ${fmtUsd(m.volumeLifetimeUsd)} volume · ${fmtNum(m.traders)} traders`);
    if (mult >= badgeRules.mooned.minPeakMultiple) add(m, 'mooned', `Peaked at ${fmtMultiple(mult)} its launch price`);
    const D = badgeRules.diedFast;
    if ((m.athAt - m.createdAt) / HOUR <= D.maxHoursToPeak && (m.lastTradeAt - m.createdAt) / DAY <= D.maxLifeDays && m.postAthLowUsd / m.athPriceUsd <= D.maxPostPeakRetain && m.volumeLifetimeUsd >= D.minVolumeUsd && m.status === 'dead')
      add(m, 'died-fast', `Peaked after ${Math.max(1, Math.round((m.athAt - m.createdAt) / HOUR))}h, then lost ${Math.round((1 - m.postAthLowUsd / m.athPriceUsd) * 100)}%`);
    const W = badgeRules.whaleMagnet;
    if ((m.largestTradeUsd ?? 0) >= W.minLargestTradeUsd) add(m, 'whale-magnet', `Largest single trade ${fmtUsd(m.largestTradeUsd!)}`);
    else if (avgTrade[i] > 0 && avgTrade[i] >= avgCut) add(m, 'whale-magnet', `Average trade ${fmtUsd(avgTrade[i])} (top ${W.topAvgTradeFraction * 100}%)`);
    const V = badgeRules.viral;
    if (m.traders >= V.minTraders && (m.peakDayAt - m.createdAt) / DAY <= V.maxDaysToPeakVolume)
      add(m, 'viral', `${fmtNum(m.traders)} traders, peak volume day ${Math.max(1, Math.ceil((m.peakDayAt - m.createdAt) / DAY + 0.01))} of life`);
    const share = (quoteCount.get(m.quote) ?? 0) / n;
    if (share < badgeRules.experimental.maxQuoteShare) add(m, 'experimental', `Only ${(share * 100).toFixed(1)}% of markets use ${m.quote}`);
  });

  [...markets]
    .sort((a, b) => b.trades - a.trades)
    .slice(0, badgeRules.mostTraded.topN)
    .forEach((m, i) => add(m, 'most-traded', `#${i + 1} by trades · ${fmtNum(m.trades)} trades`));

  const O = badgeRules.oldestSurvivor;
  markets
    .filter((m) => m.status !== 'dead' && m.volume7dUsd >= O.minVolume7dUsd && (now - m.createdAt) / DAY >= O.minAgeDays)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, O.topN)
    .forEach((m) => add(m, 'oldest-survivor', `${Math.floor((now - m.createdAt) / DAY)} days old, ${fmtUsd(m.volume7dUsd)} traded this week`));

  return out;
}

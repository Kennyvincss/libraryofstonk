/**
 * Runner stories — the coins whose launches became moments.
 * Everything in the text is computed from the market's own numbers.
 */
import type { Market, Moment, QuoteAsset } from '../data/types';
import { storyRules as R } from './config';
import { fmtDate, fmtDuration, fmtMultiple, fmtNum, fmtPct, fmtUsd } from '../lib/format';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Aggregators sometimes misprice stock-quoted bonding-curve pools (tens of
 * millions in "market cap" on a few thousand dollars of liquidity). Such caps
 * are never shown or used.
 */
export const mcapReliable = (m: Market) => m.marketCapUsd > 0 && (m.liquidityUsd <= 0 || m.marketCapUsd <= R.maxMcapToLiquidity * m.liquidityUsd);
/** circulating supply implied by the market cap (1B, the launchpad default, otherwise) */
export const supplyOf = (m: Market) => (m.priceUsd > 0 && mcapReliable(m) ? m.marketCapUsd / m.priceUsd : 1e9);
export const peakMcap = (m: Market) => (mcapReliable(m) ? m.athPriceUsd * supplyOf(m) : 0);

const titleName = (m: Market) => {
  const n = m.name.trim();
  return n && n.length <= 28 && n.toUpperCase() !== m.ticker.toUpperCase() ? n : m.ticker.toUpperCase();
};

export function runnerMoments(markets: Market[], quotes: Map<string, QuoteAsset>, now: number): Moment[] {
  // runners are judged on what was actually traded, not on quoted prices
  const cands = markets
    .filter((m) => m.volumeLifetimeUsd >= R.minVolumeUsd && m.traders >= R.minTraders)
    .sort((a, b) => b.volumeLifetimeUsd - a.volumeLifetimeUsd)
    .slice(0, R.maxRunners);
  return cands.map((m) => {
    const q = quotes.get(m.quote);
    const quoteName = q ? q.name.replace(/\s*\(tokenized\)/i, '') : m.quote;
    const peak = peakMcap(m);
    const mult = m.athPriceUsd / Math.max(1e-18, m.launchPriceUsd);
    const tPeak = Math.max(HOUR, m.athAt - m.createdAt);
    const nowMcap = m.marketCapUsd;
    const ran = mult >= R.minPeakMultiple;
    const lines = [
      `${titleName(m)} ($${m.ticker}) launched on StonkFun on ${fmtDate(m.createdAt)}, priced in ${m.quote}${quoteName !== m.quote ? ` (${quoteName})` : ''}.`,
      ran
        ? peak > 0
          ? `It ran to a ${fmtUsd(peak)} peak market cap ${fmtDuration(tPeak)} after launch, ${fmtMultiple(mult)} its starting price.`
          : `It ran ${fmtMultiple(mult)} from its starting price within ${fmtDuration(tPeak)}.`
        : '',
      `${fmtUsd(m.volumeLifetimeUsd)} has traded hands across ${fmtNum(m.traders)}+ traders${m.peakDayVolumeUsd > 0 ? `, ${fmtUsd(m.peakDayVolumeUsd)} of it on its busiest day` : ''}.`,
      m.status === 'dead'
        ? `It went quiet on ${fmtDate(m.lastTradeAt)}.`
        : nowMcap > 0 && peak > 0 && ran
          ? `Today it sits at ${fmtUsd(nowMcap)}, ${fmtPct(nowMcap / peak - 1, 0)} from its peak.`
          : '',
      m.copycats ? `In the ${fmtDuration(Math.max(DAY, (m.copycatsTo ?? m.createdAt) - m.createdAt))} that followed, ${fmtNum(m.copycats)} more tokens launched under the $${m.ticker} name.` : '',
    ].filter(Boolean);
    const copy = m.copycats ?? 0;
    return {
      id: `runner-${m.mint || m.id}`,
      kind: 'runner',
      title: `${titleName(m)} Launches`,
      tagline: peak > 0 && ran
        ? `${titleName(m)} ran to a ${fmtUsd(peak)} peak market cap, ${fmtMultiple(mult)} its launch.`
        : `${fmtUsd(m.volumeLifetimeUsd)} traded by ${fmtNum(m.traders)}+ traders${ran ? `, up to ${fmtMultiple(mult)} from launch` : ''}.`,
      body: lines.join(' '),
      image: m.image,
      start: m.createdAt,
      end: Math.max(m.createdAt + HOUR, Math.min(now, m.athAt)),
      key: m.ticker,
      marketIds: [m.id],
      topMarketId: m.id,
      stats: { marketsCreated: 1 + copy, volumeUsd: m.volumeLifetimeUsd, traders: m.traders, trades: m.trades, intensity: mult },
      confidence: 1,
      status: 'approved',
      origin: 'detected',
      evidence: [`${fmtUsd(m.volumeLifetimeUsd)} lifetime volume`, `${fmtNum(m.traders)} traders`, ...(ran ? [`${fmtMultiple(mult)} from launch`] : []), ...(peak > 0 ? [`peak market cap ${fmtUsd(peak)}`] : [])],
      callout: copy
        ? { label: 'Launched', count: 1 + copy, unit: 'tokens', detail: `across ${Math.max(1, Math.round(((m.copycatsTo ?? m.createdAt) - m.createdAt) / DAY) + 1)} days`, from: m.createdAt, to: m.copycatsTo ?? m.createdAt }
        : { label: 'Traded', count: m.traders, unit: 'traders', detail: `moved ${fmtUsd(m.volumeLifetimeUsd)}`, from: m.createdAt, to: m.lastTradeAt },
    } satisfies Moment;
  });
}

import type { PoolRecord } from './gecko';

/**
 * What counts as a StonkFun market, and the platform's documented dates.
 *
 * GeckoTerminal indexes StonkFun's own bonding curve as the `stonkfun` dex.
 * From Sept 6, 2026 new StonkFun deployments launch through Raydium
 * LaunchLab (stock-quoted). A token is a StonkFun market when any of its
 * pools matches; its graduated AMM pools are then merged into it.
 */
export const STONKFUN = {
  /** STONK, the platform token, deployed (quoted in SPYx) */
  stonkDeployed: Date.UTC(2026, 6, 23),
  /** StonkFun officially launched */
  launch: Date.UTC(2026, 7, 3),
  /** new deployments moved to Raydium LaunchLab */
  launchlab: Date.UTC(2026, 8, 6),
  dexIds: ['stonkfun'],
  launchlabDexIds: ['raydium-launchlab'],
  platformTokenSymbol: 'STONK',
} as const;

const DAY = 86_400_000;

export function isStonkFunPool(p: PoolRecord, stockQuotes: Set<string>): boolean {
  if (STONKFUN.dexIds.includes(p.dexId as 'stonkfun')) return true;
  if (STONKFUN.launchlabDexIds.includes(p.dexId as 'raydium-launchlab') && stockQuotes.has(p.quote) && p.createdAt >= STONKFUN.launchlab - DAY) return true;
  // the platform token itself
  if (p.symbol.toUpperCase() === STONKFUN.platformTokenSymbol && stockQuotes.has(p.quote) && p.createdAt >= STONKFUN.stonkDeployed - DAY) return true;
  return false;
}

/** Token mints that have at least one StonkFun pool. */
export function stonkFunMints(pools: PoolRecord[], stockQuotes: Set<string>): Set<string> {
  const s = new Set<string>();
  for (const p of pools) if (isStonkFunPool(p, stockQuotes)) s.add(p.mint);
  return s;
}

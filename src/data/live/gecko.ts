/**
 * GeckoTerminal public API (https://www.geckoterminal.com/dex-api) — shared by
 * the browser (live charts, trades, live feed) and the indexer (archive build).
 *
 * Free tier: ~30 requests/minute per IP, no key. All parsing is defensive:
 * unknown/missing fields degrade to undefined instead of throwing.
 */

export const GECKO_API = 'https://api.geckoterminal.com/api/v2';
export const NETWORK = 'solana';

// ── raw response shapes (only the fields we use) ────────────────────────────
export interface GtRel {
  data?: { id?: string; type?: string } | null;
}
export interface GtPool {
  id: string;
  type: 'pool';
  attributes: {
    address: string;
    name?: string;
    pool_created_at?: string | null;
    base_token_price_usd?: string | null;
    quote_token_price_usd?: string | null;
    base_token_price_quote_token?: string | null;
    quote_token_price_base_token?: string | null;
    fdv_usd?: string | null;
    market_cap_usd?: string | null;
    reserve_in_usd?: string | null;
    price_change_percentage?: Record<string, string | null> | null;
    transactions?: Record<string, { buys?: number; sells?: number; buyers?: number | null; sellers?: number | null } | null> | null;
    volume_usd?: Record<string, string | null> | null;
  };
  relationships?: { base_token?: GtRel; quote_token?: GtRel; dex?: GtRel };
}
export interface GtToken {
  id: string;
  type: 'token';
  attributes: { address: string; name?: string; symbol?: string; image_url?: string | null; price_usd?: string | null };
}
export interface GtList<T> {
  data?: T[];
  included?: (GtToken | { id: string; type: string; attributes?: unknown })[];
}

export const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** "solana_ABC…" → "ABC…" */
export const addrOf = (rel?: GtRel): string | undefined => {
  const id = rel?.data?.id;
  if (!id) return undefined;
  const i = id.indexOf('_');
  return i >= 0 ? id.slice(i + 1) : id;
};

export const dexOf = (rel?: GtRel): string | undefined => rel?.data?.id ?? undefined;

export function tokenMap(included: GtList<unknown>['included']): Map<string, GtToken['attributes']> {
  const m = new Map<string, GtToken['attributes']>();
  for (const inc of included ?? []) {
    if (inc.type === 'token' && inc.attributes) {
      const a = inc.attributes as GtToken['attributes'];
      if (a.address) m.set(a.address, a);
    }
  }
  return m;
}

export function cleanImage(url?: string | null): string | undefined {
  if (!url || /missing/i.test(url)) return undefined;
  return url;
}

// ── normalised pool record ───────────────────────────────────────────────────
export interface QuoteRef {
  symbol: string;
  mint: string;
}

/**
 * A StonkFun-style market: a token traded against a tokenized-stock quote.
 * `swapped` = GeckoTerminal lists the stock as the base side.
 */
export interface PoolRecord {
  address: string;
  dexId?: string;
  createdAt: number;
  mint: string; // the launched token
  symbol: string;
  name: string;
  image?: string;
  quote: string; // quote symbol, e.g. NVDAx
  quoteMint: string;
  swapped: boolean;
  priceUsd?: number;
  priceQuote?: number;
  change24h?: number;
  fdvUsd?: number;
  mcapUsd?: number;
  reserveUsd?: number;
  vol24?: number;
  tx24?: number;
  buyers24?: number;
  sellers24?: number;
  observedAt: number;
}

/**
 * Turn a GeckoTerminal pool into a market record, or null when it is not a
 * token-vs-tokenized-stock pool (e.g. NVDAx/USDC, or two stocks).
 */
export function poolToRecord(
  p: GtPool,
  tokens: Map<string, GtToken['attributes']>,
  stockQuotes: Map<string, QuoteRef>,
  excluded: Set<string>,
  now: number,
  /** crypto quotes (SOL, USDC) — only accepted for pools on these dexes */
  crypto?: { quotes: Map<string, QuoteRef>; dexIds: readonly string[] },
): PoolRecord | null {
  const a = p.attributes;
  const baseMint = addrOf(p.relationships?.base_token);
  const quoteMint = addrOf(p.relationships?.quote_token);
  if (!a?.address || !baseMint || !quoteMint) return null;
  const dex = dexOf(p.relationships?.dex);
  const quotes = crypto && dex && crypto.dexIds.includes(dex) && !stockQuotes.has(baseMint) && !stockQuotes.has(quoteMint) ? crypto.quotes : stockQuotes;
  const baseIsStock = quotes.has(baseMint);
  const quoteIsStock = quotes.has(quoteMint);
  if (baseIsStock === quoteIsStock) return null;
  const swapped = baseIsStock;
  const tokenMint = swapped ? quoteMint : baseMint;
  const stock = quotes.get(swapped ? baseMint : quoteMint)!;
  if (excluded.has(tokenMint) || stockQuotes.has(tokenMint)) return null;

  const tok = tokens.get(tokenMint);
  const [nameBase, nameQuote] = (a.name ?? '').split(' / ');
  const symbol = (tok?.symbol ?? (swapped ? nameQuote : nameBase) ?? '').trim() || tokenMint.slice(0, 5);
  const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;

  const h24 = a.transactions?.h24 ?? undefined;
  const basePx = num(a.base_token_price_usd);
  const quotePx = num(a.quote_token_price_usd);
  const baseInQuote = num(a.base_token_price_quote_token);
  const quoteInBase = num(a.quote_token_price_base_token);
  return {
    address: a.address,
    dexId: dex,
    createdAt: Number.isFinite(created) ? created : now,
    mint: tokenMint,
    symbol,
    name: (tok?.name ?? symbol).trim(),
    image: cleanImage(tok?.image_url),
    quote: stock.symbol,
    quoteMint: stock.mint,
    swapped,
    priceUsd: swapped ? quotePx : basePx,
    priceQuote: swapped ? quoteInBase : baseInQuote,
    // GeckoTerminal's change is for the base token; only trust it when the base is our token
    change24h: !swapped && num(a.price_change_percentage?.h24) !== undefined ? num(a.price_change_percentage?.h24)! / 100 : undefined,
    fdvUsd: num(a.fdv_usd),
    mcapUsd: num(a.market_cap_usd),
    reserveUsd: num(a.reserve_in_usd),
    vol24: num(a.volume_usd?.h24),
    tx24: h24 ? (h24.buys ?? 0) + (h24.sells ?? 0) : undefined,
    buyers24: h24?.buyers ?? undefined,
    sellers24: h24?.sellers ?? undefined,
    observedAt: now,
  };
}

/** OHLCV list → ascending [tMs, o, h, l, c, vUsd]. */
export type Ohlcv = [number, number, number, number, number, number];
export function parseOhlcv(json: unknown): Ohlcv[] {
  const list = (json as { data?: { attributes?: { ohlcv_list?: unknown[] } } })?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const out: Ohlcv[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const r = row.map(Number);
    if (r.some((x) => !Number.isFinite(x))) continue;
    out.push([r[0] * 1000, r[1], r[2], r[3], r[4], r[5]]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

export interface GtTrade {
  attributes: {
    block_timestamp?: string;
    tx_hash?: string;
    tx_from_address?: string;
    kind?: 'buy' | 'sell';
    volume_in_usd?: string;
    price_from_in_usd?: string;
    price_to_in_usd?: string;
    from_token_address?: string;
    to_token_address?: string;
  };
}

/** Pool trades → our Trade shape, from the launched token's point of view. */
export function parseTrades(json: unknown, tokenMint: string) {
  const data = (json as { data?: GtTrade[] })?.data ?? [];
  return data
    .map((t) => {
      const a = t.attributes ?? {};
      const buy = a.to_token_address ? a.to_token_address === tokenMint : a.kind === 'buy';
      const price = buy ? num(a.price_to_in_usd) : num(a.price_from_in_usd);
      return {
        t: a.block_timestamp ? Date.parse(a.block_timestamp) : 0,
        side: buy ? ('buy' as const) : ('sell' as const),
        usd: num(a.volume_in_usd) ?? 0,
        priceUsd: price ?? 0,
        wallet: a.tx_from_address ?? '',
        signature: a.tx_hash ?? '',
      };
    })
    .filter((t) => t.t > 0 && t.signature);
}

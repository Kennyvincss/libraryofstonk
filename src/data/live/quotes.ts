import type { QuoteAsset, QuoteKind } from '../types';

/**
 * Tokenized assets StonkFun markets can be quoted in.
 *
 * `mint` values are hints only: the indexer verifies each one against
 * GeckoTerminal (symbol must match) and otherwise resolves the symbol by
 * search, preferring xStocks' "Xs…" vanity mints and the most liquid token.
 * Add a symbol here to start tracking markets quoted in it.
 */
export interface QuoteSpec {
  symbol: string;
  name: string;
  underlying: string;
  kind: QuoteKind;
  hue: number;
  mint?: string;
}

export const QUOTE_SPECS: QuoteSpec[] = [
  { symbol: 'SPYx', name: 'S&P 500 ETF (tokenized)', underlying: 'SPY', kind: 'etf', hue: 145, mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W' },
  { symbol: 'NVDAx', name: 'NVIDIA (tokenized)', underlying: 'NVDA', kind: 'xstock', hue: 95, mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh' },
  { symbol: 'TSLAx', name: 'Tesla (tokenized)', underlying: 'TSLA', kind: 'xstock', hue: 352, mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB' },
  { symbol: 'QQQx', name: 'Nasdaq-100 ETF (tokenized)', underlying: 'QQQ', kind: 'etf', hue: 200, mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ' },
  { symbol: 'AAPLx', name: 'Apple (tokenized)', underlying: 'AAPL', kind: 'xstock', hue: 220, mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp' },
  { symbol: 'MSTRx', name: 'Strategy (tokenized)', underlying: 'MSTR', kind: 'xstock', hue: 30, mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ' },
  { symbol: 'COINx', name: 'Coinbase (tokenized)', underlying: 'COIN', kind: 'xstock', hue: 210, mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu' },
  { symbol: 'GOOGLx', name: 'Alphabet (tokenized)', underlying: 'GOOGL', kind: 'xstock', hue: 48, mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN' },
  { symbol: 'METAx', name: 'Meta (tokenized)', underlying: 'META', kind: 'xstock', hue: 232, mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu' },
  { symbol: 'AMZNx', name: 'Amazon (tokenized)', underlying: 'AMZN', kind: 'xstock', hue: 36, mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg' },
  { symbol: 'HOODx', name: 'Robinhood (tokenized)', underlying: 'HOOD', kind: 'xstock', hue: 75, mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg' },
  { symbol: 'CRCLx', name: 'Circle (tokenized)', underlying: 'CRCL', kind: 'xstock', hue: 180, mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1' },
  { symbol: 'MSFTx', name: 'Microsoft (tokenized)', underlying: 'MSFT', kind: 'xstock', hue: 190 },
  { symbol: 'PLTRx', name: 'Palantir (tokenized)', underlying: 'PLTR', kind: 'xstock', hue: 0 },
  { symbol: 'AMDx', name: 'AMD (tokenized)', underlying: 'AMD', kind: 'xstock', hue: 12 },
  { symbol: 'NFLXx', name: 'Netflix (tokenized)', underlying: 'NFLX', kind: 'xstock', hue: 358 },
  { symbol: 'GMEx', name: 'GameStop (tokenized)', underlying: 'GME', kind: 'xstock', hue: 300 },
  { symbol: 'MCDx', name: "McDonald's (tokenized)", underlying: 'MCD', kind: 'xstock', hue: 44 },
  { symbol: 'GLDx', name: 'Gold ETF (tokenized)', underlying: 'GLD', kind: 'etf', hue: 50 },
  { symbol: 'TQQQx', name: 'ProShares UltraPro QQQ (tokenized)', underlying: 'TQQQ', kind: 'etf', hue: 260 },
  { symbol: 'AVGOx', name: 'Broadcom (tokenized)', underlying: 'AVGO', kind: 'xstock', hue: 330 },
  { symbol: 'ORCLx', name: 'Oracle (tokenized)', underlying: 'ORCL', kind: 'xstock', hue: 8 },
  { symbol: 'JPMx', name: 'JPMorgan (tokenized)', underlying: 'JPM', kind: 'xstock', hue: 215 },
];

/** Crypto quotes StonkFun also supports — only accepted for StonkFun's own pools. */
export const CRYPTO_QUOTE_SPECS: QuoteSpec[] = [
  { symbol: 'SOL', name: 'Solana', underlying: 'SOL', kind: 'crypto', hue: 275, mint: 'So11111111111111111111111111111111111111112' },
  { symbol: 'USDC', name: 'USD Coin', underlying: 'USD', kind: 'stable', hue: 190, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
];

/** Tokens that are never "launched markets" even if paired with a stock. */
export const EXCLUDED_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

export function specToQuote(s: QuoteSpec, mint: string, priceUsd: number): QuoteAsset {
  return { symbol: s.symbol, name: s.name, kind: s.kind, underlying: s.underlying, mint, priceUsd, hue: s.hue };
}

import type { QuoteAsset } from '../types';
import type { Rng } from './rng';

/**
 * Demo catalog: quote assets and naming vocabularies for the simulation.
 * Quote prices here are rough placeholders for the demo only.
 */
export const DEMO_QUOTES: (QuoteAsset & { weight: number })[] = [
  { symbol: 'SPYx', name: 'S&P 500 ETF (tokenized)', kind: 'etf', underlying: 'SPY', priceUsd: 668, hue: 145, weight: 20 },
  { symbol: 'NVDAx', name: 'NVIDIA (tokenized)', kind: 'xstock', underlying: 'NVDA', priceUsd: 187, hue: 95, weight: 15 },
  { symbol: 'TSLAx', name: 'Tesla (tokenized)', kind: 'xstock', underlying: 'TSLA', priceUsd: 436, hue: 352, weight: 11 },
  { symbol: 'QQQx', name: 'Nasdaq-100 ETF (tokenized)', kind: 'etf', underlying: 'QQQ', priceUsd: 602, hue: 200, weight: 8 },
  { symbol: 'SOL', name: 'Solana', kind: 'crypto', underlying: 'SOL', priceUsd: 214, hue: 275, weight: 8 },
  { symbol: 'AAPLx', name: 'Apple (tokenized)', kind: 'xstock', underlying: 'AAPL', priceUsd: 255, hue: 220, weight: 6 },
  { symbol: 'MSTRx', name: 'Strategy (tokenized)', kind: 'xstock', underlying: 'MSTR', priceUsd: 331, hue: 30, weight: 6 },
  { symbol: 'COINx', name: 'Coinbase (tokenized)', kind: 'xstock', underlying: 'COIN', priceUsd: 338, hue: 210, weight: 5 },
  { symbol: 'GOOGLx', name: 'Alphabet (tokenized)', kind: 'xstock', underlying: 'GOOGL', priceUsd: 245, hue: 48, weight: 4 },
  { symbol: 'METAx', name: 'Meta (tokenized)', kind: 'xstock', underlying: 'META', priceUsd: 727, hue: 232, weight: 4 },
  { symbol: 'AMZNx', name: 'Amazon (tokenized)', kind: 'xstock', underlying: 'AMZN', priceUsd: 220, hue: 36, weight: 4 },
  { symbol: 'HOODx', name: 'Robinhood (tokenized)', kind: 'xstock', underlying: 'HOOD', priceUsd: 143, hue: 75, weight: 4 },
  { symbol: 'USDC', name: 'USD Coin', kind: 'stable', underlying: 'USD', priceUsd: 1, hue: 190, weight: 3 },
  { symbol: 'CRCLx', name: 'Circle (tokenized)', kind: 'xstock', underlying: 'CRCL', priceUsd: 136, hue: 180, weight: 2 },
  { symbol: 'PLTRx', name: 'Palantir (tokenized)', kind: 'xstock', underlying: 'PLTR', priceUsd: 182, hue: 0, weight: 2 },
  { symbol: 'GLDx', name: 'Gold ETF (tokenized)', kind: 'etf', underlying: 'GLD', priceUsd: 355, hue: 44, weight: 0.6 },
  { symbol: 'MCDx', name: "McDonald's (tokenized)", kind: 'xstock', underlying: 'MCD', priceUsd: 305, hue: 12, weight: 0.35 },
];

export interface Theme {
  key: string;
  /** quote symbols this narrative gravitates to */
  quotes: string[];
  names: string[];
  blurbs: string[];
}

/**
 * Narrative vocabularies. Every name inside a theme carries the theme key so
 * the moment detector can find clusters purely from market names.
 */
export const THEMES: Theme[] = [
  { key: 'gpu', quotes: ['NVDAx'], names: ['GPU Goblin', 'GPU Daddy', 'GPU Rich', 'GPU Poor', 'GPU Cartel', 'GPU Farm', 'GPU Wizard', 'Melted GPU', 'GPU Hoarder', 'GPU Monk'], blurbs: ['more compute, more problems', 'we print GPUs now', 'every frame a candle'] },
  { key: 'ai', quotes: ['NVDAx', 'GOOGLx', 'METAx'], names: ['Sentient AI', 'Feral AI', 'AI Intern', 'AI Overlord', 'Lazy AI', 'AI Cult', 'Tiny AI', 'AI Landlord', 'Rogue AI', 'AI Therapist'], blurbs: ['the model is the market', 'agents trading agents', 'it learned to pump'] },
  { key: 'robotaxi', quotes: ['TSLAx'], names: ['Robotaxi Uncle', 'Robotaxi Dreams', 'Robotaxi Crash', 'Robotaxi Rider', 'Robotaxi Cult', 'Robotaxi Fleet'], blurbs: ['no driver, no brakes', 'next year, for sure'] },
  { key: 'earnings', quotes: ['AAPLx', 'NVDAx', 'METAx', 'AMZNx', 'GOOGLx'], names: ['Earnings Beat', 'Earnings Gamble', 'Earnings Szn', 'Earnings Whisper', 'Earnings Copium', 'Earnings Miss'], blurbs: ['after hours is the real hours', 'guidance raised, vibes raised'] },
  { key: 'split', quotes: ['NVDAx', 'TSLAx', 'AAPLx'], names: ['Stock Split Frog', 'Split Season', 'Split Maxi', 'Split Happens', 'Ten For One Split'], blurbs: ['cheaper shares, same delusion', 'slice it thinner'] },
  { key: 'treasury', quotes: ['MSTRx', 'COINx'], names: ['Treasury Ape', 'Treasury Maxi', 'Treasury Wizard', 'Corporate Treasury', 'Treasury Degen'], blurbs: ['the balance sheet is the meme', 'buy, borrow, buy again'] },
  { key: 'rate', quotes: ['SPYx', 'QQQx', 'USDC'], names: ['Rate Cut Copium', 'Rate Pivot', 'Rate Cut Frog', 'Rate Hike Ghost', 'Rate Cut Szn'], blurbs: ['the dot plot is a meme', 'priced in, probably'] },
  { key: 'mag7', quotes: ['QQQx', 'SPYx'], names: ['Mag7 Cult', 'Mag7 Index', 'Mag7 Maxi', 'Mag7 Bag', 'Mag7 Orphan'], blurbs: ['seven stocks, one market', 'concentration risk is a lifestyle'] },
  { key: 'quantum', quotes: ['QQQx', 'GOOGLx'], names: ['Quantum Cat', 'Quantum Leap', 'Quantum Chad', 'Quantum Frog', 'Quantum Supremacy'], blurbs: ['both pumping and dumping until observed'] },
  { key: 'frog', quotes: ['SOL', 'SPYx'], names: ['Frog Capital', 'Frog King', 'Frog Pond', 'Frog Index', 'Frog Fund', 'Frog Desk'], blurbs: ['ribbit-adjusted returns', 'the pond is the market'] },
  { key: 'cat', quotes: ['SPYx', 'SOL', 'QQQx'], names: ['Cat Index', 'Cat Fund', 'Cat Desk', 'Cat Capital', 'Index Cat', 'Cat ETF'], blurbs: ['passive income, passive cat', 'nine lives, zero stops'] },
  { key: 'moon', quotes: ['SOL', 'TSLAx', 'SPYx'], names: ['Moon Shot', 'Moon Base', 'Moon Mission', 'Moon Desk', 'Moon Index'], blurbs: ['up only (citation needed)'] },
  { key: 'stablecoin', quotes: ['CRCLx', 'COINx', 'USDC'], names: ['Stablecoin Summer', 'Stablecoin Bill', 'Stablecoin Maxi', 'Stablecoin Frog'], blurbs: ['one dollar, many memes'] },
  { key: 'gold', quotes: ['GLDx', 'SPYx'], names: ['Gold Bug', 'Gold Rush', 'Gold Brick', 'Digital Gold Ape'], blurbs: ['shiny rock, shinier token'] },
  { key: 'burger', quotes: ['MCDx'], names: ['Burger Index', 'Burger Flip', 'Burger Desk', 'Burger Capital'], blurbs: ['would you like fries with that bag'] },
  { key: 'retail', quotes: ['HOODx', 'SPYx'], names: ['Retail Army', 'Retail Revenge', 'Retail Flow', 'Retail Cult'], blurbs: ['the house is the users now'] },
];

const SYL_A = ['Blo', 'Zin', 'Mor', 'Kra', 'Plu', 'Sno', 'Wub', 'Gli', 'Tro', 'Fen', 'Qua', 'Dro', 'Vex', 'Lum', 'Pog', 'Yel', 'Bon', 'Cru', 'Nib', 'Ska', 'Hon', 'Jib', 'Mek', 'Ras'];
const SYL_B = ['rp', 'kle', 'dle', 'zo', 'mp', 'nk', 'bby', 'tch', 'ggo', 'rf', 'ndo', 'x', 'lly', 'mbo', 'pi', 'zz', 'go', 'ra', 'ffy', 'ck'];
const WORDS = ['Index', 'Desk', 'Capital', 'Bag', 'Club', 'Coin', 'Ape', 'Chad', 'Wojak', 'Gremlin', 'Bull', 'Bear', 'Candle', 'Liquidity', 'Bagholder', 'Fund', 'Dividend', 'Options', 'Margin', 'Squeeze', 'Ticker', 'Bell', 'Floor', 'Pit'];
const GENERIC_BLURBS = ['community takeover pending', 'just vibes', 'not financial advice', 'buy the rumor', 'a coin about a coin', 'stonks only go one way', 'deployed at 3am', 'the chart is the art'];

export function genericName(r: Rng): string {
  const coin = r.pick(SYL_A) + r.pick(SYL_B);
  if (r.chance(0.45)) return coin;
  return r.chance(0.5) ? `${coin} ${r.pick(WORDS)}` : `${r.pick(WORDS)} ${coin}`;
}

export function genericBlurb(r: Rng): string {
  return r.pick(GENERIC_BLURBS);
}

export function tickerFor(name: string, r: Rng): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
  let t: string;
  if (words.length === 1) t = words[0].slice(0, Math.min(6, words[0].length));
  else if (r.chance(0.5)) t = words.map((w) => w[0]).join('') + words[words.length - 1].slice(1, 3);
  else t = words[0].slice(0, 3) + words[words.length - 1].slice(0, 3);
  return t.slice(0, 7);
}

import { describe, expect, test } from 'vitest';
import { parseOhlcv, parseTrades, poolToRecord, tokenMap, type GtList, type GtPool } from '../src/data/live/gecko';
import { EXCLUDED_MINTS } from '../src/data/live/quotes';
import { buildArchive } from './build';
import { Archive } from '../src/engine/archive';

const NVDAX = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const TOK = 'TokenMint1111111111111111111111111111111111';
const NOW = Date.parse('2026-10-03T12:00:00Z');
const quotes = new Map([[NVDAX, { symbol: 'NVDAx', mint: NVDAX }]]);

// shaped like GET /networks/solana/tokens/{mint}/pools?include=base_token,quote_token,dex
const page: GtList<GtPool> = {
  data: [
    {
      id: 'solana_PoolA',
      type: 'pool',
      attributes: {
        address: 'PoolA',
        name: 'GPUG / NVDAx',
        pool_created_at: '2026-09-01T10:00:00Z',
        base_token_price_usd: '0.0000421',
        quote_token_price_usd: '187.2',
        base_token_price_quote_token: '0.000000225',
        fdv_usd: '42100',
        market_cap_usd: null,
        reserve_in_usd: '15000.5',
        price_change_percentage: { h24: '12.5' },
        transactions: { h24: { buys: 300, sells: 200, buyers: 120, sellers: 90 } },
        volume_usd: { h24: '88000' },
      },
      relationships: { base_token: { data: { id: `solana_${TOK}`, type: 'token' } }, quote_token: { data: { id: `solana_${NVDAX}`, type: 'token' } }, dex: { data: { id: 'stonkfun', type: 'dex' } } },
    },
    {
      // NVDAx/USDC — a stock/stable pool, not a launched market
      id: 'solana_PoolB',
      type: 'pool',
      attributes: { address: 'PoolB', name: 'NVDAx / USDC' },
      relationships: { base_token: { data: { id: `solana_${NVDAX}` } }, quote_token: { data: { id: 'solana_EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } } },
    },
    {
      // reversed: the stock is listed as base
      id: 'solana_PoolC',
      type: 'pool',
      attributes: { address: 'PoolC', name: 'NVDAx / FROG', pool_created_at: '2026-09-10T00:00:00Z', base_token_price_usd: '187', quote_token_price_usd: '0.002', quote_token_price_base_token: '0.0000107', volume_usd: { h24: '0' } },
      relationships: { base_token: { data: { id: `solana_${NVDAX}` } }, quote_token: { data: { id: 'solana_FrogMint' } }, dex: { data: { id: 'stonkfun' } } },
    },
  ],
  included: [
    { id: `solana_${TOK}`, type: 'token', attributes: { address: TOK, name: 'GPU Goblin', symbol: 'GPUG', image_url: 'https://img/x.png' } },
    { id: 'solana_FrogMint', type: 'token', attributes: { address: 'FrogMint', name: 'Frog Desk', symbol: 'FROG', image_url: 'missing.png' } },
  ],
};

describe('GeckoTerminal parsing', () => {
  const toks = tokenMap(page.included);
  const recs = page.data!.map((p) => poolToRecord(p, toks, quotes, EXCLUDED_MINTS, NOW));

  test('keeps token-vs-stock pools and drops stock/stable pools', () => {
    expect(recs[0]).toMatchObject({ address: 'PoolA', symbol: 'GPUG', name: 'GPU Goblin', quote: 'NVDAx', mint: TOK, swapped: false, dexId: 'stonkfun', vol24: 88000, tx24: 500, buyers24: 120 });
    expect(recs[0]!.change24h).toBeCloseTo(0.125);
    expect(recs[0]!.image).toBe('https://img/x.png');
    expect(recs[1]).toBeNull();
  });

  test('handles pools where the stock is listed as base', () => {
    expect(recs[2]).toMatchObject({ address: 'PoolC', mint: 'FrogMint', symbol: 'FROG', swapped: true, priceUsd: 0.002, image: undefined });
    expect(recs[2]!.change24h).toBeUndefined();
  });

  test('parses OHLCV (newest-first, seconds) into ascending ms', () => {
    const ohlcv = parseOhlcv({ data: { attributes: { ohlcv_list: [[1790000000, 2, 3, 1, 2.5, 100], [1789913600, 1, 2, 0.5, 2, 50], ['bad']] } } });
    expect(ohlcv).toEqual([[1789913600000, 1, 2, 0.5, 2, 50], [1790000000000, 2, 3, 1, 2.5, 100]]);
  });

  test('parses trades from the launched token’s side', () => {
    const tr = parseTrades({ data: [{ attributes: { block_timestamp: '2026-10-03T11:00:00Z', tx_hash: 'sig1', tx_from_address: 'W1', kind: 'buy', volume_in_usd: '42.5', price_to_in_usd: '0.00004', to_token_address: TOK } }] }, TOK);
    expect(tr[0]).toMatchObject({ side: 'buy', usd: 42.5, priceUsd: 0.00004, wallet: 'W1', signature: 'sig1' });
  });
});

describe('archive build', () => {
  const toks = tokenMap(page.included);
  const recs = page.data!.map((p) => poolToRecord(p, toks, quotes, EXCLUDED_MINTS, NOW)).filter(Boolean) as NonNullable<ReturnType<typeof poolToRecord>>[];
  const day = (iso: string) => Date.parse(iso);
  const bars = new Map([
    ['PoolA', [[day('2026-09-01'), 0.000005, 0.00009, 0.000005, 0.00006, 400000], [day('2026-09-02'), 0.00006, 0.00007, 0.00002, 0.00003, 120000], [day('2026-10-03'), 0.00003, 0.00005, 0.00003, 0.0000421, 88000]] as [number, number, number, number, number, number][]],
  ]);
  const tracked = { PoolA: { [String(day('2026-10-03'))]: { traders: 120, trades: 500 } } };
  const built = buildArchive(recs, bars, tracked, [{ symbol: 'NVDAx', name: 'NVIDIA', kind: 'xstock', underlying: 'NVDA', mint: NVDAX, priceUsd: 187, hue: 95 }], NOW);

  test('derives lifetime metrics from history', () => {
    const a = built.markets.find((m) => m.id === 'PoolA')!;
    expect(a.volumeLifetimeUsd).toBe(608000);
    expect(a.athPriceUsd).toBe(0.00009);
    expect(a.launchPriceUsd).toBe(0.000005);
    expect(a.peakDayVolumeUsd).toBe(400000);
    expect(a.status).toBe('bonding');
    expect(a.traders).toBe(120);
    expect(a.marketCapUsd).toBe(42100);
  });

  test('marks silent markets dead and builds ecosystem + activity', () => {
    expect(built.markets.find((m) => m.id === 'PoolC')!.status).toBe('dead');
    // the archive starts when STONK was deployed (July 23, 2026)
    expect(built.meta.archiveStart).toBe(day('2026-07-23'));
    const sep1 = built.ecosystem.findIndex((e) => e.t === day('2026-09-01'));
    expect(built.ecosystem[sep1].volumeUsd).toBe(400000);
    expect(built.ecosystem[sep1].marketsCreated).toBe(1);
    expect(built.activity.rows.PoolA[0]).toBe(sep1);
    expect(built.activity.rows.PoolA.length).toBe(1 + 33);
  });

  test('merges a token’s pools (bonding curve + graduated AMM) into one market', () => {
    const second = { ...recs[0], address: 'PoolA2', dexId: 'raydium', vol24: 12000, reserveUsd: 100, tx24: 50 };
    const b = buildArchive([recs[0], second], new Map(), {}, [], NOW);
    expect(b.markets.length).toBe(1);
    expect(b.markets[0].id).toBe('PoolA');
    expect(b.markets[0].volume24hUsd).toBe(100000);
    expect(b.markets[0].trades24h).toBe(550);
  });

  test('only StonkFun markets are kept', () => {
    const pump = { ...recs[0], address: 'PumpPool', mint: 'PumpMint', symbol: 'PUMPY', dexId: 'pump-fun' };
    const early = { ...recs[0], address: 'OldLaunchlab', mint: 'OldMint', dexId: 'raydium-launchlab', createdAt: day('2026-08-20') };
    const lateLL = { ...recs[0], address: 'NewLaunchlab', mint: 'NewMint', dexId: 'raydium-launchlab', createdAt: day('2026-09-10') };
    const stonk = { ...recs[0], address: 'StonkPool', mint: 'StonkMint', symbol: 'STONK', dexId: 'raydium-clmm', createdAt: day('2026-07-23') };
    const old = { ...recs[0], address: 'OldPool', mint: 'OldMint2', dexId: 'stonkfun', createdAt: day('2025-10-21') };
    const ids = buildArchive([recs[0], pump, early, lateLL, stonk, old], new Map(), {}, [{ symbol: 'NVDAx', name: 'NVIDIA', kind: 'xstock', underlying: 'NVDA', mint: NVDAX, priceUsd: 187, hue: 95 }], NOW).markets.map((m) => m.id).sort();
    expect(ids).toEqual(['NewLaunchlab', 'PoolA', 'StonkPool']);
  });

  test('the site engine accepts the built dataset', () => {
    const a = new Archive(built.meta, built.markets, built.ecosystem);
    expect(a.markets.length).toBe(2);
    expect(a.search('gpug').markets[0].id).toBe('PoolA');
  });
});

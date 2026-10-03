import { afterEach, describe, expect, test, vi } from 'vitest';
import { b58decode, b58encode, enumeratePools, learnLayouts } from './helius';

const MINT = (n: number) => b58encode(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + n * 13 + 1) % 256));
const STOCK = MINT(99);
const PROGRAM = 'StonkProgram11111111111111111111111111111111';

const STONK_PLATFORM = MINT(50);
const OTHER_PLATFORM = MINT(51);

/** fake pool account: base mint @40, quote mint @104, platform marker @140 */
function account(base: string, quote: string, platform = STONK_PLATFORM) {
  const d = new Uint8Array(200);
  d.set(b58decode(base), 40);
  d.set(b58decode(quote), 104);
  d.set(b58decode(platform), 140);
  return Buffer.from(d).toString('base64');
}

afterEach(() => vi.unstubAllGlobals());

describe('helius', () => {
  test('base58 round-trips', () => {
    const m = MINT(3);
    expect(b58encode(b58decode(m))).toBe(m);
    expect(b58decode('So11111111111111111111111111111111111111112').length).toBe(32);
  });

  test('learns a pool layout from known pools and enumerates the program', async () => {
    process.env.HELIUS_API_KEY = 'test';
    const pools = [1, 2, 3].map((n) => ({ address: `Pool${n}`, mint: MINT(n), quoteMint: STOCK }));
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body);
      if (req.method === 'getMultipleAccounts')
        return new Response(JSON.stringify({ result: { value: req.params[0].map((addr: string) => {
          const p = pools.find((x) => x.address === addr);
          return p ? { owner: PROGRAM, data: [account(p.mint, p.quoteMint), 'base64'] } : null;
        }) } }));
      if (req.method === 'getProgramAccounts') {
        const { offset, length } = req.params[1].dataSlice;
        const all = [4, 5].map((n) => ({ pubkey: `Chain${n}`, account: { owner: PROGRAM, data: [Buffer.from(Buffer.from(account(MINT(n), STOCK), 'base64').subarray(offset, offset + length)).toString('base64'), 'base64'] } }));
        return new Response(JSON.stringify({ result: all }));
      }
      return new Response(JSON.stringify({ error: { message: 'unexpected ' + req.method } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const [layout] = await learnLayouts(pools, []);
    expect(layout).toMatchObject({ program: PROGRAM, kind: 'stonkfun', dataSize: 200, baseOff: 40, quoteOff: 104, shared: false });
    const found = await enumeratePools(layout);
    expect(found).toEqual([
      { address: 'Chain4', program: 'stonkfun', baseMint: MINT(4), quoteMint: STOCK },
      { address: 'Chain5', program: 'stonkfun', baseMint: MINT(5), quoteMint: STOCK },
    ]);
    const gpa = JSON.parse(fetchMock.mock.calls.find((c) => JSON.parse(c[1].body).method === 'getProgramAccounts')![1].body);
    expect(gpa.params[1].filters).toEqual([{ dataSize: 200 }]);
    });

  test('on a shared launch program, finds the StonkFun platform marker and never enumerates unfiltered', async () => {
    process.env.HELIUS_API_KEY = 'test';
    const pos = [1, 2, 3, 4].map((n) => ({ address: `Sf${n}`, mint: MINT(n), quoteMint: STOCK }));
    const neg = [5, 6, 7].map((n) => ({ address: `Bonk${n}`, mint: MINT(n), quoteMint: MINT(98) }));
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      const req = JSON.parse(init.body);
      return new Response(JSON.stringify({ result: { value: req.params[0].map((addr: string) => {
        const p = pos.find((x) => x.address === addr);
        if (p) return { owner: PROGRAM, data: [account(p.mint, p.quoteMint, STONK_PLATFORM), 'base64'] };
        const q = neg.find((x) => x.address === addr)!;
        return { owner: PROGRAM, data: [account(q.mint, q.quoteMint, OTHER_PLATFORM), 'base64'] };
      }) } }));
    }));
    const [layout] = await learnLayouts(pos, neg.map((n) => n.address));
    expect(layout.shared).toBe(true);
    expect(layout.platform).toEqual({ offset: 140, values: [STONK_PLATFORM] });
    await expect(enumeratePools(layout)).rejects.toThrow(/shared/);
  });
});

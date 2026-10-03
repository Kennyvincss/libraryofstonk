# Data architecture

The archive UI never talks to a blockchain, an RPC node or a third-party API directly. Everything flows through one interface, `DataSource` (`src/data/source.ts`). Swapping the demo simulation for real StonkFun data means implementing that interface (or pointing the bundled `HttpSource` at an indexer that speaks the REST contract below). The UI stays as it is.

```
 Solana (StonkFun pools / bonding curves)
        │  program logs, swaps, pool state
        ▼
 ┌──────────────────────┐      ┌──────────────────────────────┐
 │  Indexer (yours)     │      │  Engine (src/engine, pure TS) │
 │  • decode trades     │─────▶│  • notability scoring         │
 │  • OHLCV bars        │      │  • badges (thresholds)        │
 │  • market summaries  │◀─────│  • moment detection           │
 │  • ecosystem daily   │      │  • relations / story          │
 └─────────┬────────────┘      └──────────────────────────────┘
           │ REST + SSE (contract below)
           ▼
 ┌──────────────────────┐
 │ HttpSource           │  src/data/http/HttpSource.ts
 │   implements         │
 │ DataSource           │  src/data/source.ts
 └─────────┬────────────┘
           ▼
     Archive (src/engine/archive.ts) → React UI + canvas universe
```

## Modes

| `VITE_DATA_SOURCE` | Source | What you see |
|---|---|---|
| `live` (default) | `LiveSource`: the static dataset from `indexer/` (published on the `data` branch), plus GeckoTerminal from the browser | Real on-chain data. |
| `demo` | `DemoSource` — deterministic simulation in a Web Worker | Clearly labelled **DEMO DATA**. `meta.isDemo = true`, live events carry `simulated: true`. |
| `api` | `HttpSource` → `VITE_ARCHIVE_API_URL` | Real indexed data. The demo labels go away unless the API itself sets `isDemo: true`. |

All variables are listed in `.env.example`.

## Live mode: how the real data is built

1. **Quote assets.** `src/data/live/quotes.ts` lists the tokenized stocks to track. The indexer verifies each mint with GeckoTerminal; if a mint is missing or doesn't match, it resolves the symbol by search (preferring xStocks' `Xs…` mints, then the most liquid token).
2. **Markets (StonkFun only).** GeckoTerminal indexes StonkFun's bonding curve as its own exchange (`stonkfun`). The indexer reads that pool list directly, which includes StonkFun markets quoted in SOL and USDC, and also checks `/new_pools` and each stock's pools. A token counts as a StonkFun market when it has a `stonkfun` pool, or a stock-quoted Raydium LaunchLab pool created on or after Sept 6, 2026 (when StonkFun moved deployments to LaunchLab), or when it is STONK itself. Its graduated pools are merged into it. Pools from other launchpads (pump.fun, bags.fm, …) and anything created before STONK was deployed are excluded. The rules live in `src/data/live/stonkfun.ts`.
2b. **Timeline.** The archive starts on July 23, 2026 (STONK deployed). The launch on August 3 and the LaunchLab switch on September 6 appear as *curated* moments (`src/engine/history.ts`), labelled as such, alongside the moments the engine detects.
3. **History.** Each market gets its full daily OHLCV once (`/pools/{pool}/ohlcv/day?token={mint}`). Active markets get a short top-up every 6 hours. The files are kept in `v1/bars/`, so every run only fetches what's new.
4. **Counts.** GeckoTerminal only exposes rolling-24h buyers, sellers and transactions. The indexer records the highest value it sees each UTC day, and lifetime traders/trades are the sum of those daily values. **History before the first indexer run therefore has volume and price but no trader counts.** The About page says this to visitors.
5. **Budget.** The free API allows about 30 calls a minute, so each run is capped by `INDEXER_MAX_CALLS` (default 600, about 23 minutes). Whatever isn't fetched in one run is picked up by the next.
6. **Output.** `v1/meta.json`, `markets.json` (ranked by the same notability engine the site uses), `ecosystem.json`, `activity.json` (daily volume per market, used for time travel) and `bars/<pool>.json`, force-pushed as a single commit to the `data` branch.

In the browser, `LiveSource` reads that dataset. Market pages splice GeckoTerminal's hourly candles over the daily history and show the latest trades. The live feed polls `/new_pools` (new launches) and `/pools/multi` for the 30 busiest markets (volume and trader milestones, new all-time highs, sudden volume jumps). All of these events are real: `simulated: false`.

## Domain model

Defined in `src/data/types.ts`. All money is USD unless the name ends in `Quote`, and all timestamps are unix **milliseconds**.

- **QuoteAsset**: what a market is priced in (`NVDAx`, `SPYx`, `SOL`…). Each one becomes a galaxy in the universe.
- **Market**: a token paired with a quote asset. This is the summary the universe, cards and search run on, so it must stay cheap enough to hold tens of thousands in memory.
- **Bar**: OHLCV, plus trade count and first-time wallets per bar. The demo uses hourly bars for a market's first 72 hours and daily bars after that. Any mix of resolutions works because the chart uses a real time axis.
- **Trade**: an individual fill. Optional.
- **EcosystemDay**: ecosystem-wide aggregate per UTC day. `marketReturn` is the log-volume-weighted mean log return of markets older than 3 days, and the crash/recovery detector depends on it.
- **Snapshot**: trailing 7-day volume per market at time *t*. Time travel is built on it.
- **Moment**: a detected or curated event, with the evidence for it.
- **ActivityEvent**: one item in the live feed.

## REST contract (what `HttpSource` expects)

Base URL: `VITE_ARCHIVE_API_URL` (for example `https://archive-indexer.example.com/v1`). Every response is JSON.

### `GET /meta`
```jsonc
{
  "label": "StonkFun mainnet indexer",
  "archiveStart": 1767225600000,
  "archiveEnd": 1791000000000,       // "now" for the indexer
  "totalMarkets": 412345,
  "quoteAssets": [
    { "symbol": "NVDAx", "name": "NVIDIA (tokenized)", "kind": "xstock", "underlying": "NVDA",
      "mint": "…", "priceUsd": 187.2, "hue": 95 }
  ],
  "isDemo": false
}
```

### `GET /markets?limit=&cursor=&order=notability`
Returns a page of `Market` objects, **most notable first**, so the universe can draw the brightest stars before the long tail arrives:
```jsonc
{ "markets": [ /* Market */ ], "next": "opaque-cursor-or-null", "total": 412345 }
```
The client stops paging at `MAX_CLIENT_MARKETS` (60k, in `src/hooks/archive.tsx`). Anything past that stays reachable through search on the server, which is a natural next step.

### `GET /markets/:id`
One `Market`, or 404.

### `GET /markets/:id/bars?resolution=1h|1d`
`Bar[]` in ascending time order. Returning mixed resolution (hourly early, daily later) is fine and recommended.

### `GET /markets/:id/trades?limit=30`
`Trade[]`, newest first. A 404 means "not supported", and the UI hides the section.

### `GET /ecosystem/daily`
`EcosystemDay[]` from `archiveStart` to now. Include `marketReturn` to turn on crash and recovery detection.

### `GET /snapshot?at=<ms>`
```jsonc
{ "at": 1789344000000, "activity": { "<marketId>": 18234.5, "…": 0 } }
```
`activity[id]` is the market's USD volume over the 7 days before `at`. Leave out markets created after `at`. Time travel calls this endpoint, debounced, while the user scrubs, so cache it hard. The bucket size can be coarse (daily is enough).

### `GET /moments?status=approved`
`Moment[]`. A 404 means "no curation backend", and the client then runs the detector itself on the markets and ecosystem data it loaded.

### Live activity
- **SSE (preferred):** `VITE_ARCHIVE_LIVE_URL`. Each `data:` frame is one `ActivityEvent` in JSON.
- **Polling fallback:** `GET /activity?since=<ms>` returns `ActivityEvent[]`, polled every `VITE_ARCHIVE_LIVE_POLL_MS`.

## Building the indexer

Treat this as a sketch to verify against the protocol, not a spec. Confirm program IDs and account layouts with StonkFun before relying on them.

1. **Ingest.** Subscribe to the StonkFun launch and trade programs (StonkFun launches through a bonding curve that graduates into an AMM pool) with a Geyser/gRPC stream or webhooks (Helius, Triton and similar). Persist every swap: pool, side, base amount, quote amount, wallet, slot, signature and block time.
2. **Price.** A trade's quote amount × the quote asset's USD price at that time gives the USD value. xStocks quote assets can be priced from their own liquid pools or from an oracle feed. Store `priceQuote` and `priceUsd` separately, since the archive shows both.
3. **Aggregate.** Roll trades into hourly and daily bars per market (`o/h/l/c/v/n/newTraders`), daily ecosystem rows, and market summaries (ATH, post-ATH low, peak day, 24h/7d windows, lifetime counts, holders where you track balances).
4. **Score.** Run the engine on the server. `src/engine/*` is dependency-free TypeScript, so `new Archive(meta, markets, ecosystem)` works in Node. Sort `/markets` by the result, and persist detected moments as `candidate`s for curation.
5. **Serve** the contract above.

## Notability engine

`src/engine/notability.ts`, with weights in `src/engine/config.ts`.

Each signal is converted to a **percentile rank** across all markets, then combined with configurable weights. The signals are lifetime volume, 7-day volume, traders, liquidity, longevity, peak multiple, trade frequency, activity spike, growth, and membership in detected moments. Percentiles hold up well against meme-market heavy tails, and they keep the weights readable. The score:

- orders and sizes the universe (level of detail: only the top-N by score get full glows at a given zoom),
- weights Surprise Me, the daily discovery and "random",
- picks the Legendary badge (top 0.4%, plus hard volume and trader floors),
- is **never shown to users as a number**.

## Badges

`src/engine/badges.ts`, with thresholds in `badgeRules`. Each award stores the evidence that earned it (for example "Peaked at 142× its launch price"), and the UI shows that evidence next to the badge.

## Moment detection

`src/engine/moments.ts`, with parameters in `momentRules`.

| Kind | Signal |
|---|---|
| `narrative` | Keyword counts from market names in 12h buckets, against the keyword's trailing 14-day mean. Bursts above the ratio and minimum count become candidates. Overlapping bursts are merged by member Jaccard/overlap, so `GPU Goblin` + `GPU Daddy` → one `#gpu` moment. |
| `quote-rush` | The same test, run per quote asset. |
| `volume-spike` | Ecosystem daily log-volume z-score against the trailing 21 days. |
| `crash` | z-score of the 3-day excess return. The trough is located within a week. |
| `recovery` | The rebound from a detected crash trough. |
| `launch` | One market taking ≥ 22% of a day's ecosystem volume within 3 days of creation. |
| `milestone` | Cumulative market count and volume thresholds. |

Every moment carries `evidence[]`, a `confidence` and a `status`:

- `candidate`: detected, below the auto-approve threshold. Shown on the Moments page under "Under review".
- `approved`: public.
- `hidden`: suppressed by a curator.

Curators override moments in `src/engine/curation.ts` locally, or through the indexer's `/moments` store in production. Moment IDs are stable (`kind-key-YYYY-MM-DD`), so a curation decision persists across re-detection.

## Performance notes

- The universe is a single `<canvas>` (`src/universe/renderer.ts`). It uses pre-rendered glow sprites, level-of-detail by notability rank, viewport culling, a uniform spatial grid for hit-testing, and per-node display state that interpolates toward its target, so filters and time travel animate smoothly.
- Rendering stops when the canvas is off-screen or the tab is hidden.
- The demo simulation runs in a Web Worker, and series and trades are generated on request.
- Sparklines fetch their series only when their card scrolls into view.

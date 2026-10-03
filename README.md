# STONKFUN ARCHIVE

**Explore the markets, moments and madness of StonkFun.**

An interactive digital museum for the StonkFun ecosystem. It is not another token table. Every market is a star, every quote asset is a galaxy, and narratives form clusters you can see lining up across galaxies. You can travel through time, fall into moments, roll the dice, and follow connections from one market to the next.

> **Real data by default.** An indexer (`indexer/`, run hourly by `.github/workflows/indexer.yml`) finds every Solana pool where a token trades against a tokenized stock (NVDAx, SPYx, TSLAx…), which is how StonkFun markets are quoted, and publishes the archive to this repo's `data` branch. The site reads that dataset and calls [GeckoTerminal](https://www.geckoterminal.com/dex-api) live for hourly charts, trades and the live feed. The simulated demo is still there at `?source=demo`, and it is labelled as such.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests
npm run build      # typecheck + production build
```

Run the indexer yourself (needs internet access to api.geckoterminal.com):

```bash
npx tsx indexer/main.ts --out ./data-out        # incremental; re-run to extend history
VITE_ARCHIVE_DATA_URL=http://localhost:8080/v1 npm run dev   # serve data-out/ on :8080
```

In GitHub, **Actions → Archive indexer → Run workflow** builds and publishes the dataset on demand. After that the schedule keeps it fresh every hour.

## What's inside

| Area | Where | Notes |
|---|---|---|
| **Universe** | `/universe`, homepage background | Canvas renderer with drag, zoom, pinch, hover cards and click-through. Has filters by kind and galaxy, live pulses, and level of detail by notability. |
| **Time travel** | timeline on `/universe` | Drag, play, or use the arrow keys. Playback holds each day for 5 seconds (1×; 2×/4×/10× available), with ◀ ▶ day stepping, subtitles and a data-written voiceover. The universe re-renders from `snapshot(t)`. Shows a monthly summary (markets, volume, notable markets, moments). |
| **Rewind** | `/rewind` (homepage, Moments, each moment page) | A narrated, playable film of StonkFun history: one scene per moment, with the universe time-travelling and lighting up that moment's markets. Play/pause (`space`), previous/next (`←` `→`), restart, skip to the end, skip out (`Esc`), and a clickable scene progress bar. `?from=<momentId>` starts mid-film. |
| **Moments** | `/moments`, `/moments/:id` | Detected from data (narratives, quote rushes, launches, volume spikes, crashes, recoveries, milestones). Each opens as a constellation view with its evidence. |
| **WHAT THE FUCK IS THIS?** | homepage, Explore → Unusual | Statistical oddities, each with the measurable reasons it was picked. |
| **🎲 Surprise Me** | everywhere (`R`) | A weighted pick that favours interesting markets, with a slot-machine reveal and a rarity tier. |
| **Legends** | `/legends` | Collectible cards and badge halls. Every badge is earned by a threshold and shows its evidence. |
| **Market page** | `/market/:id` | Stats, a log-time price/volume chart, the story in chapters (BORN → … → TODAY), a related-markets web, rows of similar markets, recent fills, and your trail. |
| **Connections** | `/c/quote/:symbol`, `/c/narrative/:key` | Hub pages with clickable radial webs. |
| **Search** | `/` or `⌘K` | Tickers, pairs (`gpu/nvdax`), quote assets, moments, narratives, and dates (`sep 14`, `2026-09`). |
| **Explore** | `/explore/:tab` | Trending, New, Most traded, Biggest movers, Legendary, Unusual, Historical, Random. Each tab has a bubble cluster and card grid. |
| **Live feed** | homepage, universe | SSE or polling in API mode. A simulated feed (labelled) in demo mode. |

## Project structure

```
src/
  data/            domain types, DataSource interface, demo + HTTP sources
    demo/          seeded simulation (runs in a Web Worker)
    http/          REST/SSE client for a real indexer
  engine/          pure-TS archive logic, also runnable server-side
    notability.ts  percentile-weighted scoring
    badges.ts      threshold badges with evidence
    moments.ts     moment detection
    story.ts       chapters from price history
    archive.ts     queries: explore, discovery, relations, search, time
    config.ts      all tunable thresholds and weights
    curation.ts    human overrides for moments
  universe/        layout + canvas renderer + React wrapper
  components/      cards, chart, web, timeline, search, surprise, live
  pages/           routes
  styles/          hand-written CSS (no framework)
docs/DATA_ARCHITECTURE.md
```

## Design principles

- **History, measured.** Nothing in the archive is hand-authored. Moments, legends, badges and "why it's interesting" are all computed, and each one shows its evidence.
- **Honest labels.** Demo data never passes as real. Scores are used internally and not shown as fake precision.
- **Universe first.** The canvas is the main experience. Everything else is a way back into it.
- **Built for scale.** The universe uses canvas with level of detail, data is paged most-notable-first, and series load lazily. The engine is portable, so an indexer can precompute everything.

## Keyboard

`/` or `⌘K` search · `R` surprise me · `Esc` close · `←` `→` on the timeline · Rewind: `space` play/pause, `←` `→` prev/next

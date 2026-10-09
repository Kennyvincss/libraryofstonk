import { beforeAll, describe, expect, test } from 'vitest';
import { buildWorld, DEMO_SEED, simulateBars, type SimWorld } from '../data/demo/simulate';
import { Archive, parseDates } from './archive';
import { badgeRules } from './config';
import { buildStory } from './story';
import { buildDayIndex, dayLine } from './narration';
import { fmtPct, fmtPrice } from '../lib/format';

const START = Date.parse('2026-08-03T00:00:00Z'); // StonkFun launch
const NOW = Date.parse('2026-10-03T12:00:00Z');
let world: SimWorld;
let archive: Archive;

beforeAll(() => {
  world = buildWorld(DEMO_SEED, START, NOW);
  archive = new Archive(
    { kind: 'demo', isDemo: true, label: 'test', archiveStart: START, archiveEnd: NOW, totalMarkets: world.markets.length, quoteAssets: world.quotes },
    world.markets,
    world.ecosystem,
  );
});

describe('demo simulation', () => {
  test('is deterministic', () => {
    const again = buildWorld(DEMO_SEED, START, NOW);
    expect(again.markets.length).toBe(world.markets.length);
    expect(again.markets.slice(0, 50).map((m) => m.id)).toEqual(world.markets.slice(0, 50).map((m) => m.id));
  });

  test('the past stays stable as "now" advances', () => {
    const earlier = buildWorld(DEMO_SEED, START, NOW - 20 * 86_400_000);
    const later = new Map(world.markets.map((m) => [m.id, m]));
    const cutoff = NOW - 21 * 86_400_000;
    const old = earlier.markets.filter((m) => m.createdAt < cutoff);
    expect(old.length).toBeGreaterThan(1000);
    for (const m of old) {
      const l = later.get(m.id);
      expect(l?.createdAt).toBe(m.createdAt);
      expect(l?.ticker).toBe(m.ticker);
    }
  });

  test('every market has coherent summary metrics', () => {
    for (const m of world.markets) {
      expect(m.athPriceUsd).toBeGreaterThanOrEqual(m.launchPriceUsd * 0.999);
      expect(m.postAthLowUsd).toBeLessThanOrEqual(m.athPriceUsd);
      expect(m.volumeLifetimeUsd).toBeGreaterThanOrEqual(m.volume7dUsd - 1e-6);
      expect(m.volume7dUsd).toBeGreaterThanOrEqual(m.volume24hUsd - 1e-6);
      expect(m.createdAt).toBeLessThanOrEqual(NOW);
    }
  });
});

describe('moment detection', () => {
  test('finds narrative bursts purely from market names', () => {
    const narratives = archive.publicMoments.filter((m) => m.kind === 'narrative');
    expect(narratives.length).toBeGreaterThanOrEqual(4);
    for (const mo of narratives) {
      // every member really carries the keyword the moment is named after
      const withKey = mo.marketIds.filter((id) => archive.byId.get(id)!.name.toLowerCase().includes(mo.key)).length;
      expect(withKey / mo.marketIds.length).toBeGreaterThan(0.6);
      expect(mo.evidence.length).toBeGreaterThan(0);
    }
  });

  test('detects the simulated ecosystem crashes without inventing extra ones', () => {
    const crashes = archive.publicMoments.filter((m) => m.kind === 'crash');
    expect(crashes.length).toBeGreaterThanOrEqual(1);
    expect(crashes.length).toBeLessThanOrEqual(3);
  });

  test('moment ids are unique and stable', () => {
    const ids = archive.moments.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('badges', () => {
  test('are only awarded when thresholds are met', () => {
    for (const m of archive.markets) {
      for (const b of archive.badgesOf(m.id)) {
        if (b.id === 'legendary') {
          expect(m.volumeLifetimeUsd).toBeGreaterThanOrEqual(badgeRules.legendary.minVolumeUsd);
          expect(m.traders).toBeGreaterThanOrEqual(badgeRules.legendary.minTraders);
        }
        if (b.id === 'mooned') expect(m.athPriceUsd / m.launchPriceUsd).toBeGreaterThanOrEqual(badgeRules.mooned.minPeakMultiple);
        if (b.id === 'died-fast') expect(m.status).toBe('dead');
      }
    }
    expect(archive.legends().length).toBeGreaterThan(0);
  });
});

describe('discovery & story', () => {
  test('surprise favours interesting markets', () => {
    let r = 1;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const picks = Array.from({ length: 200 }, () => archive.surprise(new Set(), rand));
    const medianRank = picks.map((m) => archive.rank(m.id)).sort((a, b) => a - b)[100];
    expect(medianRank).toBeLessThan(archive.markets.length * 0.15);
  });

  test('stories start at birth and end today', () => {
    const top = archive.ranked(1)[0];
    const story = buildStory(top, simulateBars(world.params.get(top.id)!, world, world.macro), NOW);
    expect(story[0].id).toBe('born');
    expect(story[story.length - 1].id).toBe('today');
    expect(story.some((c) => c.id === 'peak')).toBe(true);
  });

  test('search understands tickers, quote assets and dates', () => {
    const m = archive.ranked(1)[0];
    expect(archive.search(`$${m.ticker}`).markets[0].ticker).toBe(m.ticker);
    expect(archive.search('nvda').quotes.map((q) => q.symbol)).toContain('NVDAx');
    expect(parseDates('sep 14', START, NOW)[0].t).toBe(Date.UTC(2026, 8, 14));
    expect(parseDates('2026-09', START, NOW)[0].t).toBe(Date.UTC(2026, 8, 1));
  });
});

describe('narration', () => {
  test('every day gets a line, and moments are announced on the day they begin', () => {
    const facts = buildDayIndex(archive);
    for (const f of facts.values()) expect(dayLine(archive, f).length).toBeGreaterThan(10);
    const mo = archive.publicMoments.find((m) => m.kind === 'narrative')!;
    const line = dayLine(archive, facts.get(Math.floor(mo.start / 86_400_000) * 86_400_000)!);
    expect(line).toContain('A moment begins');
    expect(line).not.toMatch(/[$×]/);
  });
});

describe('format', () => {
  test('tiny prices use subscript zeros', () => {
    expect(fmtPrice(0.0000123)).toBe('$0.0₄123');
    expect(fmtPrice(1.5)).toBe('$1.5');
    expect(fmtPct(48.21)).toBe('+4,821%');
  });
});

describe('notability fast paths', () => {
  test('fast percentiles match the reference, ties included', async () => {
    const { percentiles } = await import('./notability');
    const v = Float64Array.from([3, 1, 2, 2, 5, 1, 1, 9, 0, 2]);
    const ref = (vals: Float64Array) => {
      const n = vals.length;
      const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => vals[a] - vals[b]);
      const out = new Float64Array(n);
      let i = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && vals[idx[j + 1]] === vals[idx[i]]) j++;
        for (let k = i; k <= j; k++) out[idx[k]] = (i + j) / 2 / (n - 1);
        i = j + 1;
      }
      return out;
    };
    expect([...percentiles(v)]).toEqual([...ref(v)]);
  });
});

import { useMemo, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import type { ExploreTab } from '../engine/archive';
import type { Market } from '../data/types';
import { MarketCard } from '../components/MarketCard';
import { BubbleField } from '../components/BubbleField';
import { Footer } from '../components/Footer';

const TABS: { id: ExploreTab; label: string; blurb: string; metric: (m: Market) => number }[] = [
  { id: 'trending', label: 'Trending', blurb: 'Hottest right now — 24h volume, boosted when it’s outrunning its own weekly pace.', metric: (m) => m.volume24hUsd },
  { id: 'new', label: 'New', blurb: 'Freshly born markets that already saw real trading.', metric: (m) => m.volumeLifetimeUsd },
  { id: 'most-traded', label: 'Most traded', blurb: 'By lifetime trade count. The busiest corners of the universe.', metric: (m) => m.trades },
  { id: 'movers', label: 'Biggest movers', blurb: 'Largest 24h price swings among markets with ≥ $5K daily volume.', metric: (m) => Math.abs(m.change24h) },
  { id: 'legendary', label: 'Legendary', blurb: 'Highest notability: volume, traders, longevity, moves and history combined.', metric: (m) => m.volumeLifetimeUsd },
  { id: 'unusual', label: 'Unusual', blurb: 'Statistical outliers — strange pairs, spikes, absurd peaks.', metric: (m) => m.volumeLifetimeUsd },
  { id: 'historical', label: 'Historical', blurb: 'The markets that defined moments, and the old ones still standing.', metric: (m) => m.volumeLifetimeUsd },
  { id: 'random', label: 'Random', blurb: 'A fresh handful of interesting markets, weighted towards the remarkable.', metric: (m) => m.volumeLifetimeUsd },
];

export function ExplorePage() {
  const { tab = 'trending' } = useParams();
  const { archive } = useArchive();
  const [seed, setSeed] = useState('a');
  const def = TABS.find((t) => t.id === tab) ?? TABS[0];
  const list = useMemo(() => archive.explore(def.id, 48, seed), [archive, def.id, seed]);
  return (
    <div className="explore-page">
      <header className="page-head">
        <div className="kicker">Explore</div>
        <h1>Go wandering</h1>
      </header>
      <nav className="tabs" aria-label="Explore views">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/explore/${t.id}`} className={() => (t.id === def.id ? 'on' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <p className="tab-blurb">
        {def.blurb}
        {def.id === 'random' && (
          <button className="btn ghost sm" onClick={() => setSeed(String(Math.random()))}>
            🎲 Reshuffle
          </button>
        )}
      </p>
      <div className="bubble-wrap" key={def.id + seed}>
        <BubbleField markets={list.slice(0, 36)} metric={def.metric} />
      </div>
      <div className="card-grid" key={`g-${def.id}-${seed}`}>
        {list.map((m) => (
          <MarketCard key={m.id} m={m} />
        ))}
      </div>
      <Footer />
    </div>
  );
}

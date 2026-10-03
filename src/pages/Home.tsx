import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Universe } from '../universe/Universe';
import { useArchive } from '../hooks/archive';
import { useUi } from '../hooks/ui';
import { LivePanel } from '../components/LivePanel';
import { MomentCard } from '../components/MomentCard';
import { MarketCard } from '../components/MarketCard';
import { Sigil } from '../components/bits';
import { fmtNum, fmtUsd } from '../lib/format';
import { Footer } from '../components/Footer';

export function Home() {
  const { archive } = useArchive();
  const { openSurprise } = useUi();
  const [oddSeed, setOddSeed] = useState(() => new Date().toISOString().slice(0, 10));
  const daily = useMemo(() => archive.dailyPick(), [archive]);
  const oddities = useMemo(() => archive.oddities(12, oddSeed), [archive, oddSeed]);
  const moments = archive.publicMoments.filter((m) => m.kind !== 'milestone').slice(0, 3);
  const legends = archive.legends().slice(0, 4);
  const narratives = archive.narratives.filter((n) => n.count >= 20).slice(0, 28);
  // per-market totals always exist; daily ecosystem history may still be backfilling
  const totalVol = archive.totalVolume;

  return (
    <div className="home">
      <section className="hero">
        <Universe mode="ambient" className="hero-universe" initialZoom={1.25} />
        <div className="hero-vignette" aria-hidden />
        <div className="hero-content">
          <div className="eyebrow">
            <span className="pulse-dot" /> {fmtNum(archive.markets.length)} {archive.tracked}markets · {archive.publicMoments.length} moments · {fmtUsd(totalVol)} traded{archive.meta.platform ? ` (${archive.meta.platform.source})` : ''}
          </div>
          <h1 className="hero-title">
            <span>STONKFUN</span>
            <span className="outline">ARCHIVE</span>
          </h1>
          <p className="hero-sub">Explore the markets, moments and madness of StonkFun.</p>
          <div className="hero-cta">
            <Link to="/rewind" className="btn primary lg rewind-cta">
              <span className="rw-cta-ico" aria-hidden>
                ▶
              </span>
              <span className="rw-cta-text">
                Watch the rewind
                <em>{archive.publicMoments.length + 2} scenes · narrated</em>
              </span>
            </Link>
            <Link to="/universe" className="btn outline lg">
              Enter the universe
            </Link>
            <button className="btn dice lg" onClick={openSurprise}>
              <span className="die" aria-hidden>
                🎲
              </span>{' '}
              Surprise me
            </button>
          </div>
          <div className="hero-hint">drag to wander · pinch or ctrl+scroll to zoom · click any star</div>
        </div>
        <Link to={`/market/${daily.id}`} className="daily">
          <Sigil m={daily} size={36} />
          <div>
            <span>Today’s discovery</span>
            <b>
              ${daily.ticker} / {daily.quote}
            </b>
          </div>
          <i>→</i>
        </Link>
        <div className="hero-live">
          <LivePanel compact />
        </div>
        <div className="scroll-cue" aria-hidden>
          <span />
        </div>
      </section>

      <section className="band">
        <header className="band-head">
          <div>
            <div className="kicker">Moments</div>
            <h2>When StonkFun lost its mind</h2>
            <p className="muted">Detected from launch bursts, volume anomalies and ecosystem-wide swings — never written by hand.</p>
          </div>
          <Link to="/moments" className="btn ghost">
            All moments →
          </Link>
        </header>
        <div className="moment-row">
          {moments.map((mo) => (
            <MomentCard key={mo.id} mo={mo} />
          ))}
        </div>
      </section>

      <section className="band wtf">
        <header className="band-head">
          <div>
            <div className="kicker pink">Market discovery</div>
            <h2 className="wtf-title">
              WHAT THE FUCK <span>IS THIS?</span>
            </h2>
            <p className="muted">Statistical outliers. Strange pairs, absurd moves, suspicious longevity. Each one picked by the numbers.</p>
          </div>
          <button className="btn ghost" onClick={() => setOddSeed(String(Math.random()))}>
            ↻ Show me weirder
          </button>
        </header>
        <div className="swipe">
          {oddities.map((m) => (
            <MarketCard key={m.id} m={m} variant="oddity" />
          ))}
        </div>
      </section>

      <section className="band">
        <header className="band-head">
          <div>
            <div className="kicker gold">Legends</div>
            <h2>The hall of fame</h2>
            <p className="muted">Badges awarded by thresholds, not opinions.</p>
          </div>
          <Link to="/legends" className="btn ghost">
            Enter the hall →
          </Link>
        </header>
        <div className="legend-row swipe">
          {legends.map((m, i) => (
            <MarketCard key={m.id} m={m} variant="legend" index={i} />
          ))}
        </div>
      </section>

      <section className="band">
        <header className="band-head">
          <div>
            <div className="kicker cyan">Rabbit holes</div>
            <h2>Pick a thread and pull</h2>
          </div>
        </header>
        <div className="tagcloud">
          {narratives.map((n) => (
            <Link key={n.key} to={`/c/narrative/${encodeURIComponent(n.key)}`} className="tag" style={{ fontSize: `${Math.min(2.1, 0.85 + Math.log10(n.count) * 0.42)}rem` }}>
              #{n.key}
              <sup>{n.count}</sup>
            </Link>
          ))}
        </div>
      </section>
      <Footer />
    </div>
  );
}

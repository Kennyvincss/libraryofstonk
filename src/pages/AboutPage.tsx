import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { BADGES, type BadgeId } from '../engine/badges';
import { momentRules, notabilityWeights } from '../engine/config';
import { MOMENT_KIND } from '../components/MomentCard';
import { Footer } from '../components/Footer';
import { fmtAgo, fmtDate, fmtNum } from '../lib/format';

export function AboutPage() {
  const { archive } = useArchive();
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [loc.hash]);
  const meta = archive.meta;
  return (
    <div className="about-page">
      <header className="page-head">
        <div className="kicker">About</div>
        <h1>A museum that’s still being built</h1>
        <p className="lede">
          StonkFun lets anyone launch a token priced in tokenized stocks, ETFs and crypto. Thousands of markets later, it has a history — manias, crashes, legends and fossils. This archive maps all of it as a universe you can wander.
        </p>
      </header>

      <section className="about-grid">
        <article>
          <h3>How to explore</h3>
          <ul className="keys">
            <li>
              <kbd>drag</kbd> wander the universe
            </li>
            <li>
              <kbd>scroll</kbd> / <kbd>pinch</kbd> zoom (on the homepage: <kbd>ctrl</kbd>+scroll)
            </li>
            <li>
              <kbd>click</kbd> a star to open its market · tap twice on touch
            </li>
            <li>
              <kbd>/</kbd> or <kbd>⌘K</kbd> search anything — tickers, pairs, dates, narratives
            </li>
            <li>
              <kbd>R</kbd> surprise me
            </li>
            <li>
              <kbd>←</kbd> <kbd>→</kbd> on the timeline to travel through time
            </li>
          </ul>
        </article>
        <article id="data" className={meta.isDemo ? 'warn' : ''}>
          <h3>Where the data comes from</h3>
          <p>
            Source: <b>{meta.label}</b> ({meta.kind}) · {fmtNum(meta.totalMarkets)} markets · {fmtDate(meta.archiveStart)} → {fmtDate(meta.archiveEnd)}
          </p>
          {meta.isDemo ? (
            <p>
              <b>Every number you see right now is simulated.</b> No indexer is connected, so the archive runs on a deterministic simulation of a StonkFun-like ecosystem (adoption curve, attention shocks, two market-wide drawdowns, per-market lifecycles). Tickers, addresses, prices and the live feed are synthetic and labelled as such. The moments, badges and legends are <i>not</i> hand-written: the engine detects them from the simulated time series exactly as it will from chain data.
            </p>
          ) : (
            <>
              <p>
                <b>Real on-chain data.</b>
                {meta.generatedAt ? ` Archive rebuilt ${fmtAgo(meta.generatedAt)}; charts, trades and the live feed are fetched live.` : ''} Moments, legends and badges are detected by the engine from this data.
              </p>
              {meta.method && (
                <ul className="method">
                  {meta.method.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              <p className="muted small">
                Prefer the sandbox? <a href="?source=demo">View the simulated demo</a>.
              </p>
            </>
          )}
          <p className="muted small">
            Connect real data by setting <code>VITE_DATA_SOURCE=api</code> and <code>VITE_ARCHIVE_API_URL</code>. The REST contract lives in <code>docs/DATA_ARCHITECTURE.md</code>.
          </p>
        </article>
      </section>

      <section className="band">
        <div className="kicker">The notability engine</div>
        <h2>How “interesting” is decided</h2>
        <p className="muted">
          Each market gets percentile ranks for the signals below, combined with these weights. The score orders the universe, sizes the stars and weights Surprise Me — it is deliberately never shown as a number.
        </p>
        <div className="weights">
          {Object.entries(notabilityWeights).map(([k, w]) => (
            <div key={k} className="weight">
              <span>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
              <i style={{ width: `${(w / 0.26) * 100}%` }} />
              <b>{Math.round(w * 100)}%</b>
            </div>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="kicker gold">Badges</div>
        <h2>Earned, not assigned</h2>
        <div className="rules">
          {(Object.keys(BADGES) as BadgeId[]).map((b) => (
            <div key={b} className="rule">
              <span className="rule-emoji">{BADGES[b].emoji}</span>
              <b>{BADGES[b].label}</b>
              <span>{BADGES[b].rule}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="kicker">Moment detection</div>
        <h2>History, measured</h2>
        <div className="rules">
          <div className="rule">
            <span className="rule-emoji">{MOMENT_KIND.narrative.glyph}</span>
            <b>Narratives</b>
            <span>
              Keywords in market names are counted in {momentRules.bucketHours}h buckets. A keyword bursting ≥ {momentRules.narrative.minRatio}× its trailing {momentRules.baselineDays}-day pace with ≥ {momentRules.narrative.minMarkets} markets becomes a candidate. Overlapping bursts merge.
            </span>
          </div>
          <div className="rule">
            <span className="rule-emoji">{MOMENT_KIND['quote-rush'].glyph}</span>
            <b>Quote rushes</b>
            <span>Same test on quote assets: ≥ {momentRules.quoteRush.minRatio}× the usual launch rate against one asset.</span>
          </div>
          <div className="rule">
            <span className="rule-emoji">{MOMENT_KIND['volume-spike'].glyph}</span>
            <b>Volume spikes</b>
            <span>Daily ecosystem volume with a z-score ≥ {momentRules.volumeSpike.minZ} against the trailing {momentRules.volumeSpike.trailingDays} days.</span>
          </div>
          <div className="rule">
            <span className="rule-emoji">{MOMENT_KIND.crash.glyph}</span>
            <b>Crashes & recoveries</b>
            <span>
              {momentRules.crash.windowDays}-day activity-weighted excess return with z ≤ {momentRules.crash.maxZ}; the rebound from the trough is tested separately.
            </span>
          </div>
          <div className="rule">
            <span className="rule-emoji">{MOMENT_KIND.launch.glyph}</span>
            <b>Launches</b>
            <span>One market taking ≥ {Math.round(momentRules.launch.minShareOfDay * 100)}% of a day’s ecosystem volume within days of birth.</span>
          </div>
          <div className="rule">
            <span className="rule-emoji">{MOMENT_KIND.milestone.glyph}</span>
            <b>Milestones</b>
            <span>Cumulative market count and volume thresholds.</span>
          </div>
        </div>
        <p className="muted small">
          Candidates above {Math.round(momentRules.autoApproveConfidence * 100)}% confidence appear automatically; the rest wait for review on the Moments page. Curators can approve, hide or retitle any moment.
        </p>
      </section>
      <Footer />
    </div>
  );
}

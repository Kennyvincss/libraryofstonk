import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { ConnectionWeb, narrativeGraph, quoteGraph } from '../components/ConnectionWeb';
import { MarketCard } from '../components/MarketCard';
import { MomentCard } from '../components/MomentCard';
import { Universe } from '../universe/Universe';
import { fmtNum, fmtUsd } from '../lib/format';
import { NotFound } from './NotFound';
import { Footer } from '../components/Footer';
import { nameKeywords } from '../engine/text';

/** Hub pages for a quote asset (galaxy) or a narrative (keyword). */
export function ConstellationPage() {
  const { kind = '', key = '' } = useParams();
  const { archive } = useArchive();
  const isQuote = kind === 'quote';
  const markets = useMemo(() => (isQuote ? archive.quoteMarkets(key, 100_000) : archive.narrativeMarkets(key, 100_000)), [archive, key, isQuote]);
  const graph = useMemo(() => (isQuote ? quoteGraph(archive, key) : narrativeGraph(archive, key)), [archive, key, isQuote]);
  const ids = useMemo(() => markets.map((m) => m.id), [markets]);
  if (!markets.length || !graph) return <NotFound what={isQuote ? 'quote asset' : 'narrative'} />;
  const q = isQuote ? archive.quotes.get(key) : undefined;
  const vol = markets.reduce((s, m) => s + m.volumeLifetimeUsd, 0);
  const traders = markets.reduce((s, m) => s + m.traders, 0);
  const alive = markets.filter((m) => m.status !== 'dead').length;
  const share = (ids: string[], pred: (id: string) => boolean) => ids.filter(pred).length / Math.max(1, ids.length);
  const moments = archive.publicMoments
    .filter((mo) =>
      mo.key === key || (mo.kind !== 'milestone' && share(mo.marketIds.slice(0, 60), (id) => {
        const m = archive.byId.get(id);
        return !!m && (isQuote ? m.quote === key : nameKeywords(m).includes(key));
      }) >= 0.3),
    )
    .slice(0, 6);
  const first = markets.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));

  return (
    <div className="const-page">
      <section className="mp-hero short">
        <Universe mode="focus" highlight={ids.slice(0, 600)} fitHighlight className="mp-universe" />
        <div className="mp-overlay">
          <div className="kicker">{isQuote ? 'Galaxy · quote asset' : 'Narrative'}</div>
          <h1>{isQuote ? key : `#${key.toUpperCase()}`}</h1>
          <p className="mp-tagline">{isQuote ? q?.name : `Every market whose name carries “${key}”.`}</p>
        </div>
      </section>
      <section className="mp-stats">
        <div>
          <span>Markets</span>
          <b>{fmtNum(markets.length)}</b>
        </div>
        <div>
          <span>Lifetime volume</span>
          <b>{fmtUsd(vol)}</b>
        </div>
        <div>
          <span>Traders (sum)</span>
          <b>{fmtNum(traders)}</b>
        </div>
        <div>
          <span>Still trading</span>
          <b>{fmtNum(alive)}</b>
        </div>
        <div>
          <span>First market</span>
          <b>
            <Link to={`/market/${first.id}`}>${first.ticker}</Link>
          </b>
        </div>
      </section>
      <section className="band">
        <header className="band-head">
          <div>
            <div className="kicker">Connections</div>
            <h2>Follow the threads</h2>
          </div>
        </header>
        <ConnectionWeb graph={graph} />
      </section>
      {moments.length > 0 && (
        <section className="band">
          <header className="band-head">
            <div>
              <div className="kicker">Moments</div>
              <h2>When it mattered</h2>
            </div>
          </header>
          <div className="moment-row">
            {moments.map((m) => (
              <MomentCard key={m.id} mo={m} />
            ))}
          </div>
        </section>
      )}
      <section className="band">
        <header className="band-head">
          <div>
            <div className="kicker">Most notable</div>
            <h2>Brightest stars</h2>
          </div>
        </header>
        <div className="card-grid">
          {markets.slice(0, 24).map((m) => (
            <MarketCard key={m.id} m={m} />
          ))}
        </div>
      </section>
      <Footer />
    </div>
  );
}

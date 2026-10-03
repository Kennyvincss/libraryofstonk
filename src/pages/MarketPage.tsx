import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useArchive, useSeries } from '../hooks/archive';
import { useUi } from '../hooks/ui';
import { buildStory } from '../engine/story';
import { PriceChart } from '../components/PriceChart';
import { ConnectionWeb, marketGraph } from '../components/ConnectionWeb';
import { MarketCard } from '../components/MarketCard';
import { MomentCard } from '../components/MomentCard';
import { Badge, Change, KindTag, Sigil, Stat } from '../components/bits';
import { Footer } from '../components/Footer';
import { NotFound } from './NotFound';
import type { Market, Trade } from '../data/types';
import { config } from '../lib/env';
import { fmtAgo, fmtDate, fmtNum, fmtPrice, fmtQuotePrice, fmtUsd, shortAddr } from '../lib/format';

const STATUS: Record<Market['status'], string> = {
  bonding: 'On the bonding curve',
  graduated: 'Graduated',
  dormant: 'Dormant',
  dead: 'Silent',
};

function useTrail(id: string) {
  const [trail, setTrail] = useState<string[]>([]);
  useEffect(() => {
    let prev: string[] = [];
    try {
      prev = JSON.parse(sessionStorage.getItem('sfa.trail') || '[]') as string[];
    } catch {
      /* no storage */
    }
    const next = [...prev.filter((x) => x !== id), id].slice(-8);
    try {
      sessionStorage.setItem('sfa.trail', JSON.stringify(next));
    } catch {
      /* no storage */
    }
    setTrail(next);
  }, [id]);
  return trail;
}

export function MarketPage() {
  const { id = '' } = useParams();
  const { archive, source } = useArchive();
  const { openSurprise, markDiscovered } = useUi();
  const m = archive.byId.get(id);
  const bars = useSeries(m?.id);
  const [active, setActive] = useState<number | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const trail = useTrail(id);
  useEffect(() => {
    if (m) markDiscovered(m.id);
  }, [m, markDiscovered]);
  useEffect(() => {
    setTrades(null);
    if (!m || !source.trades) return;
    let alive = true;
    source.trades(m.id, 12).then((t) => alive && setTrades(t), () => alive && setTrades([]));
    return () => {
      alive = false;
    };
  }, [m, source]);
  const story = useMemo(() => (m && bars ? buildStory(m, bars, archive.now) : []), [m, bars, archive.now]);
  const graph = useMemo(() => (m ? marketGraph(archive, m.id) : undefined), [archive, m]);
  const rel = useMemo(() => (m ? archive.related(m.id) : undefined), [archive, m]);
  if (!m) return <NotFound what="market" />;

  const q = archive.quoteOf(m);
  const badges = archive.badgesOf(m.id);
  const reasons = archive.reasons(m.id);
  const moments = archive.momentsByMarket.get(m.id) ?? [];
  const demo = archive.meta.isDemo;

  return (
    <div className="market-page" style={{ ['--h' as string]: q.hue }}>
      <section className="mk-hero">
        <div className="mk-glow" aria-hidden />
        <div className="mk-id">
          <Sigil m={m} size={96} />
          <div>
            <div className="mk-badges-top">
              <KindTag kind={archive.kindOf(m.id)} />
              <span className={`status s-${m.status}`}>{STATUS[m.status]}</span>
              {m.status === 'bonding' && m.bondingProgress !== undefined && (
                <span className="bond" title="Bonding curve progress">
                  <i style={{ width: `${m.bondingProgress * 100}%` }} />
                </span>
              )}
            </div>
            <h1 className="mk-ticker">${m.ticker}</h1>
            <div className="mk-pair">
              {m.ticker} <span>/</span> <Link to={`/c/quote/${encodeURIComponent(m.quote)}`}>{m.quote}</Link>
            </div>
            <div className="mk-name">
              {m.name}
              {m.description && <em> — “{m.description}”</em>}
            </div>
          </div>
        </div>
        {badges.length > 0 && (
          <div className="mk-badges">
            {badges.map((b) => (
              <div key={b.id} className="mk-badge">
                <Badge award={b} />
                <span>{b.evidence}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mk-actions">
          <Link to={`/universe?focus=${m.id}`} className="btn ghost sm">
            ✦ Find in universe
          </Link>
          <button className="btn ghost sm" onClick={openSurprise}>
            🎲 Explore another
          </button>
          {demo ? (
            <span className="muted small" title="Addresses in demo mode are simulated">
              mint {shortAddr(m.mint)} (demo)
            </span>
          ) : (
            <>
              <a className="btn ghost sm" href={`https://www.geckoterminal.com/solana/pools/${m.id}`} target="_blank" rel="noreferrer">
                GeckoTerminal ↗
              </a>
              <a className="btn ghost sm" href={`${config.explorerUrl}/token/${m.mint}`} target="_blank" rel="noreferrer">
                Solscan ↗
              </a>
              <a className="btn primary sm" href={config.appUrl} target="_blank" rel="noreferrer">
                StonkFun ↗
              </a>
            </>
          )}
        </div>
      </section>

      <section className="mk-stats">
        <Stat k="Current price" v={fmtPrice(m.priceUsd)} sub={fmtQuotePrice(m.priceQuote, m.quote)} accent />
        <Stat k="24h change" v={<Change v={m.change24h} />} />
        <Stat k="Market cap" v={fmtUsd(m.marketCapUsd)} sub={`ATH ${fmtUsd(m.athPriceUsd * (m.priceUsd > 0 && m.marketCapUsd > 0 ? m.marketCapUsd / m.priceUsd : 1e9))}`} />
        <Stat k="Liquidity" v={fmtUsd(m.liquidityUsd)} />
        <Stat k="Volume" v={fmtUsd(m.volumeLifetimeUsd)} sub={`${fmtUsd(m.volume24hUsd)} in 24h`} />
        <Stat k="Traders" v={fmtNum(m.traders)} sub={m.holders ? `${fmtNum(m.holders)} holders` : undefined} />
        <Stat k="Trades" v={fmtNum(m.trades)} sub={`${fmtNum(m.trades24h)} in 24h`} />
        <Stat k="Created" v={fmtDate(m.createdAt)} sub={fmtAgo(m.createdAt, archive.now)} />
      </section>

      <section className="band chart-band">
        {bars ? <PriceChart bars={bars} chapters={story} active={active} onActive={setActive} hue={q.hue} now={archive.now} /> : <div className="chart-skeleton" />}
      </section>

      <section className="band story-band">
        <header className="band-head">
          <div>
            <div className="kicker">The story</div>
            <h2>A life in {story.length} chapters</h2>
            <p className="muted">Chapters are cut from the price and volume history. Hover one to see it on the chart.</p>
          </div>
        </header>
        <ol className="story">
          {story.map((c, i) => (
            <li key={c.id} className={`chapter tone-${c.tone} ${active === i ? 'on' : ''}`} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} tabIndex={0}>
              <div className="ch-rail">
                <span className="ch-node" />
              </div>
              <div className="ch-body">
                <div className="ch-label">
                  {c.label} <time>{fmtDate(c.t)}</time>
                </div>
                <p className="ch-headline">{c.headline}</p>
                <dl className="ch-facts">
                  {c.facts.map((f) => (
                    <div key={f.k}>
                      <dt>{f.k}</dt>
                      <dd>{f.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {reasons.length > 0 && (
        <section className="band">
          <div className="kicker pink">Why it’s interesting</div>
          <div className="reasons">
            {reasons.map((r) => (
              <div key={r.label} className="reason">
                <b>{r.value}</b>
                <span>{r.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {moments.length > 0 && (
        <section className="band">
          <header className="band-head">
            <div>
              <div className="kicker">Part of history</div>
              <h2>Moments it belongs to</h2>
            </div>
          </header>
          <div className="moment-row">
            {moments.slice(0, 3).map((mo) => (
              <MomentCard key={mo.id} mo={mo} />
            ))}
          </div>
        </section>
      )}

      {graph && (
        <section className="band">
          <header className="band-head">
            <div>
              <div className="kicker cyan">Related markets</div>
              <h2>The web around ${m.ticker}</h2>
              <p className="muted">Connected by quote asset, narrative, moment, birth date and trading behaviour. Click anything to keep going.</p>
            </div>
          </header>
          <ConnectionWeb graph={graph} />
        </section>
      )}

      {rel && (
        <section className="band related-rows">
          {[
            ['Same quote asset', rel.sameQuote],
            ['Born around the same time', rel.samePeriod],
            ['Trades alike', rel.similar],
          ].map(([label, list]) =>
            (list as Market[]).length ? (
              <div key={label as string}>
                <h4>{label as string}</h4>
                <div className="swipe">
                  {(list as Market[]).slice(0, 8).map((x) => (
                    <MarketCard key={x.id} m={x} variant="mini" />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </section>
      )}

      {trades && trades.length > 0 && (
        <section className="band">
          <div className="kicker">
            Latest fills {demo && <span className="sim-tag">SIMULATED</span>}
          </div>
          <table className="trades">
            <thead>
              <tr>
                <th>When</th>
                <th>Side</th>
                <th>USD</th>
                <th>Price</th>
                <th>Wallet</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.signature}>
                  <td>{fmtAgo(t.t, archive.now)}</td>
                  <td className={t.side === 'buy' ? 'up' : 'down'}>{t.side}</td>
                  <td>{fmtUsd(t.usd, t.usd < 10 ? 2 : undefined)}</td>
                  <td>{fmtPrice(t.priceUsd)}</td>
                  <td className="mono">{shortAddr(t.wallet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {trail.length > 1 && (
        <nav className="trail" aria-label="Your trail">
          <span>Your trail</span>
          {trail.map((tid, i) => {
            const tm = archive.byId.get(tid);
            if (!tm) return null;
            return (
              <span key={tid} className="trail-step">
                {i > 0 && <i>→</i>}
                {tid === m.id ? <b>${tm.ticker}</b> : <Link to={`/market/${tid}`}>${tm.ticker}</Link>}
              </span>
            );
          })}
        </nav>
      )}
      <Footer />
    </div>
  );
}

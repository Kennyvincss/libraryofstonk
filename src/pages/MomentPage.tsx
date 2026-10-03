import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { Universe } from '../universe/Universe';
import { MOMENT_KIND, MomentCard } from '../components/MomentCard';
import { MarketCard } from '../components/MarketCard';
import { fmtDate, fmtDuration, fmtMultiple, fmtNum, fmtUsd } from '../lib/format';
import { NotFound } from './NotFound';
import { Footer } from '../components/Footer';

export function MomentPage() {
  const { id = '' } = useParams();
  const { archive } = useArchive();
  const mo = archive.moment(id);
  const [all, setAll] = useState(false);
  const ids = useMemo(() => mo?.marketIds ?? [], [mo]);
  if (!mo) return <NotFound what="moment" />;
  const pub = archive.publicMoments.slice().sort((a, b) => a.start - b.start);
  const i = pub.findIndex((m) => m.id === mo.id);
  const prev = i > 0 ? pub[i - 1] : undefined;
  const next = i >= 0 && i < pub.length - 1 ? pub[i + 1] : undefined;
  const kin = archive.publicMoments.filter((m) => m.id !== mo.id && (m.key === mo.key || Math.abs(m.start - mo.start) < 5 * 86_400_000)).slice(0, 3);
  const members = ids.map((x) => archive.byId.get(x)!).filter(Boolean);
  const top = mo.topMarketId ? archive.byId.get(mo.topMarketId) : undefined;
  const quotes = new Map<string, number>();
  for (const m of members) quotes.set(m.quote, (quotes.get(m.quote) ?? 0) + 1);
  const ecoLevel = mo.kind === 'crash' || mo.kind === 'recovery' || mo.kind === 'volume-spike' || (mo.kind === 'milestone' && mo.key.endsWith('volume'));

  return (
    <div className="moment-page">
      <section className="mp-hero">
        <Universe mode="focus" highlight={ids} fitHighlight className="mp-universe" />
        <div className="mp-overlay">
          <Link to="/moments" className="back">
            ← All moments
          </Link>
          <div className={`mp-kind mk-${mo.kind}`}>
            {MOMENT_KIND[mo.kind].glyph} {MOMENT_KIND[mo.kind].label}
            {mo.status === 'candidate' && <span className="cand">under review</span>}
          </div>
          <h1>{mo.title}</h1>
          <p className="mp-tagline">“{mo.tagline}”</p>
          <div className="mp-when">
            {fmtDate(mo.start)} → {fmtDate(mo.end)} · {fmtDuration(Math.max(3_600_000, mo.end - mo.start))}
          </div>
        </div>
      </section>

      <section className="mp-stats">
        <div>
          <span>{ecoLevel ? 'Markets most active' : 'Markets created'}</span>
          <b>{fmtNum(ecoLevel ? members.length : mo.stats.marketsCreated)}</b>
        </div>
        <div>
          <span>{ecoLevel ? 'Ecosystem volume in window' : 'Trading volume (these markets)'}</span>
          <b>{fmtUsd(mo.stats.volumeUsd)}</b>
        </div>
        <div>
          <span>Traders (these markets)</span>
          <b>{fmtNum(mo.stats.traders)}</b>
        </div>
        <div>
          <span>Top market</span>
          <b>{top ? <Link to={`/market/${top.id}`}>${top.ticker} / {top.quote}</Link> : '—'}</b>
        </div>
      </section>

      <section className="band two-col">
        <div>
          <div className="kicker">Why this is a Moment</div>
          <ul className="evidence">
            {mo.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
            {mo.stats.intensity > 1.05 && mo.kind !== 'milestone' && <li>intensity {fmtMultiple(mo.stats.intensity)} vs. baseline</li>}
            <li>
              detection confidence {Math.round(mo.confidence * 100)}% · {mo.origin === 'curated' ? 'curated' : 'auto-detected'}
            </li>
          </ul>
        </div>
        <div>
          <div className="kicker">Where it happened</div>
          <div className="quote-bars">
            {[...quotes]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([q, n]) => (
                <Link key={q} to={`/c/quote/${encodeURIComponent(q)}`} className="qbar" style={{ ['--h' as string]: archive.quotes.get(q)?.hue ?? 200 }}>
                  <span>{q}</span>
                  <i style={{ width: `${(n / members.length) * 100}%` }} />
                  <b>{n}</b>
                </Link>
              ))}
          </div>
        </div>
      </section>

      <section className="band">
        <header className="band-head">
          <div>
            <div className="kicker">The markets</div>
            <h2>{fmtNum(members.length)} stars in this constellation</h2>
          </div>
        </header>
        <div className="card-grid">
          {members.slice(0, all ? 120 : 12).map((m) => (
            <MarketCard key={m.id} m={m} />
          ))}
        </div>
        {!all && members.length > 12 && (
          <div className="center">
            <button className="btn ghost" onClick={() => setAll(true)}>
              Show {Math.min(120, members.length) - 12} more
            </button>
          </div>
        )}
      </section>

      <nav className="mp-travel">
        {prev ? (
          <Link to={`/moments/${prev.id}`} className="travel prev">
            <span>← Earlier</span>
            <b>{prev.title}</b>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={`/moments/${next.id}`} className="travel next">
            <span>Later →</span>
            <b>{next.title}</b>
          </Link>
        ) : (
          <span />
        )}
      </nav>

      {kin.length > 0 && (
        <section className="band">
          <header className="band-head">
            <div>
              <div className="kicker">Rabbit hole</div>
              <h2>Around the same time, or the same idea</h2>
            </div>
          </header>
          <div className="moment-row">
            {kin.map((m) => (
              <MomentCard key={m.id} mo={m} />
            ))}
          </div>
        </section>
      )}
      <Footer />
    </div>
  );
}

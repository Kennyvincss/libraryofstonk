import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { MomentCard, MOMENT_KIND } from '../components/MomentCard';
import type { MomentKind } from '../data/types';
import { fmtDate, fmtNum, monthLabel } from '../lib/format';
import { Footer } from '../components/Footer';

const KINDS: MomentKind[] = ['news', 'runner', 'narrative', 'quote-rush', 'launch', 'volume-spike', 'crash', 'recovery', 'milestone'];

export function MomentsPage() {
  const { archive } = useArchive();
  const [kind, setKind] = useState<MomentKind | 'all'>('all');
  const list = useMemo(() => archive.publicMoments.filter((m) => kind === 'all' || m.kind === kind), [archive, kind]);
  const candidates = archive.moments.filter((m) => m.status === 'candidate');
  const start = archive.meta.archiveStart;
  const end = archive.now;
  const pos = (t: number) => ((t - start) / (end - start)) * 100;
  const maxI = Math.max(...archive.publicMoments.map((m) => Math.log1p(m.marketIds.length)));
  const months = useMemo(() => {
    const out: { t: number; l: string }[] = [];
    const d = new Date(start);
    for (let y = d.getUTCFullYear(), m = d.getUTCMonth(); Date.UTC(y, m, 1) <= end; m === 11 ? ((m = 0), y++) : m++) out.push({ t: Date.UTC(y, m, 1), l: monthLabel(m) });
    return out;
  }, [start, end]);

  const first = archive.publicMoments.reduce<(typeof archive.publicMoments)[number] | undefined>((a, m) => (!a || m.start < a.start ? m : a), undefined);

  return (
    <div className="moments-page">
      <header className="page-head">
        <div className="kicker">Moments</div>
        <h1>The history, as it happened</h1>
        <p className="lede">
          A Moment is a measurable anomaly: a burst of launches around one idea, a quote asset stampede, a market that swallowed a whole day’s volume, an ecosystem-wide crash and the comeback after it.
        </p>
        <div className="row gap" style={{ marginTop: 18 }}>
          <Link to="/" className="btn primary">
            ▶ Play the rewind
          </Link>
          {first && (
            <Link to={`/moments/${encodeURIComponent(first.id)}?play=1`} className="btn ghost">
              ▶ Play the moments one by one
            </Link>
          )}
        </div>
      </header>

      <div className="river" aria-label="Moments over time">
        <div className="river-line" />
        {months.map((m) => (
          <span key={m.t} className="river-month" style={{ left: `${pos(m.t)}%` }}>
            {m.l}
          </span>
        ))}
        {archive.publicMoments.map((m) => (
          <Link
            key={m.id}
            to={`/moments/${m.id}`}
            className={`river-dot mk-${m.kind} ${kind !== 'all' && m.kind !== kind ? 'dim' : ''}`}
            style={{ left: `${pos(m.start)}%`, ['--s' as string]: `${8 + (Math.log1p(m.marketIds.length) / maxI) * 22}px` }}
            title={`${m.title} · ${fmtDate(m.start)}`}
          >
            <span className="river-tip">
              <b>{m.title}</b>
              {fmtDate(m.start)} · {fmtNum(m.marketIds.length)} markets
            </span>
          </Link>
        ))}
      </div>

      <div className="chips center">
        <button className={`chip ${kind === 'all' ? 'on' : ''}`} onClick={() => setKind('all')}>
          All · {archive.publicMoments.length}
        </button>
        {KINDS.map((k) => {
          const n = archive.publicMoments.filter((m) => m.kind === k).length;
          if (!n) return null;
          return (
            <button key={k} className={`chip mk-${k} ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
              {MOMENT_KIND[k].glyph} {MOMENT_KIND[k].label} · {n}
            </button>
          );
        })}
      </div>

      <div className="moment-grid">
        {list.map((mo) => (
          <MomentCard key={mo.id} mo={mo} size="lg" />
        ))}
      </div>

      {candidates.length > 0 && (
        <section className="band review">
          <header className="band-head">
            <div>
              <div className="kicker">Under review</div>
              <h2>Detected, not yet confirmed</h2>
              <p className="muted">
                The detector flagged these, but their confidence is below the auto-approve threshold. A curator can promote or hide them (see <code>src/engine/curation.ts</code>).
              </p>
            </div>
          </header>
          <ul className="candidates">
            {candidates.map((m) => (
              <li key={m.id}>
                <span className="glyph">{MOMENT_KIND[m.kind].glyph}</span>
                <Link to={`/moments/${m.id}`}>{m.title}</Link>
                <span className="muted">{fmtDate(m.start)}</span>
                <span className="conf" title="detection confidence">
                  <i style={{ width: `${m.confidence * 100}%` }} />
                </span>
                <span className="muted small">{m.evidence[0]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Footer />
    </div>
  );
}

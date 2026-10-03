import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MOMENT_KIND } from '../components/MomentCard';
import { Universe } from '../universe/Universe';
import { useArchive } from '../hooks/archive';
import { Timeline } from '../components/Timeline';
import { LivePanel } from '../components/LivePanel';
import type { UNode } from '../universe/layout';
import type { VisualKind } from '../engine/archive';
import { KIND_LABEL } from '../components/bits';
import { fmtDate, fmtNum } from '../lib/format';
import { useUi } from '../hooks/ui';

const KINDS: VisualKind[] = ['legendary', 'high-volume', 'unusual', 'historical', 'crashed', 'active'];
const KIND_HINT: Record<VisualKind, string> = {
  legendary: 'gold, flared, ringed',
  'high-volume': 'bright, breathing halo',
  unusual: 'magenta, flickering, boxed',
  historical: 'amber orbit — old & still alive',
  crashed: 'red, crossed out',
  active: 'traded in the last day',
  quiet: 'faint dust',
};

export function UniversePage() {
  const { archive, source } = useArchive();
  const { openSurprise } = useUi();
  const [params, setParams] = useSearchParams();
  const tParam = params.get('t');
  const [t, setT] = useState<number | null>(tParam ? Number(tParam) : null);
  const [caption, setCaption] = useState<string | null>(null);
  const [activity, setActivity] = useState<{ at: number; map: Map<string, number> } | null>(null);
  const [kinds, setKinds] = useState<Set<VisualKind>>(new Set());
  const [quotes, setQuotes] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(params.get('q') ?? '');
  const [focusCluster, setFocusCluster] = useState<string | null>(params.get('galaxy'));
  const [panel, setPanel] = useState(() => window.innerWidth > 900);

  // time travel: keep exactly one snapshot request in flight and always ask
  // for the newest date, so playback renders continuously instead of
  // cancelling every frame
  const tRef = useRef<number | null>(t);
  tRef.current = t;
  const inflight = useRef(false);
  const wanted = useRef<number | null>(null);
  const pump = useCallback(() => {
    if (inflight.current || wanted.current === null) return;
    const at = wanted.current;
    wanted.current = null;
    inflight.current = true;
    source
      .snapshot(at)
      .then((s) => {
        if (tRef.current !== null) setActivity({ at, map: s.activity });
      })
      .finally(() => {
        inflight.current = false;
        pump();
      });
  }, [source]);
  useEffect(() => {
    if (t === null) {
      wanted.current = null;
      setActivity(null);
      return;
    }
    wanted.current = t;
    pump();
  }, [t, pump]);

  // moments happening at the current point in time
  const happening = useMemo(
    () => (t === null ? [] : archive.publicMoments.filter((m) => m.kind !== 'milestone' && t >= m.start && t <= m.end + 2 * 86_400_000).slice(0, 2)),
    [archive, t],
  );
  const pulse = useMemo(() => (happening[0] ? { key: happening[0].id, ids: happening[0].marketIds.slice(0, 12), color: '#ffcf5a' } : null), [happening]);
  const bornBy = useMemo(() => (t === null ? 0 : archive.markets.reduce((n, m) => n + (m.createdAt <= t ? 1 : 0), 0)), [archive, t]);

  const onTime = useCallback(
    (nt: number | null) => {
      setT(nt);
      setParams(
        (p) => {
          if (nt === null) p.delete('t');
          else p.set('t', String(Math.round(nt)));
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const query = q.trim().toLowerCase().replace(/^\$/, '');
  const filter = useMemo(() => {
    if (!kinds.size && !quotes.size && !query) return null;
    return (n: UNode) => {
      if (kinds.size && !kinds.has(n.kind)) return false;
      if (quotes.size && !quotes.has(n.quote)) return false;
      if (query) {
        const m = archive.markets[n.i];
        if (!m.ticker.toLowerCase().includes(query) && !m.name.toLowerCase().includes(query) && !(n.narrative ?? '').startsWith(query)) return false;
      }
      return true;
    };
  }, [kinds, quotes, query, archive]);

  const galaxies = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of archive.markets) c.set(m.quote, (c.get(m.quote) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [archive]);

  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  return (
    <div className="universe-page">
      <Universe mode="full" filter={filter} activity={activity} focusCluster={focusCluster} focusId={params.get('focus')} pulse={pulse} controls />

      {t !== null && (
        <div className="tt-overlay" aria-live="polite">
          <div className="tt-date">{fmtDate(t)}</div>
          <div className="tt-count">
            <b>{fmtNum(bornBy)}</b> markets alive in the archive
          </div>
          {caption && (
            <p className="tt-caption" key={caption}>
              {caption}
            </p>
          )}
          {happening.map((m) => (
            <Link key={m.id} to={`/moments/${m.id}`} className={`tt-moment mk-${m.kind}`}>
              <span>{MOMENT_KIND[m.kind].glyph} Now happening</span>
              <b>{m.title}</b>
            </Link>
          ))}
        </div>
      )}

      <aside className={`navigator ${panel ? 'open' : ''}`}>
        <button className="nav-toggle" onClick={() => setPanel((p) => !p)} aria-expanded={panel}>
          {panel ? '× Navigator' : '☰ Navigator'}
        </button>
        {panel && (
          <div className="nav-body">
            <label className="u-search">
              <span aria-hidden>⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Light up a ticker, name or #narrative" aria-label="Filter the universe" />
              {q && (
                <button onClick={() => setQ('')} aria-label="Clear">
                  ×
                </button>
              )}
            </label>
            <div className="nav-sec">
              <h5>Show</h5>
              <div className="chips">
                {KINDS.map((k) => (
                  <button key={k} className={`chip k-${k} ${kinds.has(k) ? 'on' : ''}`} onClick={() => setKinds((s) => toggle(s, k))} title={KIND_HINT[k]}>
                    <i className="kdot" /> {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <div className="nav-sec">
              <h5>Galaxies · quote assets</h5>
              <div className="galaxy-list">
                {galaxies.map(([sym, n]) => {
                  const qa = archive.quotes.get(sym)!;
                  return (
                    <div key={sym} className={`gal ${quotes.has(sym) ? 'on' : ''}`}>
                      <button className="gal-name" onClick={() => setFocusCluster(`${sym}#${Date.now()}`)} style={{ ['--h' as string]: qa.hue }} title={`Fly to ${sym}`}>
                        <i />
                        {sym}
                        <span>{fmtNum(n)}</span>
                      </button>
                      <button className="gal-only" onClick={() => setQuotes((s) => toggle(s, sym))} title={`Only show ${sym}`}>
                        {quotes.has(sym) ? '◉' : '○'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="nav-sec legend-key">
              <h5>How to read the sky</h5>
              <p>Each star is a market. Size follows lifetime volume and traders. Galaxies are quote assets; satellite clusters are narratives that line up across galaxies.</p>
              <ul>
                {KINDS.map((k) => (
                  <li key={k}>
                    <i className={`kdot k-${k}`} /> <b>{KIND_LABEL[k]}</b> — {KIND_HINT[k]}
                  </li>
                ))}
              </ul>
            </div>
            <button className="btn dice wide" onClick={openSurprise}>
              🎲 Surprise me
            </button>
          </div>
        )}
      </aside>

      <div className="u-live">
        <LivePanel compact={window.innerWidth < 900} />
      </div>
      <div className="u-timeline">
        <Timeline value={t} onChange={onTime} onCaption={setCaption} />
      </div>
    </div>
  );
}

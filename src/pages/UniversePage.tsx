import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Universe } from '../universe/Universe';
import { useArchive } from '../hooks/archive';
import { Timeline } from '../components/Timeline';
import { LivePanel } from '../components/LivePanel';
import type { UNode } from '../universe/layout';
import type { VisualKind } from '../engine/archive';
import { KIND_LABEL } from '../components/bits';
import { fmtNum } from '../lib/format';
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
  const [activity, setActivity] = useState<{ at: number; map: Map<string, number> } | null>(null);
  const [kinds, setKinds] = useState<Set<VisualKind>>(new Set());
  const [quotes, setQuotes] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(params.get('q') ?? '');
  const [focusCluster, setFocusCluster] = useState<string | null>(params.get('galaxy'));
  const [panel, setPanel] = useState(() => window.innerWidth > 900);
  const req = useRef(0);

  // time travel: fetch the snapshot for the chosen moment (debounced)
  useEffect(() => {
    if (t === null) {
      setActivity(null);
      return;
    }
    const id = ++req.current;
    const h = setTimeout(() => {
      source.snapshot(t).then((s) => id === req.current && setActivity({ at: t, map: s.activity }));
    }, 60);
    return () => clearTimeout(h);
  }, [t, source]);

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
      <Universe mode="full" filter={filter} activity={activity} focusCluster={focusCluster} focusId={params.get('focus')} controls />

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
        <Timeline value={t} onChange={onTime} />
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { useUi } from '../hooks/ui';
import { fmtDate, fmtNum, fmtUsd } from '../lib/format';
import { Sigil, KindTag } from './bits';
import { MOMENT_KIND } from './MomentCard';

const SUGGESTIONS = ['NVDA', 'gpu', 'TSLAx', 'frog', 'sep 14', 'quantum', 'SOL', 'crash'];

export function SearchOverlay() {
  const { searchOpen, closeSearch, searchSeed } = useUi();
  if (!searchOpen) return null;
  return <SearchPanel seed={searchSeed} onClose={closeSearch} />;
}

type Item = { key: string; go: () => void };

function SearchPanel({ seed, onClose }: { seed: string; onClose: () => void }) {
  const { archive } = useArchive();
  const nav = useNavigate();
  const [q, setQ] = useState(seed);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const res = useMemo(() => archive.search(q, 10), [archive, q]);
  const go = (path: string) => {
    onClose();
    nav(path);
  };
  const items: Item[] = [
    ...res.dates.map((d) => ({ key: `d-${d.t}`, go: () => go(`/universe?t=${d.t}`) })),
    ...res.quotes.map((x) => ({ key: `q-${x.symbol}`, go: () => go(`/c/quote/${encodeURIComponent(x.symbol)}`) })),
    ...res.markets.map((m) => ({ key: `m-${m.id}`, go: () => go(`/market/${m.id}`) })),
    ...res.moments.map((m) => ({ key: `mo-${m.id}`, go: () => go(`/moments/${m.id}`) })),
    ...res.narratives.map((n) => ({ key: `n-${n.key}`, go: () => go(`/c/narrative/${encodeURIComponent(n.key)}`) })),
  ];
  const idx = (key: string) => items.findIndex((i) => i.key === key);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && items[sel]) items[sel].go();
  };
  const cls = (key: string) => `sr-item ${idx(key) === sel ? 'sel' : ''}`;
  const empty = q.trim() && items.length === 0;
  return (
    <div className="overlay-bg" onMouseDown={onClose}>
      <div className="search-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="search-input">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKey}
            placeholder="Search tickers, pairs, quote assets, moments, dates, narratives…"
            aria-label="Search"
          />
          <kbd onClick={onClose}>esc</kbd>
        </div>
        <div className="search-results">
          {!q.trim() && (
            <div className="sr-empty">
              <p>Try something:</p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => setQ(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {empty && <div className="sr-empty">Nothing in the archive matches “{q}”. The universe is big, but not that big.</div>}
          {res.dates.length > 0 && (
            <section>
              <h4>Travel in time</h4>
              {res.dates.map((d) => (
                <button key={d.t} className={cls(`d-${d.t}`)} onClick={() => go(`/universe?t=${d.t}`)}>
                  <span className="sr-glyph">⏱</span>
                  <span className="sr-main">{d.label}</span>
                  <span className="sr-meta">open the universe as it was</span>
                </button>
              ))}
            </section>
          )}
          {res.quotes.length > 0 && (
            <section>
              <h4>Quote assets</h4>
              {res.quotes.map((x) => (
                <button key={x.symbol} className={cls(`q-${x.symbol}`)} onClick={() => go(`/c/quote/${encodeURIComponent(x.symbol)}`)}>
                  <span className="sr-glyph" style={{ color: `hsl(${x.hue},100%,70%)` }}>
                    ◉
                  </span>
                  <span className="sr-main">{x.symbol}</span>
                  <span className="sr-meta">
                    {x.name} · {fmtNum(archive.markets.filter((m) => m.quote === x.symbol).length)} markets
                  </span>
                </button>
              ))}
            </section>
          )}
          {res.markets.length > 0 && (
            <section>
              <h4>Markets</h4>
              {res.markets.map((m) => (
                <button key={m.id} className={cls(`m-${m.id}`)} onClick={() => go(`/market/${m.id}`)}>
                  <Sigil m={m} size={28} />
                  <span className="sr-main">
                    ${m.ticker} <em>/ {m.quote}</em>
                  </span>
                  <span className="sr-meta">
                    {m.name} · {fmtUsd(m.volumeLifetimeUsd)} · {fmtDate(m.createdAt)}
                  </span>
                  <KindTag kind={archive.kindOf(m.id)} />
                </button>
              ))}
            </section>
          )}
          {res.moments.length > 0 && (
            <section>
              <h4>Moments</h4>
              {res.moments.map((m) => (
                <button key={m.id} className={cls(`mo-${m.id}`)} onClick={() => go(`/moments/${m.id}`)}>
                  <span className="sr-glyph">{MOMENT_KIND[m.kind].glyph}</span>
                  <span className="sr-main">{m.title}</span>
                  <span className="sr-meta">
                    {fmtDate(m.start)} · {fmtNum(m.marketIds.length)} markets
                  </span>
                </button>
              ))}
            </section>
          )}
          {res.narratives.length > 0 && (
            <section>
              <h4>Narratives</h4>
              {res.narratives.map((n) => (
                <button key={n.key} className={cls(`n-${n.key}`)} onClick={() => go(`/c/narrative/${encodeURIComponent(n.key)}`)}>
                  <span className="sr-glyph">#</span>
                  <span className="sr-main">{n.key}</span>
                  <span className="sr-meta">
                    {fmtNum(n.count)} markets · {fmtUsd(n.volumeUsd)} · mostly {n.quotes.join(', ')}
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

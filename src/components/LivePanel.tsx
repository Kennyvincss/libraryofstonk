import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive, useArchive } from '../hooks/archive';
import { fmtAgo } from '../lib/format';
import { useNow } from '../hooks/useNow';

const ICON: Record<string, string> = {
  launch: '✦',
  'volume-milestone': '◆',
  'traders-milestone': '◎',
  unusual: '⚠',
  graduated: '⬆',
  ath: '▲',
  whale: '🐋',
};

export function LivePanel({ compact }: { compact?: boolean }) {
  const { events } = useLive();
  const { archive } = useArchive();
  const [open, setOpen] = useState(!compact);
  const now = useNow(5000);
  const simulated = events.some((e) => e.simulated) || archive.meta.isDemo;
  return (
    <aside className={`live ${open ? 'open' : ''}`} aria-live="polite">
      <button className="live-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="live-dot" />
        LIVE ON STONKFUN
        {simulated && <span className="sim-tag">SIMULATED</span>}
        <span className="chev">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <ul className="live-list">
          {events.length === 0 && <li className="live-empty">Listening for activity…</li>}
          {events.slice(0, compact ? 5 : 9).map((e) => (
            <li key={e.id} className={`ev ev-${e.kind}`}>
              <span className="ev-ico">{ICON[e.kind] ?? '•'}</span>
              {e.marketId && archive.byId.has(e.marketId) ? (
                <Link to={`/market/${e.marketId}`}>{e.text}</Link>
              ) : (
                <span>{e.text}</span>
              )}
              <time>{fmtAgo(e.t, now)}</time>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

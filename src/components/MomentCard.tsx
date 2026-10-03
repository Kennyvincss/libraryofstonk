import { Link } from 'react-router-dom';
import type { Moment } from '../data/types';
import { fmtDate, fmtDuration, fmtNum, fmtUsd } from '../lib/format';
import { useArchive } from '../hooks/archive';
import { MiniConstellation } from './MiniConstellation';

export const MOMENT_KIND: Record<Moment['kind'], { label: string; glyph: string }> = {
  narrative: { label: 'Narrative', glyph: '✺' },
  'quote-rush': { label: 'Quote rush', glyph: '⇶' },
  'volume-spike': { label: 'Volume spike', glyph: '⚡' },
  crash: { label: 'Crash', glyph: '▼' },
  recovery: { label: 'Recovery', glyph: '▲' },
  launch: { label: 'Launch', glyph: '✦' },
  milestone: { label: 'Milestone', glyph: '◆' },
};

export function MomentCard({ mo, size = 'md' }: { mo: Moment; size?: 'md' | 'lg' }) {
  const { archive } = useArchive();
  const top = mo.topMarketId ? archive.byId.get(mo.topMarketId) : undefined;
  const k = MOMENT_KIND[mo.kind];
  return (
    <article className={`moment-card mk-${mo.kind} ${size}`}>
      <div className="mo-art">
        <MiniConstellation ids={mo.marketIds.slice(0, 120)} />
        <span className="mo-kind">
          <span aria-hidden>{k.glyph}</span> {k.label}
        </span>
        <span className="mo-date">{fmtDate(mo.start)}</span>
      </div>
      <div className="mo-body">
        <h3 className="mo-title">{mo.title}</h3>
        <p className="mo-tagline">“{mo.tagline}”</p>
        <dl className="mo-stats">
          <div>
            <dt>Markets</dt>
            <dd>{fmtNum(mo.marketIds.length)}</dd>
          </div>
          <div>
            <dt>{mo.kind === 'crash' || mo.kind === 'recovery' || mo.kind === 'volume-spike' || mo.kind === 'milestone' ? 'Ecosystem volume' : 'Trading volume'}</dt>
            <dd>{fmtUsd(mo.stats.volumeUsd)}</dd>
          </div>
          <div>
            <dt>Traders</dt>
            <dd>{fmtNum(mo.stats.traders)}</dd>
          </div>
          <div>
            <dt>Span</dt>
            <dd>{fmtDuration(Math.max(3_600_000, mo.end - mo.start))}</dd>
          </div>
        </dl>
        {top && (
          <div className="mo-top">
            <span>Top market</span>
            <Link to={`/market/${top.id}`}>
              ${top.ticker} / {top.quote}
            </Link>
          </div>
        )}
        <Link to={`/moments/${mo.id}`} className="btn primary sm">
          Explore moment →
        </Link>
      </div>
    </article>
  );
}

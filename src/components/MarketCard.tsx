import { Link } from 'react-router-dom';
import type { Market } from '../data/types';
import { fmtDate, fmtNum, fmtPeakMove, fmtPrice, fmtUsd } from '../lib/format';
import { useArchive } from '../hooks/archive';
import { Badge, Change, KindTag, Pair, Sigil } from './bits';
import { Sparkline } from './Sparkline';

type Variant = 'grid' | 'oddity' | 'legend' | 'mini';

export function MarketCard({ m, variant = 'grid', index }: { m: Market; variant?: Variant; index?: number }) {
  const { archive } = useArchive();
  const q = archive.quoteOf(m);
  const badges = archive.badgesOf(m.id);
  const kind = archive.kindOf(m.id);

  if (variant === 'mini') {
    return (
      <Link to={`/market/${m.id}`} className={`mcard mini k-${kind}`}>
        <Sigil m={m} size={30} />
        <div>
          <div className="mc-ticker">${m.ticker}</div>
          <div className="mc-sub">{m.quote}</div>
        </div>
        <div className="mc-mini-v">{fmtUsd(m.volumeLifetimeUsd)}</div>
      </Link>
    );
  }

  if (variant === 'oddity') {
    const reasons = archive.reasons(m.id).slice(0, 4);
    return (
      <article className="mcard oddity" style={{ ['--h' as string]: q.hue }}>
        <div className="odd-head">
          <Sigil m={m} size={52} />
          <div>
            <div className="mc-ticker big">${m.ticker}</div>
            <Pair m={m} />
          </div>
        </div>
        <div className="odd-why">Why it’s interesting</div>
        <ul className="odd-reasons">
          {reasons.map((r) => (
            <li key={r.label}>
              <b>{r.value}</b>
              <span>{r.label}</span>
            </li>
          ))}
          <li>
            <b>{archive.ago(m.createdAt)}</b>
            <span>created</span>
          </li>
        </ul>
        <Link to={`/market/${m.id}`} className="btn ghost sm">
          Explore market →
        </Link>
      </article>
    );
  }

  if (variant === 'legend') {
    return (
      <Link to={`/market/${m.id}`} className="mcard legend" style={{ ['--h' as string]: q.hue }}>
        <div className="holo" aria-hidden />
        {index !== undefined && <div className="legend-no">#{String(index + 1).padStart(2, '0')}</div>}
        <Sigil m={m} size={72} />
        <div className="mc-ticker huge">${m.ticker}</div>
        <div className="mc-name">{m.name}</div>
        <Pair m={m} link={false} />
        <div className="legend-badges">
          {badges.map((b) => (
            <Badge key={b.id} award={b} />
          ))}
        </div>
        <dl className="legend-stats">
          <dt>Lifetime volume</dt>
          <dd>{fmtUsd(m.volumeLifetimeUsd)}</dd>
          <dt>Traders</dt>
          <dd>{fmtNum(m.traders)}</dd>
          <dt>Peak move</dt>
          <dd>{fmtPeakMove(m.launchPriceUsd, m.athPriceUsd)}</dd>
          <dt>Created</dt>
          <dd>{archive.ago(m.createdAt)}</dd>
        </dl>
        <span className="btn ghost sm">Explore →</span>
      </Link>
    );
  }

  return (
    <Link to={`/market/${m.id}`} className={`mcard grid k-${kind}`} style={{ ['--h' as string]: q.hue }}>
      <div className="mc-head">
        <Sigil m={m} size={40} />
        <div className="mc-titles">
          <div className="mc-ticker">${m.ticker}</div>
          <div className="mc-sub">
            {m.name} · <span className="q">{m.quote}</span>
          </div>
        </div>
        <KindTag kind={kind} />
      </div>
      <Sparkline id={m.id} hue={q.hue} />
      <div className="mc-stats">
        <div>
          <span>Price</span>
          <b>{fmtPrice(m.priceUsd)}</b>
        </div>
        <div>
          <span>24h</span>
          <b>
            <Change v={m.change24h} />
          </b>
        </div>
        <div>
          <span>Volume</span>
          <b>{fmtUsd(m.volumeLifetimeUsd)}</b>
        </div>
        <div>
          <span>Traders</span>
          <b>{fmtNum(m.traders)}</b>
        </div>
      </div>
      <div className="mc-foot">
        <span className="mc-date">{fmtDate(m.createdAt)}</span>
        <span className="mc-badges">
          {badges.slice(0, 3).map((b) => (
            <Badge key={b.id} award={b} compact />
          ))}
        </span>
      </div>
    </Link>
  );
}

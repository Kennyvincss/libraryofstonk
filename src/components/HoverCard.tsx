import type { Market } from '../data/types';
import { fmtNum, fmtPrice, fmtUsd } from '../lib/format';
import { useArchive } from '../hooks/archive';
import { Badge, Change, KindTag } from './bits';

export function HoverCard({ market: m, x, y }: { market: Market; x: number; y: number }) {
  const { archive } = useArchive();
  const badges = archive.badgesOf(m.id);
  const flipX = x > window.innerWidth - 300;
  const flipY = y > window.innerHeight - 240;
  return (
    <div className="hover-card" style={{ left: flipX ? x - 266 : x + 18, top: flipY ? y - 200 : y + 14 }} role="tooltip">
      <div className="hc-top">
        <div className="hc-name">{m.name}</div>
        <KindTag kind={archive.kindOf(m.id)} />
      </div>
      <div className="hc-pair">
        ${m.ticker} <span>/ {m.quote}</span>
      </div>
      <dl className="hc-grid">
        <dt>Price</dt>
        <dd>{fmtPrice(m.priceUsd)}</dd>
        <dt>24h</dt>
        <dd>
          <Change v={m.change24h} />
        </dd>
        <dt>Volume</dt>
        <dd>{fmtUsd(m.volumeLifetimeUsd)}</dd>
        <dt>Traders</dt>
        <dd>{fmtNum(m.traders)}</dd>
      </dl>
      {badges.length > 0 && (
        <div className="hc-badges">
          {badges.slice(0, 4).map((b) => (
            <Badge key={b.id} award={b} compact={badges.length > 2} />
          ))}
        </div>
      )}
      <div className="hc-hint">click to open →</div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { BADGES, type BadgeId } from '../engine/badges';
import { MarketCard } from '../components/MarketCard';
import { Footer } from '../components/Footer';
import { fmtNum } from '../lib/format';

const ORDER: BadgeId[] = ['mooned', 'viral', 'whale-magnet', 'most-traded', 'oldest-survivor', 'died-fast', 'experimental'];

export function LegendsPage() {
  const { archive } = useArchive();
  const legends = archive.legends();
  return (
    <div className="legends-page">
      <header className="page-head center">
        <div className="kicker gold">Legends</div>
        <h1>The Hall of Fame</h1>
        <p className="lede">
          Every badge here is earned by crossing a measured threshold — volume, traders, multiples, survival. No votes, no vibes, no paid placements.
        </p>
      </header>

      <section className="band">
        <header className="band-head">
          <div>
            <h2>🏆 Legendary</h2>
            <p className="muted">{BADGES.legendary.rule}.</p>
          </div>
          <span className="count">{fmtNum(legends.length)}</span>
        </header>
        <div className="legend-grid">
          {legends.map((m, i) => (
            <MarketCard key={m.id} m={m} variant="legend" index={i} />
          ))}
        </div>
      </section>

      {ORDER.map((b) => {
        const list = archive.withBadge(b, 12);
        if (!list.length) return null;
        const total = archive.markets.filter((m) => archive.hasBadge(m.id, b)).length;
        return (
          <section className="band badge-band" key={b}>
            <header className="band-head">
              <div>
                <h2>
                  {BADGES[b].emoji} {BADGES[b].label}
                </h2>
                <p className="muted">Earned by: {BADGES[b].rule}.</p>
              </div>
              <span className="count">{fmtNum(total)}</span>
            </header>
            <div className="swipe">
              {list.map((m) => (
                <Link key={m.id} to={`/market/${m.id}`} className="badge-tile">
                  <span className="bt-emoji">{BADGES[b].emoji}</span>
                  <b>${m.ticker}</b>
                  <span className="muted">{m.quote}</span>
                  <em>{archive.badgesOf(m.id).find((x) => x.id === b)?.evidence}</em>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      <Footer />
    </div>
  );
}

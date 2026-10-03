import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Market } from '../data/types';
import { useArchive } from '../hooks/archive';
import { useUi } from '../hooks/ui';
import { fmtDate, fmtNum, fmtPeakMove, fmtUsd } from '../lib/format';
import { Badge, Sigil } from './bits';

export function SurpriseModal() {
  const { surpriseOpen, closeSurprise } = useUi();
  if (!surpriseOpen) return null;
  return <Surprise onClose={closeSurprise} />;
}

function rarity(rank: number, n: number) {
  const p = (rank + 1) / n;
  if (p <= 0.005) return { label: 'MYTHIC', cls: 'r-mythic' };
  if (p <= 0.03) return { label: 'LEGENDARY FIND', cls: 'r-legend' };
  if (p <= 0.1) return { label: 'RARE', cls: 'r-rare' };
  return { label: 'UNCOMMON', cls: 'r-uncommon' };
}

function Surprise({ onClose }: { onClose: () => void }) {
  const { archive } = useArchive();
  const { discovered, markDiscovered } = useUi();
  const nav = useNavigate();
  const [pick, setPick] = useState<Market | null>(null);
  const [phase, setPhase] = useState<'roll' | 'reveal'>('roll');
  const [reel, setReel] = useState('????');
  const seen = useRef(new Set<string>());
  const timers = useRef<number[]>([]);

  const roll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('roll');
    const m = archive.surprise(seen.current);
    seen.current.add(m.id);
    setPick(m);
    // slot-machine reel through other tickers before landing
    const pool = archive.ranked(800);
    let i = 0;
    const spin = () => {
      setReel(pool[Math.floor(Math.random() * pool.length)].ticker);
      i++;
      if (i < 14) timers.current.push(window.setTimeout(spin, 35 + i * i * 1.1));
      else {
        setReel(m.ticker);
        timers.current.push(
          window.setTimeout(() => {
            setPhase('reveal');
            markDiscovered(m.id);
          }, 160),
        );
      }
    };
    spin();
  }, [archive, markDiscovered]);

  useEffect(() => {
    roll();
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, [roll]);

  if (!pick) return null;
  const q = archive.quoteOf(pick);
  const rank = archive.rank(pick.id);
  const rar = rarity(rank, archive.markets.length);
  const badges = archive.badgesOf(pick.id);
  const reasons = archive.reasons(pick.id).slice(0, 2);
  return (
    <div className="overlay-bg surprise-bg" onMouseDown={onClose}>
      <div className={`surprise ${phase} ${rar.cls}`} style={{ ['--h' as string]: q.hue }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Surprise discovery">
        <div className="warp" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => (
            <i key={i} style={{ ['--a' as string]: `${(i * 360) / 28}deg`, ['--d' as string]: `${(i % 7) * 0.09}s` }} />
          ))}
        </div>
        <button className="x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="s-eyebrow">{phase === 'roll' ? 'Scanning the archive…' : 'You discovered…'}</div>
        <div className="s-reel">
          <Sigil m={pick} size={phase === 'reveal' ? 92 : 64} />
          <div className="s-ticker">${reel}</div>
        </div>
        {phase === 'reveal' && (
          <div className="s-reveal">
            <div className={`s-rarity ${rar.cls}`}>{rar.label}</div>
            <div className="s-pair">
              {pick.ticker} / {pick.quote}
            </div>
            <div className="s-name">“{pick.name}”</div>
            <div className="s-created">Created {fmtDate(pick.createdAt)}</div>
            <div className="s-stats">
              <div>
                <b>{fmtUsd(pick.volumeLifetimeUsd)}</b>
                <span>lifetime volume</span>
              </div>
              <div>
                <b>{fmtNum(pick.traders)}</b>
                <span>traders</span>
              </div>
              <div>
                <b>{fmtPeakMove(pick.launchPriceUsd, pick.athPriceUsd)}</b>
                <span>peak</span>
              </div>
            </div>
            {reasons.length > 0 && (
              <div className="s-reasons">
                {reasons.map((r) => (
                  <span key={r.label}>
                    {r.label}: <b>{r.value}</b>
                  </span>
                ))}
              </div>
            )}
            {badges.length > 0 && (
              <div className="s-badges">
                {badges.map((b) => (
                  <Badge key={b.id} award={b} />
                ))}
              </div>
            )}
            <div className="s-actions">
              <button
                className="btn primary"
                onClick={() => {
                  onClose();
                  nav(`/market/${pick.id}`);
                }}
              >
                Explore market
              </button>
              <button className="btn ghost" onClick={roll}>
                🎲 Another one
              </button>
            </div>
            <div className="s-count">
              {discovered.size} {discovered.size === 1 ? 'market' : 'markets'} discovered by you · press <kbd>R</kbd> anywhere to roll
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

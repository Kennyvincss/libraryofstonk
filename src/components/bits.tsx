import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BADGES, type BadgeAward } from '../engine/badges';
import type { VisualKind } from '../engine/archive';
import type { Market } from '../data/types';
import { fmtPct } from '../lib/format';
import { useArchiveState } from '../hooks/archive';

export const KIND_LABEL: Record<VisualKind, string> = {
  legendary: 'Legendary',
  unusual: 'Unusual',
  'high-volume': 'High volume',
  historical: 'Historical',
  crashed: 'Crashed',
  active: 'Active',
  quiet: 'Quiet',
};

export function KindTag({ kind }: { kind: VisualKind }) {
  return <span className={`kind-tag k-${kind}`}>{KIND_LABEL[kind]}</span>;
}

export function Badge({ award, compact }: { award: BadgeAward; compact?: boolean }) {
  const b = BADGES[award.id];
  return (
    <span className={`badge b-${award.id}`} title={`${b.label}: ${award.evidence}\nEarned by: ${b.rule}`}>
      <span aria-hidden>{b.emoji}</span>
      {!compact && <span>{b.label}</span>}
    </span>
  );
}

export function Change({ v }: { v: number }) {
  return <span className={v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : 'flat'}>{fmtPct(v)}</span>;
}

export function Stat({ k, v, sub, accent }: { k: string; v: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <div className="stat-k">{k}</div>
      <div className="stat-v">{v}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Pair({ m, link = true }: { m: Market; link?: boolean }) {
  const inner = (
    <>
      <span className="pair-base">{m.ticker}</span>
      <span className="pair-sep">/</span>
      <span className="pair-quote">{m.quote}</span>
    </>
  );
  return link ? (
    <Link to={`/c/quote/${encodeURIComponent(m.quote)}`} className="pair" onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  ) : (
    <span className="pair">{inner}</span>
  );
}

/** A deterministic sigil for a token — no images required. */
export function Sigil({ m, size = 44 }: { m: Market; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (m.image && !broken) {
    return <img className="sigil sigil-img" src={m.image} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <GenSigil m={m} size={size} />;
}

function GenSigil({ m, size }: { m: Market; size: number }) {
  const { archive } = useArchiveState();
  const q = archive?.quotes.get(m.quote);
  const hue = q?.hue ?? 260;
  let h = 0;
  for (const c of m.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pts = 5 + (h % 4);
  const rot = (h >> 3) % 360;
  const inner = 0.38 + ((h >> 7) % 30) / 100;
  const path = Array.from({ length: pts * 2 }, (_, i) => {
    const a = (i * Math.PI) / pts + (rot * Math.PI) / 180;
    const r = i % 2 ? inner : 0.92;
    return `${50 + Math.cos(a) * r * 46},${50 + Math.sin(a) * r * 46}`;
  }).join(' ');
  return (
    <svg className="sigil" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <radialGradient id={`sg-${m.id.slice(0, 8)}`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={`hsl(${hue},100%,85%)`} />
          <stop offset="60%" stopColor={`hsl(${(hue + 40) % 360},90%,55%)`} />
          <stop offset="100%" stopColor={`hsl(${(hue + 80) % 360},80%,30%)`} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`hsla(${hue},60%,20%,0.6)`} stroke={`hsla(${hue},100%,70%,0.4)`} />
      <polygon points={path} fill={`url(#sg-${m.id.slice(0, 8)})`} opacity="0.9" />
      <text x="50" y="57" textAnchor="middle" fontSize="20" fontWeight="800" fill="#0b1518" fontFamily="Unbounded, sans-serif">
        {m.ticker.slice(0, 2)}
      </text>
    </svg>
  );
}

export function DemoChip() {
  const { archive } = useArchiveState();
  if (!archive?.meta.isDemo) return null;
  return (
    <Link to="/about#data" className="demo-chip" title="All numbers are simulated until a real StonkFun indexer is connected. Click to learn more.">
      <span className="dot" /> DEMO DATA
    </Link>
  );
}

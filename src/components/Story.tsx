import { useState } from 'react';
import type { Moment } from '../data/types';
import { fmtDate, fmtNum } from '../lib/format';

/** Token image in a CRT frame with corner brackets. */
export function StoryImage({ src, alt, size = 'md' }: { src?: string; alt: string; size?: 'sm' | 'md' | 'lg' }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <figure className={`story-img ${size}`}>
      <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} />
      <i className="c tl" />
      <i className="c tr" />
      <i className="c bl" />
      <i className="c br" />
    </figure>
  );
}

/** "LAUNCHED · AUG 4, 2026 · 67 tokens across 11 days" */
export function StoryCallout({ c }: { c: NonNullable<Moment['callout']> }) {
  return (
    <div className="story-callout">
      <div className="sc-head">
        <span>{c.label}</span> · <span>{fmtDate(c.from)}</span>
      </div>
      <div className="sc-body">
        <b>{fmtNum(c.count)}</b> {c.unit} {c.detail}
      </div>
    </div>
  );
}

export function ShareButton({ id, className = 'btn ghost sm' }: { id: string; className?: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/moments/${encodeURIComponent(id)}`;
    try {
      if (navigator.share) await navigator.share({ url });
      else await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* dismissed */
    }
  };
  return (
    <button className={className} onClick={share}>
      {done ? '✓ Link copied' : '↗ Share this moment'}
    </button>
  );
}

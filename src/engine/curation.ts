import type { Moment } from '../data/types';

/**
 * Human curation layer for detected moments.
 *
 * Detected moments are candidates. A curator can approve, hide or retitle
 * them here (or, in production, through the indexer's /moments admin API —
 * this file then only acts as a local override). Keys are moment ids, which
 * are stable: `${kind}-${key}-${YYYY-MM-DD}`.
 */
export interface CurationEntry {
  status?: Moment['status'];
  title?: string;
  tagline?: string;
}

export const curation: Record<string, CurationEntry> = {
  // 'narrative-gpu-2026-09-12': { status: 'approved', title: 'THE GPU GOLD RUSH' },
};

export function applyCuration(moments: Moment[], overrides: Record<string, CurationEntry> = curation): Moment[] {
  return moments.map((m) => {
    const c = overrides[m.id];
    if (!c) return m;
    return { ...m, ...c, status: c.status ?? m.status, origin: 'curated' };
  });
}

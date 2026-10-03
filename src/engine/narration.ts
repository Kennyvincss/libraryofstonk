/**
 * Voiceover scripts, written from data. Every sentence is built from the
 * archive's measured numbers — the narrator never says anything the data
 * doesn't show.
 */
import type { Market, Moment } from '../data/types';
import type { Archive } from './archive';
import { hashString } from '../lib/hash';
import { sayDate, sayNum, sayQuote, sayUsd, speakable } from '../lib/narrator';

const DAY = 86_400_000;

export interface DayFacts {
  t: number;
  launches: number;
  volumeUsd: number;
  activeMarkets: number;
  topLaunch?: Market;
  loudest?: Market;
  moments: Moment[];
  milestones: Moment[];
}

/** Per-day facts, computed once per archive. */
export function buildDayIndex(a: Archive): Map<number, DayFacts> {
  const idx = new Map<number, DayFacts>();
  for (const d of a.ecosystem) {
    idx.set(d.t, { t: d.t, launches: d.marketsCreated, volumeUsd: d.volumeUsd, activeMarkets: d.activeMarkets, moments: [], milestones: [] });
  }
  const dayOf = (t: number) => Math.floor(t / DAY) * DAY;
  a.markets.forEach((m, i) => {
    const born = idx.get(dayOf(m.createdAt));
    if (born && (!born.topLaunch || a.notability.score[i] > a.score(born.topLaunch.id))) born.topLaunch = m;
    const peak = idx.get(dayOf(m.peakDayAt));
    if (peak && (!peak.loudest || m.peakDayVolumeUsd > peak.loudest.peakDayVolumeUsd)) peak.loudest = m;
  });
  for (const mo of a.publicMoments) {
    const f = idx.get(dayOf(mo.start));
    if (!f) continue;
    if (mo.kind === 'milestone') f.milestones.push(mo);
    else f.moments.push(mo);
  }
  return idx;
}

const KIND_SAY: Record<Moment['kind'], string> = {
  narrative: 'A narrative',
  'quote-rush': 'A quote rush',
  'volume-spike': 'A volume spike',
  crash: 'A crash',
  recovery: 'A recovery',
  launch: 'A launch',
  milestone: 'A milestone',
};

const pick = <T,>(arr: T[], seed: string) => arr[hashString(seed) % arr.length];

function marketPhrase(a: Archive, m: Market) {
  return `${m.name}, paired with ${sayQuote(m.quote, a.quotes.get(m.quote)?.name)}`;
}

/** One spoken line for one day — short enough to fit the 5-second beat on quiet days. */
export function dayLine(a: Archive, f: DayFacts): string {
  const date = sayDate(f.t);
  const tr = a.tracked; // 'tracked ' when the market list is partial
  const parts: string[] = [];
  if (f.launches === 0 && f.volumeUsd < 1) return `${date}. Silence on StonkFun.`;

  parts.push(
    pick(
      [
        `${date}. ${sayUsd(f.volumeUsd)} traded across StonkFun; ${sayNum(f.launches)} new ${tr}${f.launches === 1 ? 'market' : 'markets'}.`,
        `${date}. ${sayUsd(f.volumeUsd)} changed hands, and ${sayNum(f.launches)} ${tr}${f.launches === 1 ? 'market was' : 'markets were'} born.`,
        `${date}. ${sayNum(f.launches)} ${tr}launches. ${sayUsd(f.volumeUsd)} in volume.`,
      ],
      `d${f.t}`,
    ),
  );

  if (f.moments.length) {
    const mo = f.moments[0];
    parts.push(`A moment begins: ${titleCase(mo.title)}.`);
  } else if (f.loudest && f.loudest.peakDayVolumeUsd > Math.max(50_000, f.volumeUsd * 0.15)) {
    parts.push(
      pick(
        [
          `The loudest market was ${marketPhrase(a, f.loudest)}.`,
          `All eyes on ${marketPhrase(a, f.loudest)}.`,
          `${f.loudest.name} took ${Math.round((f.loudest.peakDayVolumeUsd / Math.max(1, f.volumeUsd)) * 100)} percent of the day's volume.`,
        ],
        `l${f.t}`,
      ),
    );
  } else if (f.topLaunch && a.rank(f.topLaunch.id) < a.markets.length * 0.05) {
    parts.push(`Born today: ${marketPhrase(a, f.topLaunch)}. Remember that name.`);
  }
  if (f.milestones.length) parts.push(speakable(f.milestones[0].tagline));
  return parts.join(' ');
}

/** Short version for fast playback: only days with something to say. */
export function dayHeadline(f: DayFacts): string | null {
  if (f.moments.length) return `${sayDate(f.t)}. ${titleCase(f.moments[0].title)}.`;
  if (f.milestones.length) return speakable(f.milestones[0].tagline);
  return null;
}

/** Narration for a Rewind scene. */
export function sceneLine(kind: 'intro' | 'moment' | 'outro', title: string, body: string, moment?: Moment): string {
  if (kind === 'moment' && moment) {
    return `${sayDate(moment.start)}. ${KIND_SAY[moment.kind]}. ${titleCase(title)}. ${speakable(body)}`;
  }
  return `${titleCase(title)}. ${speakable(body)}`;
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/\$/g, '')
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

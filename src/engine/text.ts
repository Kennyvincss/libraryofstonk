import { STOPWORDS } from './config';
import type { Market } from '../data/types';

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Keywords that describe a market (name + description). */
export function marketKeywords(m: Market): string[] {
  return [...new Set([...tokenize(m.name), ...tokenize(m.description ?? '')])];
}

/** Keywords from the name only — what narratives are built from. */
export function nameKeywords(m: Market): string[] {
  return [...new Set(tokenize(m.name))];
}

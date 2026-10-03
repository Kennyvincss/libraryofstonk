/** Typed access to build-time environment variables. See .env.example. */
const env = import.meta.env;

const DAY = 86_400_000;

function parseDate(v: string | undefined, fallback: string): number {
  const t = Date.parse(v || fallback);
  return Number.isFinite(t) ? t : Date.parse(fallback);
}

type SourceKind = 'live' | 'api' | 'demo';

/** ?source=demo|live in the URL overrides the build setting (remembered per tab). */
function pickSource(): SourceKind {
  const valid = (v: string | null | undefined): v is SourceKind => v === 'live' || v === 'api' || v === 'demo';
  try {
    const q = new URLSearchParams(window.location.search).get('source');
    if (valid(q)) {
      sessionStorage.setItem('sfa.source', q);
      return q;
    }
    const s = sessionStorage.getItem('sfa.source');
    if (valid(s)) return s;
  } catch {
    /* no window / storage */
  }
  const e = env.VITE_DATA_SOURCE as string | undefined;
  return valid(e) ? e : 'live';
}

export const config = {
  dataSource: pickSource(),
  /** where the indexer publishes the dataset (the repo's `data` branch by default) */
  dataUrl: ((env.VITE_ARCHIVE_DATA_URL as string | undefined) || 'https://raw.githubusercontent.com/Kennyvincss/libraryofstonk/data/v1').replace(/\/$/, ''),
  geckoApi: ((env.VITE_GECKO_API as string | undefined) || 'https://api.geckoterminal.com/api/v2').replace(/\/$/, ''),
  apiUrl: ((env.VITE_ARCHIVE_API_URL as string | undefined) || '').replace(/\/$/, ''),
  liveUrl: (env.VITE_ARCHIVE_LIVE_URL as string | undefined) || '',
  livePollMs: Number(env.VITE_ARCHIVE_LIVE_POLL_MS) || 8000,
  archiveStart: parseDate(env.VITE_ARCHIVE_START as string | undefined, '2026-08-03T00:00:00Z'),
  explorerUrl: ((env.VITE_EXPLORER_URL as string | undefined) || 'https://solscan.io').replace(/\/$/, ''),
  appUrl: ((env.VITE_STONKFUN_APP_URL as string | undefined) || 'https://stonk.fun').replace(/\/$/, ''),
} as const;

export { DAY };

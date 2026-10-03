/** Typed access to build-time environment variables. See .env.example. */
const env = import.meta.env;

const DAY = 86_400_000;

function parseDate(v: string | undefined, fallback: string): number {
  const t = Date.parse(v || fallback);
  return Number.isFinite(t) ? t : Date.parse(fallback);
}

export const config = {
  dataSource: (env.VITE_DATA_SOURCE as string | undefined) === 'api' ? 'api' : 'demo',
  apiUrl: ((env.VITE_ARCHIVE_API_URL as string | undefined) || '').replace(/\/$/, ''),
  liveUrl: (env.VITE_ARCHIVE_LIVE_URL as string | undefined) || '',
  livePollMs: Number(env.VITE_ARCHIVE_LIVE_POLL_MS) || 8000,
  archiveStart: parseDate(env.VITE_ARCHIVE_START as string | undefined, '2026-01-01T00:00:00Z'),
  explorerUrl: ((env.VITE_EXPLORER_URL as string | undefined) || 'https://solscan.io').replace(/\/$/, ''),
  appUrl: ((env.VITE_STONKFUN_APP_URL as string | undefined) || 'https://stonk.fun').replace(/\/$/, ''),
} as const;

export { DAY };

/**
 * Stale-while-revalidate for the archive dataset (Cache API).
 * A returning visitor gets the last copy instantly while a fresh one is
 * fetched in the background for next time; copies older than `maxAgeMs`
 * wait for the network. Falls back to plain fetch where the Cache API is
 * unavailable, and to the stale copy when the network fails.
 */
const CACHE = 'sfa-data-v1';
const SAVED = 'x-sfa-saved-at';

async function fetchFresh(url: string) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Archive dataset unavailable (${res.status} on ${url.split('/').pop()})`);
  return res;
}

async function store(cache: Cache, url: string, res: Response) {
  const body = await res.clone().blob();
  const headers = new Headers(res.headers);
  headers.set(SAVED, String(Date.now()));
  await cache.put(url, new Response(body, { status: 200, headers }));
}

export async function cachedJson<T>(url: string, maxAgeMs = 6 * 3_600_000): Promise<T> {
  let cache: Cache | null = null;
  try {
    cache = 'caches' in globalThis ? await caches.open(CACHE) : null;
  } catch {
    cache = null;
  }
  if (!cache) return (await fetchFresh(url)).json() as Promise<T>;

  const hit = await cache.match(url).catch(() => undefined);
  const age = hit ? Date.now() - Number(hit.headers.get(SAVED) ?? 0) : Infinity;
  const refresh = () =>
    fetchFresh(url).then(async (res) => {
      await store(cache!, url, res).catch(() => {});
      return res;
    });
  if (hit && age < maxAgeMs) {
    // update quietly for the next visit, once the page has settled
    setTimeout(() => void refresh().catch(() => {}), 20_000);
    return hit.json() as Promise<T>;
  }
  try {
    return (await refresh()).json() as Promise<T>;
  } catch (e) {
    if (hit) return hit.json() as Promise<T>;
    throw e;
  }
}

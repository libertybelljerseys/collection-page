// Public pages read the static JSON snapshot in data/ (written by
// scripts/fetch-data.mjs) instead of calling the Flickr API directly — no
// API key ships to visitors, and there's no live external round-trip on
// every page load. Cached in sessionStorage so navigating around the site
// during one visit doesn't even re-fetch the local JSON.

const CACHE_TTL_MS = 5 * 60 * 1000;
const ADMIN_API = 'https://admin-api.libertybelljerseys.com';

async function cachedFetch(url, cacheKey) {
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    const { time, data } = JSON.parse(cached);
    if (Date.now() - time < CACHE_TTL_MS) return data;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  const data = await res.json();
  sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), data }));
  return data;
}

export async function getAlbums() {
  return cachedFetch('data/albums.json', 'data:albums');
}

export async function getAlbumPhotos(id) {
  return cachedFetch(`data/albums/${id}.json`, `data:album:${id}`);
}

// Album category/team/cover/title-description assignments — edited via
// admin.html, written to R2 by the collection-admin Worker (see worker/).
export async function getMeta() {
  return cachedFetch(`${ADMIN_API}/meta`, 'data:meta');
}

export async function saveMeta(password, data) {
  const res = await fetch(`${ADMIN_API}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, data }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Wrong password' : `Save failed (${res.status})`);
  sessionStorage.removeItem('data:meta');
}

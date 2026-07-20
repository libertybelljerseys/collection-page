// Fetches the full Flickr album/photo tree AND the actual image bytes,
// writing everything to data/ as a fully self-contained static snapshot.
// Public pages never touch live.staticflickr.com — only this build does.
// Run in CI on every deploy (see .github/workflows/deploy.yml) and on a
// schedule; run locally with a real js/config.js to refresh data/.
import { mkdir, writeFile } from 'node:fs/promises';
import { getAlbums, getAlbumPhotos } from '../js/flickr.js';

const IMG_DIR = 'data/images';

// Flickr rate-limits image requests (we've hit real 429s) — retry with
// backoff instead of failing the whole build over a transient limit.
async function downloadImage(url, destPath, attempt = 1) {
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 4) {
    await new Promise((r) => setTimeout(r, attempt * 2000));
    return downloadImage(url, destPath, attempt + 1);
  }
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}

// Small worker pool so we're not hammering Flickr with hundreds of
// concurrent requests (which is what caused the 429s in the first place).
async function withLimit(items, limit, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: limit }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

await mkdir(`${IMG_DIR}/covers`, { recursive: true });
await mkdir(`${IMG_DIR}/photos`, { recursive: true });
await mkdir('data/albums', { recursive: true });

const albums = await getAlbums();

await withLimit(albums, 5, async (a) => {
  if (!a.cover) return;
  const dest = `${IMG_DIR}/covers/${a.id}.jpg`;
  await downloadImage(a.cover, dest);
  a.cover = dest;
});

await writeFile('data/albums.json', JSON.stringify(albums));

let photoCount = 0;
for (const a of albums) {
  const { title, photos } = await getAlbumPhotos(a.id);
  await withLimit(photos, 5, async (p) => {
    const thumbDest = `${IMG_DIR}/photos/${p.id}_thumb.jpg`;
    const fullDest = `${IMG_DIR}/photos/${p.id}_full.jpg`;
    await downloadImage(p.thumb, thumbDest);
    await downloadImage(p.full, fullDest);
    p.thumb = thumbDest;
    p.full = fullDest;
  });
  photoCount += photos.length;
  await writeFile(`data/albums/${a.id}.json`, JSON.stringify({ title, photos }));
}

console.log(`Fetched ${albums.length} albums, ${photoCount} photos.`);

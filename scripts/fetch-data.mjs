// Fetches the full Flickr album/photo tree and writes it to data/ as static
// JSON. Run in CI on every deploy (see .github/workflows/deploy.yml) and on
// a schedule, so the public pages never call the Flickr API themselves.
// Run locally with a real js/config.js to refresh your local data/ folder.
import { mkdir, writeFile } from 'node:fs/promises';
import { getAlbums, getAlbumPhotos } from '../js/flickr.js';

const albums = await getAlbums();
await mkdir('data/albums', { recursive: true });
await writeFile('data/albums.json', JSON.stringify(albums));

for (const a of albums) {
  const photos = await getAlbumPhotos(a.id);
  await writeFile(`data/albums/${a.id}.json`, JSON.stringify(photos));
}

console.log(`Fetched ${albums.length} albums.`);

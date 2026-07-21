// Generates one static album-<id>.html per album (flat, same directory as
// album.html) with per-album og/twitter meta tags so links shared to
// Discord/Slack/iMessage/etc. unfurl with the album title and its first
// photo — crawlers don't run JS, so album.html?id=X (title filled in client-
// side) always showed the same generic preview. Kept flat rather than
// nested under a directory so the existing root-relative asset paths
// (css/, js/, data/) in album.html still resolve unchanged.
// Run in CI right before the Pages upload step; output isn't committed.
import { readFile, writeFile } from 'node:fs/promises';

const albums = JSON.parse(await readFile('data/albums.json', 'utf8'));
const template = await readFile('album.html', 'utf8');

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

for (const { id, title, cover } of albums) {
  const pageTitle = `${title} — Liberty Bell Jerseys`;
  const desc = 'Custom and game-worn jersey photos from the Liberty Bell Jerseys collection.';

  const html = template
    .replace(/<title>.*<\/title>/, `<title>${escapeAttr(pageTitle)}</title>`)
    .replace(/(property="og:title" content=").*?(")/, `$1${escapeAttr(pageTitle)}$2`)
    .replace(/(property="og:description" content=").*?(")/, `$1${escapeAttr(desc)}$2`)
    .replace(/(property="og:image" content=").*?(")/, `$1${escapeAttr(cover)}$2`)
    .replace(/(name="twitter:title" content=").*?(")/, `$1${escapeAttr(pageTitle)}$2`)
    .replace(/(name="twitter:description" content=").*?(")/, `$1${escapeAttr(desc)}$2`)
    .replace(/(name="twitter:image" content=").*?(")/, `$1${escapeAttr(cover)}$2`)
    .replace('<body>', `<body data-id="${escapeAttr(id)}">`);

  await writeFile(`album-${id}.html`, html);
}

console.log(`Generated ${albums.length} album-*.html pages`);

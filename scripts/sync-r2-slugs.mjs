// Keeps each album's R2 folder name (albums/<slug>/...) aligned with its
// own id in data/albums.json. They drift apart whenever an album is
// re-categorized (scripts/r2-publish.mjs slugifies from the title at
// publish time, before admin.html assigns the category prefix that ends up
// in the id) — run this after that to fold the R2 layout back in line.
//
// Renames happen server-side inside the collection-admin Worker's
// password-gated /sync-slug endpoint (R2-to-R2 copy, no bytes round-tripped
// through this machine), copying every object under the old prefix before
// deleting any of the old ones — a failure mid-run leaves a harmless
// duplicate, never lost data.
//
// Usage:
//   node scripts/sync-r2-slugs.mjs                          # dry run
//   ADMIN_PASSWORD=... node scripts/sync-r2-slugs.mjs --apply
import { readFile, writeFile } from 'node:fs/promises';

const APPLY = process.argv.includes('--apply');
const ADMIN_API = 'https://admin-api.libertybelljerseys.com';
const PASSWORD = process.env.ADMIN_PASSWORD;

if (APPLY && !PASSWORD) {
  console.error('Set ADMIN_PASSWORD to apply.');
  process.exit(1);
}

const albums = JSON.parse(await readFile('data/albums.json', 'utf8'));

function slugOf(url) {
  return new URL(url).pathname.match(/\/albums\/([^/]+)\//)[1];
}

const work = albums
  .map((a) => ({ id: a.id, oldSlug: slugOf(a.cover) }))
  .filter((w) => w.oldSlug !== w.id);

console.log(`${work.length} of ${albums.length} albums have a mismatched R2 folder.`);
for (const w of work) console.log(`  albums/${w.oldSlug}/  ->  albums/${w.id}/`);

if (!APPLY) {
  console.log('\nDry run only — re-run with --apply (and ADMIN_PASSWORD set) to write changes.');
  process.exit(0);
}

// Each album is moved on R2 and then immediately reflected in the local
// JSON before moving to the next — so a crash partway through (a prior run
// hit a transient 500 on album 72/103) never leaves an album whose R2
// folder was renamed but whose manifest still points at the deleted path.
async function moveOne(w, attempt = 1) {
  const res = await fetch(`${ADMIN_API}/sync-slug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD, oldSlug: w.oldSlug, newSlug: w.id }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (attempt < 2) {
      console.log(`retry (${res.status})...`);
      await new Promise((r) => setTimeout(r, 2000));
      return moveOne(w, attempt + 1);
    }
    throw new Error(`FAILED (${res.status}) ${body.slice(0, 200)}`);
  }
  return res.json();
}

for (const w of work) {
  process.stdout.write(`  ${w.oldSlug} -> ${w.id} ... `);
  const { moved } = await moveOne(w);
  console.log(`${moved} objects moved`);

  const a = albums.find((x) => x.id === w.id);
  a.cover = a.cover.replace(`/albums/${w.oldSlug}/`, `/albums/${w.id}/`);
  await writeFile('data/albums.json', JSON.stringify(albums, null, 2));

  const path = `data/albums/${w.id}.json`;
  const detail = JSON.parse(await readFile(path, 'utf8'));
  detail.photos = detail.photos.map((p) => ({
    ...p,
    thumb: p.thumb.replace(`/albums/${w.oldSlug}/`, `/albums/${w.id}/`),
    full: p.full.replace(`/albums/${w.oldSlug}/`, `/albums/${w.id}/`),
  }));
  await writeFile(path, JSON.stringify(detail, null, 2));
}

console.log('\nDone. data/albums.json and data/albums/*.json now point at the new R2 paths.');

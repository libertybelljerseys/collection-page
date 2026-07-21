// Publishes album photos to Cloudflare R2, replacing Flickr as the image
// backing store. Two modes:
//
//   node scripts/r2-publish.mjs --migrate
//     One-time bulk migration: reads the already-fetched Flickr snapshot
//     (data/images/ + data/albums.json + data/albums/<id>.json, produced by
//     the now-retired scripts/fetch-data.mjs) and re-uploads every photo
//     into the new albums/<slug>/{cover,full,thumb} layout, rewriting the
//     manifest in place with R2 URLs. Reuses the images already on disk —
//     does not re-hit Flickr, so it can't trigger the API rate limits that
//     the old thumb/full split was designed around.
//
//   node scripts/r2-publish.mjs --new "<Title>" <folder-of-photos>
//     Publishes a brand-new album (no Flickr history) from a local folder,
//     in filename order. Full-resolution photos are uploaded as-is; only
//     the thumb is generated.
//
// Requires wrangler to be authenticated (CLOUDFLARE_API_TOKEN / `wrangler
// login`) and these env vars:
//   R2_BUCKET       the bucket name, e.g. lbj-photos
//   R2_PUBLIC_BASE  the public base URL, e.g. https://img.libertybelljerseys.com

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const BUCKET = process.env.R2_BUCKET;
// Accept either "img.example.com" or "https://img.example.com" in the env var.
const PUBLIC_BASE = process.env.R2_PUBLIC_BASE
  ?.replace(/\/+$/, '')
  ?.replace(/^(?!https?:\/\/)/, 'https://');
const THUMB_WIDTH = 640;

if (!BUCKET || !PUBLIC_BASE) {
  console.error('Set R2_BUCKET and R2_PUBLIC_BASE (see comment at top of this script).');
  process.exit(1);
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Uploads over ~1000 files via individual `wrangler` invocations hit the
// occasional transient DNS/network blip — retry instead of aborting the
// whole migration over one flaky request.
async function uploadFile(localPath, key, contentType, attempt = 1) {
  const args = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', localPath, '--remote'];
  if (contentType) args.push('--content-type', contentType);
  try {
    execFileSync('npx', args, { stdio: 'inherit' });
  } catch (err) {
    if (attempt >= 4) throw err;
    console.warn(`  retrying ${key} (attempt ${attempt + 1})...`);
    await sleep(attempt * 3000);
    await uploadFile(localPath, key, contentType, attempt + 1);
  }
}

async function uploadBuffer(buffer, key, contentType) {
  const tmp = path.join(tmpdir(), `r2-publish-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  await writeFile(tmp, buffer);
  try {
    await uploadFile(tmp, key, contentType);
  } finally {
    await unlink(tmp);
  }
}

// entries: [{ title, fullPath, thumbPath }] — thumbPath null means "resize
// fullPath down to THUMB_WIDTH instead of reusing an existing derivative".
async function publishAlbum({ slug, id, title, entries }) {
  const photos = [];
  let i = 0;
  for (const entry of entries) {
    i += 1;
    const n = String(i).padStart(2, '0');
    const fullKey = `albums/${slug}/full/${n}.jpg`;
    const thumbKey = `albums/${slug}/thumb/${n}.jpg`;

    await uploadFile(entry.fullPath, fullKey, 'image/jpeg');

    if (entry.thumbPath) {
      await uploadFile(entry.thumbPath, thumbKey, 'image/jpeg');
    } else {
      const buf = await sharp(entry.fullPath)
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      await uploadBuffer(buf, thumbKey, 'image/jpeg');
    }

    if (i === 1) await uploadFile(entry.fullPath, `albums/${slug}/cover.jpg`, 'image/jpeg');

    photos.push({
      id: `${id}-${n}`,
      title: entry.title || '',
      thumb: `${PUBLIC_BASE}/${thumbKey}`,
      full: `${PUBLIC_BASE}/${fullKey}`,
    });
  }

  await mkdir('data/albums', { recursive: true });
  await writeFile(`data/albums/${id}.json`, JSON.stringify({ title, photos }, null, 2));

  return { id, title, count: photos.length, cover: `${PUBLIC_BASE}/albums/${slug}/cover.jpg` };
}

async function upsertAlbumsManifest(entry) {
  const albumsPath = 'data/albums.json';
  let albums = [];
  try {
    albums = JSON.parse(await readFile(albumsPath, 'utf8'));
  } catch {
    // No manifest yet — starting fresh.
  }
  const idx = albums.findIndex((a) => a.id === entry.id);
  if (idx >= 0) albums[idx] = entry;
  else albums.push(entry);
  await writeFile(albumsPath, JSON.stringify(albums, null, 2));
}

async function bulkMigrate() {
  const albums = JSON.parse(await readFile('data/albums.json', 'utf8'));
  let migrated = 0;
  let skipped = 0;
  for (const a of albums) {
    // Resumable: a prior run may have already migrated this album (its
    // manifest entry already points at R2) — don't re-upload it.
    if (a.cover?.startsWith(PUBLIC_BASE)) {
      skipped += 1;
      continue;
    }
    const albumData = JSON.parse(await readFile(`data/albums/${a.id}.json`, 'utf8'));
    const displayTitle = albumData.title || a.title || a.id;
    const slug = slugify(displayTitle);
    const entries = albumData.photos.map((p) => {
      // Prefer the true original (fetched separately, once, straight from
      // Flickr) over the 2048px derivative the old build pipeline kept to
      // dodge Flickr's rate limits on originals.
      const origPath = `data/images/photos/${p.id}_orig.jpg`;
      return {
        title: p.title,
        fullPath: existsSync(origPath) ? origPath : `data/images/photos/${p.id}_full.jpg`,
        thumbPath: `data/images/photos/${p.id}_thumb.jpg`,
      };
    });

    const result = await publishAlbum({ slug, id: a.id, title: albumData.title, entries });
    await upsertAlbumsManifest(result);
    migrated += 1;
    console.log(`✓ ${displayTitle} → albums/${slug}/ (${entries.length} photos)`);
  }
  console.log(`Migrated ${migrated} albums (${skipped} already done).`);
}

async function publishNew(title, folder) {
  const files = (await readdir(folder))
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) {
    console.error(`No images found in ${folder}`);
    process.exit(1);
  }

  const slug = slugify(title);
  const entries = files.map((f) => ({ title: '', fullPath: path.join(folder, f), thumbPath: null }));
  const result = await publishAlbum({ slug, id: slug, title, entries });
  await upsertAlbumsManifest(result);
  console.log(`✓ Published "${title}" → albums/${slug}/ (${entries.length} photos)`);
}

const [, , mode, ...rest] = process.argv;

if (mode === '--new') {
  const [title, folder] = rest;
  if (!title || !folder) {
    console.error('Usage: node scripts/r2-publish.mjs --new "<Title>" <folder-of-photos>');
    process.exit(1);
  }
  await publishNew(title, folder);
} else if (mode === '--migrate' || !mode) {
  await bulkMigrate();
} else {
  console.error('Usage:\n  node scripts/r2-publish.mjs --migrate\n  node scripts/r2-publish.mjs --new "<Title>" <folder-of-photos>');
  process.exit(1);
}

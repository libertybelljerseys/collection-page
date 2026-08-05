// Recomputes each album's id from its current category/team assignment —
// custom-<slug> / <team-abbr>-<slug> / nonnhl-<slug> / wife-<team-abbr>-<slug>
// — and renames anything that's drifted. The gap this closes: publishing a
// new album with `r2-publish.mjs --new` has no category yet (that only
// happens later, in admin.html), so it starts life as a bare
// slugify(title). Run this after categorizing it and the id, the
// data/albums/<id>.json file, and the meta/config.json keys all snap into
// the standard scheme in one shot — then hands off to sync-r2-slugs.mjs to
// fold the R2 folder layout back in line, so the whole footprint (id, JSON
// filename, R2 path, meta keys) never needs hand-remapping.
//
// Usage:
//   node scripts/rename-album-id.mjs                          # dry run
//   ADMIN_PASSWORD=... node scripts/rename-album-id.mjs --apply
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const PASSWORD = process.env.ADMIN_PASSWORD;
if (APPLY && !PASSWORD) {
  console.error('Set ADMIN_PASSWORD to apply (needed by sync-r2-slugs.mjs afterward).');
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

const teamsSrc = await readFile('js/teams.js', 'utf8');
const TEAMS = [...teamsSrc.matchAll(/slug: '([^']+)', label: '([^']+)', abbr: '([^']+)'/g)]
  .map(([, slug, label, abbr]) => ({ slug, label, abbr: abbr.toLowerCase() }));
const teamBySlug = Object.fromEntries(TEAMS.map((t) => [t.slug, t]));
const teamByLabel = Object.fromEntries(TEAMS.map((t) => [t.label, t]));

const CATEGORY_PREFIX = { 'custom-work': 'custom', 'non-nhl': 'nonnhl' };

const albums = JSON.parse(await readFile('data/albums.json', 'utf8'));
const meta = JSON.parse(await readFile('data/meta.config.local.json', 'utf8'));
const { albumCategories, albumTeam, albumMeta, categoryCovers } = meta;

const errors = [];
const idMap = {};
const usedIds = new Set();
const teamBackfill = {}; // wife albums resolved via description, not yet in albumTeam

for (const a of albums) {
  const cat = albumCategories[a.id];
  let prefix;

  if (cat === 'nhl') {
    const team = teamBySlug[albumTeam[a.id]];
    if (!team) errors.push(`${a.id}: category "nhl" but team "${albumTeam[a.id]}" not in teams.js`);
    else prefix = team.abbr;
  } else if (cat === 'wife-jerseys') {
    let team = teamBySlug[albumTeam[a.id]];
    if (!team) {
      const desc = albumMeta[a.id]?.description || '';
      const m = desc.match(/\* Team:\s*(.+)/);
      team = m && teamByLabel[m[1].trim()];
      if (team) teamBackfill[a.id] = team.slug;
    }
    if (!team) errors.push(`${a.id}: wife-jerseys, no Team set and none resolvable from description`);
    else prefix = `wife-${team.abbr}`;
  } else if (cat && CATEGORY_PREFIX[cat]) {
    prefix = CATEGORY_PREFIX[cat];
  } else {
    errors.push(`${a.id}: unrecognized/missing category "${cat}"`);
  }
  if (!prefix) continue;

  const displayTitle = albumMeta[a.id]?.title || a.title;
  let base = `${prefix}-${slugify(displayTitle)}`;
  let candidate = base;
  let n = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  usedIds.add(candidate);
  idMap[a.id] = candidate;
}

if (errors.length) {
  console.error('Aborting — unresolved albums:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const changed = albums.filter((a) => idMap[a.id] !== a.id);
console.log(`${albums.length} albums checked, ${changed.length} need renaming.`);
for (const a of changed) console.log(`  ${a.id}  ->  ${idMap[a.id]}`);

if (!changed.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}
if (!APPLY) {
  console.log('\nDry run only — re-run with --apply (and ADMIN_PASSWORD set) to write changes.');
  process.exit(0);
}

const newAlbums = albums.map((a) => ({ ...a, id: idMap[a.id] }));
await writeFile('data/albums.json', JSON.stringify(newAlbums, null, 2));

for (const a of changed) {
  const oldPath = `data/albums/${a.id}.json`;
  const newPath = `data/albums/${idMap[a.id]}.json`;
  const detail = JSON.parse(await readFile(oldPath, 'utf8'));
  detail.photos = detail.photos.map((p) => ({ ...p, id: p.id.replace(`${a.id}-`, `${idMap[a.id]}-`) }));
  await writeFile(newPath, JSON.stringify(detail, null, 2));
  if (oldPath !== newPath) await unlink(oldPath);
}

function remapKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[idMap[k] ?? k] = v;
  return out;
}
const newAlbumTeam = remapKeys(albumTeam);
for (const [oldId, teamSlug] of Object.entries(teamBackfill)) newAlbumTeam[idMap[oldId]] = teamSlug;

const newMeta = {
  albumCategories: remapKeys(albumCategories),
  albumTeam: newAlbumTeam,
  albumMeta: remapKeys(albumMeta),
  categoryCovers: Object.fromEntries(
    Object.entries(categoryCovers).map(([cat, id]) => [cat, idMap[id] ?? id])
  ),
};
await writeFile('data/meta.config.local.json', JSON.stringify(newMeta, null, 2));

console.log('\nRenamed locally. Pushing meta/config.json to R2...');
execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'lbj-photos/meta/config.json',
  '--file=../data/meta.config.local.json', '--content-type=application/json', '--remote'],
  { cwd: 'worker', stdio: 'inherit' });

console.log('\nSyncing R2 folder names to match the new ids...');
execFileSync('node', ['scripts/sync-r2-slugs.mjs', '--apply'], {
  env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
  stdio: 'inherit',
});

console.log('\nDone — id, data/albums/*.json, meta/config.json (local + R2), and R2 folders are all in sync.');

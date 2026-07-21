# collection-page

Static site for the "Liberty Bell Jerseys" custom jersey photo albums,
organized into browsable categories (Custom Work / NHL / Non-NHL / Wife
Jerseys). NHL further splits by NHL team (teams with no albums are hidden
automatically). Styled to match libertybelljerseys.com's other pages
(status./scf. subdomains). Photos are hosted in Cloudflare R2.

Every page has static Open Graph/Twitter Card tags (branded title,
description, and the LBJ logo as the preview image) so links unfurl
properly in Discord/Slack/iMessage/etc. They're the same on every page —
there's no server to generate a per-album or per-category preview, since
social unfurl bots fetch the raw HTML and don't run JS. Only really
testable once deployed (bots won't fetch `localhost`).

## How data flows

The public pages (`index.html`, `category.html`, `album.html`) and
`admin.html` all read the same committed manifest: `data/albums.json`
(one entry per album — `id`, `title`, `count`, `cover`) plus one
`data/albums/<id>.json` per album (`title` and a `photos` array of
`{id, title, thumb, full}`). `cover`/`thumb`/`full` are all URLs on the R2
custom domain (`img.libertybelljerseys.com`) — the manifest JSON is the
only thing in `data/` that's checked into git; no image bytes live in this
repo. `js/data.js` fetches that JSON (with a 5-minute sessionStorage cache
for snappy in-visit navigation) and is the single source both public pages
and `admin.html` read from — there's no separate "live" backend to keep in
sync.

The manifest and the R2 bucket are both written by
`scripts/r2-publish.mjs`, run locally (not in CI) whenever you publish a
new album. See "Adding a new album" below.

## Setup

1. Run a local server (needed because pages use ES modules, which browsers
   block over `file://`):
   ```
   python3 -m http.server 8000
   ```
   then open http://localhost:8000
2. Go to `/admin.html` (password gate is skipped locally as long as
   `js/admin-auth.js` has an empty hash, which it does by default — see
   Deploy below). Tag each album's category, and — for NHL albums — pick a
   team. Optionally give an album a friendlier display title/description,
   or pick which album represents each category's home-page tile (defaults
   to the first album in that category — the "Category covers" pickers at
   the top of the page). Click "Copy config" and paste the result over
   `ALBUM_CATEGORIES`, `ALBUM_TEAM`, and `CATEGORY_COVERS` in
   `js/categories.js`, and `ALBUM_META` in `js/album-meta.js`. Untagged
   albums show up under "Uncategorized" (or "Unassigned" within the NHL
   team split) so nothing gets lost. Albums
   titled "K ..." auto-tag to Wife Jerseys.

## Adding a new album

1. `npm install` once (installs `sharp`, used to generate thumbnails).
2. Put the album's photos in a local folder, named in the order you want
   them to appear.
3. Set `R2_BUCKET` and `R2_PUBLIC_BASE` env vars, and make sure `wrangler`
   is authenticated (`npx wrangler login`, or set `CLOUDFLARE_API_TOKEN`).
4. `node scripts/r2-publish.mjs --new "<Album Title>" <folder>` — uploads
   full-resolution photos plus a generated ~640px thumb to
   `albums/<slug>/{cover,full,thumb}` in R2, and writes/updates
   `data/albums.json` + `data/albums/<slug>.json`.
5. Commit the updated `data/albums.json` and `data/albums/<slug>.json`,
   then tag the new album via `/admin.html` as in Setup step 2, and push.

## Deploy

Deploys via GitHub Actions (`.github/workflows/deploy.yml`) instead of a
plain branch deploy, so secrets never have to live in the repo:

1. Repo → Settings → Secrets and variables → Actions → **Secrets** tab, add:
   - `ADMIN_PASSWORD_HASH` — the SHA-256 hash of your `/admin.html`
     password (not the plaintext password itself). Generate it locally:
     `printf '%s' 'your-password' | shasum -a 256` (macOS/BSD) or
     `sha256sum` (Linux) — take the hex string before the space. The
     plaintext password never touches GitHub at all.
2. Repo → Settings → Pages → Source → **GitHub Actions** (not "Deploy from
   branch").
3. Push to `main`. The workflow generates `js/admin-auth.js` from the
   secret and publishes the repo as-is — no data fetch step, since the
   manifest is already committed and images already live in R2.

There's no schedule/cron anymore: nothing goes stale on its own (R2 doesn't
change unless you run `scripts/r2-publish.mjs`), so a normal push is the
only trigger. Publishing a new album is a local step (`r2-publish.mjs`)
followed by a commit — see "Adding a new album" above — which triggers a
deploy the same as any other push.

`ADMIN_PASSWORD_HASH` is just the SHA-256 hash, and that hash is what ships
in `js/admin-auth.js` — the plaintext password never exists in any file,
GitHub secret, or CI log. This keeps casual visitors out of `/admin.html`
but isn't real access control — the hash is public in the shipped JS, so a
determined, technical visitor could brute-force it offline. There's no
exposure of anything sensitive behind it either way (the photos are already
public on the site), so this is meant as a "keep it out of casual view"
gate, not a security boundary.

### Custom domain (collection.libertybelljerseys.com)

A `CNAME` file at the repo root already points GitHub Pages at
`collection.libertybelljerseys.com`. Two more steps, both outside GitHub's
reach (GitHub doesn't manage Cloudflare DNS — there's no integration for
that):

1. In Cloudflare DNS, add a `CNAME` record: `collection` →
   `libertybelljerseys.github.io`.
2. Repo → Settings → Pages → Custom domain → enter
   `collection.libertybelljerseys.com` → Save. Once DNS resolves, GitHub
   provisions HTTPS automatically (can take a few minutes to a few hours).

## Files

- `index.html` — category tiles
- `category.html?cat=<slug>` — team tiles for NHL, or albums for other categories
- `category.html?cat=<slug>&team=<slug>` — albums for one team within NHL
- `album.html?id=<id>` — photo grid + lightbox (prev/next arrows, arrow-key
  navigation) for one album; shows a custom title/description if set
- `admin.html` — password-gated; tag albums into categories/teams and set
  custom titles/descriptions, reading the same committed manifest as the
  public pages
- `js/no-save.js` — blocks the right-click context menu on images (public
  pages only); basic friction, not real protection
- `.wm-pattern`/`.wm-logo` (in `css/style.css`) — display-only watermark on
  the actual jersey photos (album thumbnails + lightbox only — not the
  navigational tiles/cards on the home and category pages): a repeating
  diagonal "LIBERTY BELL JERSEYS" text (`logos/watermark-pattern.svg`) and
  a bottom-right corner logo (`logos/watermark-logo.png` — a recolored copy
  of the LBJ patch/bolt mark, black background made transparent and the
  orange stripe made white so it reads on dark photo backgrounds; to
  regenerate from a source logo:
  `magick source.png -fuzz 20% -transparent black -fuzz 35% -fill white -opaque red watermark-logo.png`).
  Same caveat as
  `no-save.js`: this doesn't touch the actual image files, so anyone who
  gets the raw file gets it unwatermarked — it's deterrence, not baked into
  the pixels. Baking it in for real would mean adding it to the resize step
  in `scripts/r2-publish.mjs`, which was deliberately avoided (extra
  complexity in a script that already touches every photo once).
- `js/data.js` — reads the committed manifest in `data/`; used by both the
  public pages and `admin.html`, with a 5-minute sessionStorage cache
- `data/albums.json`, `data/albums/<id>.json` — the committed manifest;
  `cover`/`thumb`/`full` are R2 URLs
- `scripts/r2-publish.mjs` — Node script (run locally, not in CI) that
  uploads photos to R2 and writes the manifest above; `--migrate` for the
  one-time Flickr→R2 move, `--new "<Title>" <folder>` for publishing a new
  album (see "Adding a new album")
- `js/admin-auth.js` — SHA-256 hash of the admin password (safe to commit;
  overwritten by CI from the `ADMIN_PASSWORD_HASH` secret)
- `.github/workflows/deploy.yml` — builds admin-auth.js from a secret on
  every push to `main`, and publishes to GitHub Pages
- `CNAME` — custom domain for GitHub Pages
- `js/categories.js` — category list, album→category/team mappings, and
  per-category home-page cover overrides (edit this after using admin.html)
- `js/album-meta.js` — optional per-album title/description overrides (edit
  this after using admin.html)
- `js/teams.js` — the NHL teams (slug, label, color, logo)
- `logos/teams/` — team crest PNGs (pulled from the lbj-status project's asset set)
- `backgrounds/texture.jpg` — same background texture as status.libertybelljerseys.com

Category tiles and team tiles show a preview image (a representative album
cover, or the team crest) so there's something to look at while browsing —
no more blank tiles.

The header logo links out to libertybelljerseys.com (new tab) on every
page. The footer (public pages only, not `/admin.html`) links to
libertybelljerseys.com, Instagram, and a contact email, plus the standard
team-logo disclaimer reused from lbj-status.

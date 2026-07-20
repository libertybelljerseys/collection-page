# collection-page

Static site that re-hosts the "Liberty Bell Jerseys" Flickr albums,
organized into browsable categories (Custom Work / NHL / Non-NHL / Wife
Jerseys). NHL further splits by NHL team (teams with no albums are hidden
automatically). Styled to match libertybelljerseys.com's other pages
(status./scf. subdomains).

Every page has static Open Graph/Twitter Card tags (branded title,
description, and the LBJ logo as the preview image) so links unfurl
properly in Discord/Slack/iMessage/etc. They're the same on every page —
there's no server to generate a per-album or per-category preview, since
social unfurl bots fetch the raw HTML and don't run JS. Only really
testable once deployed (bots won't fetch `localhost`).

## How data flows

The public pages (`index.html`, `category.html`, `album.html`) never talk
to Flickr at all, not even for images — they read a fully self-contained
static snapshot in `data/`: JSON (`data/albums.json` plus one
`data/albums/<id>.json` per album) and the actual image files
(`data/images/covers/`, `data/images/photos/`, capped at 2048px — Flickr's
`_k` size — never the original file). A short sessionStorage cache sits on
top of the JSON fetches so repeat navigation within a visit is instant.

That snapshot is built by `scripts/fetch-data.mjs`, which does call the
live Flickr API and download every image — it runs in CI on every deploy
and once a day on a schedule (see `.github/workflows/deploy.yml`), and you
can run it locally too. This exists because Flickr rate-limits (429s)
image requests, especially the original file, more aggressively than a
live per-visitor integration can tolerate; baking everything into the
deploy sidesteps that entirely. It also means the site keeps working even
if Flickr is slow, down, or later closes off hotlinking.

`admin.html` is the one exception: it calls the Flickr API live
(`js/flickr.js`) so sorting/tagging always reflects the current state of
your Flickr account (e.g. an album you just deleted disappears
immediately, instead of waiting for the next snapshot refresh).

Net effect: the Flickr API key only ever needs to exist in two places — the
CI environment (to build the snapshot) and the gated `/admin.html` page
(for live editing). The fully public pages ship zero Flickr credentials and
make zero requests to Flickr.

`data/` is gitignored — none of this ever gets committed. It's regenerated
by CI into the Pages deployment each run (~430MB for ~103 albums/540
photos at the time of writing, well under GitHub Pages' 1GB soft limit).

## Setup

1. Get a free Flickr API key: https://www.flickr.com/services/apps/create/apikey/
   (choose the non-commercial key, it's instant), and find the account's
   NSID (numeric user id — not the @username).
2. `cp js/config.example.js js/config.js` and fill in `apiKey` and
   `userId`. `config.js` is gitignored, so neither ever gets committed.
3. Generate the local data snapshot: `node scripts/fetch-data.mjs` (writes
   `data/`, also gitignored — re-run any time to refresh it).
4. Run a local server (needed because pages use ES modules, which browsers
   block over `file://`):
   ```
   python3 -m http.server 8000
   ```
   then open http://localhost:8000
5. Go to `/admin.html` (password gate is skipped locally as long as
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

## Deploy

Deploys via GitHub Actions (`.github/workflows/deploy.yml`) instead of a
plain branch deploy, so secrets never have to live in the repo:

1. Repo → Settings → Secrets and variables → Actions → **Secrets** tab, add:
   - `FLICKR_API_KEY` — your Flickr key.
   - `FLICKR_USER_ID` — the Flickr NSID. Not sensitive on its own, but kept
     as a secret rather than a repo variable so it's never in the repo.
   - `ADMIN_PASSWORD_HASH` — the SHA-256 hash of your `/admin.html`
     password (not the plaintext password itself). Generate it locally:
     `printf '%s' 'your-password' | shasum -a 256` (macOS/BSD) or
     `sha256sum` (Linux) — take the hex string before the space. The
     plaintext password never touches GitHub at all.
2. Repo → Settings → Pages → Source → **GitHub Actions** (not "Deploy from
   branch").
3. Push to `main`. The workflow generates `js/config.js` and
   `js/admin-auth.js` from the secrets, runs `scripts/fetch-data.mjs` to
   build the `data/` snapshot, then publishes everything.

The workflow also runs on a `schedule` (once a day) and can be triggered
any time from the Actions tab ("Run workflow") — that's how the public
gallery picks up changes made on Flickr (new/deleted albums, retagged
photos) without a code push. `/admin.html` always reflects Flickr
immediately regardless, since it bypasses the snapshot. Daily (not more
often) because this build now downloads every image, not just JSON — no
need to run it more than the site actually changes.

Note on what the secret injection buys `FLICKR_API_KEY`/`FLICKR_USER_ID`:
they're only ever used by CI (to build the snapshot) and by `/admin.html`
(gated, unlinked, `noindex`). The fully public pages ship no Flickr
credentials at all — a real improvement over shipping the key to every
visitor, which is what a pure client-side integration would otherwise
require.

`ADMIN_PASSWORD_HASH` is different again: it's already just the SHA-256
hash, and that hash is what ships in `js/admin-auth.js` — the plaintext
password never exists in any file, GitHub secret, or CI log. This keeps
casual visitors out of `/admin.html` but isn't real access control — the
hash is public in the shipped JS, so a determined, technical visitor could
brute-force it offline. There's no exposure of anything sensitive behind it
either way (the Flickr photos are already public), so this is meant as a
"keep it out of casual view" gate, not a security boundary.

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
  custom titles/descriptions, reading live from Flickr
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
  `no-save.js`: this doesn't touch the actual image files in `data/`, so
  anyone who gets the raw file gets it unwatermarked — it's deterrence, not
  baked into the pixels. Baking it in for real would mean re-encoding every
  image in `scripts/fetch-data.mjs` (a new image-processing dependency and
  a much slower build), which was deliberately avoided.
- `js/data.js` — what the public pages use to read `data/`, with a 5-minute
  sessionStorage cache
- `js/flickr.js` — live Flickr API calls, used by `admin.html` and by
  `scripts/fetch-data.mjs`; caps images at url_k (2048px), never the
  original file
- `scripts/fetch-data.mjs` — Node script that writes the `data/` snapshot,
  including downloading every image (with 429 retry/backoff and a small
  concurrency limit, since Flickr does rate-limit this)
- `data/` — generated, gitignored; the static snapshot (JSON + images)
  public pages read
- `js/config.js` — API key + Flickr user id (gitignored; generated locally
  from `config.example.js`, or by the deploy workflow in CI)
- `js/config.example.js` — checked-in template for the above
- `js/admin-auth.js` — SHA-256 hash of the admin password (safe to commit;
  overwritten by CI from the `ADMIN_PASSWORD_HASH` secret)
- `.github/workflows/deploy.yml` — builds config.js/admin-auth.js/data from
  secrets, on push and on a daily schedule, and publishes to GitHub Pages
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

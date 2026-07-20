# collection-page

Static site that re-hosts the "Liberty Bell Jerseys" Flickr albums,
organized into browsable categories (Custom Work / NHL / Non-NHL / Wife
Jerseys). NHL further splits by NHL team (teams with no albums are hidden
automatically). No backend — pages call the Flickr REST API directly from
the browser. Styled to match libertybelljerseys.com's other pages
(status./scf. subdomains).

## Setup

1. Get a free Flickr API key: https://www.flickr.com/services/apps/create/apikey/
   (choose the non-commercial key, it's instant), and find the account's
   NSID (numeric user id — not the @username).
2. `cp js/config.example.js js/config.js` and fill in `apiKey` and
   `userId`. `config.js` is gitignored, so neither ever gets committed.
3. Run a local server (needed because pages use ES modules, which browsers
   block over `file://`):
   ```
   python3 -m http.server 8000
   ```
   then open http://localhost:8000
4. Go to `/admin.html` (password gate is skipped locally as long as
   `js/admin-auth.js` has an empty hash, which it does by default — see
   Deploy below). Tag each album's category, and — for NHL albums — pick a
   team. Optionally give an album a friendlier display title/description.
   Click "Copy config" and paste the result over `ALBUM_CATEGORIES` and
   `ALBUM_TEAM` in `js/categories.js`, and `ALBUM_META` in
   `js/album-meta.js`. Untagged albums show up under "Uncategorized" (or
   "Unassigned" within the NHL team split) so nothing gets lost. Albums
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
3. Push to `main`. The workflow generates `js/config.js` from
   `js/config.example.js` with the key/user id injected, and writes
   `ADMIN_PASSWORD_HASH` straight through to `js/admin-auth.js`, then
   publishes.

Note on what the secret injection actually buys you: since there's no
backend, `FLICKR_API_KEY` still ends up in the JS shipped to every visitor's
browser (view-source / network tab will show it — there's no way around
that for a pure client-side Flickr integration). What it does get you is
the key never sitting in the repo or git history, so it's not scraped by
secret-scanners or exposed to anyone browsing the source on GitHub. Flickr's
non-commercial key is read-only against public photos, so the blast radius
of it leaking is low regardless.

`ADMIN_PASSWORD_HASH` is different: it's already just the SHA-256 hash, and
that hash is what ships in `js/admin-auth.js` — the plaintext password
never exists in any file, GitHub secret, or CI log. This keeps casual
visitors out of `/admin.html` (it's also not linked from anywhere on
the public site, and is marked `noindex`) but it isn't real access control
— the hash is public in the shipped JS, so a determined, technical visitor
could brute-force it offline. There's no exposure of anything sensitive
behind it either way (the Flickr photos are already public), so this is
meant as a "keep it out of casual view" gate, not a security boundary.

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
  custom titles/descriptions
- `js/config.js` — API key + Flickr user id (gitignored; generated locally
  from `config.example.js`, or by the deploy workflow in CI)
- `js/config.example.js` — checked-in template for the above
- `js/admin-auth.js` — SHA-256 hash of the admin password (safe to commit;
  overwritten by CI from the `ADMIN_PASSWORD_HASH` secret)
- `.github/workflows/deploy.yml` — builds config.js/admin-auth.js from
  secrets and publishes to GitHub Pages
- `CNAME` — custom domain for GitHub Pages
- `js/categories.js` — category list + album→category/team mappings (edit
  this after using admin.html)
- `js/album-meta.js` — optional per-album title/description overrides (edit
  this after using admin.html)
- `js/teams.js` — the NHL teams (slug, label, color, logo)
- `js/flickr.js` — Flickr API calls, requesting the largest available image
  size for the lightbox
- `logos/teams/` — team crest PNGs (pulled from the lbj-status project's asset set)

Category tiles and team tiles show a preview image (a representative album
cover, or the team crest) so there's something to look at while browsing —
no more blank tiles.

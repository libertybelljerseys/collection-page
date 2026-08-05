// Backs admin.html's "Save" button: GET /meta returns the current album
// category/team/cover/title-description assignments (public — the same data
// already ships in plain JS today), POST /save overwrites them, gated by the
// same admin password as admin.html itself. Single R2 object
// (meta/config.json) in the same bucket the photos live in.
//
// GET /zip/:slug streams a zip of an album's full-res photos straight from
// R2 (client-zip builds it on the fly, no buffering) — same public exposure
// as the images already have at img.libertybelljerseys.com.
//
// POST /sync-slug (password-gated) renames an album's R2 folder — copies
// every object under albums/<oldSlug>/ to albums/<newSlug>/, then deletes
// the old ones. Copy-all-before-delete-any so a mid-run failure never loses
// data, worst case is a harmless duplicate. Runs entirely inside the Worker
// (R2-to-R2, no bytes round-tripped through a client) — see
// scripts/sync-r2-slugs.mjs, which keeps R2 folder names aligned with
// album ids after they're renamed in scripts/r2-publish.mjs or admin.html.
import { downloadZip } from 'client-zip';

const META_KEY = 'meta/config.json';
const EMPTY = { albumCategories: {}, albumTeam: {}, categoryCovers: {}, albumMeta: {} };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/meta' && request.method === 'GET') {
      const obj = await env.BUCKET.get(META_KEY);
      const body = obj ? await obj.text() : JSON.stringify(EMPTY);
      return new Response(body, {
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    }

    if (url.pathname === '/save' && request.method === 'POST') {
      const { password, data } = await request.json();
      if (password !== env.ADMIN_PASSWORD) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }
      await env.BUCKET.put(META_KEY, JSON.stringify(data), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache' },
      });
      return new Response('OK', { headers: CORS });
    }

    if (url.pathname === '/sync-slug' && request.method === 'POST') {
      const { password, oldSlug, newSlug } = await request.json();
      if (password !== env.ADMIN_PASSWORD) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }
      if (!oldSlug || !newSlug || oldSlug === newSlug) {
        return new Response('Bad request', { status: 400, headers: CORS });
      }

      const prefix = `albums/${oldSlug}/`;
      const objects = [];
      let cursor;
      do {
        const listed = await env.BUCKET.list({ prefix, cursor });
        objects.push(...listed.objects);
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      for (const o of objects) {
        const obj = await env.BUCKET.get(o.key);
        const newKey = `albums/${newSlug}/${o.key.slice(prefix.length)}`;
        await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
      }
      for (const o of objects) {
        await env.BUCKET.delete(o.key);
      }

      return new Response(JSON.stringify({ moved: objects.length }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.startsWith('/zip/') && request.method === 'GET') {
      const slug = url.pathname.slice('/zip/'.length);
      if (!slug) return new Response('Missing album', { status: 400, headers: CORS });

      const prefix = `albums/${slug}/full/`;
      const objects = [];
      let cursor;
      do {
        const listed = await env.BUCKET.list({ prefix, cursor });
        objects.push(...listed.objects);
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      if (!objects.length) return new Response('Album not found', { status: 404, headers: CORS });
      objects.sort((a, b) => a.key.localeCompare(b.key));

      const files = await Promise.all(objects.map(async (o) => {
        const obj = await env.BUCKET.get(o.key);
        return { name: o.key.slice(prefix.length), input: obj.body, size: obj.size, lastModified: obj.uploaded };
      }));

      const zip = downloadZip(files);
      const headers = new Headers(zip.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      headers.set('Content-Disposition', `attachment; filename="${slug}.zip"`);
      return new Response(zip.body, { headers });
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

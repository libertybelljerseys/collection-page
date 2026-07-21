// Backs admin.html's "Save" button: GET /meta returns the current album
// category/team/cover/title-description assignments (public — the same data
// already ships in plain JS today), POST /save overwrites them, gated by the
// same admin password as admin.html itself. Single R2 object
// (meta/config.json) in the same bucket the photos live in.
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
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
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

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

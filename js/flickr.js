import { FLICKR_CONFIG } from './config.js';

const BASE = 'https://api.flickr.com/services/rest/';

async function call(method, params = {}) {
  const url = new URL(BASE);
  url.search = new URLSearchParams({
    method,
    api_key: FLICKR_CONFIG.apiKey,
    format: 'json',
    nojsoncallback: '1',
    ...params,
  });
  const res = await fetch(url);
  const data = await res.json();
  if (data.stat !== 'ok') throw new Error(data.message || 'Flickr API error');
  return data;
}

export async function getAlbums() {
  const data = await call('flickr.photosets.getList', {
    user_id: FLICKR_CONFIG.userId,
    primary_photo_extras: 'url_q,url_s',
    per_page: 500,
  });
  return data.photosets.photoset.map((p) => ({
    id: p.id,
    title: p.title._content,
    count: Number(p.photos),
    // One step up from the 150px square crop (url_q) — tiles display much
    // larger than that and looked blurry. Note Flickr's extras naming is
    // confusing: url_s ("Small") is the 240px file, url_m ("Medium") is
    // 500px — not what the letters suggest.
    cover: p.primary_photo_extras?.url_s || p.primary_photo_extras?.url_q || '',
  }));
}

export async function getAlbumPhotos(id) {
  const data = await call('flickr.photosets.getPhotos', {
    photoset_id: id,
    user_id: FLICKR_CONFIG.userId,
    extras: 'url_q,url_s,url_c,url_l,url_h,url_k',
  });
  return {
    title: data.photoset.title,
    photos: data.photoset.photo.map((p) => ({
      id: p.id,
      title: p.title,
      // One step up from url_q (150px square, 240px "Small") — grid
      // thumbnails render much larger than 150px.
      thumb: p.url_s || p.url_q,
      // Caps at url_k (2048px). Deliberately never requests url_o (the
      // original file) — Flickr rate-limits original-file requests much
      // more aggressively than its standard derivative sizes, which is
      // what caused 429s on the lightbox.
      full: p.url_k || p.url_h || p.url_l || p.url_c || p.url_q,
    })),
  };
}

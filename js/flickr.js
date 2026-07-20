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
    primary_photo_extras: 'url_q',
    per_page: 500,
  });
  return data.photosets.photoset.map((p) => ({
    id: p.id,
    title: p.title._content,
    count: Number(p.photos),
    cover: p.primary_photo_extras?.url_q || '',
  }));
}

export async function getAlbumPhotos(id) {
  const data = await call('flickr.photosets.getPhotos', {
    photoset_id: id,
    user_id: FLICKR_CONFIG.userId,
    extras: 'url_q,url_c,url_l,url_h,url_k,url_o',
  });
  return {
    title: data.photoset.title,
    photos: data.photoset.photo.map((p) => ({
      id: p.id,
      title: p.title,
      thumb: p.url_q,
      full: p.url_o || p.url_k || p.url_h || p.url_l || p.url_c || p.url_q,
    })),
  };
}

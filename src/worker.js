// Point d'entrée Cloudflare Worker : /api/* → serveur Souki, le reste → fichiers du dossier public/.
// Pour un lien d'annonce (/?annonce=ID), on ajoute l'aperçu (photo, titre, prix) affiché par WhatsApp.
import { onRequest } from './api.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function withAdPreview(request, env, url, id) {
  const res = await env.ASSETS.fetch(new Request(url.origin + '/', request));
  try {
    const row = await env.DB.prepare('SELECT data FROM ads WHERE id = ?').bind(id).first();
    if (!row) return res;
    const a = JSON.parse(row.data);
    const price = new Intl.NumberFormat('fr-FR').format(a.price || 0).replace(/\u202f|\u00a0/g, ' ') + ' MRU';
    const img = a.photos && a.photos[0] ? url.origin + a.photos[0] : url.origin + '/icon-512.png';
    const place = [a.hood, a.city].filter(Boolean).join(', ');
    const desc = (place ? place + ' · ' : '') + String(a.desc || '').slice(0, 140);
    const tags = '<meta property="og:type" content="website"><meta property="og:site_name" content="Souki">' +
      '<meta property="og:title" content="' + esc(a.title + ' – ' + price) + '">' +
      '<meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:image" content="' + esc(img) + '">' +
      '<meta property="og:url" content="' + esc(url.href) + '">' +
      '<meta name="twitter:card" content="summary_large_image">';
    const html = (await res.text()).replace(/<!--og-->[\s\S]*?<!--\/og-->/, tags);
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (e) {
    return res;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return onRequest({ request, env, ctx });
    const id = url.searchParams.get('annonce');
    if (url.pathname === '/' && id) return withAdPreview(request, env, url, id);
    return env.ASSETS.fetch(request);
  },
};

// Point d'entrée Cloudflare Worker : /api/* → serveur Vends-moi, le reste → fichiers du dossier public/.
// Pour un lien d'annonce (/?annonce=ID), on ajoute l'aperçu (photo, titre, prix) affiché par WhatsApp.
import { onRequest } from './api.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function withAdPreview(request, env, url, id) {
  const res = await env.ASSETS.fetch(new Request(url.origin + '/', request));
  try {
    const row = await env.DB.prepare('SELECT data FROM ads WHERE id = ?').bind(id).first();
    if (!row) return res;
    const a = JSON.parse(row.data);
    const old = a.punit === 'old';
    const price = new Intl.NumberFormat('fr-FR').format(old ? (a.priceOld || (a.price || 0) * 10) : (a.price || 0)).replace(/\u202f|\u00a0/g, ' ') + (old ? ' UM (anciennes ouguiyas)' : ' MRU');
    const img = a.photos && a.photos[0] ? url.origin + a.photos[0] : url.origin + '/icon-512.png';
    const place = [a.hood, a.city].filter(Boolean).join(', ');
    const desc = (place ? place + ' · ' : '') + String(a.desc || '').slice(0, 140);
    const tags = '<meta property="og:type" content="website"><meta property="og:site_name" content="Vends-moi">' +
      '<meta property="og:title" content="' + esc((a.trip && /[\u0600-\u06FF]/.test(a.title || '') ? String(a.title).replace(/→/g, '←') : a.title) + ' – ' + price) + '">' +
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

async function withShopPreview(request, env, url, slug) {
  const res = await env.ASSETS.fetch(new Request(url.origin + '/', request));
  try {
    const u = await env.DB.prepare('SELECT shop, avatar, (SELECT COUNT(*) FROM ads a WHERE a.user_id = users.id AND a.status = \'online\') AS n FROM users WHERE shop LIKE ?')
      .bind('%"slug":"' + String(slug).replace(/["%_]/g, '').slice(0, 60) + '"%').first();
    if (!u) return res;
    const sh = JSON.parse(u.shop);
    const img = u.avatar ? url.origin + u.avatar : url.origin + '/icon-512.png';
    const desc = [sh.market, sh.desc, u.n + ' produits sur Vends-moi'].filter(Boolean).join(' · ').slice(0, 200);
    const tags = '<meta property="og:type" content="website"><meta property="og:site_name" content="Vends-moi">' +
      '<meta property="og:title" content="' + esc(sh.name + (sh.verified ? ' ✓' : '') + ' – Boutique Vends-moi') + '">' +
      '<meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:image" content="' + esc(img) + '">' +
      '<meta property="og:url" content="' + esc(url.href) + '">';
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
    const b = url.searchParams.get('b');
    if (url.pathname === '/' && b) return withShopPreview(request, env, url, b);
    return env.ASSETS.fetch(request);
  },
};

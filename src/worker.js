// Point d'entrée Cloudflare Worker : /api/* → serveur Bi3li, le reste → fichiers du dossier public/.
// Pour un lien d'annonce (/?annonce=ID), on ajoute l'aperçu (photo, titre, prix) affiché par WhatsApp.
import { onRequest, cleanupTmp } from './api.js';

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
    const tags = '<meta property="og:type" content="website"><meta property="og:site_name" content="Bi3li">' +
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
    const desc = [sh.market, sh.desc, u.n + ' produits sur Bi3li'].filter(Boolean).join(' · ').slice(0, 200);
    const tags = '<meta property="og:type" content="website"><meta property="og:site_name" content="Bi3li">' +
      '<meta property="og:title" content="' + esc(sh.name + (sh.verified ? ' ✓' : '') + ' – Boutique Bi3li') + '">' +
      '<meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:image" content="' + esc(img) + '">' +
      '<meta property="og:url" content="' + esc(url.href) + '">';
    const html = (await res.text()).replace(/<!--og-->[\s\S]*?<!--\/og-->/, tags);
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (e) {
    return res;
  }
}

// lien entre le site et l'application Android (Google Play) : enlève la barre d'adresse dans l'appli
const ASSETLINKS = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: 'net.bi3li.twa',
    sha256_cert_fingerprints: ['79:7F:E6:FB:0D:8B:C5:78:B9:BD:2C:DE:12:10:A7:EB:B1:E8:F6:F6:0F:B1:C1:9A:96:DF:F6:E9:EF:F5:35:53'],
  },
}];

export default {
  // chaque nuit : suppression des photos de dépôts abandonnés (voir cleanupTmp)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupTmp(env).catch(() => 0));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return onRequest({ request, env, ctx });
    if (url.pathname === '/.well-known/assetlinks.json')
      return new Response(JSON.stringify(ASSETLINKS, null, 2), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' } });
    const id = url.searchParams.get('annonce');
    if (url.pathname === '/' && id) return withAdPreview(request, env, url, id);
    const b = url.searchParams.get('b');
    if (url.pathname === '/' && b) return withShopPreview(request, env, url, b);
    return env.ASSETS.fetch(request);
  },
};

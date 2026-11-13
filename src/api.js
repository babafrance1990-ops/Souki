import { recognise } from './vision.js';
// Vends-moi API — Cloudflare Pages Function, base de données D1 (binding "DB").
// Toutes les routes /api/* passent ici.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT DEFAULT '', shop TEXT, favs TEXT DEFAULT '[]', pass_hash TEXT NOT NULL, salt TEXT NOT NULL, fails INTEGER DEFAULT 0, lock_until INTEGER DEFAULT 0, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, status TEXT DEFAULT 'online', created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ads_created ON ads(created DESC)`,
  `CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, ad_id TEXT, user_id TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS convs (id TEXT PRIMARY KEY, ad_id TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, title TEXT, updated INTEGER NOT NULL, buyer_read INTEGER DEFAULT 0, seller_read INTEGER DEFAULT 0, UNIQUE(ad_id, buyer_id))`,
  `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL, sender_id TEXT NOT NULL, txt TEXT NOT NULL, t INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv_id, t)`,
  `CREATE TABLE IF NOT EXISTS follows (follower_id TEXT NOT NULL, target_id TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (follower_id, target_id))`,
  `CREATE TABLE IF NOT EXISTS reviews (target_id TEXT NOT NULL, author_id TEXT NOT NULL, stars INTEGER NOT NULL, txt TEXT, t INTEGER NOT NULL, PRIMARY KEY (target_id, author_id))`,
  `CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ad_id TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL, n INTEGER NOT NULL, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS video_chunks (vid TEXT NOT NULL, idx INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (vid, idx))`,
  `CREATE TABLE IF NOT EXISTS wa_codes (code TEXT PRIMARY KEY, phone TEXT NOT NULL, purpose TEXT NOT NULL, nonce TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS ad_contacts (ad_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (ad_id, user_id, kind))`,
  `CREATE TABLE IF NOT EXISTS imgsearch (who TEXT NOT NULL, t INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, ad_id TEXT NOT NULL, reporter_id TEXT, reason TEXT, t INTEGER NOT NULL)`,
];
const MIGRATIONS = [`ALTER TABLE users ADD COLUMN blocked INTEGER DEFAULT 0`, `ALTER TABLE users ADD COLUMN avatar TEXT`, `ALTER TABLE users ADD COLUMN last_seen INTEGER DEFAULT 0`, `ALTER TABLE messages ADD COLUMN img TEXT`, `ALTER TABLE users ADD COLUMN searches TEXT DEFAULT '[]'`, `ALTER TABLE ads ADD COLUMN views INTEGER DEFAULT 0`, `ALTER TABLE ads ADD COLUMN contacts INTEGER DEFAULT 0`, `ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0`, `ALTER TABLE users ADD COLUMN lockn INTEGER DEFAULT 0`];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  for (const m of MIGRATIONS) { try { await db.prepare(m).run(); } catch (e) { /* déjà appliquée */ } }
  schemaReady = true;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (code, status = 400) => json({ error: code }, status);
const uid = (p) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const fmtPhone = (p) => p.replace(/(\d{2})(?=\d)/g, '$1 ');

function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

async function hashPass(pass, saltB64) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: 100000 }, key, 256);
  return b64(new Uint8Array(bits));
}
function sameStr(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

function adminList(env) {
  // numéros administrateurs : ADMIN_PHONES (séparés par des virgules), sinon le numéro du support WhatsApp ; on garde les 8 derniers chiffres (+222 / 00222 acceptés)
  const raw = String(env.ADMIN_PHONES || '') + ',' + String(env.SUPPORT_WHATSAPP || '');
  return raw.split(/[,;]+/).map((x) => x.replace(/\D/g, '').slice(-8)).filter((x) => x.length === 8);
}
const WEAK_PINS = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '1212', '1122', '6969', '2580'];
function pinOk(p) { return /^\d{4}$/.test(p) && !WEAK_PINS.includes(p); }
function waOn(env) { return !!(env.WA_NUMBER && env.WA_VERIFY_TOKEN); }
async function waReply(env, to, text) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) return;
  try {
    await fetch('https://graph.facebook.com/v21.0/' + env.WA_PHONE_ID + '/messages', {
      method: 'POST', headers: { authorization: 'Bearer ' + env.WA_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
  } catch (e) { /* tant pis */ }
}
async function waSigOk(env, raw, sig) {
  if (!env.WA_APP_SECRET) return true;
  if (!sig || !sig.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.WA_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sameStr(hex, sig.slice(7));
}
function isAdmin(env, u) {
  return !!u && adminList(env).includes(String(u.phone || '').replace(/\D/g, '').slice(-8));
}
function publicUser(u, env) {
  return { verified: !!u.verified, admin: isAdmin(env || {}, u), avatar: u.avatar || '', id: u.id, phone: fmtPhone(u.phone), name: u.name, city: u.city || '', since: u.created, shop: u.shop ? JSON.parse(u.shop) : null, favs: JSON.parse(u.favs || '[]'), searches: JSON.parse(u.searches || '[]') };
}
async function newSession(db, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)').bind(token, userId, Date.now()).run();
  return token;
}
async function currentUser(db, req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const u = await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND COALESCE(u.blocked, 0) = 0').bind(token).first();
  if (u && Date.now() - (u.last_seen || 0) > 300000) { try { await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), u.id).run(); } catch (e) { /* ignore */ } }
  return u;
}
function adOut(row) {
  const a = JSON.parse(row.data);
  a.id = row.id; a.owner = row.user_id; a.t = row.created; a.status = row.status;
  return a;
}

// Sauvegarde les photos / le message vocal envoyés en "data:" et les remplace par une URL /api/media/...
async function storeMedia(db, userId, adId, dataUrl, maxBytes) {
  const m = /^data:([\w.+\/-]+)(?:;[^,]*)?;base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const bytes = unb64(m[2]);
  if (bytes.length > maxBytes) throw new Error('too_big');
  const id = uid('f');
  await db.prepare('INSERT INTO media (id, ad_id, user_id, mime, bytes, created) VALUES (?, ?, ?, ?, ?, ?)').bind(id, adId, userId, m[1], bytes.buffer, Date.now()).run();
  return '/api/media/' + id;
}

async function claimVideo(db, userId, adId, url) {
  const m = /^\/api\/videos\/(\w+)$/.exec(url || '');
  if (!m) return null;
  const v = await db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').bind(m[1], userId).first();
  if (!v) return null;
  const c = await db.prepare('SELECT COUNT(*) AS n FROM video_chunks WHERE vid = ?').bind(v.id).first();
  if (!c || c.n !== v.n) return null;
  await db.prepare('UPDATE videos SET ad_id = ? WHERE id = ?').bind(adId, v.id).run();
  return '/api/videos/' + v.id;
}
async function dropVideo(db, url) {
  const m = /^\/api\/videos\/(\w+)$/.exec(url || '');
  if (m) await db.batch([db.prepare('DELETE FROM video_chunks WHERE vid = ?').bind(m[1]), db.prepare('DELETE FROM videos WHERE id = ?').bind(m[1])]);
}
async function readBody(req) { try { return await req.json(); } catch (e) { return {}; } }


// ---------- Boutiques ----------
// La fiche complète est dans users.shop ; les annonces n'en gardent qu'un résumé (nom, marché, badge, lien).
function shopSlug(name) {
  const base = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'boutique';
}
async function cleanShop(db, b, prevJson, ownerId) {
  if (!b) return null;
  const prev = prevJson ? JSON.parse(prevJson) : null;
  const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const name = s(b.name, 60);
  if (!name) return null;
  const same = prev && prev.name === name;
  const o = { name, market: s(b.market, 100), desc: s(b.desc, 400), addr: s(b.addr, 160), hours: s(b.hours, 80),
    deliv: !!b.deliv, delivNote: s(b.delivNote, 120), wa: String(b.wa || '').replace(/\D/g, '').slice(-8),
    verified: !!(same && prev.verified), slug: same && prev.slug ? prev.slug : '' };
  if (!o.slug) {
    const base = shopSlug(name);
    for (let i = 1; i < 50; i++) {
      const cand = i === 1 ? base : base + '-' + i;
      const hit = await db.prepare('SELECT id FROM users WHERE shop LIKE ? AND id != ?').bind('%"slug":"' + cand + '"%', ownerId).first();
      if (!hit) { o.slug = cand; break; }
    }
  }
  return JSON.stringify(o);
}
function adShop(shopJson) {
  if (!shopJson) return null;
  const x = JSON.parse(shopJson);
  return { name: x.name, market: x.market || '', verified: !!x.verified, slug: x.slug || '' };
}
async function syncShopAds(db, userId, name, shopJson) {
  const { results } = await db.prepare('SELECT id, data FROM ads WHERE user_id = ?').bind(userId).all();
  const sh = adShop(shopJson);
  const st = results.map((r) => { const a = JSON.parse(r.data); if (name) a.seller = name; if (sh) a.shop = sh; else delete a.shop; return db.prepare('UPDATE ads SET data = ? WHERE id = ?').bind(JSON.stringify(a), r.id); });
  if (st.length) await db.batch(st);
}

export async function onRequest(ctx) {
  const { request: req, env } = ctx;
  const db = env.DB;
  if (!db) return fail('no_database', 500);
  await ensureSchema(db);
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  try {
    // ---------- Médias (photos, vocal) ----------
    if (parts[0] === 'media' && parts[1] && method === 'GET') {
      const r = await db.prepare('SELECT mime, bytes FROM media WHERE id = ?').bind(parts[1]).first();
      if (!r) return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(r.bytes), { headers: { 'content-type': r.mime, 'cache-control': 'public, max-age=31536000, immutable' } });
    }

    // ---------- Vidéos (lecture publique, par plages pour l'iPhone) ----------
    if (parts[0] === 'videos' && parts[1] && method === 'GET') {
      const v = await db.prepare('SELECT * FROM videos WHERE id = ?').bind(parts[1]).first();
      if (!v) return new Response('Not found', { status: 404 });
      const CH = 1500000, total = v.size;
      let start = 0, end = total - 1, partial = false;
      const rg = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      if (rg) { partial = true; if (rg[1]) start = +rg[1]; if (rg[2]) end = Math.min(+rg[2], total - 1); if (!rg[1] && rg[2]) { start = Math.max(0, total - +rg[2]); end = total - 1; } }
      if (start > end || start >= total) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + total } });
      end = Math.min(end, start + 3 * CH - 1);
      const first = Math.floor(start / CH), last = Math.floor(end / CH);
      const { results } = await db.prepare('SELECT idx, bytes FROM video_chunks WHERE vid = ? AND idx BETWEEN ? AND ? ORDER BY idx').bind(v.id, first, last).all();
      const out = new Uint8Array(end - start + 1); let pos = 0;
      for (const c of results) {
        const b = new Uint8Array(c.bytes), off = c.idx * CH;
        const s0 = Math.max(start, off) - off, s1 = Math.min(end + 1, off + b.length) - off;
        if (s1 > s0) { out.set(b.subarray(s0, s1), pos); pos += s1 - s0; }
      }
      const h = { 'content-type': v.mime, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable', 'content-length': String(out.length) };
      if (partial || out.length < total) { h['content-range'] = 'bytes ' + start + '-' + end + '/' + total; return new Response(out, { status: 206, headers: h }); }
      return new Response(out, { status: 200, headers: h });
    }

    // ---------- Comptes ----------
    if (parts[0] === 'auth') {
      const b = await readBody(req);
      const phone = String(b.phone || '').replace(/\D/g, '');
      const pass = String(b.password || '');
      if (parts[1] === 'check' && method === 'POST') {
        if (!/^\d{8}$/.test(phone)) return fail('phone');
        const u = await db.prepare('SELECT id, blocked FROM users WHERE phone = ?').bind(phone).first();
        return json({ exists: !!u, blocked: !!(u && u.blocked) });
      }
      if (parts[1] === 'register' && method === 'POST') {
        const name = String(b.name || '').trim().slice(0, 30);
        if (!/^\d{8}$/.test(phone)) return fail('phone');
        if (!/^\d{4}$/.test(pass)) return fail('pin_format');
        if (!pinOk(pass)) return fail('pin_weak');
        if (!name) return fail('name');
        const exists = await db.prepare('SELECT id FROM users WHERE phone = ?').bind(phone).first();
        if (exists) return fail('exists', 409);
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const id = uid('u');
        await db.prepare('INSERT INTO users (id, phone, name, pass_hash, salt, created) VALUES (?, ?, ?, ?, ?, ?)').bind(id, phone, name, await hashPass(pass, salt), salt, Date.now()).run();
        const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
        return json({ token: await newSession(db, id), user: publicUser(u, env) });
      }
      if (parts[1] === 'login' && method === 'POST') {
        const u = await db.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
        if (!u) return fail('nouser', 404);
        if (u.blocked) return fail('blocked', 403);
        if (u.lock_until > Date.now()) return fail('locked', 429);
        if (!sameStr(await hashPass(pass, u.salt), u.pass_hash)) {
          const fails = (u.fails || 0) + 1, lockn = (u.lockn || 0) + (fails >= 5 ? 1 : 0);
          const wait = Math.min(24 * 3600000, 15 * 60000 * Math.pow(4, Math.max(0, lockn - 1)));
          await db.prepare('UPDATE users SET fails = ?, lock_until = ?, lockn = ? WHERE id = ?').bind(fails >= 5 ? 0 : fails, fails >= 5 ? Date.now() + wait : 0, lockn, u.id).run();
          return fail('badpass', 401);
        }
        await db.prepare('UPDATE users SET fails = 0, lock_until = 0, lockn = 0 WHERE id = ?').bind(u.id).run();
        return json({ token: await newSession(db, u.id), user: publicUser(u, env) });
      }
      if (parts[1] === 'logout' && method === 'POST') {
        const h = req.headers.get('authorization') || '';
        if (h.startsWith('Bearer ')) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(h.slice(7)).run();
        return json({ ok: true });
      }
      return fail('not_found', 404);
    }

    // ---------- WhatsApp : webhook Meta, vérification du numéro, connexion ----------
    if (parts[0] === 'wa' && parts[1] === 'webhook') {
      if (method === 'GET') {
        if (url.searchParams.get('hub.mode') === 'subscribe' && env.WA_VERIFY_TOKEN && url.searchParams.get('hub.verify_token') === env.WA_VERIFY_TOKEN)
          return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
        return new Response('forbidden', { status: 403 });
      }
      if (method === 'POST') {
        const raw = await req.text();
        if (!(await waSigOk(env, raw, req.headers.get('x-hub-signature-256')))) return new Response('bad signature', { status: 401 });
        let body = {}; try { body = JSON.parse(raw); } catch (e) { /* vide */ }
        for (const en of body.entry || []) for (const ch of en.changes || []) for (const m of (ch.value && ch.value.messages) || []) {
          const from = String(m.from || '').replace(/\D/g, '').slice(-8);
          const txt = String((m.text && m.text.body) || (m.button && m.button.text) || '');
          const mm = txt.match(/(?:code|رمز|الرمز)\D{0,3}(\d{6})/i) || txt.match(/(\d{6})/);
          if (!mm) { await waReply(env, m.from, 'Bonjour 👋 Pour vérifier votre numéro ou vous connecter, utilisez le bouton WhatsApp dans l’application Vends-moi.'); continue; }
          const row = await db.prepare('SELECT * FROM wa_codes WHERE code = ? AND done = 0 AND created > ?').bind(mm[1], Date.now() - 15 * 60000).first();
          if (!row || row.phone !== from) { await waReply(env, m.from, 'Ce code ne correspond pas à votre numéro ou a expiré. Recommencez depuis l’application.'); continue; }
          await db.prepare('UPDATE wa_codes SET done = 1 WHERE code = ?').bind(row.code).run();
          await db.prepare('UPDATE users SET verified = 1 WHERE phone = ?').bind(from).run();
          await waReply(env, m.from, row.purpose === 'login' ? '✅ C’est bon ! Retournez dans Vends-moi, vous êtes connecté.' : '✅ Votre numéro est vérifié. Merci !');
        }
        return json({ ok: true });
      }
    }
    if (parts[0] === 'wa' && parts[1] === 'start' && method === 'POST') {
      if (!waOn(env)) return fail('wa_off', 503);
      const b = await readBody(req);
      const viewer = await currentUser(db, req);
      const purpose = b.purpose === 'login' ? 'login' : 'verify';
      let phone = '';
      if (purpose === 'verify') { if (!viewer) return fail('auth', 401); phone = viewer.phone; }
      else {
        phone = String(b.phone || '').replace(/\D/g, '').slice(-8);
        if (!/^\d{8}$/.test(phone)) return fail('phone');
        const u = await db.prepare('SELECT id, blocked FROM users WHERE phone = ?').bind(phone).first();
        if (!u) return fail('nouser', 404);
        if (u.blocked) return fail('blocked', 403);
      }
      const recent = await db.prepare('SELECT COUNT(*) AS n FROM wa_codes WHERE phone = ? AND created > ?').bind(phone, Date.now() - 3600000).first();
      if (recent && recent.n >= 8) return fail('too_many', 429);
      let code = '';
      for (let i = 0; i < 5; i++) { code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); if (!(await db.prepare('SELECT code FROM wa_codes WHERE code = ?').bind(code).first())) break; }
      const nonce = crypto.randomUUID();
      await db.prepare('INSERT INTO wa_codes (code, phone, purpose, nonce, created) VALUES (?, ?, ?, ?, ?)').bind(code, phone, purpose, nonce, Date.now()).run();
      return json({ code, nonce, wa: String(env.WA_NUMBER).replace(/\D/g, '') });
    }
    if (parts[0] === 'wa' && parts[1] === 'status' && method === 'POST') {
      const b = await readBody(req);
      const row = await db.prepare('SELECT * FROM wa_codes WHERE code = ? AND nonce = ?').bind(String(b.code || ''), String(b.nonce || '')).first();
      if (!row) return fail('not_found', 404);
      if (!row.done) return json({ done: false, expired: row.created < Date.now() - 15 * 60000 });
      const u = await db.prepare('SELECT * FROM users WHERE phone = ?').bind(row.phone).first();
      if (!u) return fail('nouser', 404);
      if (row.purpose === 'login') {
        await db.prepare('DELETE FROM wa_codes WHERE code = ?').bind(row.code).run();
        await db.prepare('UPDATE users SET fails = 0, lock_until = 0, lockn = 0 WHERE id = ?').bind(u.id).run();
        return json({ done: true, token: await newSession(db, u.id), user: publicUser(u, env) });
      }
      return json({ done: true, user: publicUser(u, env) });
    }
    if (parts[0] === 'config' && method === 'GET') {
      return json({ support: String(env.SUPPORT_WHATSAPP || '').replace(/\D/g, ''), admins: adminList(env).length, wa: waOn(env) ? String(env.WA_NUMBER).replace(/\D/g, '') : '' });
    }

    // ---------- Recherche par photo (ouverte à tous, 10 par jour et par personne) ----------
    if (parts[0] === 'imgsearch' && method === 'POST') {
      const viewer = await currentUser(db, req);
      const who = viewer ? 'u:' + viewer.id : 'ip:' + (req.headers.get('cf-connecting-ip') || 'x');
      const day = Date.now() - 86400000;
      const used = await db.prepare('SELECT COUNT(*) AS n FROM imgsearch WHERE who = ? AND t > ?').bind(who, day).first();
      if (used && used.n >= 10) return fail('img_limit', 429);
      const b = await readBody(req);
      const m = /^data:image\/[\w.+-]+;base64,(.+)$/.exec(String(b.img || ''));
      if (!m) return fail('invalid');
      const bytes = unb64(m[1]);
      if (bytes.length > 400000) return fail('too_big', 413);
      let r;
      try { r = await recognise(env, bytes); } catch (e) { return fail(e && e.message === 'no_ai' ? 'img_off' : 'img_busy', 503); }
      await db.batch([db.prepare('INSERT INTO imgsearch (who, t) VALUES (?, ?)').bind(who, Date.now()), db.prepare('DELETE FROM imgsearch WHERE t < ?').bind(day)]);
      return json(r);
    }

    // ---------- Annonces (lecture publique) ----------
    if (parts[0] === 'ads' && !parts[1] && method === 'GET') {
      const limit = Math.max(1, Math.min(300, +url.searchParams.get('limit') || 300));
      const before = +url.searchParams.get('before') || 9e15;
      const { results } = await db.prepare('SELECT a.* FROM ads a JOIN users u ON u.id = a.user_id WHERE COALESCE(u.blocked, 0) = 0 AND a.created < ? ORDER BY a.created DESC LIMIT ?').bind(before, limit + 1).all();
      const more = results.length > limit;
      const ads = results.slice(0, limit).map(adOut);
      try {
        const { results: rv } = await db.prepare('SELECT target_id, AVG(stars) AS avg, COUNT(*) AS n FROM reviews GROUP BY target_id').all();
        const R = {}; for (const r of rv) R[r.target_id] = r;
        for (const a of ads) { const r = R[a.owner]; if (r) { a.sr = Math.round(r.avg * 10) / 10; a.sn = r.n; } }
        const { results: vr } = await db.prepare('SELECT id FROM users WHERE verified = 1').all();
        const VS = new Set(vr.map((x) => x.id)); for (const a of ads) if (VS.has(a.owner)) a.sv = 1;
      } catch (e) { /* pas d'avis */ }
      return json({ ads, more });
    }

    // ---------- Vues et contacts (ouverts à tous, même sans compte) ----------
    if (parts[0] === 'ads' && parts[1] && (parts[2] === 'view' || parts[2] === 'contact') && method === 'POST') {
      const row = await db.prepare('SELECT id, user_id FROM ads WHERE id = ?').bind(parts[1]).first();
      if (!row) return fail('not_found', 404);
      const viewer = await currentUser(db, req);
      if (viewer && viewer.id === row.user_id) return json({ ok: true });
      if (parts[2] === 'view') { await db.prepare('UPDATE ads SET views = COALESCE(views, 0) + 1 WHERE id = ?').bind(row.id).run(); return json({ ok: true }); }
      const b = await readBody(req);
      const kind = ['wa', 'call', 'msg'].includes(b.kind) ? b.kind : 'call';
      await db.prepare('UPDATE ads SET contacts = COALESCE(contacts, 0) + 1 WHERE id = ?').bind(row.id).run();
      if (viewer) await db.prepare('INSERT OR REPLACE INTO ad_contacts (ad_id, user_id, kind, t) VALUES (?, ?, ?, ?)').bind(row.id, viewer.id, kind, Date.now()).run();
      return json({ ok: true });
    }

    // ---------- Profil public ----------
    if (parts[0] === 'shops' && parts[1] && method === 'GET') {
      const slug = decodeURIComponent(parts[1]).slice(0, 60);
      const u = await db.prepare('SELECT id FROM users WHERE shop LIKE ? AND COALESCE(blocked, 0) = 0').bind('%"slug":"' + slug.replace(/["%_]/g, '') + '"%').first();
      return u ? json({ id: u.id }) : fail('notfound', 404);
    }
    if (parts[0] === 'users' && parts[1] && method === 'GET') {
      const viewer = await currentUser(db, req);
      const u = await db.prepare('SELECT * FROM users WHERE id = ? AND COALESCE(blocked, 0) = 0').bind(parts[1]).first();
      if (!u) return fail('not_found', 404);
      if (parts[2] === 'reviews') {
        const { results } = await db.prepare('SELECT r.stars, r.txt, r.t, a.name FROM reviews r JOIN users a ON a.id = r.author_id WHERE r.target_id = ? ORDER BY r.t DESC LIMIT 200').bind(u.id).all();
        return json({ reviews: results.map((r) => ({ stars: r.stars, txt: r.txt || '', t: r.t, name: r.name })) });
      }
      const agg = await db.prepare(`SELECT (SELECT COUNT(*) FROM follows WHERE target_id = ?) AS followers,
          (SELECT COUNT(*) FROM reviews WHERE target_id = ?) AS nrev, (SELECT AVG(stars) FROM reviews WHERE target_id = ?) AS avg,
          (SELECT COUNT(*) FROM convs c WHERE c.seller_id = ? AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.sender_id = c.buyer_id)) AS asked,
          (SELECT COUNT(*) FROM convs c WHERE c.seller_id = ? AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.sender_id = c.seller_id)) AS answered`)
        .bind(u.id, u.id, u.id, u.id, u.id).first();
      const out = { id: u.id, name: u.name, city: u.city || '', since: u.created, lastSeen: u.last_seen || 0, avatar: u.avatar || '',
        shop: u.shop ? Object.assign(JSON.parse(u.shop), { wa: JSON.parse(u.shop).wa || u.phone }) : null, followers: agg.followers || 0, rating: { n: agg.nrev || 0, avg: agg.avg ? Math.round(agg.avg * 10) / 10 : 0 },
        reactive: (agg.asked || 0) >= 3 && (agg.answered || 0) / agg.asked >= 0.8, following: false, canReview: false, myReview: null };
      if (viewer && viewer.id !== u.id) {
        out.following = !!(await db.prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND target_id = ?').bind(viewer.id, u.id).first());
        out.canReview = !!(await db.prepare(`SELECT 1 AS x FROM convs c WHERE ((c.buyer_id = ? AND c.seller_id = ?) OR (c.buyer_id = ? AND c.seller_id = ?))
          AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.sender_id = ?)`).bind(viewer.id, u.id, u.id, viewer.id, u.id).first());
        const mr = await db.prepare('SELECT stars, txt FROM reviews WHERE target_id = ? AND author_id = ?').bind(u.id, viewer.id).first();
        if (mr) out.myReview = { stars: mr.stars, txt: mr.txt || '' };
      }
      return json({ user: out });
    }

    // ---------- Tout le reste demande d'être connecté ----------
    const me = await currentUser(db, req);
    if (!me) return fail('auth', 401);

    // Lecture d'une capture d'écran ou d'images tirées d'une vidéo : on renvoie le texte de l'annonce.
    if (parts[0] === 'ai' && parts[1] === 'read' && method === 'POST') {
      const b = await readBody(req);
      const img = String(b.img || '');
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(img);
      if (!m) return fail('invalid');
      if (m[2].length > 1600000) return fail('too_big', 413);
      const who = 'ai:' + me.id, since = Date.now() - 86400000;
      const used = await db.prepare('SELECT COUNT(*) AS n FROM imgsearch WHERE who = ? AND t > ?').bind(who, since).first();
      if (used && used.n >= 60 && !isAdmin(env, me)) return json({ text: '', limit: true });
      await db.prepare('INSERT INTO imgsearch (who, t) VALUES (?, ?)').bind(who, Date.now()).run();
      if (!env.AI) return json({ text: '' });
      const video = !!b.video, ar = b.lang === 'ar';
      // Consignes en anglais (mieux suivies par les modèles), mais le texte lu reste dans sa langue d'origine.
      const sys = 'You read screenshots of classified ads from Mauritania (Facebook, WhatsApp, TikTok, Instagram). The ads are usually written in Arabic (Hassaniya) or French. You are a transcriber, never a translator.';
      const ask = (video ? 'This image puts together several frames of an ad video. ' : '') +
        'Copy the text of the ad exactly as it is written in the image: title, price, description, city or neighbourhood, phone number. ' +
        'IMPORTANT: keep the original language and script. Arabic text must stay in Arabic letters. French text stays in French. Do NOT translate anything, do NOT transliterate. ' +
        'Ignore the app interface (Like, Comment, Share, time, battery, view counts, commenter names). Output only the ad text, nothing else. ' +
        'If there is almost no text, describe the item for sale in one or two short sentences ' + (ar ? 'IN ARABIC' : 'in French') + ' (kind, visible brand, colour, condition).';
      const pick = (r) => { if (!r) return ''; if (typeof r === 'string') return r; if (r.response !== undefined) return r.response;
        if (r.choices && r.choices[0] && r.choices[0].message) return r.choices[0].message.content || ''; return r.description || ''; };
      let out = '', usedModel = '';
      const errs = [];
      const hasAr = (x) => /[؀-ۿ]/.test(String(x || ''));
      // Modèles multilingues d'abord (ils lisent l'arabe), sous deux formes d'appel possibles.
      const tries = [
        ['gemma-a', '@cf/google/gemma-3-12b-it', { messages: [{ role: 'user', content: [{ type: 'text', text: sys + '\n\n' + ask }, { type: 'image_url', image_url: { url: img } }] }], max_tokens: 900, temperature: 0.1 }],
        ['gemma-b', '@cf/google/gemma-3-12b-it', { messages: [{ role: 'user', content: sys + '\n\n' + ask }], image: img, max_tokens: 900, temperature: 0.1 }],
        ['mistral', '@cf/mistralai/mistral-small-3.1-24b-instruct', { messages: [{ role: 'user', content: [{ type: 'text', text: sys + '\n\n' + ask }, { type: 'image_url', image_url: { url: img } }] }], max_tokens: 900, temperature: 0.1 }],
      ];
      for (const [tag, model, input] of tries) {
        try { const r = await env.AI.run(model, input); const o = String(pick(r) || '').trim(); if (o) { out = o; usedModel = tag; break; } errs.push(tag + ': vide'); }
        catch (e) { errs.push(tag + ': ' + String(e && e.message || e).slice(0, 160)); }
      }
      // Llama 3.2 Vision en dernier secours : il ne lit bien que l'anglais.
      if (!out) {
        const vision = '@cf/meta/llama-3.2-11b-vision-instruct';
        const run = () => env.AI.run(vision, { messages: [{ role: 'system', content: sys }, { role: 'user', content: ask }], image: img, max_tokens: 900, temperature: 0.1 });
        try {
          let r;
          try { r = await run(); } catch (e) {
            if (/agree|licen/i.test(String(e && e.message))) { await env.AI.run(vision, { prompt: 'agree' }); r = await run(); } else throw e;
          }
          out = String(pick(r) || '').trim(); usedModel = 'llama';
        } catch (e) { errs.push('llama: ' + String(e && e.message || e).slice(0, 160)); }
      }
      if (!out) return json({ text: '', err: 'busy', dbg: isAdmin(env, me) ? errs : undefined });
      const res = { text: out.slice(0, 4000), model: usedModel, warnLang: ar && usedModel === 'llama' && !hasAr(out) };
      if (isAdmin(env, me)) res.dbg = errs;
      return json(res);
    }
    if (parts[0] === 'ai' && parts[1] === 'parse' && method === 'POST') {
      const b = await readBody(req);
      const text = String(b.text || '').slice(0, 4000).trim();
      if (!text) return json({ items: [] });
      const who = 'ai:' + me.id, since = Date.now() - 86400000;
      const used = await db.prepare('SELECT COUNT(*) AS n FROM imgsearch WHERE who = ? AND t > ?').bind(who, since).first();
      if (used && used.n >= 60 && !isAdmin(env, me)) return json({ items: [], limit: true });
      await db.prepare('INSERT INTO imgsearch (who, t) VALUES (?, ?)').bind(who, Date.now()).run();
      if (!env.AI) return json({ items: [] });
      const schema = String(b.schema || '').slice(0, 3000);
      const isAr = (text.match(/[\u0600-\u06FF]/g) || []).length > (text.match(/[A-Za-z]/g) || []).length;
      const lang = isAr ? 'ARABE (écris le titre et la description en arabe, avec l\'alphabet arabe)' : 'FRANÇAIS';
      const sys = 'Tu lis des petites annonces de Mauritanie (français, arabe, hassanya). Tu réponds UNIQUEMENT avec du JSON valide, sans texte autour. Tu ne traduis JAMAIS : le titre et la description restent dans la langue du texte d\'origine.';
      const ask = (b.multi
        ? 'Le texte est une liste de produits d\'un commerçant. Crée un élément par produit.'
        : 'Le texte est UNE seule annonce. Crée un seul élément.') +
        '\nCatégories et types autorisés (cat: types) :\n' + schema +
        '\nLangue du texte : ' + lang + '. Le titre et la description doivent être dans cette langue, sans traduction.' +
        '\nFormat : {"items":[{"title":"titre court et clair (max 60 caractères, même langue que le texte)","cat":"id de catégorie","type":"id de type ou vide","deal":"sale ou rent (immobilier seulement)","price":nombre ou null,"unit":"new ou old (old si ancienne ouguiya, UM, ou montant très élevé en ouguiya)","city":"ville en français ou vide","desc":"description reprise du texte, sans numéro de téléphone"}]}' +
        '\nTexte :\n' + text;
      const models = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];
      for (const m of models) {
        try {
          const r = await env.AI.run(m, { messages: [{ role: 'system', content: sys }, { role: 'user', content: ask }], max_tokens: 2000, temperature: 0.1 });
          let out = r && (r.response !== undefined ? r.response : r);
          if (typeof out !== 'string') out = JSON.stringify(out);
          const a = out.indexOf('{'), z = out.lastIndexOf('}');
          if (a < 0 || z < a) continue;
          const j = JSON.parse(out.slice(a, z + 1));
          if (j && Array.isArray(j.items)) return json({ items: j.items.slice(0, 40) });
        } catch (e) { /* modèle suivant */ }
      }
      return json({ items: [] });
    }
    if (parts[0] === 'me' && parts[1] === 'pin' && method === 'POST') {
      const b = await readBody(req);
      const pin = String(b.pin || '');
      if (!/^\d{4}$/.test(pin)) return fail('pin_format');
      if (!pinOk(pin)) return fail('pin_weak');
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      await db.prepare('UPDATE users SET pass_hash = ?, salt = ?, fails = 0, lock_until = 0, lockn = 0 WHERE id = ?').bind(await hashPass(pin, salt), salt, me.id).run();
      return json({ ok: true });
    }
    if (parts[0] === 'me' && parts[1] === 'adstats' && method === 'GET') {
      const { results } = await db.prepare('SELECT id, COALESCE(views, 0) AS views, COALESCE(contacts, 0) AS contacts FROM ads WHERE user_id = ?').bind(me.id).all();
      const out = {}; for (const r of results) out[r.id] = { views: r.views, contacts: r.contacts };
      return json({ stats: out });
    }
    if (parts[0] === 'ads' && parts[1] && parts[2] === 'stats' && method === 'GET') {
      const row = await db.prepare('SELECT id, user_id, COALESCE(views, 0) AS views, COALESCE(contacts, 0) AS contacts FROM ads WHERE id = ?').bind(parts[1]).first();
      if (!row || row.user_id !== me.id) return fail('forbidden', 403);
      const { results } = await db.prepare('SELECT c.kind, c.t, u.id AS uid, u.name, u.avatar FROM ad_contacts c JOIN users u ON u.id = c.user_id WHERE c.ad_id = ? ORDER BY c.t DESC LIMIT 100').bind(row.id).all();
      return json({ views: row.views, contacts: row.contacts, people: results.map((r) => ({ kind: r.kind, t: r.t, id: r.uid, name: r.name, avatar: r.avatar || '' })) });
    }
    if (parts[0] === 'me' && parts[1] === 'following' && method === 'GET') {
      const { results } = await db.prepare(`SELECT u.id, u.name, u.city, u.avatar, u.shop, (SELECT COUNT(*) FROM ads a WHERE a.user_id = u.id AND a.status = 'online') AS ads
        FROM follows f JOIN users u ON u.id = f.target_id WHERE f.follower_id = ? AND COALESCE(u.blocked, 0) = 0 ORDER BY f.t DESC LIMIT 200`).bind(me.id).all();
      return json({ users: results.map((u) => ({ id: u.id, name: u.name, city: u.city || '', avatar: u.avatar || '', shop: u.shop ? JSON.parse(u.shop).name : '', ads: u.ads })) });
    }
    if (parts[0] === 'me') {
      if (method === 'GET') return json({ user: publicUser(me, env) });
      if (method === 'PUT') {
        const b = await readBody(req);
        const name = b.name !== undefined ? String(b.name).trim().slice(0, 30) : me.name;
        if (!name) return fail('name');
        const city = b.city !== undefined ? String(b.city).slice(0, 60) : me.city;
        const shop = b.shop !== undefined ? await cleanShop(db, b.shop, me.shop, me.id) : me.shop;
        const favs = Array.isArray(b.favs) ? JSON.stringify(b.favs.map(String).slice(0, 500)) : me.favs;
        if (Array.isArray(b.searches)) {
          const clean = b.searches.slice(0, 50).map((x) => ({ q: String(x.q || '').slice(0, 80), cat: String(x.cat || '').slice(0, 20), city: String(x.city || '').slice(0, 60), hood: String(x.hood || '').slice(0, 60),
            pmin: String(x.pmin || '').replace(/\D/g, '').slice(0, 12), pmax: String(x.pmax || '').replace(/\D/g, '').slice(0, 12), seller: x.seller === 'part' || x.seller === 'pro' ? x.seller : '', tonly: !!x.tonly,
            t: +x.t || Date.now(), seen: +x.seen || Date.now(), alert: x.alert !== false }));
          await db.prepare('UPDATE users SET searches = ? WHERE id = ?').bind(JSON.stringify(clean), me.id).run();
        }
        if (b.avatar !== undefined) {
          let av = '';
          if (b.avatar) av = (await storeMedia(db, me.id, null, b.avatar, 600000)) || '';
          const old = /^\/api\/media\/(\w+)$/.exec(me.avatar || '');
          if (old) await db.prepare('DELETE FROM media WHERE id = ?').bind(old[1]).run();
          await db.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(av, me.id).run();
        }
        await db.prepare('UPDATE users SET name = ?, city = ?, shop = ?, favs = ? WHERE id = ?').bind(name, city, shop, favs, me.id).run();
        if (name !== me.name || shop !== me.shop) {
          await syncShopAds(db, me.id, name, shop);
        }
        const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
        return json({ user: publicUser(u, env) });
      }
    }

    if (parts[0] === 'ads') {
      if (!parts[1] && method === 'POST') {
        const b = await readBody(req);
        const ad = b.ad || {};
        if (!ad.title || !ad.cat || typeof ad.price !== 'number') return fail('invalid');
        const n = await db.prepare('SELECT COUNT(*) AS n FROM ads WHERE user_id = ? AND created > ?').bind(me.id, Date.now() - 86400000).first();
        if (n && n.n >= 60) return fail('too_many', 429);
        const id = uid('a');
        const photos = [];
        for (const p of (Array.isArray(ad.photos) ? ad.photos : []).slice(0, 6)) {
          const u = await storeMedia(db, me.id, id, p, 1500000);
          if (u) photos.push(u);
        }
        ad.photos = photos;
        if (ad.voice) ad.voice = await storeMedia(db, me.id, id, ad.voice, 1600000);
        if (!ad.voice) delete ad.voice;
        ad.video = await claimVideo(db, me.id, id, ad.video);
        if (!ad.video) delete ad.video;
        delete ad.id; delete ad.owner; delete ad.t; delete ad.status; delete ad.sample; delete ad.photosSaved;
        ad.seller = me.name; ad.phone = fmtPhone(me.phone);
        if (me.shop) ad.shop = adShop(me.shop); else delete ad.shop;
        const created = Date.now();
        await db.prepare('INSERT INTO ads (id, user_id, data, status, created) VALUES (?, ?, ?, ?, ?)').bind(id, me.id, JSON.stringify(ad), 'online', created).run();
        return json({ ad: adOut({ id, user_id: me.id, data: JSON.stringify(ad), status: 'online', created }) });
      }
      const row = parts[1] ? await db.prepare('SELECT * FROM ads WHERE id = ?').bind(parts[1]).first() : null;
      if (!row) return fail('not_found', 404);
      if (parts[2] === 'report' && method === 'POST') {
        const b = await readBody(req);
        const dup = await db.prepare('SELECT id FROM reports WHERE ad_id = ? AND reporter_id = ?').bind(row.id, me.id).first();
        if (!dup) await db.prepare('INSERT INTO reports (ad_id, reporter_id, reason, t) VALUES (?, ?, ?, ?)').bind(row.id, me.id, String(b.reason || '').slice(0, 300), Date.now()).run();
        return json({ ok: true });
      }
      const admin = isAdmin(env, me);
      if (row.user_id !== me.id && !(admin && !parts[2] && method === 'DELETE')) return fail('forbidden', 403);
      if (!parts[2] && method === 'PUT') {
        const b = await readBody(req);
        const ad = b.ad || {};
        if (!ad.title || !ad.cat || typeof ad.price !== 'number') return fail('invalid');
        const keep = [], photos = [];
        for (const p of (Array.isArray(ad.photos) ? ad.photos : []).slice(0, 6)) {
          const m = /^\/api\/media\/(\w+)$/.exec(p || '');
          if (m) {
            const own = await db.prepare('SELECT id FROM media WHERE id = ? AND ad_id = ?').bind(m[1], row.id).first();
            if (own) { keep.push(m[1]); photos.push(p); }
          } else {
            const u = await storeMedia(db, me.id, row.id, p, 1500000);
            if (u) { keep.push(u.split('/').pop()); photos.push(u); }
          }
        }
        ad.photos = photos;
        const vm = /^\/api\/media\/(\w+)$/.exec(ad.voice || '');
        if (vm) keep.push(vm[1]);
        else if (ad.voice) { ad.voice = await storeMedia(db, me.id, row.id, ad.voice, 1600000); if (ad.voice) keep.push(ad.voice.split('/').pop()); }
        if (!ad.voice) delete ad.voice;
        const oldVid = JSON.parse(row.data).video;
        ad.video = await claimVideo(db, me.id, row.id, ad.video);
        if (!ad.video) delete ad.video;
        if (oldVid && oldVid !== ad.video) await dropVideo(db, oldVid);
        const { results: old } = await db.prepare('SELECT id FROM media WHERE ad_id = ?').bind(row.id).all();
        const drop = old.filter((o) => !keep.includes(o.id)).map((o) => db.prepare('DELETE FROM media WHERE id = ?').bind(o.id));
        if (drop.length) await db.batch(drop);
        delete ad.id; delete ad.owner; delete ad.t; delete ad.status; delete ad.sample;
        ad.seller = me.name; ad.phone = fmtPhone(me.phone);
        if (me.shop) ad.shop = adShop(me.shop); else delete ad.shop;
        ad.edited = Date.now();
        await db.prepare('UPDATE ads SET data = ? WHERE id = ?').bind(JSON.stringify(ad), row.id).run();
        return json({ ad: adOut({ ...row, data: JSON.stringify(ad) }) });
      }
      if (parts[2] === 'bump' && method === 'POST' && row.user_id === me.id) {
        const a = JSON.parse(row.data), last = a.bumpedAt || row.created, wait = 7 * 86400000;
        if (row.status === 'sold') return fail('sold');
        if (Date.now() - last < wait) return json({ error: 'too_soon', next: last + wait }, 429);
        const now = Date.now();
        a.bumpedAt = now; if (!a.firstAt) a.firstAt = row.created;
        await db.prepare('UPDATE ads SET created = ?, data = ? WHERE id = ?').bind(now, JSON.stringify(a), row.id).run();
        return json({ ad: adOut({ ...row, created: now, data: JSON.stringify(a) }) });
      }
      if (parts[2] === 'sold' && method === 'POST') {
        await db.prepare("UPDATE ads SET status = 'sold' WHERE id = ?").bind(row.id).run();
        return json({ ok: true });
      }
      if (!parts[2] && method === 'DELETE') {
        const vd = JSON.parse(row.data).video;
        if (vd) await dropVideo(db, vd);
        await db.batch([db.prepare('DELETE FROM ads WHERE id = ?').bind(row.id), db.prepare('DELETE FROM media WHERE ad_id = ?').bind(row.id), db.prepare('DELETE FROM reports WHERE ad_id = ?').bind(row.id)]);
        return json({ ok: true });
      }
    }

    if (parts[0] === 'users' && parts[1] && method === 'POST') {
      const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(parts[1]).first();
      if (!u) return fail('not_found', 404);
      if (u.id === me.id) return fail('self');
      const b = await readBody(req);
      if (parts[2] === 'follow') {
        if (b.on) await db.prepare('INSERT OR IGNORE INTO follows (follower_id, target_id, t) VALUES (?, ?, ?)').bind(me.id, u.id, Date.now()).run();
        else await db.prepare('DELETE FROM follows WHERE follower_id = ? AND target_id = ?').bind(me.id, u.id).run();
        return json({ ok: true });
      }
      if (parts[2] === 'reviews') {
        const stars = Math.round(+b.stars);
        if (!(stars >= 1 && stars <= 5)) return fail('stars');
        const ok = await db.prepare(`SELECT 1 AS x FROM convs c WHERE ((c.buyer_id = ? AND c.seller_id = ?) OR (c.buyer_id = ? AND c.seller_id = ?))
          AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.sender_id = ?)`).bind(me.id, u.id, u.id, me.id, u.id).first();
        if (!ok) return fail('no_contact', 403);
        await db.prepare('INSERT OR REPLACE INTO reviews (target_id, author_id, stars, txt, t) VALUES (?, ?, ?, ?, ?)').bind(u.id, me.id, stars, String(b.txt || '').trim().slice(0, 500), Date.now()).run();
        return json({ ok: true });
      }
    }

    // ---------- Administration ----------
    if (parts[0] === 'admin') {
      if (!isAdmin(env, me)) return fail('forbidden', 403);
      if (parts[1] === 'users' && !parts[2] && method === 'POST') {
        const b = await readBody(req);
        const phone = String(b.phone || '').replace(/\D/g, '').slice(-8);
        const name = String(b.name || '').trim().slice(0, 30);
        if (!/^\d{8}$/.test(phone)) return fail('phone');
        if (!name) return fail('name');
        if (await db.prepare('SELECT id FROM users WHERE phone = ?').bind(phone).first()) return fail('exists', 409);
        let pass = '';
        do { pass = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0'); } while (!pinOk(pass));
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        await db.prepare('INSERT INTO users (id, phone, name, pass_hash, salt, created) VALUES (?, ?, ?, ?, ?, ?)').bind(uid('u'), phone, name, await hashPass(pass, salt), salt, Date.now()).run();
        return json({ phone, name, pass });
      }
      if (parts[1] === 'shops' && method === 'GET') {
        const { results } = await db.prepare(`SELECT u.id, u.phone, u.name, u.shop, (SELECT COUNT(*) FROM ads a WHERE a.user_id = u.id AND a.status = 'online') AS ads
          FROM users u WHERE u.shop IS NOT NULL AND u.shop != '' ORDER BY u.created DESC LIMIT 200`).all();
        return json({ shops: results.map((u) => ({ id: u.id, phone: fmtPhone(u.phone), name: u.name, ads: u.ads, shop: JSON.parse(u.shop) })) });
      }
      if (parts[1] === 'overview' && method === 'GET') {
        const day = Date.now() - 86400000;
        const c = await db.prepare(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE created > ?) AS users24,
          (SELECT COUNT(*) FROM ads WHERE status = 'online') AS online, (SELECT COUNT(*) FROM ads WHERE created > ?) AS ads24,
          (SELECT COUNT(*) FROM messages WHERE t > ?) AS msgs24`).bind(day, day, day).first();
        const { results: reps } = await db.prepare(`SELECT r.ad_id, COUNT(*) AS n, MAX(r.t) AS last, GROUP_CONCAT(r.reason, ' | ') AS reasons, a.data, a.user_id, u.name, u.phone
          FROM reports r JOIN ads a ON a.id = r.ad_id JOIN users u ON u.id = a.user_id GROUP BY r.ad_id ORDER BY last DESC LIMIT 100`).all();
        return json({ counts: c, reports: reps.map((r) => ({ adId: r.ad_id, n: r.n, last: r.last, reasons: (r.reasons || '').replace(/^[ |]+|[ |]+$/g, ''), title: JSON.parse(r.data).title, ownerId: r.user_id, ownerName: r.name, ownerPhone: fmtPhone(r.phone) })) });
      }
      if (parts[1] === 'users' && !parts[2] && method === 'GET') {
        const q = (url.searchParams.get('q') || '').replace(/\D/g, '');
        const { results } = await db.prepare(`SELECT u.id, u.phone, u.name, u.created, COALESCE(u.blocked, 0) AS blocked, (SELECT COUNT(*) FROM ads a WHERE a.user_id = u.id) AS ads
          FROM users u WHERE u.phone LIKE ? ORDER BY u.created DESC LIMIT 50`).bind('%' + q + '%').all();
        return json({ users: results.map((u) => ({ id: u.id, phone: fmtPhone(u.phone), name: u.name, since: u.created, blocked: !!u.blocked, ads: u.ads })) });
      }
      const target = parts[1] === 'users' && parts[2] ? await db.prepare('SELECT * FROM users WHERE id = ?').bind(parts[2]).first() : null;
      if (target && method === 'POST') {
        const b = await readBody(req);
        if (parts[3] === 'shopverify') {
          if (!target.shop) return fail('noshop');
          const sh = JSON.parse(target.shop); sh.verified = !!b.verified;
          const js = JSON.stringify(sh);
          await db.prepare('UPDATE users SET shop = ? WHERE id = ?').bind(js, target.id).run();
          await syncShopAds(db, target.id, null, js);
          return json({ ok: true, verified: sh.verified });
        }
        if (parts[3] === 'password') {
          const pass = String(b.password || '');
          if (!/^\d{4}$/.test(pass) && pass.length < 6) return fail('pin_format');
          const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
          await db.batch([
            db.prepare('UPDATE users SET pass_hash = ?, salt = ?, fails = 0, lock_until = 0 WHERE id = ?').bind(await hashPass(pass, salt), salt, target.id),
            db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
          ]);
          return json({ ok: true });
        }
        if (parts[3] === 'block') {
          if (target.id === me.id) return fail('self');
          const v = b.blocked ? 1 : 0;
          const st = [db.prepare('UPDATE users SET blocked = ? WHERE id = ?').bind(v, target.id)];
          if (v) st.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id));
          await db.batch(st);
          return json({ ok: true });
        }
      }
      if (parts[1] === 'reports' && parts[2] && method === 'DELETE') {
        await db.prepare('DELETE FROM reports WHERE ad_id = ?').bind(parts[2]).run();
        return json({ ok: true });
      }
      return fail('not_found', 404);
    }

    // ---------- Envoi d'une vidéo (morceaux de 1,5 Mo, 8 Mo max) ----------
    if (parts[0] === 'videos') {
      if (!parts[1] && method === 'POST') {
        const b = await readBody(req);
        const size = +b.size || 0, n = Math.ceil(size / 1500000);
        if (!size || size > 8000000) return fail('too_big', 413);
        if (!/^video\/(mp4|webm|quicktime)/.test(String(b.mime || ''))) return fail('invalid');
        const day = await db.prepare('SELECT COUNT(*) AS n FROM videos WHERE user_id = ? AND created > ?').bind(me.id, Date.now() - 86400000).first();
        if (day && day.n >= 20) return fail('too_many', 429);
        const id = uid('v');
        await db.prepare('INSERT INTO videos (id, user_id, mime, size, n, created) VALUES (?, ?, ?, ?, ?, ?)').bind(id, me.id, String(b.mime).split(';')[0], size, n, Date.now()).run();
        return json({ id, chunk: 1500000, n });
      }
      const v = parts[1] ? await db.prepare('SELECT * FROM videos WHERE id = ?').bind(parts[1]).first() : null;
      if (!v || v.user_id !== me.id) return fail('not_found', 404);
      if (parts[2] !== undefined && method === 'PUT') {
        const idx = +parts[2];
        if (!(idx >= 0 && idx < v.n)) return fail('invalid');
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (!bytes.length || bytes.length > 1500000) return fail('invalid');
        await db.prepare('INSERT OR REPLACE INTO video_chunks (vid, idx, bytes) VALUES (?, ?, ?)').bind(v.id, idx, bytes.buffer).run();
        return json({ ok: true });
      }
    }

    // ---------- Messagerie ----------
    if (parts[0] === 'convs') {
      if (!parts[1] && method === 'GET') {
        const { results: cs } = await db.prepare(
          `SELECT c.*, ub.name AS buyer_name, us.name AS seller_name, ub.created AS buyer_created, us.created AS seller_created, ub.city AS buyer_city, us.city AS seller_city, ub.avatar AS buyer_avatar, us.avatar AS seller_avatar, ub.id AS bid, us.id AS sid FROM convs c JOIN users ub ON ub.id = c.buyer_id JOIN users us ON us.id = c.seller_id
           WHERE c.buyer_id = ? OR c.seller_id = ? ORDER BY c.updated DESC LIMIT 200`).bind(me.id, me.id).all();
        if (!cs.length) return json({ convs: [] });
        const ids = cs.map((c) => c.id);
        const { results: ms } = await db.prepare(`SELECT * FROM messages WHERE conv_id IN (${ids.map(() => '?').join(',')}) ORDER BY t`).bind(...ids).all();
        return json({ convs: cs.map((c) => {
          const buyer = c.buyer_id === me.id, read = buyer ? c.buyer_read : c.seller_read;
          const msgs = ms.filter((m) => m.conv_id === c.id).map((m) => ({ me: m.sender_id === me.id, txt: m.txt, t: m.t, img: m.img || '' }));
          return { id: c.id, adId: c.ad_id, title: c.title, seller: buyer ? c.seller_name : c.buyer_name, otherSince: buyer ? c.seller_created : c.buyer_created, otherCity: (buyer ? c.seller_city : c.buyer_city) || '', otherRead: buyer ? c.seller_read : c.buyer_read, otherId: buyer ? c.seller_id : c.buyer_id, otherAvatar: (buyer ? c.seller_avatar : c.buyer_avatar) || '', buyer, updated: c.updated, msgs, unread: msgs.filter((m) => !m.me && m.t > read).length };
        }) });
      }
      if (!parts[1] && method === 'POST') {
        const b = await readBody(req);
        const ad = await db.prepare('SELECT * FROM ads WHERE id = ?').bind(String(b.adId || '')).first();
        if (!ad) return fail('not_found', 404);
        if (ad.user_id === me.id) return fail('own_ad');
        try { await db.prepare('INSERT OR REPLACE INTO ad_contacts (ad_id, user_id, kind, t) VALUES (?, ?, ?, ?)').bind(ad.id, me.id, 'msg', Date.now()).run(); } catch (e) { /* ignore */ }
        let c = await db.prepare('SELECT id FROM convs WHERE ad_id = ? AND buyer_id = ?').bind(ad.id, me.id).first();
        if (!c) {
          c = { id: uid('c') };
          await db.prepare('INSERT INTO convs (id, ad_id, buyer_id, seller_id, title, updated, buyer_read) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(c.id, ad.id, me.id, ad.user_id, JSON.parse(ad.data).title, Date.now(), Date.now()).run();
        }
        return json({ id: c.id });
      }
      const c = parts[1] ? await db.prepare('SELECT * FROM convs WHERE id = ?').bind(parts[1]).first() : null;
      if (!c || (c.buyer_id !== me.id && c.seller_id !== me.id)) return fail('not_found', 404);
      const col = c.buyer_id === me.id ? 'buyer_read' : 'seller_read';
      if (parts[2] === 'messages' && method === 'POST') {
        const b = await readBody(req);
        const txt = String(b.txt || '').trim().slice(0, 500);
        let img = null;
        if (b.img) img = await storeMedia(db, me.id, null, b.img, 1500000);
        if (!txt && !img) return fail('empty');
        const t = Date.now();
        await db.batch([
          db.prepare('INSERT INTO messages (conv_id, sender_id, txt, t, img) VALUES (?, ?, ?, ?, ?)').bind(c.id, me.id, txt, t, img),
          db.prepare(`UPDATE convs SET updated = ?, ${col} = ? WHERE id = ?`).bind(t, t, c.id),
        ]);
        return json({ ok: true, t, img });
      }
      if (parts[2] === 'read' && method === 'POST') {
        await db.prepare(`UPDATE convs SET ${col} = ? WHERE id = ?`).bind(Date.now(), c.id).run();
        return json({ ok: true });
      }
    }

    return fail('not_found', 404);
  } catch (e) {
    if (e && e.message === 'too_big') return fail('too_big', 413);
    return fail('server', 500);
  }
}

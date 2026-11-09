// Souki API — Cloudflare Pages Function, base de données D1 (binding "DB").
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
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
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

function publicUser(u) {
  return { id: u.id, phone: fmtPhone(u.phone), name: u.name, city: u.city || '', since: u.created, shop: u.shop ? JSON.parse(u.shop) : null, favs: JSON.parse(u.favs || '[]') };
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
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').bind(token).first();
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

async function readBody(req) { try { return await req.json(); } catch (e) { return {}; } }

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

    // ---------- Comptes ----------
    if (parts[0] === 'auth') {
      const b = await readBody(req);
      const phone = String(b.phone || '').replace(/\D/g, '');
      const pass = String(b.password || '');
      if (parts[1] === 'register' && method === 'POST') {
        const name = String(b.name || '').trim().slice(0, 30);
        if (!/^\d{8}$/.test(phone)) return fail('phone');
        if (pass.length < 6) return fail('pass_short');
        if (!name) return fail('name');
        const exists = await db.prepare('SELECT id FROM users WHERE phone = ?').bind(phone).first();
        if (exists) return fail('exists', 409);
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const id = uid('u');
        await db.prepare('INSERT INTO users (id, phone, name, pass_hash, salt, created) VALUES (?, ?, ?, ?, ?, ?)').bind(id, phone, name, await hashPass(pass, salt), salt, Date.now()).run();
        const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
        return json({ token: await newSession(db, id), user: publicUser(u) });
      }
      if (parts[1] === 'login' && method === 'POST') {
        const u = await db.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
        if (!u) return fail('nouser', 404);
        if (u.lock_until > Date.now()) return fail('locked', 429);
        if (!sameStr(await hashPass(pass, u.salt), u.pass_hash)) {
          const fails = (u.fails || 0) + 1;
          await db.prepare('UPDATE users SET fails = ?, lock_until = ? WHERE id = ?').bind(fails >= 5 ? 0 : fails, fails >= 5 ? Date.now() + 15 * 60000 : 0, u.id).run();
          return fail('badpass', 401);
        }
        await db.prepare('UPDATE users SET fails = 0, lock_until = 0 WHERE id = ?').bind(u.id).run();
        return json({ token: await newSession(db, u.id), user: publicUser(u) });
      }
      if (parts[1] === 'logout' && method === 'POST') {
        const h = req.headers.get('authorization') || '';
        if (h.startsWith('Bearer ')) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(h.slice(7)).run();
        return json({ ok: true });
      }
      return fail('not_found', 404);
    }

    // ---------- Annonces (lecture publique) ----------
    if (parts[0] === 'ads' && !parts[1] && method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM ads ORDER BY created DESC LIMIT 1000').all();
      return json({ ads: results.map(adOut) });
    }

    // ---------- Tout le reste demande d'être connecté ----------
    const me = await currentUser(db, req);
    if (!me) return fail('auth', 401);

    if (parts[0] === 'me') {
      if (method === 'GET') return json({ user: publicUser(me) });
      if (method === 'PUT') {
        const b = await readBody(req);
        const name = b.name !== undefined ? String(b.name).trim().slice(0, 30) : me.name;
        if (!name) return fail('name');
        const city = b.city !== undefined ? String(b.city).slice(0, 60) : me.city;
        const shop = b.shop !== undefined ? (b.shop ? JSON.stringify({ name: String(b.shop.name || '').slice(0, 60), market: String(b.shop.market || '').slice(0, 100) }) : null) : me.shop;
        const favs = Array.isArray(b.favs) ? JSON.stringify(b.favs.map(String).slice(0, 500)) : me.favs;
        await db.prepare('UPDATE users SET name = ?, city = ?, shop = ?, favs = ? WHERE id = ?').bind(name, city, shop, favs, me.id).run();
        if (name !== me.name || shop !== me.shop) {
          const { results } = await db.prepare('SELECT id, data FROM ads WHERE user_id = ?').bind(me.id).all();
          const st = results.map((r) => { const a = JSON.parse(r.data); a.seller = name; if (shop) a.shop = JSON.parse(shop); else delete a.shop; return db.prepare('UPDATE ads SET data = ? WHERE id = ?').bind(JSON.stringify(a), r.id); });
          if (st.length) await db.batch(st);
        }
        const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
        return json({ user: publicUser(u) });
      }
    }

    if (parts[0] === 'ads') {
      if (!parts[1] && method === 'POST') {
        const b = await readBody(req);
        const ad = b.ad || {};
        if (!ad.title || !ad.cat || typeof ad.price !== 'number') return fail('invalid');
        const n = await db.prepare('SELECT COUNT(*) AS n FROM ads WHERE user_id = ? AND created > ?').bind(me.id, Date.now() - 86400000).first();
        if (n && n.n >= 30) return fail('too_many', 429);
        const id = uid('a');
        const photos = [];
        for (const p of (Array.isArray(ad.photos) ? ad.photos : []).slice(0, 4)) {
          const u = await storeMedia(db, me.id, id, p, 1500000);
          if (u) photos.push(u);
        }
        ad.photos = photos;
        if (ad.voice) ad.voice = await storeMedia(db, me.id, id, ad.voice, 1600000);
        if (!ad.voice) delete ad.voice;
        delete ad.id; delete ad.owner; delete ad.t; delete ad.status; delete ad.sample; delete ad.photosSaved;
        ad.seller = me.name; ad.phone = fmtPhone(me.phone);
        if (me.shop) ad.shop = JSON.parse(me.shop); else delete ad.shop;
        const created = Date.now();
        await db.prepare('INSERT INTO ads (id, user_id, data, status, created) VALUES (?, ?, ?, ?, ?)').bind(id, me.id, JSON.stringify(ad), 'online', created).run();
        return json({ ad: adOut({ id, user_id: me.id, data: JSON.stringify(ad), status: 'online', created }) });
      }
      const row = parts[1] ? await db.prepare('SELECT * FROM ads WHERE id = ?').bind(parts[1]).first() : null;
      if (!row) return fail('not_found', 404);
      if (row.user_id !== me.id) return fail('forbidden', 403);
      if (parts[2] === 'sold' && method === 'POST') {
        await db.prepare("UPDATE ads SET status = 'sold' WHERE id = ?").bind(row.id).run();
        return json({ ok: true });
      }
      if (!parts[2] && method === 'DELETE') {
        await db.batch([db.prepare('DELETE FROM ads WHERE id = ?').bind(row.id), db.prepare('DELETE FROM media WHERE ad_id = ?').bind(row.id)]);
        return json({ ok: true });
      }
    }

    // ---------- Messagerie ----------
    if (parts[0] === 'convs') {
      if (!parts[1] && method === 'GET') {
        const { results: cs } = await db.prepare(
          `SELECT c.*, ub.name AS buyer_name, us.name AS seller_name FROM convs c JOIN users ub ON ub.id = c.buyer_id JOIN users us ON us.id = c.seller_id
           WHERE c.buyer_id = ? OR c.seller_id = ? ORDER BY c.updated DESC LIMIT 200`).bind(me.id, me.id).all();
        if (!cs.length) return json({ convs: [] });
        const ids = cs.map((c) => c.id);
        const { results: ms } = await db.prepare(`SELECT * FROM messages WHERE conv_id IN (${ids.map(() => '?').join(',')}) ORDER BY t`).bind(...ids).all();
        return json({ convs: cs.map((c) => {
          const buyer = c.buyer_id === me.id, read = buyer ? c.buyer_read : c.seller_read;
          const msgs = ms.filter((m) => m.conv_id === c.id).map((m) => ({ me: m.sender_id === me.id, txt: m.txt, t: m.t }));
          return { id: c.id, adId: c.ad_id, title: c.title, seller: buyer ? c.seller_name : c.buyer_name, buyer, updated: c.updated, msgs, unread: msgs.filter((m) => !m.me && m.t > read).length };
        }) });
      }
      if (!parts[1] && method === 'POST') {
        const b = await readBody(req);
        const ad = await db.prepare('SELECT * FROM ads WHERE id = ?').bind(String(b.adId || '')).first();
        if (!ad) return fail('not_found', 404);
        if (ad.user_id === me.id) return fail('own_ad');
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
        if (!txt) return fail('empty');
        const t = Date.now();
        await db.batch([
          db.prepare('INSERT INTO messages (conv_id, sender_id, txt, t) VALUES (?, ?, ?, ?)').bind(c.id, me.id, txt, t),
          db.prepare(`UPDATE convs SET updated = ?, ${col} = ? WHERE id = ?`).bind(t, t, c.id),
        ]);
        return json({ ok: true, t });
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

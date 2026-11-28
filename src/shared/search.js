// Recherche dans les annonces, comme sur le site : tout se fait sur le téléphone, sur la liste complète.
// Chaque mot tapé doit se trouver dans l'annonce, OU un mot équivalent (frigo ↔ ثلاجة ↔ tallaja, villa ↔ فيلا…).
import { CATEGORIES } from './categories';
import { cityName, NKC, WILAYAS } from './places';
import { SYN_GROUPS } from './synonyms';

// Même normalisation que le site : minuscules, sans accents, أ/إ/آ → ا, ة → ه, ى → ي, sans voyelles arabes
export function norm(s) {
  s = String(s ?? '').toLowerCase();
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch {}
  return s.replace(/­/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '');
}

// Les marques et modèles ne sont PAS des synonymes entre eux (hilux ≠ corolla) : on les retire des groupes généraux
// et on garde seulement leur traduction (toyota ↔ تويوتا, hilux ↔ هيلكس…).
const NAMES = [
  ['toyota', 'تويوتا'], ['hilux', 'هيلكس', 'هيليكس'], ['corolla', 'كورولا'], ['avensis', 'افنسيس', 'افينسيس'], ['yaris', 'ياريس'],
  ['prado', 'برادو'], ['land cruiser', 'لاند كروزر', 'v8'], ['rav4', 'راف فور'], ['mercedes', 'مرسيدس'], ['hyundai', 'هيونداي'],
  ['nissan', 'نيسان'], ['peugeot', 'بيجو'], ['kia', 'كيا'], ['renault', 'رينو'], ['mitsubishi', 'ميتسوبيشي'], ['ford', 'فورد'],
  ['suzuki', 'سوزوكي'], ['land rover', 'لاند روفر'], ['volkswagen', 'فولكس فاجن'], ['honda', 'هوندا'], ['isuzu', 'ايسوزو'],
  ['iphone', 'ايفون', 'آيفون'], ['samsung', 'سامسونج', 'سامسونغ'], ['galaxy', 'جالاكسي', 'غالاكسي'], ['tecno', 'تكنو'],
  ['itel', 'ايتل'], ['infinix', 'انفينكس'], ['redmi', 'ريدمي'], ['xiaomi', 'شاومي'], ['huawei', 'هواوي'], ['oppo', 'اوبو'],
  ['nokia', 'نوكيا'], ['apple', 'ابل'], ['lg', 'ال جي'], ['sony', 'سوني'], ['playstation', 'بلايستيشن', 'ps4', 'ps5'],
  ['hp', 'اتش بي'], ['dell', 'ديل'], ['lenovo', 'لينوفو'], ['macbook', 'ماك بوك'], ['yamaha', 'ياماها'], ['midea', 'ميديا'],
  ['nike', 'نايك'], ['adidas', 'اديداس'],
].map((g) => g.map(norm));
const NAME_SET = new Set(NAMES.flat());
const GROUPS = [
  ...SYN_GROUPS.map((g) => g.map(norm).filter((w) => w.length >= 2 && !NAME_SET.has(w))).filter((g) => g.length > 1),
  ...NAMES,
];

// Pour un mot tapé : le mot lui-même + les mots des groupes où il apparaît
function alternatives(w) {
  const alt = new Set([w]);
  for (const g of GROUPS) {
    // même mot, début de mot (« clim » → climatiseur), ou petit pluriel (« frigos » → frigo)
    if (g.some((x) => x === w || (w.length >= 3 && x.startsWith(w)) || (x.length >= 5 && w.startsWith(x) && w.length - x.length <= 2))) {
      g.forEach((x) => alt.add(x));
    }
  }
  return [...alt];
}

// Les mots très courts (tv, lit, or…) doivent être des mots entiers, sinon « tv » trouverait n'importe quoi
const SEP = '[^a-z0-9\u0600-\u06ff]';
const tester = (w) => (w.length <= 3 && !/\s/.test(w)
  ? ((re) => (h) => re.test(h))(new RegExp('(^|' + SEP + ')' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(' + SEP + '|$)'))
  : (h) => h.includes(w));

export function prepareQuery(q) {
  return norm(q).split(/\s+/).filter(Boolean).map((w) => ({
    w,
    tests: alternatives(w).map((x) => (x === w && w.length <= 3 ? (h) => h.includes(w) : tester(x))),
  }));
}

// Distance d'édition (Levenshtein) bornée : renvoie false dès qu'elle dépasse max
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

// Mots de l'annonce, pour la tolérance aux fautes de frappe (« toyta » → Toyota)
const tokCache = new WeakMap();
function tokensOf(a) {
  let t = tokCache.get(a);
  if (!t) {
    t = [...new Set(hay(a).split(/[^a-z0-9\u0600-\u06ff]+/).filter(Boolean))];
    tokCache.set(a, t);
  }
  return t;
}

// Un mot d'au moins 4 lettres est accepté s'il ressemble à un mot de l'annonce (1 faute, 2 pour les mots longs)
function fuzzyHit(a, w) {
  if (w.length < 4) return false;
  const max = w.length >= 7 ? 2 : 1;
  return tokensOf(a).some((t) => within(w, t, max));
}

// Tout le texte d'une annonce dans lequel on cherche (titre, description, lieu en FR et AR, catégorie, vendeur, marque…)
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
// Mots ajoutés à chaque catégorie (ex. « voiture » trouve toutes les annonces de véhicules)
const CAT_WORDS = {
  auto: 'voiture voitures vehicule auto سيارة سيارات طوموبيل', phone: 'telephone portable smartphone هاتف تلفون',
  multi: 'electronique الكترونيات', menager: 'electromenager اجهزة منزلية', immo: 'immobilier عقار عقارات',
  anim: 'animaux betail مواشي', maison: 'meuble meubles اثاث', mode: 'vetement vetements habits ملابس', job: 'emploi travail وظيفة عمل',
};
const KIND_WORDS = {
  apt: 'appartement شقة', house: 'maison منزل', villa: 'villa فيلا', duplex: 'duplex دوبلكس', room: 'chambre غرفة',
  shop: 'boutique محل', office: 'bureau مكتب', warehouse: 'entrepot مستودع', land: 'terrain ارض قطعة', building: 'immeuble عمارة', farm: 'ferme مزرعة',
};
const hayCache = new WeakMap();
function hay(a) {
  let h = hayCache.get(a);
  if (h) return h;
  const c = CAT[a.cat] || {};
  const o = a.car || a.veh || a.dev || a.mm || a.home || a.mo || {};
  const e = a.estate || {};
  h = norm([
    a.title, a.desc, a.hood, a.near, a.city, cityName(a.city, 'ar'), c.fr, c.ar, CAT_WORDS[a.cat], a.seller,
    a.shop?.name, a.splace?.name, a.splace?.addr, o.brand, o.model, o.year,
    KIND_WORDS[e.kind], e.deal === 'rent' ? 'location louer كراء ايجار' : e.deal === 'sale' ? 'vente بيع' : '',
  ].filter(Boolean).join(' '));
  hayCache.set(a, h);
  return h;
}

export function matchQuery(a, prepared) {
  if (!prepared.length) return true;
  const h = hay(a);
  return prepared.every((g) => g.tests.some((test) => test(h)) || fuzzyHit(a, g.w));
}

// ---------- Suggestions pendant la frappe ----------
// Mots des titres, marques et modèles des annonces (et des catégories), avec leur nombre d'apparitions
const sugCache = new WeakMap();
function suggestIndex(ads) {
  let m = sugCache.get(ads);
  if (m) return m;
  m = new Map();
  const add = (text, bonus) => String(text || '').split(/[\s,;.!?()\/\-:"'«»]+/).forEach((w) => {
    const k = norm(w);
    if (k.length < 3 || /^\d+$/.test(k)) return;
    const e = m.get(k);
    if (e) e.n += bonus;
    else m.set(k, { w: w.trim(), n: bonus });
  });
  ads.forEach((a) => {
    if (a.status === 'sold' || a.status === 'deleted') return;
    add(a.title, 1);
    const o = a.car || a.veh || a.dev || a.mm || {};
    add(o.brand, 1);
    add(o.model, 1);
  });
  CATEGORIES.forEach((c) => { add(c.fr, 0); add(c.ar, 0); });
  sugCache.set(ads, m);
  return m;
}

// Propose des mots qui commencent par le dernier mot tapé ; chaque suggestion donne la requête complète
export function suggest(ads, q, limit = 6) {
  const raw = String(q ?? '');
  if (!ads || !raw.trim() || /\s$/.test(raw)) return [];
  const last = norm(raw).split(/\s+/).filter(Boolean).pop();
  if (!last || last.length < 2) return [];
  const head = raw.trim().split(/\s+/).slice(0, -1);
  const out = [];
  for (const [k, e] of suggestIndex(ads)) {
    if (k !== last && k.startsWith(last)) out.push(e);
  }
  out.sort((x, y) => y.n - x.n || x.w.length - y.w.length);
  return out.slice(0, limit).map((e) => ({ label: e.w, value: [...head, e.w].join(' ') }));
}

// ---------- Filtres ----------
export const EMPTY_FILTERS = {
  city: '', hood: '',          // hood : nom d'une moughataa ou 'w:nkcO' (toute une wilaya de Nouakchott)
  pmin: '', pmax: '',          // en MRU (nouvelle ouguiya)
  date: '',                    // '', today, 7d, 30d
  photo: false, nego: false, deliv: false,
  seller: '',                  // '', part, pro
  deal: '', kind: '',          // immobilier
  brand: '', yearMin: '',      // véhicules
  sort: 'new',                 // new, pa (prix croissant), pd (prix décroissant)
};

const wilayaOfCity = (c) => WILAYAS.find((w) => w.cities.some(([fr]) => fr === c))?.id;
const hoodGroup = (h) => NKC.find((g) => g.h.includes(h))?.id;
const stypeOf = (a) => (a.stype ? (a.stype === 'vendeur' ? 'part' : a.stype) : a.shop || a.estate?.pub === 'agent' ? 'pro' : 'part');

// Année du véhicule : champ « année » s'il existe, sinon une année écrite dans le titre ou la description (ex. « Corolla 2015 »)
function yearOf(a) {
  const v = a.car || a.veh || {};
  if (+v.year) return +v.year;
  const m = String((a.title || '') + ' ' + (a.desc || '')).match(/(?:^|\D)(19[89]\d|20[0-3]\d)(?!\d)/);
  return m ? +m[1] : 0;
}

export function countFilters(f) {
  return ['city', 'date', 'seller', 'deal', 'kind', 'brand', 'yearMin'].filter((k) => f[k]).length
    + (f.pmin || f.pmax ? 1 : 0) + (f.photo ? 1 : 0) + (f.nego ? 1 : 0) + (f.deliv ? 1 : 0);
}

export function search(ads, { q = '', cat = null, f = EMPTY_FILTERS }) {
  const prepared = prepareQuery(q);
  const now = Date.now();
  const lim = { today: 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 }[f.date];
  const r = ads.filter((a) => {
    if (a.status === 'sold' || a.status === 'deleted') return false;
    if (cat && a.cat !== cat) return false;
    if (f.city) {
      if (f.city.startsWith('w:')) { if (wilayaOfCity(a.city) !== f.city.slice(2)) return false; }
      else if (a.city !== f.city) return false;
    }
    if (f.city === 'Nouakchott' && f.hood) {
      if (f.hood.startsWith('w:')) { if (hoodGroup(a.hood) !== f.hood.slice(2)) return false; }
      else if (a.hood !== f.hood) return false;
    }
    if (lim && now - a.t > lim) return false;
    if (f.pmin && a.price < +f.pmin) return false;
    if (f.pmax && a.price > +f.pmax) return false;
    if (f.photo && !a.photos?.length) return false;
    if (f.nego && !a.nego) return false;
    if (f.deliv && !(a.deliv || a.home?.delivery || a.anim?.delivery)) return false;
    if (f.seller && stypeOf(a) !== f.seller) return false;
    if (cat === 'immo') {
      const e = a.estate || {};
      if (f.deal && e.deal !== f.deal) return false;
      if (f.kind && e.kind !== f.kind) return false;
    }
    if (cat === 'auto') {
      const v = a.car || a.veh || {};
      if (f.brand && !norm(v.brand + ' ' + a.title).includes(norm(f.brand))) return false;
      if (f.yearMin && !(yearOf(a) >= +f.yearMin)) return false;
    }
    return matchQuery(a, prepared);
  });
  if (f.sort === 'pa') r.sort((x, y) => (x.price || 0) - (y.price || 0));
  else if (f.sort === 'pd') r.sort((x, y) => (y.price || 0) - (x.price || 0));
  else r.sort((x, y) => y.t - x.t);
  return r;
}

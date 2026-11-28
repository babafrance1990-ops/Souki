// Catégories Bi3li — mêmes identifiants et couleurs que le site (CATS dans public/index.html)
export const CATEGORIES = [
  { id: 'auto', fr: 'Véhicules', ar: 'سيارات ومركبات', c: '#9A3412', icon: '🚗' },
  { id: 'immo', fr: 'Immobilier', ar: 'عقارات', c: '#0B6B3A', icon: '🏠' },
  { id: 'phone', fr: 'Téléphones', ar: 'هواتف', c: '#5B4BA8', icon: '📱' },
  { id: 'menager', fr: 'Électroménager', ar: 'أجهزة منزلية', c: '#C2410C', icon: '🧊' },
  { id: 'multi', fr: 'Électronique', ar: 'إلكترونيات', c: '#2563A8', icon: '💻' },
  { id: 'anim', fr: 'Animaux', ar: 'مواشي', c: '#8A5A12', icon: '🐐' },
  { id: 'maison', fr: 'Meubles & maison', ar: 'أثاث ومنزل', c: '#B7791F', icon: '🛋️' },
  { id: 'equip', fr: 'Matériaux & équipements', ar: 'معدات ومواد', c: '#B45309', icon: '🧱' },
  { id: 'alim', fr: 'Alimentation', ar: 'مواد غذائية', c: '#65A30D', icon: '🍚' },
  { id: 'mode', fr: 'Mode', ar: 'ملابس وموضة', c: '#8E3B76', icon: '👗' },
  { id: 'serv', fr: 'Services', ar: 'خدمات', c: '#2F6F4E', icon: '🛠️' },
  { id: 'beaute', fr: 'Beauté & santé', ar: 'صحة وجمال', c: '#C2185B', icon: '💄' },
  { id: 'fam', fr: 'Bébé & enfants', ar: 'الأطفال والرضّع', c: '#B4235A', icon: '🍼' },
  { id: 'job', fr: 'Emploi', ar: 'وظائف', c: '#3D5A80', icon: '💼' },
  { id: 'covoit', fr: 'Transport entre villes', ar: 'نقل بين المدن', c: '#0E7490', icon: '🚐' },
  { id: 'autre', fr: 'Autres', ar: 'أخرى', c: '#56625A', icon: '📦' },
];

export const catById = (id) => CATEGORIES.find((c) => c.id === id);

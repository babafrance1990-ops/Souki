// Recherche par photo : Workers AI reconnaît l'objet (modèle ResNet-50, étiquettes en anglais),
// puis on le traduit en mots français / arabes et en catégorie Bi3li.
// [mot anglais contenu dans l'étiquette, français, arabe, catégorie]
const MAP = [
  ['sports car', 'voiture', 'سيارة', 'auto'], ['convertible', 'voiture', 'سيارة', 'auto'], ['cab', 'voiture', 'سيارة', 'auto'],
  ['beach wagon', 'voiture', 'سيارة', 'auto'], ['station wagon', 'voiture', 'سيارة', 'auto'], ['limousine', 'voiture', 'سيارة', 'auto'],
  ['racer', 'voiture', 'سيارة', 'auto'], ['car wheel', 'jante', 'جنط', 'auto'], ['grille', 'voiture', 'سيارة', 'auto'],
  ['jeep', '4x4', 'سيارة دفع رباعي', 'auto'], ['minivan', 'minibus', 'حافلة صغيرة', 'auto'], ['pickup', 'pick-up', 'بيك أب', 'auto'],
  ['minibus', 'minibus', 'حافلة صغيرة', 'auto'], ['school bus', 'bus', 'حافلة', 'auto'], ['trolleybus', 'bus', 'حافلة', 'auto'],
  ['trailer truck', 'camion', 'شاحنة', 'auto'], ['tow truck', 'camion', 'شاحنة', 'auto'], ['garbage truck', 'camion', 'شاحنة', 'auto'],
  ['moving van', 'camion', 'شاحنة', 'auto'], ['tractor', 'tracteur', 'جرار', 'auto'], ['ambulance', 'voiture', 'سيارة', 'auto'],
  ['moped', 'moto', 'دراجة نارية', 'auto'], ['motor scooter', 'moto', 'دراجة نارية', 'auto'], ['mountain bike', 'vélo', 'دراجة', 'auto'],
  ['bicycle', 'vélo', 'دراجة', 'auto'], ['tricycle', 'tricycle', 'دراجة ثلاثية', 'auto'], ['crash helmet', 'casque', 'خوذة', 'auto'],
  ['cellular telephone', 'téléphone', 'هاتف', 'multi'], ['cellular phone', 'téléphone', 'هاتف', 'multi'], ['dial telephone', 'téléphone', 'هاتف', 'multi'],
  ['hand-held computer', 'téléphone', 'هاتف', 'multi'], ['ipod', 'téléphone', 'هاتف', 'multi'], ['laptop', 'ordinateur portable', 'حاسوب محمول', 'multi'],
  ['notebook', 'ordinateur portable', 'حاسوب محمول', 'multi'], ['desktop computer', 'ordinateur', 'حاسوب', 'multi'], ['monitor', 'écran', 'شاشة', 'multi'],
  ['screen', 'télévision', 'تلفاز', 'multi'], ['television', 'télévision', 'تلفاز', 'multi'], ['home theater', 'télévision', 'تلفاز', 'multi'],
  ['entertainment center', 'télévision', 'تلفاز', 'multi'], ['remote control', 'télécommande', 'جهاز تحكم', 'multi'], ['joystick', 'manette', 'يد تحكم', 'multi'],
  ['computer keyboard', 'clavier', 'لوحة مفاتيح', 'multi'], ['typewriter keyboard', 'clavier', 'لوحة مفاتيح', 'multi'], ['mouse', 'souris', 'فأرة', 'multi'],
  ['printer', 'imprimante', 'طابعة', 'multi'], ['loudspeaker', 'haut-parleur', 'مكبر صوت', 'multi'], ['radio', 'radio', 'راديو', 'multi'],
  ['reflex camera', 'appareil photo', 'آلة تصوير', 'multi'], ['polaroid camera', 'appareil photo', 'آلة تصوير', 'multi'], ['tape player', 'radio', 'راديو', 'multi'],
  ['modem', 'modem', 'مودم', 'multi'], ['hard disc', 'disque dur', 'قرص صلب', 'multi'], ['projector', 'projecteur', 'جهاز عرض', 'multi'],
  ['refrigerator', 'réfrigérateur', 'ثلاجة', 'maison'], ['washer', 'machine à laver', 'غسالة', 'maison'], ['microwave', 'micro-ondes', 'ميكروويف', 'maison'],
  ['stove', 'cuisinière', 'موقد', 'maison'], ['dishwasher', 'lave-vaisselle', 'غسالة صحون', 'maison'], ['electric fan', 'ventilateur', 'مروحة', 'maison'],
  ['space heater', 'chauffage', 'مدفأة', 'maison'], ['vacuum', 'aspirateur', 'مكنسة كهربائية', 'maison'], ['iron', 'fer à repasser', 'مكواة', 'maison'],
  ['toaster', 'grille-pain', 'محمصة', 'maison'], ['espresso maker', 'machine à café', 'آلة قهوة', 'maison'], ['coffeepot', 'cafetière', 'إبريق قهوة', 'maison'],
  ['teapot', 'théière', 'إبريق شاي', 'maison'], ['tray', 'plateau', 'صينية', 'maison'], ['wok', 'marmite', 'قدر', 'maison'],
  ['frying pan', 'poêle', 'مقلاة', 'maison'], ['crock pot', 'marmite', 'قدر', 'maison'], ['dutch oven', 'marmite', 'قدر', 'maison'],
  ['caldron', 'marmite', 'قدر', 'maison'], ['pressure cooker', 'cocotte', 'قدر ضغط', 'maison'], ['water jug', 'bidon', 'دلو', 'maison'],
  ['studio couch', 'salon', 'صالون', 'maison'], ['sofa', 'salon', 'صالون', 'maison'], ['four-poster', 'lit', 'سرير', 'maison'],
  ['quilt', 'couverture', 'لحاف', 'maison'], ['pillow', 'coussin', 'وسادة', 'maison'], ['prayer rug', 'tapis', 'سجادة', 'maison'],
  ['doormat', 'tapis', 'سجادة', 'maison'], ['wardrobe', 'armoire', 'خزانة', 'maison'], ['chiffonier', 'commode', 'خزانة', 'maison'],
  ['china cabinet', 'buffet', 'خزانة', 'maison'], ['dining table', 'table', 'طاولة', 'maison'], ['desk', 'bureau', 'مكتب', 'maison'],
  ['folding chair', 'chaise', 'كرسي', 'maison'], ['rocking chair', 'chaise', 'كرسي', 'maison'], ['barber chair', 'fauteuil', 'كرسي', 'maison'],
  ['throne', 'fauteuil', 'كرسي', 'maison'], ['table lamp', 'lampe', 'مصباح', 'maison'], ['lampshade', 'lampe', 'مصباح', 'maison'],
  ['wall clock', 'horloge', 'ساعة حائط', 'maison'], ['window shade', 'rideau', 'ستارة', 'maison'], ['shower curtain', 'rideau', 'ستارة', 'maison'],
  ['theater curtain', 'rideau', 'ستارة', 'maison'], ['vase', 'vase', 'مزهرية', 'maison'], ['plate rack', 'vaisselle', 'أواني', 'maison'],
  ['digital watch', 'montre', 'ساعة', 'mode'], ['analog clock', 'montre', 'ساعة', 'mode'], ['stopwatch', 'montre', 'ساعة', 'mode'],
  ['wallet', 'portefeuille', 'محفظة', 'mode'], ['purse', 'sac', 'حقيبة', 'mode'], ['backpack', 'sac à dos', 'حقيبة ظهر', 'mode'],
  ['mailbag', 'sac', 'حقيبة', 'mode'], ['jersey', 't-shirt', 'قميص', 'mode'], ['sweatshirt', 'pull', 'سترة', 'mode'],
  ['cardigan', 'pull', 'سترة', 'mode'], ['suit', 'costume', 'بدلة', 'mode'], ['abaya', 'melhfa', 'ملحفة', 'mode'],
  ['cloak', 'daraa', 'دراعة', 'mode'], ['kimono', 'robe', 'فستان', 'mode'], ['gown', 'robe', 'فستان', 'mode'],
  ['sarong', 'melhfa', 'ملحفة', 'mode'], ['poncho', 'melhfa', 'ملحفة', 'mode'], ['stole', 'melhfa', 'ملحفة', 'mode'],
  ['jean', 'jean', 'جينز', 'mode'], ['miniskirt', 'jupe', 'تنورة', 'mode'], ['trench coat', 'manteau', 'معطف', 'mode'],
  ['running shoe', 'chaussures', 'حذاء', 'mode'], ['sandal', 'sandales', 'صندل', 'mode'], ['loafer', 'chaussures', 'حذاء', 'mode'],
  ['cowboy boot', 'bottes', 'حذاء', 'mode'], ['clog', 'chaussures', 'حذاء', 'mode'], ['sunglass', 'lunettes', 'نظارات', 'mode'],
  ['necklace', 'collier', 'قلادة', 'mode'], ['chain', 'collier', 'قلادة', 'mode'], ['perfume', 'parfum', 'عطر', 'mode'],
  ['lipstick', 'maquillage', 'مكياج', 'mode'], ['hair spray', 'parfum', 'عطر', 'mode'],
  ['crib', 'lit bébé', 'سرير طفل', 'fam'], ['cradle', 'berceau', 'مهد', 'fam'], ['bassinet', 'berceau', 'مهد', 'fam'],
  ['stroller', 'poussette', 'عربة أطفال', 'fam'], ['baby', 'poussette', 'عربة أطفال', 'fam'], ['teddy', 'jouet', 'لعبة', 'fam'],
  ['toyshop', 'jouet', 'لعبة', 'fam'], ['diaper', 'couches', 'حفاضات', 'fam'],
  ['ram', 'mouton', 'خروف', 'anim'], ['bighorn', 'mouton', 'خروف', 'anim'], ['ibex', 'chèvre', 'ماعز', 'anim'],
  ['arabian camel', 'chameau', 'جمل', 'anim'], ['ox', 'vache', 'بقرة', 'anim'], ['water buffalo', 'vache', 'بقرة', 'anim'],
  ['hen', 'poule', 'دجاج', 'anim'], ['cock', 'poule', 'دجاج', 'anim'], ['sorrel', 'cheval', 'حصان', 'anim'],
  ['tabby', 'chat', 'قط', 'anim'], ['tiger cat', 'chat', 'قط', 'anim'], ['persian cat', 'chat', 'قط', 'anim'],
  ['siamese cat', 'chat', 'قط', 'anim'], ['egyptian cat', 'chat', 'قط', 'anim'], ['parrot', 'perroquet', 'ببغاء', 'anim'],
  ['macaw', 'perroquet', 'ببغاء', 'anim'], ['goldfish', 'poisson', 'سمك', 'anim'],
  ['mobile home', 'maison', 'منزل', 'immo'], ['patio', 'maison', 'منزل', 'immo'], ['boathouse', 'maison', 'منزل', 'immo'],
  ['dumbbell', 'sport', 'رياضة', 'autre'], ['soccer ball', 'ballon', 'كرة', 'autre'], ['guitar', 'guitare', 'قيثارة', 'autre'],
  ['sewing machine', 'machine à coudre', 'آلة خياطة', 'maison'], ['power drill', 'perceuse', 'مثقاب', 'autre'], ['chain saw', 'outil', 'أداة', 'autre'],
];
const DOG_WORDS = ['terrier', 'retriever', 'spaniel', 'shepherd', 'hound', 'poodle', 'collie', 'mastiff', 'dog', 'husky', 'malamute', 'chihuahua', 'pug', 'boxer', 'dalmatian', 'rottweiler', 'doberman'];

export async function recognise(env, bytes) {
  if (!env.AI) throw new Error('no_ai');
  const out = await env.AI.run('@cf/microsoft/resnet-50', { image: [...bytes] });
  const labels = (Array.isArray(out) ? out : (out && out.result) || []).slice(0, 5)
    .map((x) => ({ en: String(x.label || '').toLowerCase(), score: +x.score || 0 }));
  let hit = null;
  for (const l of labels) {
    if (l.score < 0.08) continue;
    const m = MAP.find((e) => l.en.includes(e[0]));
    if (m) { hit = { fr: m[1], ar: m[2], cat: m[3], score: l.score }; break; }
    if (DOG_WORDS.some((w) => l.en.includes(w))) { hit = { fr: 'chien', ar: 'كلب', cat: 'anim', score: l.score }; break; }
  }
  if (!hit && labels[0] && labels[0].score >= 0.15) {
    let fr = labels[0].en.split(',')[0];
    try {
      const tr = await env.AI.run('@cf/meta/m2m100-1.2b', { text: fr, source_lang: 'english', target_lang: 'french' });
      if (tr && tr.translated_text) fr = String(tr.translated_text).toLowerCase().replace(/[.!]+$/, '');
    } catch (e) { /* garde le mot anglais */ }
    hit = { fr, ar: '', cat: '', score: labels[0].score };
  }
  return { hit, labels };
}

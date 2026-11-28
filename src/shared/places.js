// Wilayas, villes et moughataas de Nouakchott — copiés du site (WILAYAS et NKC dans public/index.html)
// La ville est enregistrée en français (comme sur le site) et affichée dans la langue choisie.
export const WILAYAS = [{"id":"nkc","fr":"Nouakchott","ar":"نواكشوط","cities":[["Nouakchott","نواكشوط"]]},{"id":"adrar","fr":"Adrar","ar":"أدرار","cities":[["Atar","أطار"],["Chinguetti","شنقيط"],["Ouadane","وادان"],["Aoujeft","أوجفت"]]},{"id":"assaba","fr":"Assaba","ar":"لعصابة","cities":[["Kiffa","كيفة"],["Guérou","كرو"],["Kankossa","كنكوصة"],["Barkéol","باركيول"],["Boumdeid","بومديد"]]},{"id":"brakna","fr":"Brakna","ar":"البراكنة","cities":[["Aleg","ألاك"],["Boghé","بوكي"],["Bababé","بابابي"],["Magta-Lahjar","مقطع لحجار"],["M'Bagne","امباني"]]},{"id":"dnou","fr":"Dakhlet Nouadhibou","ar":"داخلت نواذيبو","cities":[["Nouadhibou","نواذيبو"],["Chami","الشامي"]]},{"id":"gorgol","fr":"Gorgol","ar":"كوركول","cities":[["Kaédi","كيهيدي"],["M'Bout","امبود"],["Maghama","مقامة"],["Monguel","مونكل"],["Lexeiba","لكصيبة"]]},{"id":"guidi","fr":"Guidimakha","ar":"كيدي ماغا","cities":[["Sélibaby","سيلبابي"],["Ould Yengé","ولد ينجه"],["Ghabou","غابو"],["Wompou","ومبو"]]},{"id":"hech","fr":"Hodh Ech Chargui","ar":"الحوض الشرقي","cities":[["Néma","النعمة"],["Amourj","أمرج"],["Bassikounou","باسكنو"],["Djiguenni","جكني"],["Oualata","ولاتة"],["Timbédra","تمبدغة"],["Adel Bagrou","عدل بكرو"],["N'Beiket Lahwach","انبيكت لحواش"]]},{"id":"hgh","fr":"Hodh El Gharbi","ar":"الحوض الغربي","cities":[["Aïoun","لعيون"],["Kobenni","كوبني"],["Tintane","الطينطان"],["Tamchakett","تامشكط"],["Touil","الطويل"]]},{"id":"inchiri","fr":"Inchiri","ar":"إينشيري","cities":[["Akjoujt","أكجوجت"],["Bennichab","بنشاب"]]},{"id":"tagant","fr":"Tagant","ar":"تكانت","cities":[["Tidjikja","تجكجة"],["Moudjéria","المجرية"],["Tichitt","تيشيت"]]},{"id":"tiris","fr":"Tiris Zemmour","ar":"تيرس زمور","cities":[["Zouérate","ازويرات"],["F'Dérik","أفديرك"],["Bir Moghrein","بئر أم اكرين"]]},{"id":"trarza","fr":"Trarza","ar":"اترارزة","cities":[["Rosso","روصو"],["Boutilimit","بوتلميت"],["Keur Macène","كرمسين"],["Méderdra","المذرذرة"],["Ouad Naga","واد الناقة"],["R'Kiz","الركيز"],["Tékane","تكند"]]}];

export const NKC = [{"id":"nkcO","fr":"Nouakchott-Ouest","ar":"نواكشوط الغربية","h":["Tevragh Zeina","Ksar","Sebkha"]},{"id":"nkcN","fr":"Nouakchott-Nord","ar":"نواكشوط الشمالية","h":["Dar Naim","Teyarett","Toujounine"]},{"id":"nkcS","fr":"Nouakchott-Sud","ar":"نواكشوط الجنوبية","h":["Arafat","El Mina","Riyadh"]}];

const AR = {};
WILAYAS.forEach((w) => w.cities.forEach(([fr, ar]) => { AR[fr] = ar; }));

// Nom de la ville dans la langue de l'application
export const cityName = (fr, lang) => (lang === 'ar' && AR[fr]) || fr || '';

// Noms arabes des quartiers de Nouakchott (la valeur enregistrée reste en français, comme sur le site)
export const HOOD_AR = {
  'Tevragh Zeina': 'تفرغ زينة', Ksar: 'القصر', Sebkha: 'السبخة',
  'Dar Naim': 'دار النعيم', Teyarett: 'تيارت', Toujounine: 'توجنين',
  Arafat: 'عرفات', 'El Mina': 'الميناء', Riyadh: 'الرياض',
};

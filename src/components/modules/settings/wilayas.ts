// The 58 wilayas of Algeria (post-2019 division). `name` is the French form
// stored in kg_tenants.wilaya (DB default: 'Jijel'); `ar` is for display in AR locale.

export interface Wilaya {
  code: string;
  name: string;
  ar: string;
}

export const WILAYAS: Wilaya[] = [
  { code: "01", name: "Adrar", ar: "أدرار" },
  { code: "02", name: "Chlef", ar: "الشلف" },
  { code: "03", name: "Laghouat", ar: "الأغواط" },
  { code: "04", name: "Oum El Bouaghi", ar: "أم البواقي" },
  { code: "05", name: "Batna", ar: "باتنة" },
  { code: "06", name: "Béjaïa", ar: "بجاية" },
  { code: "07", name: "Biskra", ar: "بسكرة" },
  { code: "08", name: "Béchar", ar: "بشار" },
  { code: "09", name: "Blida", ar: "البليدة" },
  { code: "10", name: "Bouira", ar: "البويرة" },
  { code: "11", name: "Tamanrasset", ar: "تمنراست" },
  { code: "12", name: "Tébessa", ar: "تبسة" },
  { code: "13", name: "Tlemcen", ar: "تلمسان" },
  { code: "14", name: "Tiaret", ar: "تيارت" },
  { code: "15", name: "Tizi Ouzou", ar: "تيزي وزو" },
  { code: "16", name: "Alger", ar: "الجزائر" },
  { code: "17", name: "Djelfa", ar: "الجلفة" },
  { code: "18", name: "Jijel", ar: "جيجل" },
  { code: "19", name: "Sétif", ar: "سطيف" },
  { code: "20", name: "Saïda", ar: "سعيدة" },
  { code: "21", name: "Skikda", ar: "سكيكدة" },
  { code: "22", name: "Sidi Bel Abbès", ar: "سيدي بلعباس" },
  { code: "23", name: "Annaba", ar: "عنابة" },
  { code: "24", name: "Guelma", ar: "قالمة" },
  { code: "25", name: "Constantine", ar: "قسنطينة" },
  { code: "26", name: "Médéa", ar: "المدية" },
  { code: "27", name: "Mostaganem", ar: "مستغانم" },
  { code: "28", name: "M'Sila", ar: "المسيلة" },
  { code: "29", name: "Mascara", ar: "معسكر" },
  { code: "30", name: "Ouargla", ar: "ورقلة" },
  { code: "31", name: "Oran", ar: "وهران" },
  { code: "32", name: "El Bayadh", ar: "البيض" },
  { code: "33", name: "Illizi", ar: "إليزي" },
  { code: "34", name: "Bordj Bou Arreridj", ar: "برج بوعريريج" },
  { code: "35", name: "Boumerdès", ar: "بومرداس" },
  { code: "36", name: "El Tarf", ar: "الطارف" },
  { code: "37", name: "Tindouf", ar: "تندوف" },
  { code: "38", name: "Tissemsilt", ar: "تيسمسيلت" },
  { code: "39", name: "El Oued", ar: "الوادي" },
  { code: "40", name: "Khenchela", ar: "خنشلة" },
  { code: "41", name: "Souk Ahras", ar: "سوق أهراس" },
  { code: "42", name: "Tipaza", ar: "تيبازة" },
  { code: "43", name: "Mila", ar: "ميلة" },
  { code: "44", name: "Aïn Defla", ar: "عين الدفلى" },
  { code: "45", name: "Naâma", ar: "النعامة" },
  { code: "46", name: "Aïn Témouchent", ar: "عين تموشنت" },
  { code: "47", name: "Ghardaïa", ar: "غرداية" },
  { code: "48", name: "Relizane", ar: "غليزان" },
  { code: "49", name: "Timimoun", ar: "تيميمون" },
  { code: "50", name: "Bordj Badji Mokhtar", ar: "برج باجي مختار" },
  { code: "51", name: "Ouled Djellal", ar: "أولاد جلال" },
  { code: "52", name: "Béni Abbès", ar: "بني عباس" },
  { code: "53", name: "In Salah", ar: "عين صالح" },
  { code: "54", name: "In Guezzam", ar: "عين قزام" },
  { code: "55", name: "Touggourt", ar: "تقرت" },
  { code: "56", name: "Djanet", ar: "جانت" },
  { code: "57", name: "El M'Ghair", ar: "المغير" },
  { code: "58", name: "El Meniaa", ar: "المنيعة" },
];

export const WILAYA_NAMES = WILAYAS.map((w) => w.name);

export function wilayaLabel(w: Wilaya, locale: string): string {
  return `${w.code} — ${locale === "ar" ? w.ar : w.name}`;
}

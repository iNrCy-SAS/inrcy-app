import "server-only";

type FrenchGeography = {
  department: string;
  region: string;
};

const DEPARTMENT_BY_CODE: Record<string, FrenchGeography> = {
  "01": { department: "Ain", region: "Auvergne-Rhône-Alpes" },
  "02": { department: "Aisne", region: "Hauts-de-France" },
  "03": { department: "Allier", region: "Auvergne-Rhône-Alpes" },
  "04": { department: "Alpes-de-Haute-Provence", region: "Provence-Alpes-Côte d’Azur" },
  "05": { department: "Hautes-Alpes", region: "Provence-Alpes-Côte d’Azur" },
  "06": { department: "Alpes-Maritimes", region: "Provence-Alpes-Côte d’Azur" },
  "07": { department: "Ardèche", region: "Auvergne-Rhône-Alpes" },
  "08": { department: "Ardennes", region: "Grand Est" },
  "09": { department: "Ariège", region: "Occitanie" },
  "10": { department: "Aube", region: "Grand Est" },
  "11": { department: "Aude", region: "Occitanie" },
  "12": { department: "Aveyron", region: "Occitanie" },
  "13": { department: "Bouches-du-Rhône", region: "Provence-Alpes-Côte d’Azur" },
  "14": { department: "Calvados", region: "Normandie" },
  "15": { department: "Cantal", region: "Auvergne-Rhône-Alpes" },
  "16": { department: "Charente", region: "Nouvelle-Aquitaine" },
  "17": { department: "Charente-Maritime", region: "Nouvelle-Aquitaine" },
  "18": { department: "Cher", region: "Centre-Val de Loire" },
  "19": { department: "Corrèze", region: "Nouvelle-Aquitaine" },
  "21": { department: "Côte-d’Or", region: "Bourgogne-Franche-Comté" },
  "22": { department: "Côtes-d’Armor", region: "Bretagne" },
  "23": { department: "Creuse", region: "Nouvelle-Aquitaine" },
  "24": { department: "Dordogne", region: "Nouvelle-Aquitaine" },
  "25": { department: "Doubs", region: "Bourgogne-Franche-Comté" },
  "26": { department: "Drôme", region: "Auvergne-Rhône-Alpes" },
  "27": { department: "Eure", region: "Normandie" },
  "28": { department: "Eure-et-Loir", region: "Centre-Val de Loire" },
  "29": { department: "Finistère", region: "Bretagne" },
  "30": { department: "Gard", region: "Occitanie" },
  "31": { department: "Haute-Garonne", region: "Occitanie" },
  "32": { department: "Gers", region: "Occitanie" },
  "33": { department: "Gironde", region: "Nouvelle-Aquitaine" },
  "34": { department: "Hérault", region: "Occitanie" },
  "35": { department: "Ille-et-Vilaine", region: "Bretagne" },
  "36": { department: "Indre", region: "Centre-Val de Loire" },
  "37": { department: "Indre-et-Loire", region: "Centre-Val de Loire" },
  "38": { department: "Isère", region: "Auvergne-Rhône-Alpes" },
  "39": { department: "Jura", region: "Bourgogne-Franche-Comté" },
  "40": { department: "Landes", region: "Nouvelle-Aquitaine" },
  "41": { department: "Loir-et-Cher", region: "Centre-Val de Loire" },
  "42": { department: "Loire", region: "Auvergne-Rhône-Alpes" },
  "43": { department: "Haute-Loire", region: "Auvergne-Rhône-Alpes" },
  "44": { department: "Loire-Atlantique", region: "Pays de la Loire" },
  "45": { department: "Loiret", region: "Centre-Val de Loire" },
  "46": { department: "Lot", region: "Occitanie" },
  "47": { department: "Lot-et-Garonne", region: "Nouvelle-Aquitaine" },
  "48": { department: "Lozère", region: "Occitanie" },
  "49": { department: "Maine-et-Loire", region: "Pays de la Loire" },
  "50": { department: "Manche", region: "Normandie" },
  "51": { department: "Marne", region: "Grand Est" },
  "52": { department: "Haute-Marne", region: "Grand Est" },
  "53": { department: "Mayenne", region: "Pays de la Loire" },
  "54": { department: "Meurthe-et-Moselle", region: "Grand Est" },
  "55": { department: "Meuse", region: "Grand Est" },
  "56": { department: "Morbihan", region: "Bretagne" },
  "57": { department: "Moselle", region: "Grand Est" },
  "58": { department: "Nièvre", region: "Bourgogne-Franche-Comté" },
  "59": { department: "Nord", region: "Hauts-de-France" },
  "60": { department: "Oise", region: "Hauts-de-France" },
  "61": { department: "Orne", region: "Normandie" },
  "62": { department: "Pas-de-Calais", region: "Hauts-de-France" },
  "63": { department: "Puy-de-Dôme", region: "Auvergne-Rhône-Alpes" },
  "64": { department: "Pyrénées-Atlantiques", region: "Nouvelle-Aquitaine" },
  "65": { department: "Hautes-Pyrénées", region: "Occitanie" },
  "66": { department: "Pyrénées-Orientales", region: "Occitanie" },
  "67": { department: "Bas-Rhin", region: "Grand Est" },
  "68": { department: "Haut-Rhin", region: "Grand Est" },
  "69": { department: "Rhône", region: "Auvergne-Rhône-Alpes" },
  "70": { department: "Haute-Saône", region: "Bourgogne-Franche-Comté" },
  "71": { department: "Saône-et-Loire", region: "Bourgogne-Franche-Comté" },
  "72": { department: "Sarthe", region: "Pays de la Loire" },
  "73": { department: "Savoie", region: "Auvergne-Rhône-Alpes" },
  "74": { department: "Haute-Savoie", region: "Auvergne-Rhône-Alpes" },
  "75": { department: "Paris", region: "Île-de-France" },
  "76": { department: "Seine-Maritime", region: "Normandie" },
  "77": { department: "Seine-et-Marne", region: "Île-de-France" },
  "78": { department: "Yvelines", region: "Île-de-France" },
  "79": { department: "Deux-Sèvres", region: "Nouvelle-Aquitaine" },
  "80": { department: "Somme", region: "Hauts-de-France" },
  "81": { department: "Tarn", region: "Occitanie" },
  "82": { department: "Tarn-et-Garonne", region: "Occitanie" },
  "83": { department: "Var", region: "Provence-Alpes-Côte d’Azur" },
  "84": { department: "Vaucluse", region: "Provence-Alpes-Côte d’Azur" },
  "85": { department: "Vendée", region: "Pays de la Loire" },
  "86": { department: "Vienne", region: "Nouvelle-Aquitaine" },
  "87": { department: "Haute-Vienne", region: "Nouvelle-Aquitaine" },
  "88": { department: "Vosges", region: "Grand Est" },
  "89": { department: "Yonne", region: "Bourgogne-Franche-Comté" },
  "90": { department: "Territoire de Belfort", region: "Bourgogne-Franche-Comté" },
  "91": { department: "Essonne", region: "Île-de-France" },
  "92": { department: "Hauts-de-Seine", region: "Île-de-France" },
  "93": { department: "Seine-Saint-Denis", region: "Île-de-France" },
  "94": { department: "Val-de-Marne", region: "Île-de-France" },
  "95": { department: "Val-d’Oise", region: "Île-de-France" },
};

const OVERSEAS_BY_PREFIX: Record<string, FrenchGeography> = {
  "971": { department: "Guadeloupe", region: "Guadeloupe" },
  "972": { department: "Martinique", region: "Martinique" },
  "973": { department: "Guyane", region: "Guyane" },
  "974": { department: "La Réunion", region: "La Réunion" },
  "976": { department: "Mayotte", region: "Mayotte" },
};

function normalizePostalCode(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 5);
}

export function resolveFrenchGeography(postalCode: unknown, city?: string): FrenchGeography | null;
export function resolveFrenchGeography(postalCode: unknown): FrenchGeography | null {
  const postal = normalizePostalCode(postalCode);
  if (postal.length !== 5) return null;

  const overseas = OVERSEAS_BY_PREFIX[postal.slice(0, 3)];
  if (overseas) return overseas;

  const number = Number(postal);
  if (number >= 20000 && number <= 20199) {
    return { department: "Corse-du-Sud", region: "Corse" };
  }
  if (number >= 20200 && number <= 20699) {
    return { department: "Haute-Corse", region: "Corse" };
  }
  if (postal.startsWith("20")) {
    return { department: "Corse", region: "Corse" };
  }

  return DEPARTMENT_BY_CODE[postal.slice(0, 2)] || null;
}

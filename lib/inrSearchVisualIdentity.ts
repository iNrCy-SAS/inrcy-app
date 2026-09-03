export type InrSearchVisualTheme =
  | "digital"
  | "craft"
  | "flavour"
  | "care"
  | "beauty"
  | "nature"
  | "motion"
  | "structure"
  | "retail"
  | "signature";

export type InrSearchVisualPalette = {
  primary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
  ink: [number, number, number];
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

export function hashInrSearchVisualSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function inferInrSearchVisualTheme(value: string): InrSearchVisualTheme {
  const source = normalize(value);

  if (/communication|digital|informatique|logiciel|marketing|agence|web|media|graphis|technolog|plateforme|marketplace|mise en relation|saas|comparateur/.test(source)) return "digital";
  if (/batiment|construction|couvreur|macon|plomb|electric|artisan|menuis|peintre|chauffag|renov/.test(source)) return "craft";
  if (/restaurant|boulanger|patisser|traiteur|aliment|cuisine|brasserie|cafe|epicer/.test(source)) return "flavour";
  if (/sante|medical|docteur|infirm|therap|bien.?etre|pharma|dentaire|opticien/.test(source)) return "care";
  if (/beaute|coiff|esthet|cosmet|mode|spa|massage|ongler|maquill/.test(source)) return "beauty";
  if (/paysag|jardin|agric|forest|bois|nature|fleur|animal|ecolog/.test(source)) return "nature";
  if (/transport|automobile|garage|moto|logist|taxi|mobilite|livraison|formation_enseignement|auto.?ecole|ecole de conduite|bateau.?ecole|permis|code de la route|securite routiere/.test(source)) return "motion";
  if (/architect|immobilier|bureau.?etude|geometre|urbanis|interieur/.test(source)) return "structure";
  if (/commerce|boutique|magasin|retail|vente|concept.?store|bijout/.test(source)) return "retail";
  return "signature";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };

  return [
    Math.round(hueToRgb(h + 1 / 3) * 255),
    Math.round(hueToRgb(h) * 255),
    Math.round(hueToRgb(h - 1 / 3) * 255),
  ];
}

const THEME_HUES: Record<InrSearchVisualTheme, number> = {
  digital: 205,
  craft: 28,
  flavour: 12,
  care: 164,
  beauty: 315,
  nature: 126,
  motion: 194,
  structure: 221,
  retail: 277,
  signature: 232,
};

export function buildInrSearchFallbackPalette(
  seed: string,
  theme: InrSearchVisualTheme,
): InrSearchVisualPalette {
  const hash = hashInrSearchVisualSeed(seed);
  const base = (THEME_HUES[theme] + ((hash % 35) - 17) + 360) % 360;
  const secondaryHue = (base + 54 + ((hash >>> 7) % 38)) % 360;
  const tertiaryHue = (base + 132 + ((hash >>> 13) % 62)) % 360;

  return {
    primary: hslToRgb(base, 82, 56),
    secondary: hslToRgb(secondaryHue, 78, 58),
    tertiary: hslToRgb(tertiaryHue, 76, 59),
    ink: hslToRgb((base + 9) % 360, 58, 13),
  };
}

export function rgbTriplet(value: [number, number, number]) {
  return value.join(" ");
}

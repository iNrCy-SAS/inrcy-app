export type BoutiqueProduct = {
  key: string;
  title: string;
  desc: string;
  priceEurHt: number;
  comboEurHt: number;
  priceUi: number;
  badge?: string;
};

// Historical catalogue amounts included the project's 20% reference VAT.
// Only new offers use the rounded HT amounts below; stored orders are untouched.
export const BOUTIQUE_REFERENCE_VAT_PERCENT = 20;
export const BOUTIQUE_PRICE_TAX_BEHAVIOR = "exclusive" as const;

export function boutiqueTtcToRoundedHt(amountEurTtc: number): number {
  if (!Number.isFinite(amountEurTtc) || amountEurTtc < 0) {
    throw new RangeError("Invalid Boutique reference price");
  }
  return Math.round((amountEurTtc * 100) / (100 + BOUTIQUE_REFERENCE_VAT_PERCENT));
}

type LegacyBoutiqueProduct = Omit<BoutiqueProduct, "priceEurHt" | "comboEurHt"> & {
  priceEurTtc: number;
  comboEurTtc: number;
};

const LEGACY_BOUTIQUE_PRODUCTS: LegacyBoutiqueProduct[] = [
  {
    key: "cartes_visite",
    title: "Cartes de visite premium",
    desc: "Création design pro + impression sur papier de qualité + livraison pour 500 cartes.",
    priceEurTtc: 359,
    comboEurTtc: 215,
    priceUi: 7200,
    badge: "Print",
  },
  {
    key: "flyers",
    title: "Flyers professionnels",
    desc: "Création design + impression + livraison pour 1000 flyers.",
    priceEurTtc: 420,
    comboEurTtc: 252,
    priceUi: 8400,
    badge: "Print",
  },
  {
    key: "facebook_page",
    title: "Création page Facebook",
    desc: "Page professionnelle prête à valoriser votre activité.",
    priceEurTtc: 420,
    comboEurTtc: 252,
    priceUi: 8400,
    badge: "Social",
  },
  {
    key: "instagram_page",
    title: "Création page Instagram",
    desc: "Profil professionnel optimisé pour renforcer votre image.",
    priceEurTtc: 420,
    comboEurTtc: 252,
    priceUi: 8400,
    badge: "Social",
  },
  {
    key: "linkedin_page",
    title: "Création page LinkedIn",
    desc: "Page entreprise professionnelle et crédible.",
    priceEurTtc: 469,
    comboEurTtc: 281,
    priceUi: 9400,
    badge: "Social",
  },
  {
    key: "gmb",
    title: "Optimisation Google Business",
    desc: "Fiche optimisée pour renforcer votre visibilité locale.",
    priceEurTtc: 299,
    comboEurTtc: 179,
    priceUi: 6000,
    badge: "Local",
  },
  {
    key: "logo",
    title: "Logo professionnel",
    desc: "Création graphique complète avec déclinaisons exploitables.",
    priceEurTtc: 599,
    comboEurTtc: 359,
    priceUi: 12000,
    badge: "Branding",
  },
  {
    key: "ads",
    title: "Campagne publicitaire",
    desc: "Configuration complète de votre campagne d'acquisition.",
    priceEurTtc: 719,
    comboEurTtc: 431,
    priceUi: 14400,
    badge: "Acquisition",
  },
  {
    key: "site_refonte",
    title: "Refonte site internet",
    desc: "Refonte premium pour moderniser votre présence en ligne.",
    priceEurTtc: 1799,
    comboEurTtc: 1079,
    priceUi: 26000,
    badge: "Web",
  },
  {
    key: "site_creation",
    title: "Création site internet",
    desc: "Site professionnel haut de gamme conçu pour convertir.",
    priceEurTtc: 2990,
    comboEurTtc: 1794,
    priceUi: 33000,
    badge: "Web",
  },
];

// Shared source of truth for the storefront, new order rows and both emails.
export const BOUTIQUE_PRODUCTS: BoutiqueProduct[] = LEGACY_BOUTIQUE_PRODUCTS
  .map(({ priceEurTtc, comboEurTtc, ...product }) => ({
    ...product,
    priceEurHt: boutiqueTtcToRoundedHt(priceEurTtc),
    comboEurHt: boutiqueTtcToRoundedHt(comboEurTtc),
  }))
  .sort((a, b) => a.priceEurHt - b.priceEurHt);

export function boutiqueOrderAmounts(product: BoutiqueProduct, method: "EUR" | "UI") {
  return {
    amountEurHt: method === "EUR" ? product.priceEurHt : product.comboEurHt,
    amountUi: method === "UI" ? product.priceUi : null,
  };
}

export function boutiqueSavingsPercent(product: Pick<BoutiqueProduct, "priceEurHt" | "comboEurHt">): number {
  const { priceEurHt, comboEurHt } = product;
  if (!Number.isFinite(priceEurHt) || priceEurHt <= 0 || !Number.isFinite(comboEurHt) || comboEurHt < 0) return 0;
  return Math.max(0, Math.round(((priceEurHt - comboEurHt) / priceEurHt) * 100));
}

export function formatBoutiqueEurHt(amount: number, locale = "fr-FR", taxLabel = "HT") {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)} € ${taxLabel}`;
}

export function boutiqueOrderPriceLabel(product: BoutiqueProduct, method: "EUR" | "UI", locale = "fr-FR", taxLabel = "HT") {
  const amounts = boutiqueOrderAmounts(product, method);
  const euros = formatBoutiqueEurHt(amounts.amountEurHt, locale, taxLabel);
  return amounts.amountUi === null ? euros : `${euros} + ${new Intl.NumberFormat(locale).format(amounts.amountUi)} UI`;
}

export function findBoutiqueProduct(key: string) {
  return BOUTIQUE_PRODUCTS.find((p) => p.key === key) ?? null;
}

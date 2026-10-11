export type BoutiqueProduct = {
  key: string;
  title: string;
  desc: string;
  priceEurHt: number;
  comboEurHt: number;
  priceUi: number;
  badge?: string;
};

// The historical catalogue used the project's 20% reference VAT.
// Current offers below are set directly in HT; stored orders are untouched.
export const BOUTIQUE_REFERENCE_VAT_PERCENT = 20;
export const BOUTIQUE_PRICE_TAX_BEHAVIOR = "exclusive" as const;

export function boutiqueTtcToRoundedHt(amountEurTtc: number): number {
  if (!Number.isFinite(amountEurTtc) || amountEurTtc < 0) {
    throw new RangeError("Invalid Boutique reference price");
  }
  return Math.round((amountEurTtc * 100) / (100 + BOUTIQUE_REFERENCE_VAT_PERCENT));
}

// Shared source of truth for the storefront, new order rows and both emails.
// These services keep the Boutique order workflow; video recharges have a separate catalogue.
export const BOUTIQUE_PRODUCTS: BoutiqueProduct[] = [
  {
    key: "cartes_visite",
    title: "Cartes de visite premium",
    desc: "Création design pro + impression sur papier de qualité + livraison pour 500 cartes.",
    priceEurHt: 300,
    comboEurHt: 180,
    priceUi: 250,
    badge: "Print",
  },
  {
    key: "flyers",
    title: "Flyers professionnels",
    desc: "Création design + impression + livraison pour 1000 flyers.",
    priceEurHt: 350,
    comboEurHt: 210,
    priceUi: 300,
    badge: "Print",
  },
  {
    key: "facebook_page",
    title: "Création page Facebook",
    desc: "Page professionnelle prête à valoriser votre activité.",
    priceEurHt: 350,
    comboEurHt: 210,
    priceUi: 300,
    badge: "Social",
  },
  {
    key: "instagram_page",
    title: "Création page Instagram",
    desc: "Profil professionnel optimisé pour renforcer votre image.",
    priceEurHt: 350,
    comboEurHt: 210,
    priceUi: 300,
    badge: "Social",
  },
  {
    key: "linkedin_page",
    title: "Création page LinkedIn",
    desc: "Page entreprise professionnelle et crédible.",
    priceEurHt: 350,
    comboEurHt: 210,
    priceUi: 300,
    badge: "Social",
  },
  {
    key: "gmb",
    title: "Optimisation Google Business",
    desc: "Fiche optimisée pour renforcer votre visibilité locale.",
    priceEurHt: 250,
    comboEurHt: 150,
    priceUi: 200,
    badge: "Local",
  },
  {
    key: "logo",
    title: "Logo professionnel",
    desc: "Création graphique complète avec déclinaisons exploitables.",
    priceEurHt: 500,
    comboEurHt: 300,
    priceUi: 500,
    badge: "Branding",
  },
  {
    key: "ads",
    title: "Campagne publicitaire",
    desc: "Configuration complète de votre campagne d'acquisition. Budget publicitaire non inclus.",
    priceEurHt: 600,
    comboEurHt: 360,
    priceUi: 600,
    badge: "Acquisition",
  },
  {
    key: "site_refonte",
    title: "Refonte site internet",
    desc: "Refonte premium pour moderniser votre présence en ligne.",
    priceEurHt: 1500,
    comboEurHt: 900,
    priceUi: 1000,
    badge: "Web",
  },
  {
    key: "site_creation",
    title: "Création site vitrine",
    desc: "Site vitrine professionnel conçu pour présenter votre activité et convertir vos visiteurs.",
    priceEurHt: 2000,
    comboEurHt: 1200,
    priceUi: 1500,
    badge: "Web",
  },
  {
    key: "site_ecommerce",
    title: "Création site e-commerce",
    desc: "Site e-commerce professionnel pour vendre vos produits en ligne.",
    priceEurHt: 3500,
    comboEurHt: 2100,
    priceUi: 2500,
    badge: "Web",
  },
].sort((a, b) => a.priceEurHt - b.priceEurHt);

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

export const ADS_CHANNELS = [
  { id: "meta", label: "Meta Ads", format: "Trafic · Facebook · Instagram" },
  { id: "google", label: "Google Ads", format: "Recherche · annonces textuelles" },
  { id: "linkedin", label: "LinkedIn Ads", format: "Audience professionnelle" },
  { id: "tiktok", label: "TikTok Ads", format: "Vidéo · communautés" },
  { id: "pinterest", label: "Pinterest Ads", format: "Découverte visuelle" },
  { id: "x", label: "X Ads", format: "Conversations · actualité" },
] as const;

export const ADS_OAUTH_PROVIDERS = ["meta", "google"] as const;

export type AdsChannelId = (typeof ADS_CHANNELS)[number]["id"];
export type AdsProvider = (typeof ADS_OAUTH_PROVIDERS)[number];

export function isAdsChannelId(value: unknown): value is AdsChannelId {
  return ADS_CHANNELS.some((channel) => channel.id === value);
}

export function isAdsProvider(value: unknown): value is AdsProvider {
  return value === "meta" || value === "google";
}

export type AdsCampaignInput = {
  provider: AdsChannelId;
  adAccountId: string;
  accountCurrency: "EUR";
  name: string;
  dailyBudgetEuros: number;
  endDate: string;
  destinationUrl: string;
  primaryText: string;
  imageUrl: string;
  creativeUrl?: string;
  creativeType?: "image" | "video";
  pageId: string;
  headlines: string[];
  descriptions: string[];
  keywords: string[];
  noSpecialCategoryConfirmed: boolean;
  notEuPoliticalConfirmed: boolean;
};

export type AdsAccount = {
  id: string;
  name: string;
  currency: string;
  provider: AdsProvider;
  status?: string;
  /** Google manager account through which this advertiser account is accessible. */
  loginCustomerId?: string;
};

const clean = (value: unknown) => String(value ?? "").trim();

function textList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  const list = Array.isArray(value) ? value : String(value ?? "").split("\n");
  const items = list.map((item) => clean(item)).filter(Boolean);
  if (items.length > maxItems || items.some((item) => item.length > maxLength)) return null;
  return Array.from(new Set(items));
}

function httpsUrl(value: unknown): string | null {
  try {
    const raw = clean(value);
    if (raw.length > 2000) return null;
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseAdsCampaignInput(value: unknown, options: { purpose?: "draft" | "publish" } = {}): { draft: AdsCampaignInput | null; error: string | null } {
  const purpose = options.purpose || "publish";
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const provider = isAdsChannelId(raw.provider) ? raw.provider : null;
  if (!provider) return { draft: null, error: "Choisissez un canal publicitaire disponible." };
  if (purpose === "publish" && !isAdsProvider(provider)) {
    return { draft: null, error: "La connexion et la publication de ce canal ne sont pas encore disponibles." };
  }

  const rawAccountId = clean(raw.adAccountId);
  const adAccountId = rawAccountId.replace(/^act_/, "").replace(/-/g, "");
  if (purpose === "publish" && !/^\d{5,25}$/.test(adAccountId)) return { draft: null, error: "Sélectionnez un compte publicitaire connecté." };
  if (adAccountId && !/^\d{5,25}$/.test(adAccountId)) return { draft: null, error: "L’identifiant du compte publicitaire est invalide." };
  if (!isAdsProvider(provider) && adAccountId) return { draft: null, error: "Connectez ce canal dans iNr’ADS avant d’associer un compte publicitaire." };
  if (raw.accountCurrency !== "EUR") return { draft: null, error: "Cette première version accepte les comptes publicitaires en EUR uniquement." };

  const name = clean(raw.name);
  if ((purpose === "publish" && name.length < 3) || name.length > 100) return { draft: null, error: "Le nom de campagne doit contenir entre 3 et 100 caractères." };

  const dailyBudgetEuros = Number(raw.dailyBudgetEuros);
  if (!Number.isFinite(dailyBudgetEuros) || dailyBudgetEuros < 5 || dailyBudgetEuros > 500 || Math.abs(Math.round(dailyBudgetEuros * 100) - dailyBudgetEuros * 100) > 0.000001) {
    return { draft: null, error: "Le budget journalier doit être compris entre 5 et 500 €, avec deux décimales maximum." };
  }

  const endDate = clean(raw.endDate);
  const endTime = Date.parse(`${endDate}T23:59:59Z`);
  const daysUntilEnd = (endTime - Date.now()) / 86_400_000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(endTime) || daysUntilEnd < 1 || daysUntilEnd > 90) {
    return { draft: null, error: "Choisissez une fin de campagne entre demain et dans 90 jours." };
  }

  const rawDestinationUrl = clean(raw.destinationUrl);
  const destinationUrl = rawDestinationUrl ? httpsUrl(rawDestinationUrl) : null;
  if (rawDestinationUrl && !destinationUrl) return { draft: null, error: "Renseignez une URL de destination HTTPS valide." };
  if (purpose === "publish" && !destinationUrl) return { draft: null, error: "Renseignez une URL de destination HTTPS valide." };

  const primaryText = clean(raw.primaryText);
  const rawImageUrl = clean(raw.imageUrl);
  const imageUrl = rawImageUrl ? httpsUrl(rawImageUrl) : null;
  if (rawImageUrl && !imageUrl) return { draft: null, error: "L’URL du visuel doit être HTTPS." };
  const rawCreativeUrl = clean(raw.creativeUrl);
  const creativeUrl = rawCreativeUrl ? httpsUrl(rawCreativeUrl) : null;
  if (rawCreativeUrl && !creativeUrl) return { draft: null, error: "L’URL du média doit être HTTPS." };
  const creativeType = raw.creativeType === "video" ? "video" : "image";
  const pageId = clean(raw.pageId);
  const headlineLimit = provider === "linkedin" ? 200 : provider === "pinterest" ? 100 : provider === "x" ? 280 : provider === "tiktok" ? 100 : 30;
  const descriptionLimit = provider === "linkedin" ? 300 : provider === "pinterest" ? 800 : provider === "x" ? 280 : provider === "tiktok" ? 100 : 90;
  const headlines = textList(raw.headlines, 15, headlineLimit);
  const descriptions = textList(raw.descriptions, 4, descriptionLimit);
  const keywords = textList(raw.keywords, 20, 80);
  if (!headlines || !descriptions || !keywords) {
    return { draft: null, error: "Vérifiez le nombre et la longueur des titres, descriptions et mots-clés." };
  }
  const noSpecialCategoryConfirmed = raw.noSpecialCategoryConfirmed === true;
  const notEuPoliticalConfirmed = raw.notEuPoliticalConfirmed === true;

  if (purpose === "publish" && provider === "meta") {
    if (primaryText.length < 10 || primaryText.length > 500) return { draft: null, error: "Le texte Meta doit contenir entre 10 et 500 caractères." };
    if (!imageUrl) return { draft: null, error: "Meta requiert l’URL HTTPS publique d’un visuel." };
    if (!/^\d{5,30}$/.test(pageId)) return { draft: null, error: "Sélectionnez une Page Facebook autorisée pour cette annonce." };
    if (!noSpecialCategoryConfirmed) return { draft: null, error: "Confirmez que l’annonce Meta ne relève d’aucune catégorie publicitaire spéciale." };
  } else if (purpose === "publish" && provider === "google") {
    if (headlines.length < 3 || descriptions.length < 2 || keywords.length < 1) {
      return { draft: null, error: "Google Search requiert 3 titres, 2 descriptions et au moins un mot-clé." };
    }
    if (!notEuPoliticalConfirmed) {
      return { draft: null, error: "Confirmez que la campagne Google ne contient pas de publicité politique ciblant l’Union européenne." };
    }
  } else if (purpose === "publish") {
    return { draft: null, error: "La publication de ce canal n’est pas disponible." };
  }

  return {
    draft: { provider, adAccountId, accountCurrency: "EUR", name, dailyBudgetEuros, endDate, destinationUrl: destinationUrl || "", primaryText, imageUrl: imageUrl || "", creativeUrl: creativeUrl || "", creativeType, pageId, headlines, descriptions, keywords, noSpecialCategoryConfirmed, notEuPoliticalConfirmed },
    error: null,
  };
}

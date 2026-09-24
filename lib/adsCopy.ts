/**
 * Copy-generation contract for the six iNr'ADS acquisition channels.
 *
 * Platform character counts below describe the named ad format, not ad-policy
 * approval. The platform can reject an otherwise valid draft; a human review is
 * always required before any campaign is submitted.
 */
export const ADS_COPY_CHANNELS = ["meta", "google", "linkedin", "tiktok", "pinterest", "x"] as const;
export type AdsCopyChannel = (typeof ADS_COPY_CHANNELS)[number];

export type SuggestedAdsCopy = {
  primaryText: string;
  headlines: string[];
  descriptions: string[];
  keywords: string[];
};

type AdsCopySpec = {
  label: string;
  format: string;
  instructions: string;
  limits: { primaryText: number; headlines: number; descriptions: number; keywords: number };
  counts: { headlines: number; descriptions: number; keywords: number };
  minimum: { primaryText: number; headlines: number; descriptions: number; keywords: number };
};

const COPY_SPECS: Record<AdsCopyChannel, AdsCopySpec> = {
  meta: {
    label: "Meta Ads",
    format: "publicité de trafic Meta pouvant être diffusée sur Facebook et Instagram selon les placements retenus",
    instructions: "Rédige un texte principal naturel et orienté bénéfice, deux variantes de titre très courtes et deux descriptions facultatives. Garde les titres à 30 caractères et les descriptions à 90 caractères au plus pour rester compatibles avec les champs actuels d’iNr’ADS ; ce sont des limites de l’éditeur, pas une limite générale de Meta. Les mots-clés ne sont pas un champ de création d’annonce Meta dans ce parcours : renvoie un tableau vide.",
    limits: { primaryText: 500, headlines: 30, descriptions: 90, keywords: 80 },
    counts: { headlines: 2, descriptions: 2, keywords: 0 },
    minimum: { primaryText: 10, headlines: 0, descriptions: 0, keywords: 0 },
  },
  google: {
    label: "Google Ads",
    format: "annonce responsive sur le Réseau de Recherche Google",
    instructions: "Génère au moins 5 variantes de titre (30 caractères maximum chacune), au moins 3 descriptions (90 caractères maximum chacune) et 5 à 10 expressions de recherche pertinentes comme suggestions de mots-clés. Google Search utilise plusieurs titres et descriptions pour composer l’annonce ; ne promets pas un ordre d’affichage particulier. Évite les mots-clés trop larges ou sans lien direct avec l’offre.",
    limits: { primaryText: 500, headlines: 30, descriptions: 90, keywords: 80 },
    counts: { headlines: 15, descriptions: 4, keywords: 20 },
    minimum: { primaryText: 0, headlines: 3, descriptions: 2, keywords: 1 },
  },
  linkedin: {
    label: "LinkedIn Ads",
    format: "publicité Single Image / Sponsored Content dans le fil LinkedIn",
    instructions: "Écris pour une audience professionnelle sans inventer la fonction, le secteur ou les enjeux personnels des personnes ciblées. Fournis un texte d’introduction concis (vise 150 caractères pour éviter la troncature ; LinkedIn autorise jusqu’à 3 000), un titre (vise 70 caractères ; maximum 200) et une description facultative (vise 100 caractères ; maximum 300). Ces repères correspondent au format Single Image ; d’autres formats ont d’autres spécifications. Ne fournis pas de mots-clés de ciblage, ce ne sont pas des assets texte de ce format.",
    limits: { primaryText: 3000, headlines: 200, descriptions: 300, keywords: 80 },
    counts: { headlines: 1, descriptions: 1, keywords: 0 },
    minimum: { primaryText: 15, headlines: 1, descriptions: 0, keywords: 0 },
  },
  tiktok: {
    label: "TikTok Ads",
    format: "texte d’une annonce In-Feed TikTok",
    instructions: "Écris une accroche courte, orale et immédiatement compréhensible, adaptée à une création vidéo ou image In-Feed. Le preview publicitaire officiel indique un maximum de 100 caractères anglais et recommande 4 à 60 pour limiter la troncature : vise 60 caractères maximum et fais contrôler le rendu français et le placement final. Rends un seul texte principal ; pas de titres, descriptions secondaires ni mots-clés pour ce format générique.",
    limits: { primaryText: 100, headlines: 30, descriptions: 90, keywords: 80 },
    counts: { headlines: 0, descriptions: 0, keywords: 0 },
    minimum: { primaryText: 10, headlines: 0, descriptions: 0, keywords: 0 },
  },
  pinterest: {
    label: "Pinterest Ads",
    format: "annonce Pin standard, image ou vidéo",
    instructions: "Crée un titre descriptif qui donne envie d’enregistrer ou de découvrir l’offre, sans clickbait ni répétition artificielle de mots-clés : 100 caractères maximum. Ajoute une description informative (800 caractères maximum ; elle peut ne pas apparaître dans le fil, mais aide Pinterest à comprendre la pertinence du Pin). Fournis 5 à 10 expressions comme suggestions de ciblage par mots-clés, distinctes du texte de l’annonce.",
    limits: { primaryText: 800, headlines: 100, descriptions: 800, keywords: 80 },
    counts: { headlines: 1, descriptions: 1, keywords: 15 },
    minimum: { primaryText: 0, headlines: 1, descriptions: 1, keywords: 1 },
  },
  x: {
    label: "X Ads",
    format: "post sponsorisé avec lien vers le site",
    instructions: "Rédige un post direct et conversationnel, compréhensible hors contexte. Garde le texte du post à 257 caractères maximum pour conserver la marge d’un lien de destination (les spécifications X indiquent 280 caractères et 23 caractères déduits par lien). Le titre d’une Website Card peut aller jusqu’à 70 caractères ; sa description est facultative et 50 caractères sont conseillés pour éviter la troncature. Rends une seule proposition de post, sans mots-clés de ciblage.",
    limits: { primaryText: 257, headlines: 70, descriptions: 50, keywords: 80 },
    counts: { headlines: 1, descriptions: 1, keywords: 0 },
    minimum: { primaryText: 15, headlines: 0, descriptions: 0, keywords: 0 },
  },
};

export function parseAdsCopyChannel(value: unknown): AdsCopyChannel | null {
  return typeof value === "string" && (ADS_COPY_CHANNELS as readonly string[]).includes(value)
    ? value as AdsCopyChannel
    : null;
}

export function buildAdsCopySystemPrompt(channel: AdsCopyChannel): string {
  const spec = COPY_SPECS[channel];
  return [
    "Tu es le rédacteur publicitaire d'iNrCy. Réponds uniquement en JSON valide avec les clés primaryText, headlines (tableau), descriptions (tableau), keywords (tableau).",
    "Ne crée ni ne publie aucune publicité. N'invente pas de prix, de remise, de témoignage, de résultat garanti, de disponibilité, de certification ou de qualification. N'ajoute pas de fait absent du brief. Évite les attributs personnels sensibles et les promesses absolues.",
    `Canal : ${spec.label}. Format de référence : ${spec.format}.`,
    spec.instructions,
    "Écris en français. La conformité et les limites exactes dépendent aussi du compte, du placement, du pays et du format final : présente une proposition à relire, sans garantir son acceptation. Le professionnel doit vérifier les faits et les règles applicables avant toute diffusion.",
  ].join("\n\n");
}

export function buildAdsCopyInput(channel: AdsCopyChannel, brand: string, brief: string): string {
  const spec = COPY_SPECS[channel];
  return `Canal : ${spec.label}\nEntreprise : ${brand || "non précisée"}\nOffre et informations vérifiées par le professionnel : ${brief}`;
}

function list(value: unknown, count: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0 && item.length <= maxLength)
    .slice(0, count);
}

export function normalizeSuggestedAdsCopy(channel: AdsCopyChannel, value: unknown): SuggestedAdsCopy {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const spec = COPY_SPECS[channel];
  return {
    primaryText: String(source.primaryText || "").trim().slice(0, spec.limits.primaryText),
    headlines: list(source.headlines, spec.counts.headlines, spec.limits.headlines),
    descriptions: list(source.descriptions, spec.counts.descriptions, spec.limits.descriptions),
    keywords: list(source.keywords, spec.counts.keywords, spec.limits.keywords),
  };
}

export function isUsableSuggestedAdsCopy(channel: AdsCopyChannel, copy: SuggestedAdsCopy): boolean {
  const minimum = COPY_SPECS[channel].minimum;
  return copy.primaryText.length >= minimum.primaryText
    && copy.headlines.length >= minimum.headlines
    && copy.descriptions.length >= minimum.descriptions
    && copy.keywords.length >= minimum.keywords;
}

export type BoosterChannelKey =
  | "inrcy_site"
  | "site_web"
  | "inr_search"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";

export type BoosterContentLengthPreference = "short" | "medium" | "detailed";

type BoosterContentLengthRange = {
  min: number;
  max: number;
};

type BoosterChannelContentRule = {
  short: BoosterContentLengthRange;
  medium: BoosterContentLengthRange;
  detailed: BoosterContentLengthRange;
  max: number;
};

/**
 * Plages éditoriales du contenu principal généré par l'IA.
 *
 * Le titre, le CTA et les hashtags sont gérés séparément. `max` est le plafond
 * iNrCy du champ `content`, volontairement confortable par rapport aux limites
 * techniques des plateformes afin de garder une publication lisible et utile.
 */
export const BOOSTER_CHANNEL_CONTENT_RULES: Record<
  BoosterChannelKey,
  BoosterChannelContentRule
> = {
  inrcy_site: {
    short: { min: 700, max: 1000 },
    medium: { min: 1100, max: 1700 },
    detailed: { min: 1800, max: 2400 },
    max: 2600,
  },
  site_web: {
    short: { min: 700, max: 1000 },
    medium: { min: 1100, max: 1700 },
    detailed: { min: 1800, max: 2400 },
    max: 2600,
  },
  inr_search: {
    short: { min: 90, max: 140 },
    medium: { min: 150, max: 210 },
    detailed: { min: 230, max: 290 },
    max: 300,
  },
  gmb: {
    short: { min: 220, max: 350 },
    medium: { min: 400, max: 650 },
    detailed: { min: 700, max: 1000 },
    max: 1200,
  },
  facebook: {
    short: { min: 220, max: 400 },
    medium: { min: 450, max: 750 },
    detailed: { min: 800, max: 1200 },
    max: 1400,
  },
  instagram: {
    short: { min: 150, max: 280 },
    medium: { min: 300, max: 500 },
    detailed: { min: 620, max: 950 },
    max: 1200,
  },
  linkedin: {
    short: { min: 350, max: 600 },
    medium: { min: 650, max: 1000 },
    detailed: { min: 1100, max: 1700 },
    max: 2000,
  },
  tiktok: {
    short: { min: 80, max: 150 },
    medium: { min: 160, max: 300 },
    detailed: { min: 380, max: 650 },
    max: 800,
  },
  youtube_shorts: {
    short: { min: 300, max: 500 },
    medium: { min: 600, max: 950 },
    detailed: { min: 1000, max: 1600 },
    max: 2000,
  },
  pinterest: {
    short: { min: 100, max: 160 },
    medium: { min: 180, max: 260 },
    detailed: { min: 320, max: 460 },
    max: 520,
  },
};

export const INR_SEARCH_CONTENT_MAX_LENGTH =
  BOOSTER_CHANNEL_CONTENT_RULES.inr_search.max;

export function getBoosterGeneratedContentRule(
  channel: BoosterChannelKey,
  length: BoosterContentLengthPreference,
) {
  const channelRule = BOOSTER_CHANNEL_CONTENT_RULES[channel];
  return {
    ...channelRule[length],
    absoluteMax: channelRule.max,
  };
}

export function formatBoosterGeneratedContentRule(
  channel: BoosterChannelKey,
  length: BoosterContentLengthPreference,
) {
  const rule = getBoosterGeneratedContentRule(channel, length);
  return `${rule.min}–${rule.max} caractères de contenu principal. Maximum absolu : ${rule.absoluteMax} caractères dans content, à ne jamais dépasser.`;
}

function closeUnbalancedMarkdownBold(value: string) {
  const markers = value.match(/\*\*/g)?.length || 0;
  if (markers % 2 === 0) return value;
  const lastMarker = value.lastIndexOf("**");
  return lastMarker >= 0
    ? `${value.slice(0, lastMarker)}${value.slice(lastMarker + 2)}`.trimEnd()
    : value;
}

function truncateAtNaturalBoundary(value: string, maxLength: number) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxLength) return text;

  const candidate = text.slice(0, maxLength);
  const preferredFloor = Math.floor(maxLength * 0.72);
  const acceptableFloor = Math.floor(maxLength * 0.55);
  let sentenceBoundary = -1;
  const sentencePattern = /[.!?…](?:["'»”)]*)?(?=\s|$)/g;
  let sentenceMatch: RegExpExecArray | null;
  while ((sentenceMatch = sentencePattern.exec(candidate))) {
    const sentenceEnd = sentenceMatch.index + sentenceMatch[0].length;
    if (sentenceEnd >= preferredFloor) sentenceBoundary = sentenceEnd;
  }

  const paragraphIndex = candidate.lastIndexOf("\n\n");
  const lineIndex = candidate.lastIndexOf("\n");
  const preferredSpace = candidate.lastIndexOf(" ");

  let cutAt =
    sentenceBoundary >= preferredFloor
      ? sentenceBoundary
      : paragraphIndex >= preferredFloor
        ? paragraphIndex
        : lineIndex >= preferredFloor
          ? lineIndex
          : preferredSpace >= preferredFloor
            ? preferredSpace
            : -1;

  if (cutAt < 0) {
    const fallbackSpace = candidate.lastIndexOf(" ");
    cutAt = fallbackSpace >= acceptableFloor ? fallbackSpace : maxLength;
  }

  return closeUnbalancedMarkdownBold(candidate.slice(0, cutAt).trimEnd());
}

/**
 * Filet de sécurité local et instantané après la réponse IA.
 * Aucun second appel IA n'est effectué : le temps de génération n'augmente pas.
 */
export function limitBoosterGeneratedContent(
  channel: BoosterChannelKey,
  content: string,
) {
  return truncateAtNaturalBoundary(
    content,
    BOOSTER_CHANNEL_CONTENT_RULES[channel].max,
  );
}

/**
 * Limite technique historique appliquée aux contenus modifiés avant publication.
 * Les autres canaux restent inchangés ici afin de ne jamais tronquer silencieusement
 * une modification manuelle du professionnel.
 */
export function limitBoosterChannelContent(channel: string, content: string) {
  const normalized = String(content || "").trim();
  return channel === "inr_search"
    ? normalized.slice(0, INR_SEARCH_CONTENT_MAX_LENGTH).trim()
    : normalized;
}

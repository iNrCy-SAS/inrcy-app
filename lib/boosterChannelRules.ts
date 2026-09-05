import {
  normalizeAiContentLength,
  type AiContentLength,
} from "./aiContentLength.ts";

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

export type BoosterContentLengthPreference = AiContentLength | "detailed";

type BoosterContentLengthRange = {
  min: number;
  max: number;
};

type BoosterChannelContentRule = {
  adapted: BoosterContentLengthRange;
  short: BoosterContentLengthRange;
  medium: BoosterContentLengthRange;
  long: BoosterContentLengthRange;
  deep: BoosterContentLengthRange;
  /** Alias de lecture pour les anciens tests, caches et appels historiques. */
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
    adapted: { min: 1000, max: 1900 },
    short: { min: 600, max: 950 },
    medium: { min: 1100, max: 1700 },
    long: { min: 1800, max: 2600 },
    deep: { min: 2700, max: 3800 },
    detailed: { min: 1800, max: 2400 },
    max: 4200,
  },
  site_web: {
    adapted: { min: 1100, max: 2100 },
    short: { min: 600, max: 950 },
    medium: { min: 1100, max: 1700 },
    long: { min: 1800, max: 2800 },
    deep: { min: 3000, max: 4500 },
    detailed: { min: 1800, max: 2400 },
    max: 5000,
  },
  inr_search: {
    adapted: { min: 140, max: 240 },
    short: { min: 90, max: 140 },
    medium: { min: 150, max: 210 },
    long: { min: 220, max: 275 },
    deep: { min: 275, max: 300 },
    detailed: { min: 230, max: 290 },
    max: 300,
  },
  gmb: {
    adapted: { min: 350, max: 750 },
    short: { min: 220, max: 350 },
    medium: { min: 400, max: 650 },
    long: { min: 700, max: 1050 },
    deep: { min: 1000, max: 1400 },
    detailed: { min: 700, max: 1000 },
    max: 1500,
  },
  facebook: {
    adapted: { min: 350, max: 900 },
    short: { min: 220, max: 400 },
    medium: { min: 450, max: 750 },
    long: { min: 800, max: 1300 },
    deep: { min: 1300, max: 2000 },
    detailed: { min: 800, max: 1200 },
    max: 2200,
  },
  instagram: {
    adapted: { min: 260, max: 650 },
    short: { min: 150, max: 280 },
    medium: { min: 300, max: 500 },
    long: { min: 620, max: 1000 },
    deep: { min: 1000, max: 1800 },
    detailed: { min: 620, max: 950 },
    max: 2200,
  },
  linkedin: {
    adapted: { min: 550, max: 1100 },
    short: { min: 350, max: 600 },
    medium: { min: 650, max: 1000 },
    long: { min: 1100, max: 1800 },
    deep: { min: 1800, max: 2700 },
    detailed: { min: 1100, max: 1700 },
    max: 3000,
  },
  tiktok: {
    adapted: { min: 140, max: 360 },
    short: { min: 80, max: 150 },
    medium: { min: 160, max: 300 },
    long: { min: 380, max: 700 },
    deep: { min: 700, max: 1050 },
    detailed: { min: 380, max: 650 },
    max: 1200,
  },
  youtube_shorts: {
    adapted: { min: 500, max: 1100 },
    short: { min: 300, max: 500 },
    medium: { min: 600, max: 950 },
    long: { min: 1000, max: 1700 },
    deep: { min: 1700, max: 2500 },
    detailed: { min: 1000, max: 1600 },
    max: 2800,
  },
  pinterest: {
    adapted: { min: 160, max: 300 },
    short: { min: 100, max: 160 },
    medium: { min: 180, max: 260 },
    long: { min: 320, max: 460 },
    deep: { min: 440, max: 500 },
    detailed: { min: 320, max: 460 },
    max: 500,
  },
};

export const INR_SEARCH_CONTENT_MAX_LENGTH =
  BOOSTER_CHANNEL_CONTENT_RULES.inr_search.max;

export function getBoosterGeneratedContentRule(
  channel: BoosterChannelKey,
  length: BoosterContentLengthPreference,
) {
  const channelRule = BOOSTER_CHANNEL_CONTENT_RULES[channel];
  const normalizedLength = length === "detailed"
    ? "long"
    : normalizeAiContentLength(length);
  return {
    ...channelRule[normalizedLength],
    absoluteMax: channelRule.max,
  };
}

export function isBoosterWebChannel(channel: BoosterChannelKey) {
  return channel === "inrcy_site" || channel === "site_web" || channel === "inr_search";
}

export function getBoosterContentLengthForChannel(
  preferences: {
    length?: BoosterContentLengthPreference;
    webLength?: BoosterContentLengthPreference;
    socialLength?: BoosterContentLengthPreference;
  },
  channel: BoosterChannelKey,
): AiContentLength {
  const fallback = preferences.length === "detailed"
    ? "long"
    : normalizeAiContentLength(preferences.length, "medium");
  const selected = isBoosterWebChannel(channel)
    ? preferences.webLength
    : preferences.socialLength;
  return selected === "detailed"
    ? "long"
    : normalizeAiContentLength(selected, fallback);
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

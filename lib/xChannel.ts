import twitterText from "twitter-text";

export const X_CHANNEL_KEY = "x" as const;
export const X_POST_WEIGHTED_LENGTH_MAX = 280;
export const X_POST_MAX_IMAGES = 4;

export const X_CHANNEL_CAPABILITIES = {
  key: X_CHANNEL_KEY,
  label: "X",
  supportsTextOnly: true,
  requiresMedia: false,
  maxImages: X_POST_MAX_IMAGES,
  maxVideos: 1,
  maxGifs: 1,
  supportsReels: false,
  supportsStories: false,
  supportsNativeCta: false,
  supportsProfileEditing: false,
  supportsScheduling: true,
} as const;

const X_INPUT_ALIASES = new Set(["x", "twitter", "twitter_x", "x_twitter"]);

export function normalizeXChannelKey(value: unknown): typeof X_CHANNEL_KEY | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return X_INPUT_ALIASES.has(normalized) ? X_CHANNEL_KEY : null;
}

function normalizeXText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getXPostTextMetrics(value: unknown) {
  const text = normalizeXText(value);
  const parsed = twitterText.parseTweet(text);
  return {
    text,
    weightedLength: parsed.weightedLength,
    valid: Boolean(text && parsed.valid && parsed.weightedLength <= X_POST_WEIGHTED_LENGTH_MAX),
    max: X_POST_WEIGHTED_LENGTH_MAX,
  };
}

export function validateXPostText(value: unknown) {
  const metrics = getXPostTextMetrics(value);
  if (!metrics.text) {
    return { ...metrics, code: "x_text_required" as const, error: "Ajoutez un texte pour X." };
  }
  if (!metrics.valid) {
    return {
      ...metrics,
      code: "x_text_too_long" as const,
      error: `Le post X dépasse la limite de ${X_POST_WEIGHTED_LENGTH_MAX} caractères pondérés (${metrics.weightedLength}).`,
    };
  }
  return { ...metrics, code: null, error: null };
}

function ensureSentenceEnding(value: string) {
  const clean = value.trim().replace(/[,:;\-–—]+$/, "").trim();
  if (!clean) return "";
  return /[.!?…][\)\]"'»”]*$/.test(clean) ? clean : `${clean}.`;
}

/**
 * Réduit uniquement un texte généré par l'IA. Une saisie manuelle trop longue
 * doit être refusée avec validateXPostText et n'est jamais modifiée en silence.
 */
export function shortenGeneratedXPost(value: unknown) {
  const text = normalizeXText(value);
  if (!text || getXPostTextMetrics(text).valid) return text;

  const completeSentences: string[] = [];
  const sentencePattern = /[^.!?…]+[.!?…]+[\)\]"'»”]*/g;
  for (const match of text.matchAll(sentencePattern)) {
    const sentence = match[0]?.trim();
    if (sentence) completeSentences.push(sentence);
  }

  let best = "";
  for (const sentence of completeSentences) {
    const candidate = [best, sentence].filter(Boolean).join(" ");
    if (!getXPostTextMetrics(candidate).valid) break;
    best = candidate;
  }
  if (best) return best;

  const words = text.split(/\s+/).filter(Boolean);
  let low = 0;
  let high = words.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = ensureSentenceEnding(words.slice(0, mid).join(" "));
    if (getXPostTextMetrics(candidate).valid) low = mid;
    else high = mid - 1;
  }
  return ensureSentenceEnding(words.slice(0, low).join(" "));
}

export function getXProfileUrl(username: unknown) {
  const clean = String(username ?? "").trim().replace(/^@+/, "");
  return clean ? `https://x.com/${encodeURIComponent(clean)}` : null;
}

export function getXPostUrl(username: unknown, postId: unknown) {
  const cleanId = String(postId ?? "").trim();
  const profileUrl = getXProfileUrl(username);
  return profileUrl && cleanId ? `${profileUrl}/status/${encodeURIComponent(cleanId)}` : null;
}

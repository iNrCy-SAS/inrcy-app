import twitterText from "twitter-text";

export const X_CHANNEL_KEY = "x" as const;
export const X_POST_WEIGHTED_LENGTH_MAX = 280;
export const X_POST_MAX_IMAGES = 4;
export const X_FORBIDDEN_URL_ERROR =
  "Les liens et URL ne sont pas autorisés sur X. Supprimez le lien pour publier.";

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

const X_LONG_TLDS = [
  "academy",
  "agency",
  "app",
  "art",
  "asia",
  "biz",
  "blog",
  "business",
  "club",
  "cloud",
  "co",
  "com",
  "company",
  "dev",
  "digital",
  "edu",
  "email",
  "expert",
  "finance",
  "fr",
  "fun",
  "gov",
  "info",
  "io",
  "link",
  "live",
  "ly",
  "me",
  "media",
  "mobi",
  "net",
  "news",
  "online",
  "org",
  "pro",
  "shop",
  "site",
  "space",
  "store",
  "studio",
  "tech",
  "to",
  "travel",
  "tv",
  "website",
  "wiki",
  "world",
  "xyz",
] as const;

const X_LONG_TLD_PATTERN = X_LONG_TLDS.join("|");
const X_DOMAIN_LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?`;
// Tous les ccTLD ASCII à deux lettres, les TLD usuels plus longs, les TLD
// punycode et les TLD Unicode sont couverts. Limiter les TLD ASCII longs à
// une liste connue évite de prendre une phrase comme « exemple.fin » pour un
// lien, tout en bloquant les domaines réellement utilisés par les pros.
const X_DOMAIN_PATTERN = new RegExp(
  String.raw`(?:${X_DOMAIN_LABEL}\.)+(?:[a-z]{2}|(?:${X_LONG_TLD_PATTERN})|xn--[a-z0-9-]{2,59}|(?=[\p{L}-]{2,63}(?:\b|$))(?=[^\s./]*[^\x00-\x7f])[\p{L}-]{2,63})(?![\p{L}\p{N}-])(?::\d{1,5})?(?:[/?#][^\s<>"']*)?`,
  "giu",
);

const X_SCHEME_PATTERN =
  /\b(?:https?|hxxps?|ftp|ftps|mailto|tel)\s*(?::|\[\s*:\s*\]|\(\s*:\s*\)|\s+colon\s+)(?:\s*[\\/]\s*){0,2}[^\s<>"']+/giu;
const X_WWW_PATTERN = /\b(?:w\s*){3}\.[^\s<>"']+/giu;
const X_IPV4_PATTERN =
  /(?:^|[^\d])((?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?)/gu;

function normalizeXUrlDetectionText(value: unknown) {
  let text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\u3002\uFF0E\uFF61\u2024]/g, ".")
    .replace(/\b(hxxps?)\b/giu, (match) =>
      match.toLowerCase() === "hxxps" ? "https" : "http",
    )
    .replace(/\[\s*:\s*\]|\(\s*:\s*\)/g, ":")
    .replace(/\s+colon\s+/giu, ":")
    .replace(/\b(?:w\s+){2}w(?=\s*(?:\.|\[|\(|\{|dot\b|point\b))/giu, "www");

  // Les séparateurs déguisés peuvent se suivre (`www dot exemple dot fr`).
  // Plusieurs passes évitent qu'un remplacement consommant ses deux labels
  // masque le séparateur suivant.
  const disguisedDot =
    /([\p{L}\p{N}])\s*(?:[\[({]\s*(?:\.|dot|point|punto|ponto|punkt)\s*[\])}]|\b(?:dot|point|punto|ponto|punkt)\b)\s*([\p{L}\p{N}])/giu;
  for (let pass = 0; pass < 6; pass += 1) {
    const next = text.replace(disguisedDot, "$1.$2");
    if (next === text) break;
    text = next;
  }
  return text;
}

function firstPatternMatch(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  pattern.lastIndex = 0;
  return match?.[0]?.trim() || null;
}

/**
 * Retourne le premier lien détecté dans un texte destiné à X.
 *
 * La détection couvre les schémas explicites, `www`, domaines nus, IDN,
 * punycode, raccourcisseurs (qui sont des domaines) et écritures couramment
 * déguisées (`[.]`, `(dot)`, « point », caractères invisibles). Un numéro de
 * téléphone et une adresse e-mail simple restent autorisés ; `tel:` et
 * `mailto:` sont en revanche des URL et sont refusés.
 */
export function findForbiddenXUrl(value: unknown): string | null {
  const text = normalizeXUrlDetectionText(value);
  if (!text) return null;

  const scheme = firstPatternMatch(text, X_SCHEME_PATTERN);
  if (scheme) return scheme;

  // La bibliothèque officielle X maintient la liste complète des domaines
  // publics et applique exactement les règles d'auto-linkification du canal.
  const providerUrls = twitterText.extractUrlsWithIndices(text, {
    extractUrlsWithoutProtocol: true,
  });
  const providerUrl = providerUrls[0]?.url?.trim();
  if (providerUrl) return providerUrl;

  const www = firstPatternMatch(text, X_WWW_PATTERN);
  if (www) return www;

  X_DOMAIN_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(X_DOMAIN_PATTERN)) {
    const candidate = match[0]?.trim();
    if (!candidate) continue;
    const start = match.index || 0;
    // Ne pas confondre l'hôte d'une adresse e-mail simple avec une URL nue.
    if (start > 0 && text[start - 1] === "@") continue;
    X_DOMAIN_PATTERN.lastIndex = 0;
    return candidate;
  }
  X_DOMAIN_PATTERN.lastIndex = 0;

  X_IPV4_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(X_IPV4_PATTERN)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    const host = candidate.split(/[/:?#]/, 1)[0] || "";
    const octets = host.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
      continue;
    }
    // Les téléphones ponctués commençant par 0 restent permis. Les IP privées
    // ou publiques usuelles (ex. 192.168.1.1) sont bien refusées.
    if (host.startsWith("0") && !/[/:?#]/.test(candidate)) continue;
    X_IPV4_PATTERN.lastIndex = 0;
    return candidate;
  }
  X_IPV4_PATTERN.lastIndex = 0;
  return null;
}

export function containsForbiddenXUrl(value: unknown) {
  return findForbiddenXUrl(value) !== null;
}

export function validateXUrlFreeText(value: unknown) {
  const match = findForbiddenXUrl(value);
  return match
    ? {
        valid: false as const,
        code: "x_url_forbidden" as const,
        error: X_FORBIDDEN_URL_ERROR,
        match,
      }
    : { valid: true as const, code: null, error: null, match: null };
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
  const urlValidation = validateXUrlFreeText(metrics.text);
  if (!urlValidation.valid) {
    return {
      ...metrics,
      valid: false,
      code: urlValidation.code,
      error: urlValidation.error,
    };
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

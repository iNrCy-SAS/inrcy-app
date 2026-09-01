export type PublicationErrorProvider =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "gmb"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest"
  | "inrcy_site"
  | "site_web"
  | "inr_search";

export type PublicationErrorMediaKind = "photo" | "video" | "media";

function normalizeErrorText(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (input instanceof Error) return String(input.message || "").trim();
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["message", "error", "error_description", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return String(input || "").trim();
}

export function getProviderPublicationErrorMessage(
  provider: PublicationErrorProvider,
  input: unknown,
  context?: { mediaKind?: PublicationErrorMediaKind },
): string | null {
  const raw = normalizeErrorText(input);
  const message = raw.toLowerCase();
  if (!message) return null;

  if (provider === "pinterest") {
    if (
      message.includes("same width/height ratios") ||
      message.includes("same width and height ratios") ||
      message.includes("same aspect ratio") ||
      (message.includes("images") &&
        message.includes("ratio") &&
        (message.includes("must have") || message.includes("need to have")))
    ) {
      return "Pinterest exige le même format pour toutes les images d’une épingle. iNrCy les harmonise automatiquement avant l’envoi.";
    }
    if (
      message.includes("board not found") ||
      message.includes("invalid board") ||
      message.includes("board_id") && message.includes("invalid")
    ) {
      return "Le tableau Pinterest sélectionné est introuvable. Choisissez un autre tableau puis réessayez.";
    }
    if (
      message.includes("could not fetch the image") ||
      (message.includes("image url") &&
        (message.includes("unreachable") ||
          message.includes("not accessible") ||
          message.includes("could not fetch") ||
          message.includes("failed to fetch") ||
          message.includes("download")))
    ) {
      return "Pinterest n’a pas pu récupérer une image. Vérifiez qu’elle reste publique et accessible, puis réessayez.";
    }
    if (
      message.includes("invalid image") ||
      message.includes("unsupported image") ||
      message.includes("invalid media") ||
      message.includes("unsupported media")
    ) {
      return "Pinterest a refusé le format d’une image. iNrCy doit la convertir avant un nouvel envoi.";
    }
    if (
      message.includes("access token") ||
      message.includes("not authorized") ||
      message.includes("unauthorized") ||
      message.includes("authorization") ||
      message.includes("oauth") ||
      message.includes("scope")
    ) {
      return "Pinterest à reconnecter. Rendez-vous dans Canaux.";
    }
    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("quota")
    ) {
      return "Pinterest limite temporairement les publications. Réessayez dans quelques minutes.";
    }
  }

  if (provider === "tiktok") {
    if (
      message.includes("url_ownership_unverified") ||
      message.includes("url ownership") && message.includes("unverified") ||
      message.includes("url properties have not been verified") ||
      message.includes("url property has not been verified") ||
      message.includes("provided photo url") && message.includes("verified")
    ) {
      return "TikTok ne peut pas récupérer ces photos : le domaine média iNrCy doit être public et vérifié dans TikTok Developer. Ce message est normal depuis localhost.";
    }
    if (message.includes("photo_pull_failed")) {
      return "TikTok n’a pas réussi à récupérer les photos depuis leurs URL publiques. Vérifiez le domaine média puis réessayez.";
    }
    if (message.includes("picture_size_check_failed")) {
      return "TikTok refuse les dimensions d’une photo. iNrCy doit utiliser sa variante verticale compatible.";
    }
    if (message.includes("file_format_check_failed")) {
      const mediaKind = context?.mediaKind || "media";
      if (mediaKind === "photo") {
        return "TikTok refuse le format d’une photo. iNrCy doit utiliser sa variante JPEG compatible.";
      }
      if (mediaKind === "video") {
        return "TikTok refuse le format de la vidéo. Utilisez une vidéo MP4/H.264 compatible.";
      }
      return "TikTok refuse le format du média. Vérifiez sa compatibilité puis réessayez.";
    }
    if (message.includes("duration_check_failed")) {
      return "TikTok refuse la durée de cette vidéo. Utilisez une vidéo plus courte.";
    }
    if (
      message.includes("access_token_invalid") ||
      message.includes("scope_not_authorized") ||
      message.includes("not authorized") ||
      message.includes("unauthorized")
    ) {
      return "TikTok à reconnecter. Rendez-vous dans Canaux.";
    }
    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("spam_risk") ||
      message.includes("quota")
    ) {
      return "TikTok limite temporairement la publication. Réessayez plus tard.";
    }
  }

  if (provider === "instagram" || provider === "facebook") {
    if (
      message.includes("unsupported image format") ||
      message.includes("invalid image") ||
      message.includes("image could not be downloaded")
    ) {
      return `${provider === "instagram" ? "Instagram" : "Facebook"} a refusé le format d’une image. iNrCy doit utiliser une variante compatible.`;
    }

    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("quota") ||
      message.includes("application request limit reached") ||
      message.includes("user request limit reached")
    ) {
      return `${provider === "instagram" ? "Instagram" : "Facebook"} limite temporairement les publications. Réessayez dans quelques minutes.`;
    }

    if (
      message.includes("temporarily unavailable") ||
      message.includes("service unavailable") ||
      message.includes("please try again later") ||
      message.includes("an unknown error has occurred") ||
      message.includes("unexpected error")
    ) {
      return `${provider === "instagram" ? "Instagram" : "Facebook"} est temporairement indisponible. Réessayez dans quelques minutes.`;
    }
  }

  if (provider === "linkedin") {
    if (message.includes("media upload") && message.includes("failed")) {
      return "LinkedIn n’a pas pu recevoir le média. Réessayez dans quelques instants.";
    }
  }

  if (provider === "gmb") {
    if (
      message.includes("mediaitem") ||
      message.includes("sourceurl") ||
      message.includes("invalid image")
    ) {
      return "Google Business a refusé le média malgré sa conversion automatique. La publication texte seule n’a pas été envoyée ; réessayez ou consultez le motif détaillé dans iNr’Send.";
    }
  }

  if (provider === "youtube_shorts") {
    if (message.includes("upload") && message.includes("failed")) {
      return "YouTube n’a pas pu recevoir la vidéo. Réessayez dans quelques instants.";
    }
  }

  return null;
}

export function looksLikeEnglishErrorMessage(input: unknown): boolean {
  const raw = normalizeErrorText(input);
  if (!raw) return false;
  const message = raw.toLowerCase();

  const hasKnownEnglishErrorSyntax = [
    /\b(?:the|this|that) provided\b/,
    /\b(?:has|have|had) not been\b/,
    /\bmust (?:have|be|use|contain)\b/,
    /\bfailed to\b/,
    /\bcould not\b/,
    /\bcan(?:not|'t)\b/,
    /\bsomething went wrong\b/,
    /\bplease try again\b/,
    /\btoo many requests\b/,
    /\bnot authorized\b/,
    /\baccess denied\b/,
    /\binvalid (?:request|image|video|photo|media|token|url|parameter|payload|field|format|type)\b/,
    /\bmissing (?:required|parameter|field|token|id)\b/,
    /\bunsupported (?:format|media|image|video|operation)\b/,
    /\brequest (?:failed|was rejected|is invalid)\b/,
    /\bimages? (?:must|should|need to)\b/,
    /\b(?:media|image|video|photo|upload|download|publication|authentication|authorization|validation) (?:failed|failure|error|denied|rejected)\b/,
    /\b(?:media|image|video|photo|file) (?:is |was )?(?:too large|too small|invalid|unsupported|unavailable)\b/,
    /\b(?:resource|board|account|user|page|post|pin|file) not found\b/,
    /\b(?:internal server error|service unavailable|temporarily unavailable|an error occurred)\b/,
    /\b(?:maximum|limit|quota) (?:has been )?exceeded\b/,
    /\b(?:required field|permission denied|access forbidden|token expired)\b/,
  ].some((pattern) => pattern.test(message));
  if (hasKnownEnglishErrorSyntax) return true;

  const words = message.match(/[a-z]+/g) || [];
  if (!words.length) return false;
  const englishMarkers = new Set([
    "the", "this", "that", "these", "those", "a", "an", "to", "of",
    "for", "from", "with", "your", "please", "try", "again", "is",
    "are", "was", "were", "has", "have", "must", "should", "could",
    "cannot", "failed", "failure", "invalid", "missing", "unsupported",
    "provided", "required", "rejected", "denied", "expired", "unavailable",
    "error", "request", "response", "media", "image", "video", "photo",
    "file", "token", "permission", "access", "too", "large", "small",
    "not", "found", "exceeded",
  ]);
  const frenchMarkers = new Set([
    "le", "la", "les", "un", "une", "des", "du", "de", "pour", "avec",
    "est", "sont", "pas", "impossible", "merci", "erreur", "publication",
    "refuse", "refusee", "reessayez", "compte", "image", "video", "fichier",
  ]);
  const englishScore = words.reduce(
    (score, word) => score + (englishMarkers.has(word) ? 1 : 0),
    0,
  );
  const frenchScore = words.reduce(
    (score, word) => score + (frenchMarkers.has(word) ? 1 : 0),
    0,
  );
  return englishScore >= 3 && englishScore >= frenchScore + 2;
}

export function ensureFrenchPublicationErrorMessage(
  input: unknown,
  fallback: string,
): string {
  const raw = normalizeErrorText(input);
  if (!raw || looksLikeEnglishErrorMessage(raw)) return fallback;
  return raw;
}

export function getFrenchPublicationErrorMessage(
  provider: PublicationErrorProvider | string,
  input: unknown,
  fallback: string,
): string {
  const normalizedProvider =
    provider === "youtube"
      ? "youtube_shorts"
      : provider === "google_business"
        ? "gmb"
        : provider;
  const knownProvider = normalizedProvider as PublicationErrorProvider;
  return (
    getProviderPublicationErrorMessage(knownProvider, input) ||
    ensureFrenchPublicationErrorMessage(input, fallback)
  );
}

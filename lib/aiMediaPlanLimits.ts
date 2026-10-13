export const AI_MEDIA_EDITIONS = ["standard", "premium", "founder"] as const;
export const AI_MEDIA_KINDS = ["image", "video"] as const;
export const AI_MEDIA_SURFACES = ["booster", "studio"] as const;
export const AI_MEDIA_VIDEO_MIN_DURATION_SECONDS = 4;
export const AI_MEDIA_VIDEO_MAX_DURATION_SECONDS = 30;
export const AI_MEDIA_VIDEO_DURATION_OPTIONS = Object.freeze(
  Array.from({ length: AI_MEDIA_VIDEO_MAX_DURATION_SECONDS - AI_MEDIA_VIDEO_MIN_DURATION_SECONDS + 1 }, (_, index) => index + AI_MEDIA_VIDEO_MIN_DURATION_SECONDS),
);
/** Existing item/second jobs retain their immutable historical ledger amounts. */
export const AI_MEDIA_LEGACY_VIDEO_DURATION_OPTIONS = [8, 16, 24] as const;

/**
 * Solde maximal pouvant etre conserve d'un mois sur l'autre. Le quota mensuel
 * du forfait continue d'etre la recharge; ces valeurs bornent uniquement la
 * cagnotte cumulable.
 */
export type AiMediaEdition = (typeof AI_MEDIA_EDITIONS)[number];
export type AiMediaKind = (typeof AI_MEDIA_KINDS)[number];
export type AiMediaSurface = (typeof AI_MEDIA_SURFACES)[number];
/** Engine capability and account entitlement validate the exact duration. */
export type AiMediaVideoDurationLimit = number;
export type AiMediaQuotaUnit = "item" | "second" | "credit";

/** Conversion of existing rights; independent from engine prices. */
export const AI_MEDIA_LEGACY_CREDIT_FACTORS = Object.freeze({ image: 7, video: 10 });
export const AI_MEDIA_CREDIT_WALLET_VERSION = "media-credits-v1";

export function legacyAiMediaAmountToCredits(kind: AiMediaKind, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError("Montant média invalide.");
  const credits = amount * AI_MEDIA_LEGACY_CREDIT_FACTORS[kind];
  if (!Number.isSafeInteger(credits)) throw new TypeError("Montant média trop élevé.");
  return credits;
}

export const AI_MEDIA_QUOTA_UNITS: Readonly<Record<AiMediaKind, AiMediaQuotaUnit>> =
  Object.freeze({
    image: "item",
    video: "second",
  });

/**
 * Le report reste exprime dans l'unite du media : nombre d'images pour image,
 * secondes de sortie pour video. Les plafonds video sont volontairement
 * propres au forfait afin de ne pas transformer la cagnotte Standard en quota
 * Premium tout en preservant plusieurs mois de credits inutilises.
 */
export const AI_MEDIA_ROLLOVER_CAPS: Readonly<
  Record<AiMediaEdition, Readonly<Record<AiMediaKind, number>>>
> = Object.freeze({
  standard: Object.freeze({ image: 70, video: 168 }),
  premium: Object.freeze({ image: 150, video: 480 }),
  founder: Object.freeze({ image: 70, video: 480 }),
});

export type AiMediaPlanLimits = Readonly<{
  image: number;
  video: number;
  studioEnabled: boolean;
  videoMaxDurationSeconds: AiMediaVideoDurationLimit;
}>;

export const AI_MEDIA_MONTHLY_LIMITS: Readonly<Record<AiMediaEdition, AiMediaPlanLimits>> =
  Object.freeze({
    standard: Object.freeze({
      image: 25,
      video: 56,
      studioEnabled: true,
      videoMaxDurationSeconds: 30,
    }),
    premium: Object.freeze({
      image: 70,
      video: 204,
      studioEnabled: true,
      videoMaxDurationSeconds: 30,
    }),
    founder: Object.freeze({
      image: 50,
      video: 144,
      studioEnabled: true,
      videoMaxDurationSeconds: 30,
    }),
  });


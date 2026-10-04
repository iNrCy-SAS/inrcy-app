export const AI_MEDIA_EDITIONS = ["standard", "premium", "founder"] as const;
export const AI_MEDIA_KINDS = ["image", "video"] as const;
export const AI_MEDIA_SURFACES = ["booster", "studio"] as const;
export const AI_MEDIA_VIDEO_DURATION_OPTIONS = [8, 16, 24] as const;

/**
 * Solde maximal pouvant etre conserve d'un mois sur l'autre. Le quota mensuel
 * du forfait continue d'etre la recharge; ces valeurs bornent uniquement la
 * cagnotte cumulable.
 */
export type AiMediaEdition = (typeof AI_MEDIA_EDITIONS)[number];
export type AiMediaKind = (typeof AI_MEDIA_KINDS)[number];
export type AiMediaSurface = (typeof AI_MEDIA_SURFACES)[number];
export type AiMediaVideoDurationLimit = (typeof AI_MEDIA_VIDEO_DURATION_OPTIONS)[number];
export type AiMediaQuotaUnit = "item" | "second";

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
      video: 48,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    }),
    premium: Object.freeze({
      image: 70,
      video: 196,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    }),
    founder: Object.freeze({
      image: 50,
      video: 144,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    }),
  });


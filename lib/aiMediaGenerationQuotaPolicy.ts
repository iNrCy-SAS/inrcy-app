import { createHash } from "node:crypto";

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
  premium: Object.freeze({ image: 70, video: 480 }),
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
      image: 20,
      video: 48,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    }),
    premium: Object.freeze({
      image: 30,
      video: 144,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    }),
    founder: Object.freeze({
      image: 30,
      video: 144,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    }),
  });

export function normalizeAiMediaEdition(value: unknown): AiMediaEdition {
  const normalized = String(value ?? "").trim().toLowerCase();
  if ((AI_MEDIA_EDITIONS as readonly string[]).includes(normalized)) {
    return normalized as AiMediaEdition;
  }
  throw new TypeError(`Edition media IA invalide: ${normalized || "(vide)"}`);
}

export function getAiMediaMonthlyLimit(edition: AiMediaEdition, kind: AiMediaKind): number {
  return AI_MEDIA_MONTHLY_LIMITS[edition][kind];
}

export function getAiMediaRolloverCap(
  edition: AiMediaEdition,
  kind: AiMediaKind,
): number {
  return AI_MEDIA_ROLLOVER_CAPS[edition][kind];
}

export function getAiMediaQuotaUnit(kind: AiMediaKind): AiMediaQuotaUnit {
  return AI_MEDIA_QUOTA_UNITS[kind];
}

export function hasAiMediaStudioAccess(edition: AiMediaEdition): boolean {
  return AI_MEDIA_MONTHLY_LIMITS[edition].studioEnabled;
}

export function getAiMediaVideoMaxDuration(
  edition: AiMediaEdition,
): AiMediaVideoDurationLimit {
  return AI_MEDIA_MONTHLY_LIMITS[edition].videoMaxDurationSeconds;
}

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) return value.toJSON();

  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Impossible de signer une requete media IA circulaire.");
    ancestors.add(value);
    const result = value.map((item) => canonicalize(item, ancestors) ?? null);
    ancestors.delete(value);
    return result;
  }

  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("Impossible de signer une requete media IA circulaire.");
    ancestors.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = canonicalize((value as Record<string, unknown>)[key], ancestors);
      if (typeof normalized !== "undefined") result[key] = normalized;
    }
    ancestors.delete(value);
    return result;
  }

  return String(value);
}

export function stableAiMediaRequestPayload(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()) ?? null);
}

export function createAiMediaRequestFingerprint(value: unknown): string {
  return createHash("sha256").update(stableAiMediaRequestPayload(value), "utf8").digest("hex");
}

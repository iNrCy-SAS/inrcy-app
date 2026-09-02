import { createHash } from "node:crypto";

export const AI_MEDIA_EDITIONS = ["standard", "premium", "founder"] as const;
export const AI_MEDIA_KINDS = ["image", "video"] as const;
export const AI_MEDIA_SURFACES = ["booster", "studio"] as const;

export type AiMediaEdition = (typeof AI_MEDIA_EDITIONS)[number];
export type AiMediaKind = (typeof AI_MEDIA_KINDS)[number];
export type AiMediaSurface = (typeof AI_MEDIA_SURFACES)[number];
export type AiMediaVideoDurationLimit = 8 | 16 | 24;

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
      video: 5,
      studioEnabled: true,
      videoMaxDurationSeconds: 8,
    }),
    premium: Object.freeze({
      image: 30,
      video: 6,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    }),
    founder: Object.freeze({
      image: 30,
      video: 6,
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

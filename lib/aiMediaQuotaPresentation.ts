import type {
  AiMediaQuotaCounter,
  AiMediaQuotaSnapshot,
} from "@/lib/aiMediaGenerationQuota";

/**
 * L'admin global est illimité commercialement. Cette valeur n'est qu'un
 * fusible technique anti-boucle, bien au-delà de tout usage humain normal.
 */
export const AI_MEDIA_ADMIN_LIMIT_OVERRIDE = 10_000;

export type PublicAiMediaQuotaCounter = Omit<
  AiMediaQuotaCounter,
  "limit" | "remaining"
> & {
  limit: number | null;
  remaining: number | null;
};

export type PublicAiMediaQuotaSnapshot = Omit<
  AiMediaQuotaSnapshot,
  "image" | "video"
> & {
  unlimited: boolean;
  videoLongFormPremiumRequired: boolean;
  image: PublicAiMediaQuotaCounter;
  video: PublicAiMediaQuotaCounter;
};

export function presentAiMediaQuotaCounter<T extends AiMediaQuotaCounter>(
  counter: T,
  unlimited: boolean,
): T | (Omit<T, "limit" | "remaining"> & {
  limit: null;
  remaining: null;
}) {
  if (!unlimited) return counter;
  return { ...counter, limit: null, remaining: null };
}

export function presentAiMediaQuota(
  quota: AiMediaQuotaSnapshot,
  unlimited: boolean,
): PublicAiMediaQuotaSnapshot {
  return {
    ...quota,
    unlimited,
    videoLongFormPremiumRequired: !unlimited && quota.edition === "standard",
    image: presentAiMediaQuotaCounter(quota.image, unlimited),
    video: presentAiMediaQuotaCounter(quota.video, unlimited),
  };
}

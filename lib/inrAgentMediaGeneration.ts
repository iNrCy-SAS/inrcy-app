import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  acceptGeneratedAiMediaDraft,
  getPersistedGeneratedAiMediaId,
} from "@/lib/aiGeneratedMediaRegistry";
import {
  type AiMediaKind,
  type AiMediaLibraryPickerItem,
} from "@/lib/aiMediaGenerationContracts";
import {
  completeAiMediaGeneration,
  failAiMediaGeneration,
  reserveAiMediaGeneration,
} from "@/lib/aiMediaGenerationQuota";
import { createAiMediaRequestFingerprint } from "@/lib/aiMediaGenerationQuotaPolicy";
import { generateAndSaveAiMedia } from "@/lib/aiMediaGenerationServer";
import { AI_MEDIA_ADMIN_LIMIT_OVERRIDE } from "@/lib/aiMediaQuotaPresentation";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getAiMediaVideoEntitlement } from "@/lib/aiMediaVideoEntitlementServer";
import type { InrAgentTheme } from "@/lib/inrAgentSettings";
import type { AiMediaGeneratorPreferences } from "@/lib/aiMediaGenerationPreferences";
import { resolveInrAgentMediaMix } from "@/lib/inrAgentMediaMix";
import { buildInrAgentMediaGenerationRequest } from "@/lib/inrAgentMediaRequest";

type SupabaseLike = Parameters<typeof generateAndSaveAiMedia>[0]["supabase"];

const MAX_GENERATION_ATTEMPTS = 3;

export type InrAgentGeneratedMediaOutcome =
  | "generated"
  | "quota_reached"
  | "studio_unavailable"
  | "generation_failed"
  | "finalization_failed";

export type InrAgentGeneratedMediaResult = {
  item: AiMediaLibraryPickerItem | null;
  outcome: InrAgentGeneratedMediaOutcome;
  kind: AiMediaKind;
  errorCode?: string;
};

function errorCode(error: unknown) {
  const value = error instanceof Error ? error.message : String(error || "");
  return value.trim().slice(0, 120) || "inr_agent_ai_media_generation_failed";
}

/**
 * Utilise exactement la meme reservation mensuelle que le Studio media.
 * Une generation iNrAgent n'est jamais gratuite ni comptee dans un silo cache.
 */
export async function generateInrAgentMedia(args: {
  supabase: SupabaseLike;
  accountId: string;
  actorAuthUserId: string;
  idea: string;
  theme: InrAgentTheme;
  kind: AiMediaKind;
  adminUnlimited: boolean;
  /** Part Studio/variation demandée dans Publier (0–100). */
  studioMediaPreferencePercent?: number;
  /** Réglages Studio déjà chargés une fois pour toute l’action. */
  studioPreferences?: AiMediaGeneratorPreferences | null;
  /** Seed stable (action + index) pour éviter un changement au retry. */
  variantSeed?: string;
  /** Force un clip court sans modifier les anciens appels Studio 16/24 s. */
  videoDurationSeconds?: 8;
  /** Identifie un emplacement et une partie de carrousel, stable au retry. */
  generationRequestId?: string;
}): Promise<InrAgentGeneratedMediaResult> {
  const edition = await getDashboardEditionForAccountId(args.accountId);
  const videoEntitlement =
    args.kind === "video"
      ? await getAiMediaVideoEntitlement({
          accountId: args.accountId,
          edition,
        })
      : null;
  const videoMaxDurationSeconds = args.adminUnlimited
    ? 24
    : videoEntitlement?.maxDurationSeconds ?? 8;
  const mediaMix = resolveInrAgentMediaMix({
    kind: args.kind,
    theme: args.theme,
    studioMediaPreferencePercent: args.studioMediaPreferencePercent ?? 0,
    studioPreferences: args.studioPreferences,
    maxVideoDurationSeconds: videoMaxDurationSeconds,
    seed:
      args.variantSeed ||
      `${args.accountId}:${args.theme}:${args.kind}:${args.idea}`,
  });
  const generationRequestId = args.generationRequestId?.trim();
  const request = buildInrAgentMediaGenerationRequest({
    requestId: generationRequestId
      ? `inr-agent:${createHash("sha256").update(generationRequestId).digest("hex")}`
      : `inr-agent:${randomUUID()}`,
    idea: args.idea,
    theme: args.theme,
    kind: args.kind,
    mediaMix,
    videoDurationSeconds: args.videoDurationSeconds,
  });
  const fingerprint = createAiMediaRequestFingerprint({
    contract: "inrcy-agent-ai-media-v1",
    request,
  });

  const reservationArgs = {
    accountId: args.accountId,
    actorAuthUserId: args.actorAuthUserId,
    requestKey: request.requestId,
    requestFingerprint: fingerprint,
    mediaKind: args.kind,
    surface: "booster" as const,
    edition,
    reservationTtlSeconds: args.kind === "video" ? 3_600 : 900,
    quotaAmount:
      args.kind === "video" ? request.durationSeconds || 8 : 1,
    limitOverride: args.adminUnlimited
      ? AI_MEDIA_ADMIN_LIMIT_OVERRIDE
      : undefined,
    metadata: {
      source: "inr_agent",
      automation_key: "publish",
      theme: args.theme,
      duration_seconds: request.durationSeconds,
      studio_media_preference_percent: mediaMix.studioMediaPreferencePercent,
      studio_media_preference_mode: mediaMix.mode,
      studio_media_preference_blocks: mediaMix.appliedStudioBlockIds,
    },
  };
  let reservation: Awaited<ReturnType<typeof reserveAiMediaGeneration>> | null = null;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    reservation = await reserveAiMediaGeneration(reservationArgs);
    if (reservation.outcome === "quota_reached") {
      return { item: null, outcome: "quota_reached", kind: args.kind };
    }
    if (reservation.outcome === "premium_required") {
      return { item: null, outcome: "studio_unavailable", kind: args.kind };
    }
    if (!reservation.jobId) break;
    if (reservation.outcome === "reserved") break;

    // Une reprise ne doit jamais rappeler le fournisseur pour un job en cours
    // ni pour un média déjà enregistré, même si sa finalisation a échoué.
    try {
      const mediaId = await getPersistedGeneratedAiMediaId({
        accountId: args.accountId,
        jobId: reservation.jobId,
      });
      if (mediaId) {
        if (reservation.status !== "completed") {
          await completeAiMediaGeneration({
            accountId: args.accountId,
            jobId: reservation.jobId,
            mediaId,
            metadata: { source: "inr_agent", recovered_from_idempotent_replay: true },
          });
        }
        const accepted = await acceptGeneratedAiMediaDraft({
          accountId: args.accountId,
          authUserId: args.actorAuthUserId,
          mediaId,
        });
        return {
          item: accepted,
          outcome: accepted ? "generated" : "finalization_failed",
          kind: args.kind,
          ...(accepted ? {} : { errorCode: "inr_agent_ai_media_accept_failed" }),
        };
      }
    } catch (error) {
      return { item: null, outcome: "finalization_failed", kind: args.kind, errorCode: errorCode(error) };
    }

    if (reservation.status === "failed" && generationRequestId && attempt + 1 < MAX_GENERATION_ATTEMPTS) {
      // Le ledger ne rouvre pas les jobs terminaux. Deux retries concurrents
      // dérivent la même clé du job échoué : un seul peut réserver la suite.
      reservationArgs.requestKey = `${request.requestId}:retry:${reservation.jobId}`;
      continue;
    }
    return {
      item: null,
      outcome: reservation.status === "completed" ? "finalization_failed" : "generation_failed",
      kind: args.kind,
      errorCode: reservation.status === "completed"
        ? "inr_agent_ai_media_completed_media_unavailable"
        : reservation.status === "failed"
        ? "inr_agent_ai_media_retry_exhausted"
        : reservation.status === "expired"
        ? "inr_agent_ai_media_expired_requires_review"
        : "inr_agent_ai_media_generation_in_progress",
    };
  }
  if (reservation?.outcome !== "reserved" || !reservation.jobId) {
    return { item: null, outcome: "generation_failed", kind: args.kind, errorCode: "inr_agent_ai_media_reservation_unavailable" };
  }

  let mediaPersisted = false;
  let quotaCompleted = false;
  try {
    const generated = await generateAndSaveAiMedia({
      supabase: args.supabase,
      accountId: args.accountId,
      authUserId: args.actorAuthUserId,
      jobId: reservation.jobId,
      edition,
      request,
      videoMaxDurationSeconds,
    });
    mediaPersisted = true;
    await completeAiMediaGeneration({
      accountId: args.accountId,
      jobId: reservation.jobId,
      mediaId: generated.item.id,
      metadata: {
        source: "inr_agent",
        model: generated.model,
        prompt_version: generated.promptVersion,
        prompt_sha256: generated.promptSha256,
        casting_variant_key: generated.castingVariantKey,
        studio_media_preference_percent: mediaMix.studioMediaPreferencePercent,
        studio_media_preference_mode: mediaMix.mode,
        studio_media_preference_blocks: mediaMix.appliedStudioBlockIds,
      },
    });
    quotaCompleted = true;

    const accepted = await acceptGeneratedAiMediaDraft({
      accountId: args.accountId,
      authUserId: args.actorAuthUserId,
      mediaId: generated.item.id,
    });
    if (!accepted) {
      return {
        item: null,
        outcome: "finalization_failed",
        kind: args.kind,
        errorCode: "inr_agent_ai_media_accept_failed",
      };
    }
    return { item: accepted, outcome: "generated", kind: args.kind };
  } catch (error) {
    if (!mediaPersisted && !quotaCompleted) {
      try {
        mediaPersisted = Boolean(await getPersistedGeneratedAiMediaId({
          accountId: args.accountId,
          jobId: reservation.jobId,
        }));
      } catch {
        // Une lecture indisponible ne prouve pas l'absence du média. Conserver
        // la réservation permet une reprise sans nouvelle génération payante.
        return { item: null, outcome: "finalization_failed", kind: args.kind, errorCode: "inr_agent_ai_media_persistence_check_unavailable" };
      }
      if (!mediaPersisted) {
        await failAiMediaGeneration({
          accountId: args.accountId,
          jobId: reservation.jobId,
          errorCode: errorCode(error),
          errorMessage: error instanceof Error ? error.message : String(error),
          metadata: { source: "inr_agent" },
        }).catch(() => undefined);
      }
    }
    return {
      item: null,
      outcome: mediaPersisted ? "finalization_failed" : "generation_failed",
      kind: args.kind,
      errorCode: errorCode(error),
    };
  }
}

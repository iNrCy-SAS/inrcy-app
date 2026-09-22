import "server-only";

import { randomUUID } from "node:crypto";

import { acceptGeneratedAiMediaDraft } from "@/lib/aiGeneratedMediaRegistry";
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
  const request = buildInrAgentMediaGenerationRequest({
    requestId: `inr-agent:${randomUUID()}`,
    idea: args.idea,
    theme: args.theme,
    kind: args.kind,
    mediaMix,
  });
  const fingerprint = createAiMediaRequestFingerprint({
    contract: "inrcy-agent-ai-media-v1",
    request,
  });

  const reservation = await reserveAiMediaGeneration({
    accountId: args.accountId,
    actorAuthUserId: args.actorAuthUserId,
    requestKey: request.requestId,
    requestFingerprint: fingerprint,
    mediaKind: args.kind,
    surface: "booster",
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
  });

  if (reservation.outcome === "quota_reached") {
    return { item: null, outcome: "quota_reached", kind: args.kind };
  }
  if (reservation.outcome === "premium_required") {
    return { item: null, outcome: "studio_unavailable", kind: args.kind };
  }
  if (reservation.outcome !== "reserved" || !reservation.jobId) {
    return {
      item: null,
      outcome: "generation_failed",
      kind: args.kind,
      errorCode: "inr_agent_ai_media_reservation_unavailable",
    };
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
      await failAiMediaGeneration({
        accountId: args.accountId,
        jobId: reservation.jobId,
        errorCode: errorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: { source: "inr_agent" },
      }).catch(() => undefined);
    }
    return {
      item: null,
      outcome: mediaPersisted ? "finalization_failed" : "generation_failed",
      kind: args.kind,
      errorCode: errorCode(error),
    };
  }
}

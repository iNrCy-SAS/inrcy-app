import "server-only";

import { randomUUID } from "node:crypto";

import { acceptGeneratedAiMediaDraft } from "@/lib/aiGeneratedMediaRegistry";
import {
  type AiMediaGenerationRequest,
  type AiMediaKind,
  type AiMediaLibraryPickerItem,
  type AiMediaTypology,
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
import type { InrAgentTheme } from "@/lib/inrAgentSettings";
import type { AiMediaGeneratorPreferences } from "@/lib/aiMediaGenerationPreferences";
import { resolveInrAgentMediaMix } from "@/lib/inrAgentMediaMix";

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

function typologyForTheme(theme: InrAgentTheme): AiMediaTypology {
  if (["realisations", "temoignages"].includes(theme)) return "showcase";
  if (theme === "offres") return "offer";
  if (theme === "services") return "service";
  if (theme === "coulisses") return "behind_scenes";
  if (theme === "recrutement") return "recruitment";
  if (theme === "actualites") return "event";
  return "advice";
}

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
  const mediaMix = resolveInrAgentMediaMix({
    kind: args.kind,
    theme: args.theme,
    studioMediaPreferencePercent: args.studioMediaPreferencePercent ?? 0,
    studioPreferences: args.studioPreferences,
    seed:
      args.variantSeed ||
      `${args.accountId}:${args.theme}:${args.kind}:${args.idea}`,
  });
  const request: AiMediaGenerationRequest = {
    requestId: `inr-agent:${randomUUID()}`,
    kind: args.kind,
    subjectSource: "custom",
    idea: args.idea,
    aiInstruction: "",
    // Le texte social sera ecrit par Booster. Le laisser dans l'image ou dans
    // les plans Veo augmenterait le risque de faux caracteres.
    withText: false,
    textKeywords: [],
    withMusic: mediaMix.withMusic,
    withNarration: mediaMix.withNarration,
    narrationVoice: mediaMix.narrationVoice,
    format: mediaMix.format,
    typology: typologyForTheme(args.theme),
    visualStyle: mediaMix.visualStyle,
    imageStyle: mediaMix.imageStyle,
    shotType: mediaMix.shotType,
    peopleMode: mediaMix.peopleMode,
    creativity: mediaMix.creativity,
    useBrandColors: mediaMix.useBrandColors,
    logoMode: mediaMix.logoMode,
    videoEngine: args.kind === "video" ? "omni" : null,
    identityMode: "auto",
    videoCharacterMode: "auto",
    identityConsent: false,
    teamVideoMode: mediaMix.teamVideoMode,
    teamVideoSpeechMode: mediaMix.teamVideoSpeechMode,
    teamVideoVeoConsent: false,
    identityReferenceSetId: "",
    connectScenes: mediaMix.connectScenes,
    durationSeconds: mediaMix.durationSeconds,
    inspirationImages: [],
    source: "booster",
  };
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
    limitOverride: args.adminUnlimited
      ? AI_MEDIA_ADMIN_LIMIT_OVERRIDE
      : undefined,
    metadata: {
      source: "inr_agent",
      automation_key: "publish",
      theme: args.theme,
      duration_seconds: request.durationSeconds,
      studio_media_preference_percent:
        mediaMix.studioMediaPreferencePercent,
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
        studio_media_preference_percent:
          mediaMix.studioMediaPreferencePercent,
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

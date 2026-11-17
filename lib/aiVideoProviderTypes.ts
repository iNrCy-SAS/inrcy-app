import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import type { AiMediaVideoProviderContract } from "@/lib/aiMediaVideoProviderContract";
import { getAiMediaVideoModel } from "./aiMediaModelCatalog.ts";
import { hasProvidedAiMediaCharacterVoice, isAiMediaCharacterVoiceEngine } from "./aiMediaCharacterVoices.ts";
import { isAiMediaProviderBillingFailure } from "./aiMediaGenerationPublicErrors.ts";
import { safeAiVideoProviderFailureDiagnostics, type AiVideoProviderFailureDiagnostics } from "./aiMediaSensitiveText.ts";

export type AiVideoProviderClip = {
  buffer: Buffer;
  mediaType: string;
  durationSeconds: number;
  /**
   * Logical start inside a cumulative continuation output. This lets the
   * compositor reuse a cumulative MP4 while keeping one overlay per clip.
   * A new generation contains at most two clips.
   */
  sourceStartSeconds?: number;
  requestId: string;
  model: string;
  warnings: string[];
};

export type AiVideoProviderResult = {
  provider: string;
  model: string;
  clips: AiVideoProviderClip[];
  estimatedCostMicroUsd: number;
  warnings: string[];
};

export const AI_VIDEO_BILLABLE_FAILURE_CODE =
  "ai_video_provider_billable_failure" as const;

/**
 * A provider has already returned at least one chargeable video asset, but the
 * complete film could not be delivered. Callers may still use a local,
 * non-billable recovery, but must never start another video provider: doing so
 * would silently charge the professional twice for the same generation.
 */
export class AiVideoProviderBillableFailure extends Error {
  readonly code = AI_VIDEO_BILLABLE_FAILURE_CODE;
  readonly billable = true;
  readonly provider: string;
  readonly model: string;
  readonly stage: string;
  readonly diagnostics?: AiVideoProviderFailureDiagnostics;

  constructor(args: {
    provider: string;
    model: string;
    stage: string;
    details?: string;
    cause?: unknown;
    diagnostics?: AiVideoProviderFailureDiagnostics;
  }) {
    const details = String(args.details || "output_processing_failed")
      .replace(/\u0000/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 700);
    super(
      `${AI_VIDEO_BILLABLE_FAILURE_CODE}:${args.provider}:${args.stage}:${
        details || "output_processing_failed"
      }`,
      { cause: args.cause },
    );
    this.name = "AiVideoProviderBillableFailure";
    this.provider = args.provider;
    this.model = args.model;
    this.stage = args.stage;
    this.diagnostics = safeAiVideoProviderFailureDiagnostics(args.diagnostics);
  }
}

export function isAiVideoProviderBillableFailure(
  error: unknown,
): error is AiVideoProviderBillableFailure {
  if (error instanceof AiVideoProviderBillableFailure) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    billable?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return (
    candidate.billable === true &&
    (candidate.code === AI_VIDEO_BILLABLE_FAILURE_CODE ||
      String(candidate.message || "").startsWith(
        `${AI_VIDEO_BILLABLE_FAILURE_CODE}:`,
      ))
  );
}

/** Only a definite upstream rejection permits a second video submission.
 * Return a safe status, never retain the SDK's request body or private URLs.
 */
export function getAiVideoProviderRecoverableStatus(error: unknown): number {
  if (isAiMediaProviderBillingFailure(error)) return 0;
  let candidate = error;
  let status = 0;
  for (let depth = 0; candidate && typeof candidate === "object" && depth < 6; depth++) {
    if (isAiVideoProviderBillableFailure(candidate)) return 0;
    const failure = candidate as { name?: unknown; message?: unknown; code?: unknown; statusCode?: unknown; status?: unknown; cause?: unknown };
    const text = [failure.name, failure.message, failure.code].join(" ");
    if (/abort|cancel|timeout|timed.?out|fetch failed|socket|econn|network|content.?filter|policy|safety|moderation|credential|account.?limit|guard.?unavailable/i.test(text)) return 0;
    status ||= Number(failure.statusCode || failure.status || 0);
    candidate = failure.cause;
  }
  return [429, 500, 502, 503].includes(status) ? status : 0;
}

export type AiVideoProviderGenerationArgs = {
  accountId: string;
  /** Server job identity, used for upstream idempotency; never supplied by the browser. */
  jobId?: string;
  request: AiMediaGenerationRequest;
  plan: AiMediaCreativePlan;
  /** Trusted server marker: raw Studio video request, no visual planner or substitute frame. */
  directVideo?: boolean;
  /**
   * Prompt Studio complet compilé par le serveur. Il reste disponible pour
   * l'audit et son empreinte empêche tout remplacement silencieux au moment du
   * routage ou d'un fallback de moteur.
   */
  canonicalPrompt: string;
  canonicalPromptSha256: string;
  /** Contrat sémantique borné, identique pour Veo et Omni. */
  providerContract: AiMediaVideoProviderContract;
  creativeBrief: string;
  brandColors: readonly string[];
  profession: string;
  /** Langue configurée pour les éventuels dialogues natifs du plan. */
  contentLanguage?: string;
  /** Script de voix off native du mode Libre, découpé sur deux clips maximum. */
  nativeNarrationLines?: readonly string[];
  /** Exact captions for a separately selected voice-over, only when subtitles are enabled. */
  subtitleLines?: readonly string[];
  /** Short, server-resolved ADN direction for the visual provider, never a raw profile. */
  businessDnaDirection?: string;
  /**
   * Marqueur interne exclusivement positionné par le serveur après avoir
   * transformé 2–3 portraits distincts en une seule composition de groupe.
   * Ce marqueur concerne le parcours historique. Le parcours Free direct
   * transmet les originaux avec son propre contrôle de destination et capacité.
   */
  identityTeamPrecomposed?: boolean;
  /** Nombre d'adultes réunis dans l'image de groupe, sans autre attribut. */
  identityTeamMemberCount?: 2 | 3;
  /**
   * Consentement Google ponctuel, transmis séparément du consentement général
   * d’identité. Les providers le vérifient avant de créer leur client réseau.
   */
  identityTeamGoogleEgressConsent?: boolean;
  /** Engine named by the one-shot consent, checked before provider access. */
  identityTeamProviderEgressConsent?: AiMediaGenerationRequest["videoEngine"];
  /**
   * Best-effort cancellation propagated from the browser request. Veo does not
   * expose an operation-cancel method in the Gemini Developer API SDK, but the
   * signal still stops submission, polling and download as early as possible.
   */
  signal?: AbortSignal;
  /** Trusted absolute finish deadline, leaving local composition time to the caller. */
  deadlineAt?: number;
};

type ReferenceTeamEgressArgs = Pick<AiVideoProviderGenerationArgs,
  "request" | "directVideo" | "identityTeamPrecomposed" |
  "identityTeamGoogleEgressConsent" | "identityTeamProviderEgressConsent">;

type ReferenceTeamProvider = "google" | "minimax" | "alibaba" | "spacexai" | "heygen" | "kling";

/** Only the server's new Free pipeline can send the original portrait set.
 * Browser fields are normalized into request and cannot set directVideo. */
function assertDirectReferenceTeamEgress(args: ReferenceTeamEgressArgs, provider: ReferenceTeamProvider): boolean {
  const request = args.request;
  if (args.directVideo !== true || request.creationMode !== "free" || request.kind !== "video" || request.operation !== "generate") return false;
  if (args.identityTeamPrecomposed !== undefined && args.identityTeamPrecomposed !== false) throw new Error("ai_video_direct_reference_provenance_invalid");
  if (request.identityConsent !== true || request.teamVideoMode !== "cinematic") throw new Error("ai_video_reference_team_identity_consent_required");

  const model = getAiMediaVideoModel(request.videoEngine);
  const resolution = request.videoResolution || model.defaultResolution;
  if (model.id !== request.videoEngine || model.provider !== provider ||
    !model.supportsImageToVideo || !model.resolutions.includes(resolution) ||
    request.inspirationImages.length > model.maxReferenceImages ||
    (model.id === "grok" && resolution === "1080p" && request.inspirationImages.length > 1)) {
    throw new Error("ai_media_video_references_unsupported");
  }
  const characters = request.inspirationImages.filter(image => image.role === "character" && image.usage === "required");
  const indices = characters.map(image => image.characterIndex);
  if (characters.length < 2 || characters.length > 3 ||
    indices.some(index => index !== 1 && index !== 2 && index !== 3) ||
    new Set(indices).size !== indices.length ||
    characters.some(image => !image.data || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType))) {
    throw new Error("ai_video_direct_reference_team_invalid");
  }
  const engineConsent = args.identityTeamProviderEgressConsent === request.videoEngine && request.teamVideoProviderConsent === request.videoEngine;
  const googleConsent = provider === "google" && args.identityTeamGoogleEgressConsent === true && request.teamVideoVeoConsent === true;
  if (!engineConsent && !googleConsent) {
    throw new Error(provider === "google" ? "ai_video_reference_team_google_consent_required" : "ai_video_reference_team_provider_consent_required");
  }
  return true;
}

/** New Free videos retain native original references; legacy groups retain
 * their existing precomposition and one-attempt destination consent. */
export function assertAiVideoReferenceTeamGoogleEgress(
  args: ReferenceTeamEgressArgs,
) {
  if (args.request.identityMode !== "reference_team") return;
  if (assertDirectReferenceTeamEgress(args, "google")) return;
  if (!args.identityTeamPrecomposed) {
    throw new Error("ai_video_reference_team_precomposition_required");
  }
  if (!args.identityTeamGoogleEgressConsent && args.identityTeamProviderEgressConsent !== args.request.videoEngine) {
    throw new Error("ai_video_reference_team_google_consent_required");
  }
  if (args.request.inspirationImages.length !== 1) {
    throw new Error("ai_video_reference_team_single_group_image_required");
  }
}

export function assertAiVideoReferenceTeamProviderEgress(
  args: ReferenceTeamEgressArgs,
  provider: ReferenceTeamProvider,
) {
  if (args.request.identityMode !== "reference_team") return;
  if (provider === "google") return assertAiVideoReferenceTeamGoogleEgress(args);
  if (assertDirectReferenceTeamEgress(args, provider)) return;
  // Wan R2V binds each original subject image to its own optional voice.
  // A composed team frame would destroy that association. Keep the existing
  // one-attempt provider consent, without pretending these were precomposed.
  const referenceProvider = args.request.videoEngine === "heygen" ? "heygen" : "alibaba";
  if ((provider === "heygen" && args.request.videoEngine === "heygen-avatar") ||
      (provider === "kling" && (args.request.videoEngine === "kling" || args.request.videoEngine === "kling-flash")) ||
      (provider === "alibaba" && args.request.videoEngine === "wan27") ||
      (hasProvidedAiMediaCharacterVoice(args.request.inspirationImages) && isAiMediaCharacterVoiceEngine(args.request.videoEngine) && provider === referenceProvider)) {
    if (args.identityTeamProviderEgressConsent !== args.request.videoEngine) {
      throw new Error("ai_video_reference_team_provider_consent_required");
    }
    if (!args.request.inspirationImages.length || args.request.inspirationImages.length > 5) {
      throw new Error("ai_media_video_references_unsupported");
    }
    return;
  }
  if (!args.identityTeamPrecomposed) throw new Error("ai_video_reference_team_precomposition_required");
  if (args.identityTeamProviderEgressConsent !== args.request.videoEngine) {
    throw new Error("ai_video_reference_team_provider_consent_required");
  }
  if (args.request.inspirationImages.length !== 1) throw new Error("ai_video_reference_team_single_group_image_required");
}

export interface AiVideoProvider {
  readonly id: string;
  readonly model: string;
  generate(args: AiVideoProviderGenerationArgs): Promise<AiVideoProviderResult>;
}

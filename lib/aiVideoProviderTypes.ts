import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";

export type AiVideoProviderClip = {
  buffer: Buffer;
  mediaType: string;
  durationSeconds: 4 | 6 | 8;
  /**
   * Logical start inside a cumulative continuation output. This lets the
   * compositor reuse one seamless 16/24 s MP4 while keeping one overlay per
   * eight-second narrative act.
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

  constructor(args: {
    provider: string;
    model: string;
    stage: string;
    details?: string;
    cause?: unknown;
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

export type AiVideoProviderGenerationArgs = {
  accountId: string;
  request: AiMediaGenerationRequest;
  plan: AiMediaCreativePlan;
  creativeBrief: string;
  brandColors: readonly string[];
  profession: string;
  /** Langue configurée pour les éventuels dialogues natifs du plan. */
  contentLanguage?: string;
  /**
   * Marqueur interne exclusivement positionné par le serveur après avoir
   * transformé 2–3 portraits distincts en une seule composition de groupe.
   * Sans ce marqueur, les providers refusent `reference_team` afin qu'aucun
   * appel direct ne puisse leur transmettre les portraits séparément.
   */
  identityTeamPrecomposed?: boolean;
  /** Nombre d'adultes réunis dans l'image de groupe, sans autre attribut. */
  identityTeamMemberCount?: 2 | 3;
  /**
   * Consentement Google ponctuel, transmis séparément du consentement général
   * d’identité. Les providers le vérifient avant de créer leur client réseau.
   */
  identityTeamGoogleEgressConsent?: boolean;
  /**
   * Best-effort cancellation propagated from the browser request. Veo does not
   * expose an operation-cancel method in the Gemini Developer API SDK, but the
   * signal still stops submission, polling and download as early as possible.
   */
  signal?: AbortSignal;
};

/**
 * Garde réseau commune aux providers Google. Elle doit être appelée avant la
 * création de leur client afin qu'une équipe ne puisse quitter iNrCy qu'après
 * précomposition et consentement explicite pour cette tentative.
 */
export function assertAiVideoReferenceTeamGoogleEgress(
  args: Pick<
    AiVideoProviderGenerationArgs,
    | "request"
    | "identityTeamPrecomposed"
    | "identityTeamGoogleEgressConsent"
  >,
) {
  if (args.request.identityMode !== "reference_team") return;
  if (!args.identityTeamPrecomposed) {
    throw new Error("ai_video_reference_team_precomposition_required");
  }
  if (!args.identityTeamGoogleEgressConsent) {
    throw new Error("ai_video_reference_team_google_consent_required");
  }
  if (args.request.inspirationImages.length !== 1) {
    throw new Error("ai_video_reference_team_single_group_image_required");
  }
}

export interface AiVideoProvider {
  readonly id: string;
  readonly model: string;
  generate(args: AiVideoProviderGenerationArgs): Promise<AiVideoProviderResult>;
}

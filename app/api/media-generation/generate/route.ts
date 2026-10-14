import { after, NextResponse } from "next/server";

import {
  AiGatewayAccountLimitError,
  AiGatewayGuardUnavailableError,
} from "@/lib/aiGatewayAccountGuard";
import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
  type AiMediaLibraryPickerItem,
  type AiMediaGenerationRequest,
  type AiMediaSoundtrackResponse,
} from "@/lib/aiMediaGenerationContracts";
import { classifyAiMediaGenerationError, getAiMediaGenerationPublicError } from "@/lib/aiMediaGenerationPublicErrors";
import { AI_MEDIA_PROMPT_VERSION } from "@/lib/aiMediaGenerationPrompt";
import { AI_MEDIA_FREE_PROMPT_VERSION } from "@/lib/aiMediaFreeGenerationPrompt";
import {
  AiMediaGenerationQuotaError,
  completeAiMediaGeneration,
  createAiMediaRequestFingerprint,
  failAiMediaGeneration,
  getAiMediaQuotaSnapshot,
  reserveAiMediaGeneration,
} from "@/lib/aiMediaGenerationQuota";
import {
  AI_MEDIA_ADMIN_LIMIT_OVERRIDE,
  presentAiMediaQuota,
  presentAiMediaQuotaCounter,
} from "@/lib/aiMediaQuotaPresentation";
import { isAdminUserForAi } from "@/lib/aiUsageQuota";
import { generateAndSaveAiMedia } from "@/lib/aiMediaGenerationServer";
import { safeAiMediaErrorDetails, safeAiMediaErrorMessage } from "@/lib/aiMediaSensitiveText";
import {
  getExistingGeneratedAiMedia,
  getPersistedGeneratedAiMediaId,
} from "@/lib/aiGeneratedMediaRegistry";
import {
  getDashboardEditionForAccountId,
} from "@/lib/dashboardEditionServer";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import type { AiMediaVideoDurationLimit } from "@/lib/aiMediaGenerationQuotaPolicy";
import { getAiMediaVideoEntitlement } from "@/lib/aiMediaVideoEntitlementServer";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { assertAiMediaCreditQuote, quoteAiMediaRequest } from "@/lib/aiMediaCreditQuoteServer";
import type { AiMediaGenerationServerResult } from "@/lib/aiMediaGenerationServer";
import {
  AI_MEDIA_GENERATION_STREAM_TYPE, acceptsAiMediaGenerationStream, createAiMediaBillingGate,
  type AiMediaGenerationEvent,
} from "@/lib/aiMediaGenerationTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Maximum actuel d'une Function Vercel avec Fluid Compute. Le budget interne
// conserve ensuite une marge pour FFmpeg, Storage et la finalisation SQL.
export const maxDuration = 800;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
// Chaque image d'inspiration est compressée sous 560 ko par le navigateur.
// Trois images encodées en base64, le brief et l'enveloppe JSON restent ainsi
// sous cette limite, avant tout appel payant.
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const IDENTITY_REFERENCE_SET_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|identity-\d{10,16}-[a-z0-9]{8,16})$/i;

function serverTimingHeader(timings: Record<string, number>) {
  return Object.entries(timings)
    .filter(([, duration]) => Number.isFinite(duration) && duration >= 0)
    .map(([stage, duration]) =>
      `${stage.replace(/[^a-z0-9_-]/gi, "_")};dur=${Math.round(duration)}`,
    )
    .join(", ");
}

type RouteContext = {
  accountId: string;
  authUserId: string;
  requestId: string | null;
  jobId: string | null;
};

function jsonError(args: {
  status: number;
  code: string;
  message: string;
  quota?: unknown;
  retryAfterSeconds?: number;
}) {
  return NextResponse.json(
    {
      ok: false,
      code: args.code,
      error: args.message,
      ...(typeof args.quota === "undefined" ? {} : { quota: args.quota }),
    },
    {
      status: args.status,
      headers: {
        ...NO_STORE_HEADERS,
        ...(args.retryAfterSeconds
          ? { "Retry-After": String(args.retryAfterSeconds) }
          : {}),
      },
    },
  );
}

function safeFailureDetails(error: unknown) {
  const { code, message } = getAiMediaGenerationPublicError(error);
  return { code, message };
}

function publicGenerationError(error: unknown) {
  // Preserve the quota contract, including account ownership and idempotency errors.
  if (error instanceof AiMediaGenerationQuotaError) {
    return jsonError({ status: error.httpStatus, code: error.code, message: error.message });
  }
  const classified = classifyAiMediaGenerationError(error);
  if (error instanceof AiMediaRequestValidationError && (!classified || classified.code === "AI_MEDIA_INVALID_REQUEST")) {
    return jsonError({ status: 400, code: error.code, message: error.message });
  }
  if (error instanceof AiGatewayAccountLimitError || error instanceof AiGatewayGuardUnavailableError) {
    const failure = getAiMediaGenerationPublicError(error);
    return jsonError({ ...failure, retryAfterSeconds: error.retryAfterSeconds ?? failure.retryAfterSeconds });
  }
  return jsonError(classified ?? getAiMediaGenerationPublicError(error));
}

async function readRequestBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new AiMediaRequestValidationError("Demande de média trop volumineuse.");
  }
  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    throw new AiMediaRequestValidationError("Corps JSON invalide.");
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    throw new AiMediaRequestValidationError("Demande de média trop volumineuse.");
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new AiMediaRequestValidationError("Corps JSON invalide.");
  }
}

function generationFingerprint(request: AiMediaGenerationRequest) {
  return createAiMediaRequestFingerprint({
    contract: "inrcy-ai-media-generation-v13-structured-studio",
    promptVersion: request.creationMode === "free" ? AI_MEDIA_FREE_PROMPT_VERSION : AI_MEDIA_PROMPT_VERSION,
    creationMode: request.creationMode || "guided",
    freePrompt: request.creationMode === "free" ? request.freePrompt : undefined,
    ...(request.creationMode === "free" && request.useBusinessDna ? { useBusinessDna: true } : {}),
    operation: request.operation || "generate",
    inputMode: request.inputMode || "legacy",
    generationMode: request.generationMode,
    peopleCriterion: request.peopleCriterion,
    settingCriterion: request.settingCriterion,
    focusCriterion: request.focusCriterion,
    modificationSourceWidth: request.modificationSourceWidth,
    modificationSourceHeight: request.modificationSourceHeight,
    kind: request.kind,
    subjectSource: request.subjectSource,
    idea: request.idea,
    aiInstruction: request.aiInstruction,
    textMode: request.textMode,
    exactText: request.exactText,
    withText: request.withText,
    textKeywords: request.textKeywords,
    withMusic: request.withMusic,
    withNarration: request.withNarration,
    narrationVoice: request.narrationVoice,
    narrationVoiceVariant: request.narrationVoiceVariant,
    format: request.format,
    typology: request.typology,
    visualStyle: request.visualStyle,
    visualDirection: request.visualDirection,
    imagePurpose: request.imagePurpose,
    imageStyle: request.imageStyle,
    shotType: request.shotType,
    peopleMode: request.peopleMode,
    creativity: request.creativity,
    useBrandColors: request.useBrandColors,
    logoMode: request.logoMode,
    videoEngine: request.videoEngine,
    imageEngine: request.imageEngine,
    videoResolution: request.videoResolution,
    creditTariffVersion: request.creditTariffVersion,
    expectedCredits: request.expectedCredits,
    creditQuoteId: request.creditQuoteId,
    identityMode: request.identityMode,
    videoCharacterMode: request.videoCharacterMode,
    identityConsent: request.identityConsent,
    teamVideoMode: request.teamVideoMode,
    teamVideoSpeechMode: request.teamVideoSpeechMode,
    teamVideoVeoConsent: request.teamVideoVeoConsent,
    teamVideoProviderConsent: request.teamVideoProviderConsent,
    identityReferenceSetId: request.identityReferenceSetId,
    durationSeconds: request.durationSeconds,
    sceneMode: request.sceneMode,
    connectScenes: request.connectScenes,
    // Ne jamais persister une empreinte dérivée des photos. Ces descripteurs
    // non biométriques suffisent au contrôle de forme de l'idempotence.
    inspirationImages: request.inspirationImages.map((image) => ({
      mimeType: image.mimeType,
      encodedLength: image.data.length,
      role: image.role || null,
      usage: image.usage || null,
      characterIndex: image.characterIndex || null,
    })),
    source: request.source,
  });
}

function assertDraftContractVersion(value: unknown): Record<string, unknown> {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body || (body.contractVersion !== 3 && body.contractVersion !== 4)) {
    throw new AiMediaRequestValidationError(
      "Cette version de l’outil média n’est plus compatible. Actualisez la page avant de relancer.",
    );
  }
  if (body.contractVersion === 3) {
    // Un ancien onglet v3 ne possède ni l'attestation ni l'identifiant opaque
    // du contrat actuel. Ses références sont donc toujours ignorées, même si
    // un booléen historique `identityConsent` est présent.
    return {
      ...body,
      identityMode: "auto",
      videoCharacterMode: "auto",
      inspirationImages: [],
      identityConsent: false,
      teamVideoMode: "montage",
      teamVideoSpeechMode: "voiceover",
      teamVideoVeoConsent: false,
      identityReferenceSetId: "",
    };
  }
  const operation = body.operation === "modify" ? "modify" : "generate";
  // En mode Modifier, l'unique image fournie est le canvas source, pas une
  // référence biométrique destinée à composer une nouvelle scène. Elle ne
  // possède donc volontairement aucun `identityReferenceSetId`. Neutraliser
  // ici les champs d'identité empêche aussi un payload détourné de transformer
  // silencieusement cette source en référence de personne.
  if (operation === "modify") {
    return {
      ...body,
      identityMode: "auto",
      videoCharacterMode: "auto",
      identityConsent: false,
      identityReferenceSetId: "",
    };
  }
  if (Array.isArray(body.inspirationImages) && body.inspirationImages.length) {
    const referenceSetId = String(body.identityReferenceSetId || "").trim();
    if (!IDENTITY_REFERENCE_SET_ID_PATTERN.test(referenceSetId)) {
      throw new AiMediaRequestValidationError(
        "Le jeu de références d’identité est invalide. Retirez puis ajoutez de nouveau les médias avant de relancer.",
      );
    }
  }
  return body;
}

type GenerationExecutionOptions = {
  current: NonNullable<Awaited<ReturnType<typeof getCurrentInrcyAccountScope>>>;
  signal: AbortSignal;
  onBillingStarted: () => void | Promise<void>;
};

async function executeGenerate(request: Request, options: GenerationExecutionOptions) {
  const routeStartedAt = performance.now();
  const context: RouteContext = {
    accountId: "",
    authUserId: "",
    requestId: null,
    jobId: null,
  };
  let quotaReserved = false;
  let quotaCompleted = false;
  let mediaPersisted = false;
  let persistedMediaId: string | null = null;
  let persistedItem: AiMediaLibraryPickerItem | null = null;
  let persistedSoundtrack: AiMediaSoundtrackResponse | null = null;
  let persistedVideoEngineResult: AiMediaGenerationServerResult["videoEngineResult"] = null;
  let accountEdition: DashboardEdition | null = null;
  let videoMaxDurationSeconds: AiMediaVideoDurationLimit = 30;
  let adminUnlimited = false;

  try {
    const current = options.current;
    context.accountId = current.scope.activeUserId;
    context.authUserId = current.scope.authUserId;
    options.signal.throwIfAborted();
    // Ces trois lectures sont indépendantes. Les lancer ensemble supprime deux
    // allers-retours séquentiels avant même l'appel au moteur image ou vidéo.
    const [resolvedAdminUnlimited, rateLimited, edition] = await Promise.all([
      isAdminUserForAi(current.supabase, context.authUserId),
      enforceRateLimit({
        name: "ai_media_generation",
        identifier: context.accountId,
        limit: 12,
        fallbackLimit: 4,
        window: "10 m",
        failClosed: true,
        code: "ai_media_generation_burst",
      }),
      getDashboardEditionForAccountId(context.accountId),
    ]);
    adminUnlimited = resolvedAdminUnlimited;
    accountEdition = edition;
    if (rateLimited) return rateLimited;

    const requestBody = await readRequestBody(request);
    // Le contrat v1 sauvegardait immédiatement le résultat. Le refuser avant
    // toute réservation empêche un ancien onglet de contourner la validation.
    const compatibleRequestBody = assertDraftContractVersion(requestBody);
    const normalizedRequest = normalizeAiMediaGenerationRequest(
      compatibleRequestBody,
    );
    context.requestId = normalizedRequest.requestId;

    // Une image n'a aucune durée vidéo à autoriser. Éviter cette lecture
    // Supabase sur son chemin critique raccourcit chaque génération d'image.
    if (normalizedRequest.kind === "video") {
      const videoEntitlement = await getAiMediaVideoEntitlement({
        accountId: context.accountId,
        edition,
      });
      videoMaxDurationSeconds = adminUnlimited
        ? 30
        : videoEntitlement.maxDurationSeconds;
    }
    if (
      normalizedRequest.kind === "video" &&
      (normalizedRequest.durationSeconds || 16) > videoMaxDurationSeconds
    ) {
      const quota = await getAiMediaQuotaSnapshot({
        accountId: context.accountId,
        actorAuthUserId: context.authUserId,
        edition,
      }).catch(() => null);
      return jsonError({
        status: 403,
        code: "AI_MEDIA_VIDEO_DURATION_NOT_ALLOWED",
        message: `Cet établissement autorise actuellement les vidéos jusqu’à ${videoMaxDurationSeconds} secondes.`,
        quota: quota
          ? presentAiMediaQuota(quota, false, videoMaxDurationSeconds)
          : undefined,
      });
    }
    const identityConsentRecordedAt = normalizedRequest.identityConsent
      ? new Date().toISOString()
      : null;
    let quote: ReturnType<typeof quoteAiMediaRequest>;
    try {
      quote = quoteAiMediaRequest(context.accountId, normalizedRequest);
    } catch {
      throw new AiMediaRequestValidationError("Ces paramètres ne sont pas disponibles pour le moteur choisi. Actualisez le devis ou choisissez une autre durée.");
    }
    if (!assertAiMediaCreditQuote(normalizedRequest, quote)) {
      return jsonError({ status: 409, code: "AI_MEDIA_CREDIT_QUOTE_CHANGED", message: "Le devis a changé. Actualisez le coût en crédits avant de générer." });
    }
    const wallet = await getAiMediaQuotaSnapshot({ accountId: context.accountId, actorAuthUserId: context.authUserId, edition });
    if (!wallet.creditsReady) {
      return jsonError({ status: 503, code: "AI_MEDIA_CREDITS_NOT_READY", message: "Le portefeuille de crédits média doit être activé avant la génération." });
    }
    options.signal.throwIfAborted();
    const reservation = await reserveAiMediaGeneration({
      accountId: context.accountId,
      actorAuthUserId: context.authUserId,
      requestKey: normalizedRequest.requestId,
      requestFingerprint: generationFingerprint(normalizedRequest),
      mediaKind: normalizedRequest.kind,
      surface: normalizedRequest.source,
      edition,
      reservationTtlSeconds: normalizedRequest.kind === "video" ? 3_600 : 900,
      quotaUnit: "credit",
      quotaAmount: quote.totalCredits,
      limitOverride: adminUnlimited
        ? AI_MEDIA_ADMIN_LIMIT_OVERRIDE
        : undefined,
      metadata: {
        credit_tariff_version: quote.tariffVersion,
        credit_quote_id: quote.quoteId,
        credit_amount: quote.totalCredits,
        credit_breakdown: quote.breakdown,
        image_engine: normalizedRequest.imageEngine,
        video_resolution: normalizedRequest.videoResolution,
        admin_unlimited: adminUnlimited,
        source: normalizedRequest.source,
        prompt_version: AI_MEDIA_PROMPT_VERSION,
        subject_source: normalizedRequest.subjectSource,
        ai_instruction_present: Boolean(normalizedRequest.aiInstruction),
        ai_instruction_char_count: normalizedRequest.aiInstruction.length,
        with_text: normalizedRequest.withText,
        text_keyword_count: normalizedRequest.textKeywords.length,
        with_music: normalizedRequest.withMusic,
        with_narration: normalizedRequest.withNarration,
        narration_voice: normalizedRequest.narrationVoice,
        narration_voice_variant: normalizedRequest.narrationVoiceVariant,
        format: normalizedRequest.format,
        typology: normalizedRequest.typology,
        visual_style: normalizedRequest.visualStyle,
        image_style: normalizedRequest.imageStyle,
        shot_type: normalizedRequest.shotType,
        people_mode: normalizedRequest.peopleMode,
        creativity: normalizedRequest.creativity,
        use_brand_colors: normalizedRequest.useBrandColors,
        logo_mode: normalizedRequest.logoMode,
        video_engine: normalizedRequest.videoEngine,
        identity_mode: normalizedRequest.identityMode,
        video_character_mode: normalizedRequest.videoCharacterMode,
        identity_consent: normalizedRequest.identityConsent
          ? {
              granted: true,
              recorded_at: identityConsentRecordedAt,
              version: "inrcy-media-identity-consent-v1",
            }
          : null,
        team_video_mode: normalizedRequest.teamVideoMode,
        team_video_speech_mode: normalizedRequest.teamVideoSpeechMode,
        duration_seconds: normalizedRequest.durationSeconds,
        inspiration_image_count: normalizedRequest.inspirationImages.length,
      },
    });

    if (reservation.outcome === "premium_required") {
      return jsonError({
        status: 503,
        code: "AI_MEDIA_STUDIO_DISABLED",
        message:
          "La génération de média est momentanément indisponible pour cet établissement.",
        quota: presentAiMediaQuotaCounter(
          reservation.quota,
          adminUnlimited,
        ),
      });
    }
    if (reservation.outcome === "quota_reached") {
      return jsonError({
        status: 429,
        code: "AI_MEDIA_QUOTA_REACHED",
        message: `Crédits média insuffisants : ${reservation.quota.remaining} disponibles, ${quote.totalCredits} nécessaires.`,
        quota: presentAiMediaQuotaCounter(
          reservation.quota,
          adminUnlimited,
        ),
      });
    }

    context.jobId = reservation.jobId;
    if (!context.jobId) {
      throw new Error("ai_media_reservation_without_job");
    }

    if (reservation.outcome === "replayed") {
      const replayedMediaId = await getPersistedGeneratedAiMediaId({
        accountId: context.accountId,
        jobId: context.jobId,
      });
      if (replayedMediaId && reservation.status !== "completed") {
        await completeAiMediaGeneration({
          accountId: context.accountId,
          jobId: context.jobId,
          mediaId: replayedMediaId,
          metadata: { recovered_from_idempotent_replay: true },
        });
      }
      if (reservation.status === "completed") {
        const item = await getExistingGeneratedAiMedia({
          accountId: context.accountId,
          jobId: context.jobId,
        });
        if (item) {
          const quota = await getAiMediaQuotaSnapshot({
            accountId: context.accountId,
            actorAuthUserId: context.authUserId,
            edition,
          }).catch(() => null);
          return NextResponse.json(
            {
              ok: true,
              item,
              quota: quota
                ? presentAiMediaQuota(
                    quota,
                    adminUnlimited,
                    videoMaxDurationSeconds,
                  )
                : null,
              soundtrack: null,
              videoEngineResult: null,
              replayed: true,
              draft: true,
              ...(quota ? {} : { quotaUnavailable: true }),
            },
            { headers: NO_STORE_HEADERS },
          );
        }
      }
      if (replayedMediaId) {
        const item = await getExistingGeneratedAiMedia({
          accountId: context.accountId,
          jobId: context.jobId,
        });
        if (item) {
          const quota = await getAiMediaQuotaSnapshot({
            accountId: context.accountId,
            actorAuthUserId: context.authUserId,
            edition,
          }).catch(() => null);
          return NextResponse.json(
            {
              ok: true,
              item,
              quota: quota
                ? presentAiMediaQuota(
                    quota,
                    adminUnlimited,
                    videoMaxDurationSeconds,
                  )
                : null,
              soundtrack: null,
              videoEngineResult: null,
              replayed: true,
              draft: true,
              ...(quota ? {} : { quotaUnavailable: true }),
            },
            { headers: NO_STORE_HEADERS },
          );
        }
      }
      const requestClosed =
        reservation.status === "completed" ||
        reservation.status === "failed" ||
        reservation.status === "expired";
      return jsonError({
        status: 409,
        code: requestClosed
          ? "AI_MEDIA_REQUEST_ALREADY_CLOSED"
          : "AI_MEDIA_GENERATION_IN_PROGRESS",
        message:
          requestClosed
            ? "Cette tentative est terminée. Relancez avec une nouvelle demande."
            : "Cette génération est déjà en cours.",
        quota: presentAiMediaQuotaCounter(
          reservation.quota,
          adminUnlimited,
        ),
        retryAfterSeconds: requestClosed ? undefined : 5,
      });
    }

    quotaReserved = true;
    const generated = await generateAndSaveAiMedia({
      supabase: current.supabase,
      accountId: context.accountId,
      authUserId: context.authUserId,
      jobId: context.jobId,
      edition: accountEdition || undefined,
      request: normalizedRequest,
      videoMaxDurationSeconds,
      signal: options.signal,
      onBillableWorkStarted: options.onBillingStarted,
    });
    mediaPersisted = true;
    persistedMediaId = generated.item.id;
    persistedItem = generated.item;
    persistedSoundtrack = generated.soundtrack;
    persistedVideoEngineResult = generated.videoEngineResult;

    const finalizationStartedAt = performance.now();
    await completeAiMediaGeneration({
      accountId: context.accountId,
      jobId: context.jobId,
      mediaId: generated.item.id,
      metadata: {
        model: generated.model,
        prompt_version: generated.promptVersion,
        prompt_sha256: generated.promptSha256,
        casting_variant_key: generated.castingVariantKey,
        soundtrack_id: generated.soundtrack?.id || null,
        video_engine_result: generated.videoEngineResult,
        pipeline_timings_ms: generated.pipelineTimingsMs,
      },
    });
    const quotaFinalizationMs = Math.round(
      performance.now() - finalizationStartedAt,
    );
    quotaCompleted = true;

    const quotaSnapshotStartedAt = performance.now();
    const quota = await getAiMediaQuotaSnapshot({
      accountId: context.accountId,
      actorAuthUserId: context.authUserId,
      edition,
    });
    const requestTimings = {
      ...generated.pipelineTimingsMs,
      quota_finalization: quotaFinalizationMs,
      quota_snapshot: Math.round(performance.now() - quotaSnapshotStartedAt),
      request_total: Math.round(performance.now() - routeStartedAt),
    };
    console.info("[ai-media] request completed", JSON.stringify({
      accountId: context.accountId,
      jobId: context.jobId,
      kind: normalizedRequest.kind,
      durationSeconds: normalizedRequest.durationSeconds || null,
      videoEngineResult: generated.videoEngineResult,
      timingsMs: requestTimings,
    }));
    return NextResponse.json(
      {
        ok: true,
        item: generated.item,
        quota: presentAiMediaQuota(
          quota,
          adminUnlimited,
          videoMaxDurationSeconds,
        ),
        soundtrack: generated.soundtrack,
        videoEngineResult: generated.videoEngineResult,
        draft: true,
      },
      {
        headers: {
          ...NO_STORE_HEADERS,
          "Server-Timing": serverTimingHeader(requestTimings),
        },
      },
    );
  } catch (error) {
    // Le débit et le média sont déjà acquis : une lecture de snapshot en panne
    // ne doit surtout pas transformer un succès en fausse erreur régénérable.
    if (quotaCompleted && persistedItem) {
      return NextResponse.json(
        {
          ok: true,
          item: persistedItem,
          quota: null,
          soundtrack: persistedSoundtrack,
          videoEngineResult: persistedVideoEngineResult,
          recovered: true,
          quotaUnavailable: true,
          draft: true,
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    if (!quotaCompleted && context.accountId && context.jobId) {
      if (!persistedMediaId) {
        persistedMediaId = await getPersistedGeneratedAiMediaId({
          accountId: context.accountId,
          jobId: context.jobId,
        }).catch(() => null);
      }
      mediaPersisted = mediaPersisted || Boolean(persistedMediaId);
    }

    if (!quotaCompleted && mediaPersisted && persistedMediaId && context.jobId) {
      try {
        await completeAiMediaGeneration({
          accountId: context.accountId,
          jobId: context.jobId,
          mediaId: persistedMediaId,
          metadata: { recovered_after_persistence_error: true },
        });
        quotaCompleted = true;
        if (!persistedItem) {
          persistedItem = await getExistingGeneratedAiMedia({
            accountId: context.accountId,
            jobId: context.jobId,
          }).catch(() => null);
        }
        if (persistedItem && accountEdition) {
          const quota = await getAiMediaQuotaSnapshot({
            accountId: context.accountId,
            actorAuthUserId: context.authUserId,
            edition: accountEdition,
          });
          return NextResponse.json(
            {
              ok: true,
              item: persistedItem,
              quota: presentAiMediaQuota(
                quota,
                adminUnlimited,
                videoMaxDurationSeconds,
              ),
              soundtrack: null,
              videoEngineResult: persistedVideoEngineResult,
              recovered: true,
              draft: true,
            },
            { headers: NO_STORE_HEADERS },
          );
        }
      } catch (finalizationError) {
        if (quotaCompleted && persistedItem) {
          return NextResponse.json(
            {
              ok: true,
              item: persistedItem,
              quota: null,
              soundtrack: persistedSoundtrack,
              videoEngineResult: persistedVideoEngineResult,
              recovered: true,
              quotaUnavailable: true,
              draft: true,
            },
            { headers: NO_STORE_HEADERS },
          );
        }
        console.error("[ai-media] persisted media finalization pending", JSON.stringify({
          accountId: context.accountId,
          jobId: context.jobId,
          mediaId: persistedMediaId,
          error: safeAiMediaErrorMessage(finalizationError),
        }));
        return jsonError({
          status: 503,
          code: "AI_MEDIA_FINALIZATION_PENDING",
          message:
            "Le média est enregistré et sa finalisation est en cours. Réessayez dans quelques instants.",
          retryAfterSeconds: 5,
        });
      }
    }

    if (quotaReserved && !quotaCompleted && !mediaPersisted && context.accountId && context.jobId) {
      const failure = safeFailureDetails(error);
      await failAiMediaGeneration({
        accountId: context.accountId,
        jobId: context.jobId,
        errorCode: failure.code,
        errorMessage: failure.message,
        metadata: {
          request_id: context.requestId,
          request_aborted: request.signal.aborted,
          error_details: safeAiMediaErrorDetails(error),
        },
      }).catch((releaseError) => {
        console.error("[ai-media] quota release failed", JSON.stringify({
          accountId: context.accountId,
          jobId: context.jobId,
          error: safeAiMediaErrorMessage(releaseError),
        }));
      });
    }
    console.error("[ai-media] generation failed", JSON.stringify({
      accountId: context.accountId || null,
      jobId: context.jobId,
      requestId: context.requestId,
      error: safeAiMediaErrorMessage(error),
      errorDetails: safeAiMediaErrorDetails(error),
      requestAborted: request.signal.aborted,
    }));
    return publicGenerationError(error);
  }
}

export async function POST(request: Request) {
  // Authentication is resolved once, before any stream headers. Unauthorized
  // callers keep the same 401 JSON contract, regardless of their Accept header.
  let current: Awaited<ReturnType<typeof getCurrentInrcyAccountScope>>;
  try { current = await getCurrentInrcyAccountScope(); }
  catch (error) { return publicGenerationError(error); }
  if (!current) return jsonError({ status: 401, code: "UNAUTHORIZED", message: "Non authentifié." });
  if (!acceptsAiMediaGenerationStream(request.headers.get("accept"))) {
    const gate = createAiMediaBillingGate(request.signal);
    const execution = executeGenerate(request, { current, signal: gate.signal, onBillingStarted: () => gate.lock() });
    // The same paid job is allowed to finalize after a client disconnect.
    after(execution.then(() => undefined));
    try { return await execution; }
    finally { gate.dispose(); }
  }

  let connected = true;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const emit = (event: AiMediaGenerationEvent) => {
    if (!connected) return;
    try { streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
    catch { connected = false; }
  };
  const gate = createAiMediaBillingGate(request.signal, () => emit({ type: "billing_locked" }));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; },
    cancel() { connected = false; gate.disconnect(); },
  });
  const execution = executeGenerate(request, { current, signal: gate.signal, onBillingStarted: () => gate.lock() })
    .then(async (response) => {
      const payload: unknown = await response.json();
      emit({ type: "result", status: response.status, payload });
    })
    .catch(async (error) => {
      const response = publicGenerationError(error);
      emit({ type: "result", status: response.status, payload: await response.json() });
    })
    .finally(() => {
      gate.dispose();
      if (connected) { connected = false; streamController.close(); }
    });
  after(execution);
  return new Response(stream, { headers: {
    ...NO_STORE_HEADERS, "Content-Type": `${AI_MEDIA_GENERATION_STREAM_TYPE}; charset=utf-8`,
    "X-Content-Type-Options": "nosniff",
  } });
}

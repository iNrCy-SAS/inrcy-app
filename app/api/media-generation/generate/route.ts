import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

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
import { AI_MEDIA_PROMPT_VERSION } from "@/lib/aiMediaGenerationPrompt";
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
  const raw = error instanceof Error ? error.message : String(error || "");
  const code = raw
    .split(":", 1)[0]
    .replace(/[^a-z0-9_-]/gi, "_")
    .slice(0, 120) || "ai_media_generation_failed";
  return {
    code,
    message: raw.replace(/\s+/g, " ").slice(0, 1_000),
  };
}

function veoSafetyReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const marker = "ai_video_veo_safety_filtered:";
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) return "";
  return message
    .slice(markerIndex + marker.length)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function publicVeoSafetyMessage(error: unknown) {
  const reason = veoSafetyReason(error).toLocaleLowerCase();
  const suffix = " Aucun quota iNrCy n’a été consommé.";
  if (/audio|sound|speech|voice|music|piste sonore|sonore/.test(reason)) {
    return (
      "Google a bloqué ce rendu pendant le contrôle de sa piste audio. " +
      "Votre sujet n’est pas forcément en cause : réessayez, un nouveau rendu peut fonctionner." +
      suffix
    );
  }
  if (/person|people|face|human|minor|child|adult|visage|personne/.test(reason)) {
    return (
      "Google a bloqué une personne ou un visage apparu dans le rendu final. " +
      "Votre sujet n’est pas forcément en cause : réessayez pour produire une autre scène." +
      suffix
    );
  }
  if (/copyright|memor|privacy|public figure|celebrity|trademark|similar/.test(reason)) {
    return (
      "Google a bloqué le rendu lors de son contrôle de confidentialité ou de similarité. " +
      "Réessayez afin de produire une création différente." +
      suffix
    );
  }
  if (/violence|sexual|danger|hate|toxic|derogatory|prohibited|harm/.test(reason)) {
    return (
      "Google a bloqué le contenu visuel généré pour une règle de sécurité. " +
      "Modifiez légèrement la scène demandée puis réessayez." +
      suffix
    );
  }
  return (
    "Google a bloqué le rendu généré lors de son contrôle final. " +
    "Votre sujet n’est pas forcément en cause : réessayez, un nouveau rendu peut fonctionner." +
    suffix
  );
}

function publicGenerationError(error: unknown) {
  if (error instanceof AiMediaRequestValidationError) {
    return jsonError({ status: 400, code: error.code, message: error.message });
  }
  if (error instanceof AiMediaGenerationQuotaError) {
    return jsonError({
      status: error.httpStatus,
      code: error.code,
      message: error.message,
    });
  }
  if (error instanceof AiGatewayAccountLimitError) {
    return jsonError({
      status: 429,
      code: error.code,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  if (error instanceof AiGatewayGuardUnavailableError) {
    return jsonError({
      status: 503,
      code: error.code,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }

  const message = error instanceof Error ? error.message : "";
  const errorName = error instanceof Error ? error.name : "";
  if (
    message.includes("ai_media_generation_cancelled") ||
    errorName === "AbortError"
  ) {
    return jsonError({
      status: 499,
      code: "AI_MEDIA_GENERATION_CANCELLED",
      message:
        "Génération arrêtée à votre demande. Le quota iNrCy a été libéré.",
    });
  }
  if (
    message.includes("ai_gateway_credentials_missing") ||
    message.includes("ai_video_veo_credentials_missing") ||
    message.includes("ai_video_veo_credentials_rejected") ||
    message.includes("ai_video_veo_permission_denied")
  ) {
    return jsonError({
      status: 503,
      code: "AI_MEDIA_GATEWAY_NOT_CONFIGURED",
      message:
        "Le service vidéo Google est momentanément indisponible. Aucun quota iNrCy n’a été consommé.",
      retryAfterSeconds: 60,
    });
  }
  if (message.includes("ai_video_veo_rate_limited")) {
    return jsonError({
      status: 429,
      code: "AI_MEDIA_VIDEO_CAPACITY_REACHED",
      message:
        "Google reçoit trop de demandes vidéo pour le moment. Réessayez dans une minute : aucun quota iNrCy n’a été consommé.",
      retryAfterSeconds: 60,
    });
  }
  if (
    message.includes("TimeoutError") ||
    message.includes("AbortError") ||
    message.includes("timed out") ||
    message.includes("ai_video_veo_timeout")
  ) {
    return jsonError({
      status: 504,
      code: "AI_MEDIA_GENERATION_TIMEOUT",
      message: "La génération a pris trop de temps. Aucun quota iNrCy n’a été consommé.",
      retryAfterSeconds: 30,
    });
  }
  if (message.includes("ai_video_veo_safety_filtered")) {
    return jsonError({
      status: 422,
      code: "AI_MEDIA_VIDEO_SAFETY_FILTERED",
      message: publicVeoSafetyMessage(error),
    });
  }
  if (message.includes("ai_video_veo_video_missing")) {
    return jsonError({
      status: 502,
      code: "AI_MEDIA_VIDEO_FILE_MISSING",
      message:
        "Google a terminé le rendu sans renvoyer de fichier vidéo. Réessayez : aucun quota iNrCy n’a été consommé.",
    });
  }
  if (
    message.includes("ai_video_veo_unavailable") ||
    message.includes("ai_video_veo_network_failed") ||
    message.includes("ai_video_veo_model_unavailable")
  ) {
    return jsonError({
      status: 503,
      code: "AI_MEDIA_VIDEO_PROVIDER_UNAVAILABLE",
      message:
        "Le moteur vidéo Google est temporairement indisponible après plusieurs tentatives automatiques. Réessayez dans un instant : aucun quota iNrCy n’a été consommé.",
      retryAfterSeconds: 30,
    });
  }
  if (
    message.includes("ai_video_veo_configuration_rejected") ||
    message.includes("ai_video_veo_model_invalid")
  ) {
    return jsonError({
      status: 502,
      code: "AI_MEDIA_VIDEO_CONFIGURATION_REJECTED",
      message:
        "Google a refusé toutes les variantes compatibles de cette génération. Modifiez légèrement l’idée puis réessayez : aucun quota iNrCy n’a été consommé.",
    });
  }
  if (
    message.includes("ai_video_veo_download_failed") ||
    message.includes("ai_video_veo_clip_not_mp4") ||
    message.includes("ai_video_veo_clip_too_large")
  ) {
    return jsonError({
      status: 502,
      code: "AI_MEDIA_VIDEO_DOWNLOAD_FAILED",
      message:
        "La vidéo a été créée mais son fichier final n’a pas pu être récupéré correctement. Réessayez : aucun quota iNrCy n’a été consommé.",
    });
  }
  if (
    message.includes("ai_video_veo_clip_empty") ||
    message.includes("ai_video_veo_operation_id_missing") ||
    message.includes("ai_video_veo_clip_set_incomplete") ||
    message.includes("ai_original_video_clip_contract_failed") ||
    message.includes("ai_original_video_output_contract_failed") ||
    message.includes("ai_original_video_render_failed")
  ) {
    return jsonError({
      status: 502,
      code: "AI_MEDIA_VIDEO_INCOMPLETE",
      message:
        "Google a renvoyé une vidéo incomplète. Réessayez : aucun quota iNrCy n’a été consommé.",
    });
  }
  return jsonError({
    status: 502,
    code: "AI_MEDIA_GENERATION_FAILED",
    message: "Le média n’a pas pu être généré. Aucun quota iNrCy n’a été consommé.",
  });
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

function inspirationImageSha256(request: AiMediaGenerationRequest) {
  return request.inspirationImages.map((image) =>
    createHash("sha256").update(image.data).digest("hex"),
  );
}

function generationFingerprint(request: AiMediaGenerationRequest) {
  return createAiMediaRequestFingerprint({
    contract: "inrcy-ai-media-generation-v8-veo-controlled-voiceover",
    promptVersion: AI_MEDIA_PROMPT_VERSION,
    kind: request.kind,
    subjectSource: request.subjectSource,
    idea: request.idea,
    withText: request.withText,
    textKeywords: request.textKeywords,
    withMusic: request.withMusic,
    withNarration: request.withNarration,
    format: request.format,
    typology: request.typology,
    visualStyle: request.visualStyle,
    imageStyle: request.imageStyle,
    shotType: request.shotType,
    peopleMode: request.peopleMode,
    creativity: request.creativity,
    useBrandColors: request.useBrandColors,
    logoMode: request.logoMode,
    durationSeconds: request.durationSeconds,
    inspirationImageSha256: inspirationImageSha256(request),
    source: request.source,
  });
}

function assertDraftContractVersion(value: unknown) {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body || body.contractVersion !== 3) {
    throw new AiMediaRequestValidationError(
      "Cette version de l’outil média n’est plus compatible. Actualisez la page avant de relancer.",
    );
  }
}

export async function POST(request: Request) {
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
  let accountEdition: DashboardEdition | null = null;
  let videoMaxDurationSeconds: AiMediaVideoDurationLimit = 24;
  let adminUnlimited = false;

  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) {
      return jsonError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Non authentifié.",
      });
    }

    context.accountId = current.scope.activeUserId;
    context.authUserId = current.scope.authUserId;
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
    assertDraftContractVersion(requestBody);
    const normalizedRequest = normalizeAiMediaGenerationRequest(requestBody);
    context.requestId = normalizedRequest.requestId;

    // Une image n'a aucune durée vidéo à autoriser. Éviter cette lecture
    // Supabase sur son chemin critique raccourcit chaque génération d'image.
    if (normalizedRequest.kind === "video") {
      const videoEntitlement = await getAiMediaVideoEntitlement({
        accountId: context.accountId,
        edition,
      });
      videoMaxDurationSeconds = adminUnlimited
        ? 24
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
        code:
          edition === "standard" && videoMaxDurationSeconds === 8
            ? "AI_MEDIA_VIDEO_LONG_FORM_PREMIUM_REQUIRED"
            : "AI_MEDIA_VIDEO_DURATION_NOT_ALLOWED",
        message:
          edition === "standard" && videoMaxDurationSeconds === 8
            ? "Les vidéos de 16 et 24 secondes sont réservées aux offres Premium et Founder. Votre offre Standard inclut 5 vidéos de 8 secondes par mois."
            : `Cet établissement autorise actuellement les vidéos jusqu’à ${videoMaxDurationSeconds} secondes.`,
        quota: quota
          ? presentAiMediaQuota(quota, false, videoMaxDurationSeconds)
          : undefined,
      });
    }
    const reservation = await reserveAiMediaGeneration({
      accountId: context.accountId,
      actorAuthUserId: context.authUserId,
      requestKey: normalizedRequest.requestId,
      requestFingerprint: generationFingerprint(normalizedRequest),
      mediaKind: normalizedRequest.kind,
      surface: normalizedRequest.source,
      edition,
      reservationTtlSeconds: normalizedRequest.kind === "video" ? 3_600 : 900,
      limitOverride: adminUnlimited
        ? AI_MEDIA_ADMIN_LIMIT_OVERRIDE
        : undefined,
      metadata: {
        admin_unlimited: adminUnlimited,
        source: normalizedRequest.source,
        prompt_version: AI_MEDIA_PROMPT_VERSION,
        subject_source: normalizedRequest.subjectSource,
        with_text: normalizedRequest.withText,
        text_keyword_count: normalizedRequest.textKeywords.length,
        with_music: normalizedRequest.withMusic,
        with_narration: normalizedRequest.withNarration,
        format: normalizedRequest.format,
        typology: normalizedRequest.typology,
        visual_style: normalizedRequest.visualStyle,
        image_style: normalizedRequest.imageStyle,
        shot_type: normalizedRequest.shotType,
        people_mode: normalizedRequest.peopleMode,
        creativity: normalizedRequest.creativity,
        use_brand_colors: normalizedRequest.useBrandColors,
        logo_mode: normalizedRequest.logoMode,
        duration_seconds: normalizedRequest.durationSeconds,
        inspiration_image_count: normalizedRequest.inspirationImages.length,
        inspiration_image_sha256: inspirationImageSha256(normalizedRequest),
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
        message: "Le plafond mensuel de cet établissement est atteint.",
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
      request: normalizedRequest,
      signal: request.signal,
    });
    mediaPersisted = true;
    persistedMediaId = generated.item.id;
    persistedItem = generated.item;
    persistedSoundtrack = generated.soundtrack;

    const finalizationStartedAt = performance.now();
    await completeAiMediaGeneration({
      accountId: context.accountId,
      jobId: context.jobId,
      mediaId: generated.item.id,
      metadata: {
        model: generated.model,
        prompt_version: generated.promptVersion,
        prompt_sha256: generated.promptSha256,
        soundtrack_id: generated.soundtrack?.id || null,
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
    console.info("[ai-media] request completed", {
      accountId: context.accountId,
      jobId: context.jobId,
      kind: normalizedRequest.kind,
      durationSeconds: normalizedRequest.durationSeconds || null,
      timingsMs: requestTimings,
    });
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
              recovered: true,
              quotaUnavailable: true,
              draft: true,
            },
            { headers: NO_STORE_HEADERS },
          );
        }
        console.error("[ai-media] persisted media finalization pending", {
          accountId: context.accountId,
          jobId: context.jobId,
          mediaId: persistedMediaId,
          error:
            finalizationError instanceof Error
              ? finalizationError.message
              : String(finalizationError),
        });
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
        metadata: { request_id: context.requestId },
      }).catch((releaseError) => {
        console.error("[ai-media] quota release failed", {
          accountId: context.accountId,
          jobId: context.jobId,
          error:
            releaseError instanceof Error
              ? releaseError.message
              : String(releaseError),
        });
      });
    }
    console.error("[ai-media] generation failed", {
      accountId: context.accountId || null,
      jobId: context.jobId,
      requestId: context.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return publicGenerationError(error);
  }
}

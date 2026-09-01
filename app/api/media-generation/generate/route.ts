import { NextResponse } from "next/server";

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
import { generateAndSaveAiMedia } from "@/lib/aiMediaGenerationServer";
import {
  getExistingGeneratedAiMedia,
  getPersistedGeneratedAiMediaId,
} from "@/lib/aiGeneratedMediaRegistry";
import {
  getDashboardEditionForAccountId,
} from "@/lib/dashboardEditionServer";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Maximum actuel d'une Function Vercel avec Fluid Compute. Le budget interne
// conserve ensuite une marge pour FFmpeg, Storage et la finalisation SQL.
export const maxDuration = 800;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_BODY_BYTES = 16 * 1024;

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
  if (message.includes("ai_gateway_credentials_missing")) {
    return jsonError({
      status: 503,
      code: "AI_MEDIA_GATEWAY_NOT_CONFIGURED",
      message: "La génération IA est momentanément indisponible.",
    });
  }
  if (
    message.includes("TimeoutError") ||
    message.includes("AbortError") ||
    message.includes("timed out")
  ) {
    return jsonError({
      status: 504,
      code: "AI_MEDIA_GENERATION_TIMEOUT",
      message: "La génération a pris trop de temps. Aucun crédit n’a été consommé.",
    });
  }
  return jsonError({
    status: 502,
    code: "AI_MEDIA_GENERATION_FAILED",
    message: "Le média n’a pas pu être généré. Aucun crédit n’a été consommé.",
  });
}

async function readRequestBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new AiMediaRequestValidationError("Demande de média trop volumineuse.");
  }
  try {
    return await request.json();
  } catch {
    throw new AiMediaRequestValidationError("Corps JSON invalide.");
  }
}

function generationFingerprint(request: AiMediaGenerationRequest) {
  return createAiMediaRequestFingerprint({
    contract: "inrcy-ai-media-generation-v2-draft",
    promptVersion: AI_MEDIA_PROMPT_VERSION,
    kind: request.kind,
    subjectSource: request.subjectSource,
    idea: request.idea,
    withText: request.withText,
    withMusic: request.withMusic,
    source: request.source,
  });
}

function assertDraftContractVersion(value: unknown) {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body || body.contractVersion !== 2) {
    throw new AiMediaRequestValidationError(
      "Cette version de l’outil média n’est plus compatible. Actualisez la page avant de relancer.",
    );
  }
}

export async function POST(request: Request) {
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

    const rateLimited = await enforceRateLimit({
      name: "ai_media_generation",
      identifier: context.accountId,
      limit: 12,
      fallbackLimit: 4,
      window: "10 m",
      failClosed: true,
      code: "ai_media_generation_burst",
    });
    if (rateLimited) return rateLimited;

    const requestBody = await readRequestBody(request);
    // Le contrat v1 sauvegardait immédiatement le résultat. Le refuser avant
    // toute réservation empêche un ancien onglet de contourner la validation.
    assertDraftContractVersion(requestBody);
    const normalizedRequest = normalizeAiMediaGenerationRequest(requestBody);
    context.requestId = normalizedRequest.requestId;

    const edition = await getDashboardEditionForAccountId(context.accountId);
    accountEdition = edition;
    const reservation = await reserveAiMediaGeneration({
      accountId: context.accountId,
      actorAuthUserId: context.authUserId,
      requestKey: normalizedRequest.requestId,
      requestFingerprint: generationFingerprint(normalizedRequest),
      mediaKind: normalizedRequest.kind,
      surface: normalizedRequest.source,
      edition,
      reservationTtlSeconds: normalizedRequest.kind === "video" ? 3_600 : 900,
      metadata: {
        source: normalizedRequest.source,
        prompt_version: AI_MEDIA_PROMPT_VERSION,
        subject_source: normalizedRequest.subjectSource,
        with_text: normalizedRequest.withText,
        with_music: normalizedRequest.withMusic,
      },
    });

    if (reservation.outcome === "premium_required") {
      return jsonError({
        status: 503,
        code: "AI_MEDIA_STUDIO_DISABLED",
        message:
          "La génération de média est momentanément indisponible pour cet établissement.",
        quota: reservation.quota,
      });
    }
    if (reservation.outcome === "quota_reached") {
      return jsonError({
        status: 429,
        code: "AI_MEDIA_QUOTA_REACHED",
        message: "Le plafond mensuel de cet établissement est atteint.",
        quota: reservation.quota,
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
              quota,
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
              quota,
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
        quota: reservation.quota,
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
    });
    mediaPersisted = true;
    persistedMediaId = generated.item.id;
    persistedItem = generated.item;
    persistedSoundtrack = generated.soundtrack;

    await completeAiMediaGeneration({
      accountId: context.accountId,
      jobId: context.jobId,
      mediaId: generated.item.id,
      metadata: {
        model: generated.model,
        prompt_version: generated.promptVersion,
        prompt_sha256: generated.promptSha256,
        soundtrack_id: generated.soundtrack?.id || null,
      },
    });
    quotaCompleted = true;

    const quota = await getAiMediaQuotaSnapshot({
      accountId: context.accountId,
      actorAuthUserId: context.authUserId,
      edition,
    });
    return NextResponse.json(
      {
        ok: true,
        item: generated.item,
        quota,
        soundtrack: generated.soundtrack,
        draft: true,
      },
      { headers: NO_STORE_HEADERS },
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
              quota,
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

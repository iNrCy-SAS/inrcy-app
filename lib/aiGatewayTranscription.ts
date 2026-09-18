import "server-only";

import {
  cleanAiGatewayEnv,
  getAiGatewayCredential,
  getAiGatewayTranscriptionUrl,
  normalizeGatewayModelId,
} from "@/lib/aiGatewayConfig";
import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
  type AiGatewayAccountAttemptReservation,
} from "@/lib/aiGatewayAccountGuard";
import { assertAllowedAiGatewayTranscriptionModel } from "@/lib/aiGatewayPolicy";
import { fetchWithRetry } from "@/lib/observability/fetch";

const DEFAULT_TRANSCRIBE_MODEL = "openai/gpt-4o-transcribe";
const DEFAULT_TRANSCRIBE_FALLBACK_MODEL = "openai/whisper-1";
const AI_GATEWAY_PROTOCOL_VERSION = "0.0.1";
const AI_GATEWAY_TRANSCRIPTION_SPECIFICATION_VERSION = "4";

function transcriptionProtocolError() {
  return Object.assign(
    new Error("Le service de transcription audio utilise un protocole incompatible."),
    { code: "ai_gateway_transcription_protocol_unsupported" },
  );
}

function transcriptionUnavailableError(details: string[]) {
  return Object.assign(
    new Error("Le service de transcription audio est momentanément indisponible."),
    {
      code: "ai_gateway_transcription_unavailable",
      details: details.filter(Boolean).slice(0, 4),
    },
  );
}

function errorCode(error: unknown) {
  return String(
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code || ""
      : "",
  );
}

type AiGatewayTranscriptionResponse = {
  text?: string;
  segments?: unknown[];
  language?: string;
  durationInSeconds?: number;
  warnings?: unknown[];
};

export type AiGatewayTranscriptionResult = {
  text: string;
  model: string;
  language?: string;
  durationInSeconds?: number;
  warnings: unknown[];
};

function getConfiguredModels(): string[] {
  const primary = normalizeGatewayModelId(
    cleanAiGatewayEnv(process.env.AI_GATEWAY_TRANSCRIBE_MODEL) || DEFAULT_TRANSCRIBE_MODEL,
  );
  const fallback = normalizeGatewayModelId(
    cleanAiGatewayEnv(process.env.AI_GATEWAY_TRANSCRIBE_FALLBACK_MODEL) || DEFAULT_TRANSCRIBE_FALLBACK_MODEL,
  );
  return Array.from(new Set([primary, fallback]));
}

function normalizeMediaType(value: unknown): string {
  const raw = cleanAiGatewayEnv(value).toLowerCase().split(";")[0]?.trim() || "";
  return raw || "audio/webm";
}

function cleanTranscript(value: unknown): string {
  return String(value || "").trim();
}

/**
 * Point d'entrée unique de transcription brute iNrCy.
 *
 * Utilise l'endpoint REST Speech-to-Text du Vercel AI Gateway. Aucun appel
 * fournisseur direct n'est autorisé ici. Les tentatives réelles sont comptées
 * dans les garde-fous économiques par établissement actif.
 */
export async function aiTranscribeMedia(args: {
  file: File;
  accountId?: string;
  mediaType?: string;
  retries?: number;
  timeoutMs?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
}): Promise<AiGatewayTranscriptionResult> {
  const credential = getAiGatewayCredential();
  if (!credential) throw new Error("Configuration AI Gateway manquante.");
  const gatewayAuthMethod = cleanAiGatewayEnv(process.env.AI_GATEWAY_API_KEY)
    ? "api-key"
    : "oidc";

  const requestedTimeoutMs = Math.max(
    1_000,
    Math.min(110_000, Math.floor(args.timeoutMs ?? 100_000)),
  );
  const requestedDeadlineAt = Number(args.deadlineAt || 0);
  const hardDeadlineAt = Math.min(
    Date.now() + requestedTimeoutMs,
    Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > 0
      ? requestedDeadlineAt
      : Number.POSITIVE_INFINITY,
  );
  if (args.signal?.aborted || hardDeadlineAt - Date.now() <= 250) {
    throw Object.assign(new Error("Délai de transcription atteint."), {
      code: "ai_operation_deadline_exceeded",
    });
  }
  const audio = Buffer.from(await args.file.arrayBuffer()).toString("base64");
  if (args.signal?.aborted || hardDeadlineAt - Date.now() <= 250) {
    throw Object.assign(new Error("Délai de transcription atteint."), {
      code: "ai_operation_deadline_exceeded",
    });
  }
  const mediaType = normalizeMediaType(args.mediaType || args.file.type);
  const url = getAiGatewayTranscriptionUrl();
  const models = getConfiguredModels();
  const errors: string[] = [];
  let terminalError: Error | null = null;
  for (const model of models) {
    if (args.signal?.aborted || hardDeadlineAt - Date.now() <= 250) break;
    assertAllowedAiGatewayTranscriptionModel(
      model,
      process.env.AI_GATEWAY_ALLOWED_TRANSCRIPTION_MODELS,
    );

    let successfulReservation: AiGatewayAccountAttemptReservation | null = null;
    try {
      const attemptReservations = new Map<number, AiGatewayAccountAttemptReservation | null>();
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          "ai-gateway-protocol-version": AI_GATEWAY_PROTOCOL_VERSION,
          "ai-gateway-auth-method": gatewayAuthMethod,
          "ai-transcription-model-specification-version":
            AI_GATEWAY_TRANSCRIPTION_SPECIFICATION_VERSION,
          "ai-model-id": model,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ audio, mediaType }),
        retries: Math.max(0, Math.min(1, Math.floor(args.retries ?? 1))),
        timeoutMs: Math.max(
          1_000,
          Math.min(90_000, requestedTimeoutMs),
        ),
        deadlineAt: hardDeadlineAt,
        signal: args.signal,
        retryStatuses: [408, 500, 502, 503, 504],
        onAttempt: async (attempt) => {
          const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
            feature: "booster.transcribe",
            reservedOutputTokens: 128,
            estimatedCostMicroUsd: 1,
          });
          attemptReservations.set(attempt, reservation);
        },
        onAttemptSettled: async ({ attempt, response: settledResponse }) => {
          const reservation = attemptReservations.get(attempt) || null;
          if (settledResponse?.ok) {
            successfulReservation = reservation;
            return;
          }
          await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        await recordAiGatewayAccountFailure({
          accountId: args.accountId,
          feature: "booster.transcribe",
          model,
          status: response.status,
        }).catch(() => undefined);
        if (
          response.status === 400 &&
          /unsupported gateway protocol version/i.test(errorText)
        ) {
          throw transcriptionProtocolError();
        }
        errors.push(`${model}: ${response.status} ${errorText || response.statusText}`.trim());
        if (response.status === 401 || response.status === 403) break;
        continue;
      }

      const result = (await response.json().catch(() => ({}))) as AiGatewayTranscriptionResponse;
      const text = cleanTranscript(result.text);
      if (!text) {
        await rollbackAiGatewayAccountAttempt(successfulReservation).catch(
          () => undefined,
        );
        successfulReservation = null;
        errors.push(`${model}: transcription vide`);
        continue;
      }

      await commitAiGatewayAccountAttempt({
        reservation: successfulReservation,
        feature: "booster.transcribe",
        model,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }).catch((error) => {
        console.warn("[ai-gateway] transcription atomic usage commit unavailable", {
          model,
          message: error instanceof Error ? error.message : String(error),
        });
      });

      console.info("[ai-gateway] transcription usage", {
        feature: "booster.transcribe",
        model,
        accountId: args.accountId || undefined,
        mediaType,
        durationInSeconds: result.durationInSeconds,
        language: result.language,
      });

      return {
        text,
        model,
        language: result.language,
        durationInSeconds: result.durationInSeconds,
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      };
    } catch (error) {
      await rollbackAiGatewayAccountAttempt(successfulReservation).catch(
        () => undefined,
      );
      errors.push(`${model}: ${error instanceof Error ? error.message : "échec de transcription"}`);
      if (errorCode(error) === "ai_gateway_transcription_protocol_unsupported") {
        terminalError = error instanceof Error ? error : transcriptionProtocolError();
        break;
      }
    }
  }

  if (terminalError) throw terminalError;

  throw transcriptionUnavailableError(errors);
}

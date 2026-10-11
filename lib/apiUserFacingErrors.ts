import "server-only";

import { NextResponse } from "next/server";
import { fallbackForStatus, getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

type ErrorResponseOptions = {
  status?: number;
  fallback?: string;
  extra?: Record<string, unknown>;
  code?: string;
};

function getStructuredErrorCode(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const code = (input as { code?: unknown }).code;
  return typeof code === "string" ? code.trim() : "";
}



function getKnownStructuredErrorMessage(code: string): string | null {
  if (code === "ai_gateway_rate_limit") {
    return "Ce moteur IA est temporairement très sollicité. Réessayez dans quelques minutes ou choisissez un autre moteur IA.";
  }
  if (code === "ai_gateway_unavailable" || code === "ai_gateway_request_failed") {
    return "Ce moteur IA est temporairement indisponible. iNrCy a tenté les solutions de secours ; merci de relancer la génération.";
  }
  if (code === "ai_gateway_invalid_request") {
    return "Les moteurs IA disponibles n’ont pas pu traiter cette demande. Merci de relancer ou de choisir un autre moteur IA.";
  }
  if (code === "ai_gateway_account_limit_reached") {
    return "La limite de sécurité IA de ce compte est temporairement atteinte. Merci de réessayer plus tard.";
  }
  if (code === "ai_operation_budget_exceeded") {
    return "La génération a atteint sa limite technique de sécurité. Merci de relancer la génération.";
  }
  if (code === "ai_operation_deadline_exceeded" || code === "fetch_timeout") {
    return "Le moteur IA met trop de temps à répondre. Merci de relancer la génération.";
  }
  if (code === "ai_gateway_guard_unavailable") {
    return "La protection économique IA est momentanément indisponible. Merci de réessayer dans quelques minutes.";
  }
  if (
    code === "ai_gateway_transcription_unavailable" ||
    code === "ai_gateway_transcription_protocol_unsupported"
  ) {
    return "Le service vocal est momentanément indisponible. Votre saisie reste intacte ; merci de réessayer dans quelques instants.";
  }
  return null;
}

function getRetryAfterSeconds(input: unknown): number | null {
  if (!input || typeof input !== "object") return null;
  const value = Number((input as { retryAfterSeconds?: unknown }).retryAfterSeconds);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : null;
}

function resolveKnownErrorStatus(input: unknown, requestedStatus: number): number {
  const code = getStructuredErrorCode(input);
  if ([
    "ai_gateway_account_limit_reached",
    "ai_operation_budget_exceeded",
    "ai_gateway_rate_limit",
  ].includes(code)) {
    return 429;
  }
  if (code === "ai_gateway_auth") return 503;
  if (code === "ai_gateway_unavailable") return 503;
  if (code === "ai_gateway_request_failed") return 503;
  if (code === "ai_gateway_invalid_request") return 502;
  if (code === "ai_gateway_guard_unavailable") return 503;
  if (code === "ai_gateway_transcription_unavailable") return 503;
  if (code === "ai_gateway_transcription_protocol_unsupported") return 503;
  if (code === "ai_operation_deadline_exceeded" || code === "fetch_timeout") return 504;
  return requestedStatus;
}

export function buildUserFacingErrorBody(input: unknown, options: ErrorResponseOptions = {}) {
  const status = resolveKnownErrorStatus(input, options.status ?? 500);
  const structuredCode = getStructuredErrorCode(input);
  const userMessage =
    getKnownStructuredErrorMessage(structuredCode) ||
    getSimpleFrenchErrorMessage(input, fallbackForStatus(status, options.fallback));

  return {
    error: userMessage,
    user_message: userMessage,
    error_code: structuredCode || options.code || `http_${status}`,
    ...(options.extra ?? {}),
  };
}

export function jsonUserFacingError(input: unknown, options: ErrorResponseOptions = {}) {
  const status = resolveKnownErrorStatus(input, options.status ?? 500);
  const retryAfter = getRetryAfterSeconds(input);
  return NextResponse.json(buildUserFacingErrorBody(input, { ...options, status }), {
    status,
    headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
  });
}

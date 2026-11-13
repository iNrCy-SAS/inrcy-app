import { normalizeAppLanguage } from "./appLanguage";
import type { AiMediaPublicErrorCode } from "./aiMediaGenerationPublicErrors";
import { AI_MEDIA_PUBLIC_ERROR_COPY } from "./aiMediaGenerationPublicErrorCopy";
import { getClientErrorLanguage, getLocalizedErrorMessage } from "./userFacingErrors";

function publicCode(input: unknown, depth = 0): AiMediaPublicErrorCode | null {
  if (typeof input === "string") {
    const code = input.trim().toUpperCase();
    return Object.hasOwn(AI_MEDIA_PUBLIC_ERROR_COPY.fr, code) ? code as AiMediaPublicErrorCode : null;
  }
  if (!input || typeof input !== "object" || depth >= 3) return null;
  const value = input as Record<string, unknown>;
  for (const field of ["code", "error_code", "errorCode", "error", "message"]) {
    const code = publicCode(value[field], depth + 1);
    if (code) return code;
  }
  return null;
}

/** Allowlisted explanations keep their exact advice; unknown diagnostics use a safe fallback. */
export function getLocalizedAiMediaGenerationErrorMessage(input: unknown, language: unknown, fallback?: string): string {
  const locale = normalizeAppLanguage(language);
  const code = publicCode(input);
  if (code) {
    const message = AI_MEDIA_PUBLIC_ERROR_COPY[locale][code];
    if (message) return message;
  }
  return getLocalizedErrorMessage(input, locale, fallback, { allowUnknownMessage: false });
}

export function getClientAiMediaGenerationErrorMessage(input: unknown, fallback?: string): string {
  return getLocalizedAiMediaGenerationErrorMessage(input, getClientErrorLanguage(), fallback);
}

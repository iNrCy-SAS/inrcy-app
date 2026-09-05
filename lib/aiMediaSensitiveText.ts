const REDACTION = "[media-reference-redacted]";

function stringifySafely(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return "provider_error";
  }
}

/**
 * Retire les data URLs et les séquences base64 suffisamment longues pour
 * contenir un fichier. Cette fonction doit être appliquée avant tout log,
 * warning fournisseur ou message d’échec persistant.
 */
export function redactAiMediaSensitiveText(
  value: unknown,
  maxLength = 1_000,
) {
  const limit = Math.max(1, Math.min(4_000, Math.floor(maxLength)));
  return stringifySafely(value)
    .replace(
      /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi,
      REDACTION,
    )
    .replace(
      /((?:"|')?(?:data|base64|image_?bytes|imageBytes)(?:"|')?\s*[:=]\s*(?:"|'))([a-z0-9+/=\s]{64,})((?:"|'))/gi,
      `$1${REDACTION}$3`,
    )
    .replace(
      /(^|[^a-z0-9+/])((?:[a-z0-9+/]{4}){24,}(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?)(?=$|[^a-z0-9+/=])/gi,
      `$1${REDACTION}`,
    )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function safeAiMediaErrorMessage(error: unknown, maxLength = 1_000) {
  return redactAiMediaSensitiveText(
    error instanceof Error ? error.message : String(error || ""),
    maxLength,
  );
}

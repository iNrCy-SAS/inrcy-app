const REDACTION = "[media-reference-redacted]";

function stringifySafely(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? "";
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
      /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi,
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
    .replace(/([?&](?:token|key|api_key|access_token|signature|x-amz-signature|x-goog-signature)=)[^\s"'&]+/gi, "$1[redacted]")
    .replace(/(\bBearer\s+)[a-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function safeAiMediaErrorMessage(error: unknown, maxLength = 1_000) {
  const message = redactAiMediaSensitiveText(
    error instanceof Error ? error.message : String(error || ""),
    maxLength,
  );
  if (message) return message;
  const name = error instanceof Error ? error.name : "";
  return redactAiMediaSensitiveText(
    name && name !== "Error" ? name : "ai_media_unknown_error",
    maxLength,
  );
}

/** Log only selected diagnostic fields, never provider payloads or stacks. */
export function safeAiMediaErrorDetails(error: unknown) {
  const causes: Array<{ name: string; message: string; code?: string }> = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current) && causes.length < 4) {
    seen.add(current);
    const record = current instanceof Error
      ? current as Error & { code?: unknown; cause?: unknown }
      : null;
    const code = record && (typeof record.code === "string" || typeof record.code === "number")
      ? redactAiMediaSensitiveText(record.code, 120)
      : undefined;
    causes.push({
      name: redactAiMediaSensitiveText(record?.name || "UnknownError", 80),
      message: safeAiMediaErrorMessage(current, 600),
      ...(code ? { code } : {}),
    });
    current = record?.cause;
  }
  return causes;
}

type JsonRecord = Record<string, unknown>;

export class GoogleAdsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleAdsApiError";
    this.status = status;
  }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

/** Google Ads puts actionable validation errors in error.details, not error.message. */
export function googleAdsApiErrorMessage(payload: JsonRecord, fallback: string): string {
  const top = record(payload.error);
  const details = Array.isArray(top.details) ? top.details : [];
  for (const detailValue of details) {
    const detail = record(detailValue);
    const errors = Array.isArray(detail.errors) ? detail.errors : [];
    if (!errors.length) continue;
    const first = record(errors[0]);
    const code = Object.entries(record(first.errorCode))
      .filter(([, value]) => typeof value === "string")
      .map(([kind, value]) => `${kind}.${value}`)[0] || "";
    const location = record(first.location);
    const path = (Array.isArray(location.fieldPathElements) ? location.fieldPathElements : [])
      .map((partValue) => {
        const part = record(partValue);
        const field = String(part.fieldName || "");
        return /^[a-zA-Z_]+$/.test(field)
          ? `${field}${Number.isInteger(part.index) ? `[${part.index}]` : ""}` : "";
      })
      .filter(Boolean).join(".");
    const requestId = typeof detail.requestId === "string" && /^[\w-]{8,64}$/.test(detail.requestId)
      ? detail.requestId : "";
    const message = typeof first.message === "string" ? first.message : "";
    // Never include triggers: they can contain account data or user copy.
    return [message || fallback, code && `Code : ${code}`, path && `Champ : ${path}`,
      requestId && `Requête Google : ${requestId}`].filter(Boolean).join(" · ").slice(0, 500);
  }
  return String(top.message || payload.message || fallback).slice(0, 300);
}

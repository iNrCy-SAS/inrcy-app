export const DEFAULT_VEO_MODEL = "veo-3.1-fast-generate-preview";
export const DEFAULT_VEO_FALLBACK_MODELS = Object.freeze([
  "veo-3.1-lite-generate-preview",
]);

export type VeoInspirationMode = "references" | "source" | "none";

export type VeoFailureKind =
  | "cancelled"
  | "invalid_argument"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "safety"
  | "authentication"
  | "permission"
  | "not_found"
  | "network"
  | "unknown";

export type VeoFailureClassification = {
  kind: VeoFailureKind;
  status: number;
  details: string;
  retryable: boolean;
  modelFallbackEligible: boolean;
};

const ACTIVE_VEO_MODELS = new Set([
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
]);
const RETIRED_MODEL_PATTERN = /^veo-(?:2(?:\.0)?|3\.0)-/i;

function compact(value: unknown, max = 4_000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function errorDetails(error: unknown) {
  const values: string[] = [];
  const visited = new Set<object>();

  const visit = (value: unknown, depth: number) => {
    if (value === null || value === undefined || depth > 5) return;
    if (typeof value === "string" || typeof value === "number") {
      values.push(String(value));
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    const record = value as Record<string, unknown>;
    for (const key of [
      "name",
      "message",
      "status",
      "statusText",
      "code",
      "reason",
      "details",
      "error",
      "cause",
      "response",
      "data",
    ]) {
      if (key in record) visit(record[key], depth + 1);
    }
    if (depth === 0) {
      try {
        values.push(JSON.stringify(value));
      } catch {
        // The explicitly visited fields above are sufficient for cyclic errors.
      }
    }
  };

  visit(error, 0);
  return compact(values.join(" | ") || error);
}

function statusFromDetails(details: string) {
  const match = details.match(
    /(?:status|statusCode|http(?:Status)?|code)[^0-9]{0,12}(400|401|403|404|408|409|422|429|500|502|503|504)\b/i,
  ) || details.match(/\b(400|401|403|404|408|409|422|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : 0;
}

export function isValidVeoModelId(value: unknown) {
  const model = compact(value, 120).toLocaleLowerCase();
  return ACTIVE_VEO_MODELS.has(model) && !RETIRED_MODEL_PATTERN.test(model);
}

/**
 * Resolve a deterministic model chain. A stale/unknown primary override is
 * replaced by the active default instead of taking the whole video service
 * down. An explicitly empty fallback setting disables model fallback; an
 * absent setting keeps the safe versioned default.
 */
export function resolveVeoModelCandidates(args: {
  primary?: unknown;
  fallbacks?: unknown;
}) {
  const configuredPrimary = compact(args.primary, 120);
  const primary = isValidVeoModelId(configuredPrimary)
    ? configuredPrimary.toLocaleLowerCase()
    : DEFAULT_VEO_MODEL;

  const rawFallbacks =
    args.fallbacks === undefined
      ? DEFAULT_VEO_FALLBACK_MODELS.join(",")
      : compact(args.fallbacks, 600);
  const candidates = [
    primary,
    ...rawFallbacks
      .split(",")
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(isValidVeoModelId),
  ];
  return Array.from(new Set(candidates));
}

export function supportsVeoReferenceImages(model: string) {
  const normalized = compact(model, 120).toLocaleLowerCase();
  return (
    normalized === "veo-3.1-generate-preview" ||
    normalized === "veo-3.1-fast-generate-preview"
  );
}

/** Google only accepts referenceImages on the full/Fast Veo 3.1 models at 8s. */
export function selectVeoInspirationMode(args: {
  model: string;
  durationSeconds: 4 | 6 | 8;
  imageCount: number;
}): VeoInspirationMode {
  if (args.imageCount <= 0) return "none";
  if (
    args.imageCount > 1 &&
    args.durationSeconds === 8 &&
    supportsVeoReferenceImages(args.model)
  ) {
    return "references";
  }
  return "source";
}

export function nextVeoInspirationMode(
  mode: VeoInspirationMode,
): VeoInspirationMode | null {
  if (mode === "references") return "source";
  if (mode === "source") return "none";
  return null;
}

export function classifyVeoFailure(error: unknown): VeoFailureClassification {
  const details = errorDetails(error);
  const normalized = details.toLocaleLowerCase();
  const status = statusFromDetails(details);

  let kind: VeoFailureKind = "unknown";
  if (
    /aborterror|ai_media_generation_cancelled|the operation was aborted|user.?cancel/.test(
      normalized,
    )
  ) {
    kind = "cancelled";
  } else if (
    /ai_video_veo_safety_filtered|rai_media|responsible ai|safety filter|blockedreason|content policy|prohibited content/.test(
      normalized,
    )
  ) {
    kind = "safety";
  } else if (
    status === 401 ||
    /ai_video_veo_credentials_rejected|unauthenticated|invalid api key|api key not valid|api key was reported as leaked/.test(
      normalized,
    )
  ) {
    kind = "authentication";
  } else if (
    status === 403 ||
    /ai_video_veo_permission_denied|permission_denied|permission denied/.test(
      normalized,
    )
  ) {
    kind = "permission";
  } else if (
    status === 429 ||
    /ai_video_veo_rate_limited|resource_exhausted|rate.?limit|too many requests/.test(
      normalized,
    )
  ) {
    kind = "rate_limited";
  } else if (
    status === 408 ||
    status === 504 ||
    /deadline_exceeded|timed out|timeout/.test(normalized)
  ) {
    kind = "timeout";
  } else if (
    status === 404 ||
    /ai_video_veo_model_unavailable|not_found|not found|model.+(?:does not exist|is not available)/.test(
      normalized,
    )
  ) {
    kind = "not_found";
  } else if (
    status === 400 ||
    status === 422 ||
    /ai_video_veo_configuration_rejected|invalid_argument|bad request|unsupported parameter|not supported/.test(
      normalized,
    )
  ) {
    kind = "invalid_argument";
  } else if (
    [500, 502, 503].includes(status) ||
    /ai_video_veo_unavailable|\bunavailable\b|internal_server_error|internal error|bad gateway|backend error|service unavailable/.test(
      normalized,
    )
  ) {
    kind = "unavailable";
  } else if (
    /ai_video_veo_network_failed|fetch failed|network error|econnreset|econnrefused|enotfound|socket hang up|connection reset|connection closed/.test(
      normalized,
    )
  ) {
    kind = "network";
  }

  const retryable = ["rate_limited", "unavailable", "timeout", "network"].includes(
    kind,
  );
  const modelFallbackEligible = [
    "invalid_argument",
    "rate_limited",
    "unavailable",
    "safety",
    "not_found",
    "network",
  ].includes(kind);

  return { kind, status, details, retryable, modelFallbackEligible };
}

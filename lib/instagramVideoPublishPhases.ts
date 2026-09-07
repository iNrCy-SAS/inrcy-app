import { createHash } from "crypto";

import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { isMetaAuthorizationError } from "@/lib/metaGraphErrorClassification";

const INSTAGRAM_VIDEO_CHECKPOINT_VERSION = 3 as const;
const INSTAGRAM_VIDEO_DEFAULT_RETRY_AFTER_MS = 3_000;
// Status reads are cheap and safe to retry. Container creation and publication
// are mutations: Meta can legitimately need longer to acknowledge them and an
// early client timeout leaves their result ambiguous (and unsafe to replay).
const INSTAGRAM_VIDEO_STATUS_HTTP_TIMEOUT_MS = 15_000;
const INSTAGRAM_VIDEO_MUTATION_HTTP_TIMEOUT_MS = 45_000;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type InstagramVideoTokenCandidate = {
  source: string;
  accessToken: string;
};

export type InstagramVideoCheckpointState =
  | "created"
  | "processing"
  | "ready"
  | "published"
  | "failed"
  | "publish_unknown";

export type InstagramVideoMediaType = "REELS" | "STORIES";

export type InstagramVideoPublishCheckpoint = {
  version: 1 | 2 | typeof INSTAGRAM_VIDEO_CHECKPOINT_VERSION;
  containerId: string;
  igUserId: string;
  requestFingerprint: string;
  state: InstagramVideoCheckpointState;
  createdAt: string;
  updatedAt: string;
  pollCount: number;
  lastStatusCode: string | null;
  lastStatus: string | null;
  mediaId: string | null;
  tokenSource: string | null;
  mediaType: InstagramVideoMediaType;
};

export type InstagramVideoPhaseDependencies = {
  fetchImpl?: FetchLike;
  now?: () => Date;
};

type InstagramVideoPhaseDiagnostics = {
  httpStatus?: number;
  response?: unknown;
  attempts?: Array<{
    source: string;
    ok: boolean;
    outcome: InstagramVideoPhaseResult["outcome"];
    authorizationError: boolean;
  }>;
};

type InstagramVideoPhaseFailure = {
  ok: false;
  phase: "create" | "poll" | "publish";
  outcome: "retryable" | "failed" | "ambiguous";
  error: string;
  code: string;
  retryable: boolean;
  requestMayHaveSucceeded: boolean;
  authorizationError: boolean;
  retryAfterMs?: number;
  checkpoint?: InstagramVideoPublishCheckpoint;
  diagnostics?: InstagramVideoPhaseDiagnostics;
};

type InstagramVideoCreateSuccess = {
  ok: true;
  phase: "create";
  outcome: "checkpoint";
  checkpoint: InstagramVideoPublishCheckpoint;
  diagnostics?: InstagramVideoPhaseDiagnostics;
};

type InstagramVideoPollSuccess = {
  ok: true;
  phase: "poll";
  outcome: "processing" | "ready" | "published";
  checkpoint: InstagramVideoPublishCheckpoint;
  retryAfterMs?: number;
  mediaId?: string;
  diagnostics?: InstagramVideoPhaseDiagnostics;
};

type InstagramVideoPublishSuccess = {
  ok: true;
  phase: "publish";
  outcome: "published";
  checkpoint: InstagramVideoPublishCheckpoint;
  mediaId: string;
  mediaType: InstagramVideoMediaType;
  diagnostics?: InstagramVideoPhaseDiagnostics;
};

export type InstagramVideoPhaseResult =
  | InstagramVideoPhaseFailure
  | InstagramVideoCreateSuccess
  | InstagramVideoPollSuccess
  | InstagramVideoPublishSuccess;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function normalizeInstagramVideoMediaType(
  value: unknown,
): InstagramVideoMediaType {
  return cleanString(value).toUpperCase() === "STORIES" ? "STORIES" : "REELS";
}

function nowIso(dependencies: InstagramVideoPhaseDependencies) {
  return (dependencies.now?.() || new Date()).toISOString();
}

function isCheckpointState(value: string): value is InstagramVideoCheckpointState {
  return [
    "created",
    "processing",
    "ready",
    "published",
    "failed",
    "publish_unknown",
  ].includes(value);
}

export function parseInstagramVideoPublishCheckpoint(
  value: unknown,
): InstagramVideoPublishCheckpoint | null {
  const record = asRecord(value);
  const version = Number(record.version);
  const containerId = cleanString(record.containerId);
  const igUserId = cleanString(record.igUserId);
  const requestFingerprint = cleanString(record.requestFingerprint).toLowerCase();
  const state = cleanString(record.state);
  const createdAt = cleanString(record.createdAt);
  const updatedAt = cleanString(record.updatedAt);
  const pollCount = Number(record.pollCount);
  const mediaId = cleanString(record.mediaId) || null;
  const tokenSource = cleanString(record.tokenSource) || null;
  const mediaType = normalizeInstagramVideoMediaType(record.mediaType);

  if (
    (version !== 1 && version !== 2 && version !== INSTAGRAM_VIDEO_CHECKPOINT_VERSION) ||
    !containerId ||
    !igUserId ||
    !/^[a-f0-9]{64}$/.test(requestFingerprint) ||
    !isCheckpointState(state) ||
    !createdAt ||
    !updatedAt ||
    !Number.isSafeInteger(pollCount) ||
    pollCount < 0 ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    (state === "published" && !mediaId) ||
    (version === INSTAGRAM_VIDEO_CHECKPOINT_VERSION &&
      !["REELS", "STORIES"].includes(cleanString(record.mediaType).toUpperCase()))
  ) {
    return null;
  }

  return {
    version: version as InstagramVideoPublishCheckpoint["version"],
    containerId,
    igUserId,
    requestFingerprint,
    state,
    createdAt,
    updatedAt,
    pollCount,
    lastStatusCode: cleanString(record.lastStatusCode) || null,
    lastStatus: cleanString(record.lastStatus) || null,
    mediaId,
    tokenSource,
    mediaType,
  };
}

function canonicalizeVideoUrlIdentity(value: unknown) {
  const rawUrl = cleanString(value);
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Returns the durable identity of the bytes sent to Instagram.
 *
 * Supabase signed URLs are delivery credentials and can change between two
 * serverless invocations. A storage reference is therefore authoritative when
 * available. URL identity is only a compatibility fallback for remote media
 * that has no durable storage reference.
 */
export function buildInstagramVideoSourceIdentity(params: {
  bucket?: string | null;
  storagePath?: string | null;
  videoUrl?: string | null;
}) {
  const storagePath = cleanString(params.storagePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (storagePath) {
    const bucket = cleanString(params.bucket) || "booster";
    return `storage:${JSON.stringify([bucket, storagePath])}`;
  }

  const videoUrl = canonicalizeVideoUrlIdentity(params.videoUrl);
  return videoUrl ? `url:${videoUrl}` : "";
}

export function buildInstagramVideoRequestFingerprint(params: {
  igUserId: string;
  videoUrl: string;
  videoSourceIdentity?: string;
  caption: string;
  shareToFeed?: boolean;
  mediaType?: InstagramVideoMediaType;
}) {
  const videoSourceIdentity = cleanString(params.videoSourceIdentity);
  const mediaType = normalizeInstagramVideoMediaType(params.mediaType);
  const mediaTypeIdentity =
    mediaType === "STORIES" ? { mediaType: "STORIES" as const } : {};
  const canonicalRequest = JSON.stringify(
    videoSourceIdentity
      ? {
          igUserId: cleanString(params.igUserId),
          videoSourceIdentity,
          caption: String(params.caption || ""),
          shareToFeed: params.shareToFeed !== false,
          ...mediaTypeIdentity,
        }
      : {
          // Preserve the exact v1 canonical request for rolling compatibility.
          igUserId: cleanString(params.igUserId),
          videoUrl: cleanString(params.videoUrl),
          caption: String(params.caption || ""),
          shareToFeed: params.shareToFeed !== false,
          ...mediaTypeIdentity,
        },
  );
  return createHash("sha256").update(canonicalRequest).digest("hex");
}

function normalizeTokenCandidates(
  accessToken: string,
  tokenCandidates?: InstagramVideoTokenCandidate[],
) {
  const candidates: InstagramVideoTokenCandidate[] = [];
  const seen = new Set<string>();
  const push = (source: string, token: string) => {
    const cleanToken = cleanString(token);
    if (!cleanToken || seen.has(cleanToken)) return;
    seen.add(cleanToken);
    candidates.push({
      source: cleanString(source) || `token_${candidates.length + 1}`,
      accessToken: cleanToken,
    });
  };
  push("primary", accessToken);
  for (const candidate of tokenCandidates || []) {
    push(candidate.source, candidate.accessToken);
  }
  return candidates;
}

async function readJson(response: Response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function graphErrorMessage(value: unknown, fallback: string) {
  const error = asRecord(asRecord(value).error);
  return cleanString(error.message) || fallback;
}

function isAuthorizationFailure(value: unknown, httpStatus?: number) {
  const error = asRecord(asRecord(value).error);
  return isMetaAuthorizationError({
    message: error.message,
    type: error.type,
    code: error.code,
    subcode: error.error_subcode,
    httpStatus,
  });
}

function isTransientHttpStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response) {
  const raw = cleanString(response.headers.get("retry-after"));
  if (!raw) return INSTAGRAM_VIDEO_DEFAULT_RETRY_AFTER_MS;
  if (/^\d+$/.test(raw)) {
    return Math.max(1_000, Math.min(60_000, Number(raw) * 1_000));
  }
  const target = Date.parse(raw);
  if (!Number.isFinite(target)) return INSTAGRAM_VIDEO_DEFAULT_RETRY_AFTER_MS;
  return Math.max(1_000, Math.min(60_000, target - Date.now()));
}

function invalidCheckpointResult(
  phase: "poll" | "publish",
): InstagramVideoPhaseFailure {
  return {
    ok: false,
    phase,
    outcome: "failed",
    error: "Le checkpoint Instagram vid\u00e9o est invalide.",
    code: "instagram_video_checkpoint_invalid",
    retryable: false,
    requestMayHaveSucceeded: false,
    authorizationError: false,
  };
}

function withUpdatedCheckpoint(
  checkpoint: InstagramVideoPublishCheckpoint,
  dependencies: InstagramVideoPhaseDependencies,
  patch: Partial<InstagramVideoPublishCheckpoint>,
) {
  return {
    ...checkpoint,
    ...patch,
    updatedAt: nowIso(dependencies),
  } satisfies InstagramVideoPublishCheckpoint;
}

function withAttemptDiagnostics<T extends InstagramVideoPhaseResult>(
  result: T,
  attempts: NonNullable<InstagramVideoPhaseDiagnostics["attempts"]>,
): T {
  return {
    ...result,
    diagnostics: {
      ...(result.diagnostics || {}),
      attempts,
    },
  };
}

function validateExpectedFingerprint(
  checkpoint: InstagramVideoPublishCheckpoint,
  expectedRequestFingerprint?: string,
  compatibleRequestFingerprints?: string[],
) {
  const expected = cleanString(expectedRequestFingerprint).toLowerCase();
  const compatible = (compatibleRequestFingerprints || [])
    .map((candidate) => cleanString(candidate).toLowerCase())
    .filter((candidate) => /^[a-f0-9]{64}$/.test(candidate));
  if (!expected && compatible.length === 0) return true;
  if (expected === checkpoint.requestFingerprint) return true;

  // A durable-source checkpoint (v2+) must only match its durable-source fingerprint. A v1
  // checkpoint may additionally match the exact historical URL fingerprint,
  // which keeps stable public-URL jobs resumable during a rolling deployment.
  return (
    checkpoint.version === 1 &&
    compatible.includes(checkpoint.requestFingerprint)
  );
}

export async function instagramCreateVideoCheckpoint(
  params: {
    igUserId: string;
    accessToken: string;
    caption: string;
    videoUrl: string;
    videoSourceIdentity?: string;
    shareToFeed?: boolean;
    mediaType?: InstagramVideoMediaType;
    tokenSource?: string;
  },
  dependencies: InstagramVideoPhaseDependencies = {},
): Promise<InstagramVideoPhaseResult> {
  const igUserId = cleanString(params.igUserId);
  const accessToken = cleanString(params.accessToken);
  const videoUrl = cleanString(params.videoUrl);
  if (!igUserId || !accessToken || !videoUrl) {
    return {
      ok: false,
      phase: "create",
      outcome: "failed",
      error: "Informations Instagram vid\u00e9o incompl\u00e8tes.",
      code: "instagram_video_create_invalid_input",
      retryable: false,
      requestMayHaveSucceeded: false,
      authorizationError: !accessToken,
    };
  }
  const videoSourceIdentity =
    cleanString(params.videoSourceIdentity) ||
    buildInstagramVideoSourceIdentity({ videoUrl });
  const mediaType = normalizeInstagramVideoMediaType(params.mediaType);

  const createParams = new URLSearchParams({
    media_type: mediaType,
    video_url: videoUrl,
    access_token: accessToken,
  });
  if (mediaType === "REELS") {
    createParams.set(
      "share_to_feed",
      params.shareToFeed === false ? "false" : "true",
    );
  }
  if (params.caption) createParams.set("caption", params.caption);
  const createUrl = `${buildMetaGraphUrl(`${encodeURIComponent(igUserId)}/media`)}?${createParams.toString()}`;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(createUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(INSTAGRAM_VIDEO_MUTATION_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      phase: "create",
      outcome: "ambiguous",
      error:
        error instanceof Error
          ? error.message
          : "La cr\u00e9ation du container Instagram a \u00e9t\u00e9 interrompue.",
      code: "instagram_video_create_ambiguous",
      retryable: false,
      requestMayHaveSucceeded: true,
      authorizationError: false,
    };
  }

  const data = await readJson(response);
  const authorizationError = isAuthorizationFailure(data, response.status);
  if (!response.ok) {
    const ambiguous = isTransientHttpStatus(response.status);
    return {
      ok: false,
      phase: "create",
      outcome: ambiguous ? "ambiguous" : "failed",
      error: graphErrorMessage(
        data,
        "Impossible de cr\u00e9er le container vid\u00e9o Instagram.",
      ),
      code: ambiguous
        ? "instagram_video_create_ambiguous"
        : "instagram_video_create_rejected",
      retryable: false,
      requestMayHaveSucceeded: ambiguous,
      authorizationError,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }

  const containerId = cleanString(asRecord(data).id);
  if (!containerId) {
    return {
      ok: false,
      phase: "create",
      outcome: "ambiguous",
      error: "Instagram a accept\u00e9 la cr\u00e9ation sans renvoyer le containerId.",
      code: "instagram_video_create_missing_container_id",
      retryable: false,
      requestMayHaveSucceeded: true,
      authorizationError: false,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }

  const createdAt = nowIso(dependencies);
  const checkpoint: InstagramVideoPublishCheckpoint = {
    version: INSTAGRAM_VIDEO_CHECKPOINT_VERSION,
    containerId,
    igUserId,
    requestFingerprint: buildInstagramVideoRequestFingerprint({
      igUserId,
      videoUrl,
      videoSourceIdentity,
      caption: params.caption,
      shareToFeed: params.shareToFeed,
      mediaType,
    }),
    state: "created",
    createdAt,
    updatedAt: createdAt,
    pollCount: 0,
    lastStatusCode: null,
    lastStatus: null,
    mediaId: null,
    tokenSource: cleanString(params.tokenSource) || null,
    mediaType,
  };
  return {
    ok: true,
    phase: "create",
    outcome: "checkpoint",
    checkpoint,
    diagnostics: { httpStatus: response.status, response: data },
  };
}

export async function instagramCreateVideoCheckpointWithTokenFallback(
  params: {
    igUserId: string;
    accessToken: string;
    tokenCandidates?: InstagramVideoTokenCandidate[];
    caption: string;
    videoUrl: string;
    videoSourceIdentity?: string;
    shareToFeed?: boolean;
    mediaType?: InstagramVideoMediaType;
  },
  dependencies: InstagramVideoPhaseDependencies = {},
) {
  const candidates = normalizeTokenCandidates(
    params.accessToken,
    params.tokenCandidates,
  );
  const attempts: NonNullable<InstagramVideoPhaseDiagnostics["attempts"]> = [];
  let lastResult: InstagramVideoPhaseResult | null = null;
  for (const candidate of candidates) {
    const result = await instagramCreateVideoCheckpoint(
      { ...params, ...candidate, tokenSource: candidate.source },
      dependencies,
    );
    attempts.push({
      source: candidate.source,
      ok: result.ok,
      outcome: result.outcome,
      authorizationError: !result.ok && result.authorizationError,
    });
    const sourcedResult =
      result.ok && result.checkpoint
        ? ({
            ...result,
            checkpoint: {
              ...result.checkpoint,
              tokenSource: candidate.source,
            },
          } as InstagramVideoPhaseResult)
        : result;
    lastResult = sourcedResult;
    if (result.ok || !result.authorizationError || result.outcome !== "failed") {
      return withAttemptDiagnostics(sourcedResult, attempts);
    }
  }
  return withAttemptDiagnostics(
    lastResult || {
      ok: false,
      phase: "create",
      outcome: "failed",
      error: "La connexion Instagram a expir\u00e9.",
      code: "instagram_video_token_missing",
      retryable: false,
      requestMayHaveSucceeded: false,
      authorizationError: true,
    },
    attempts,
  );
}

export async function instagramPollVideoCheckpoint(
  params: {
    checkpoint: unknown;
    accessToken: string;
    expectedRequestFingerprint?: string;
    compatibleRequestFingerprints?: string[];
  },
  dependencies: InstagramVideoPhaseDependencies = {},
): Promise<InstagramVideoPhaseResult> {
  const checkpoint = parseInstagramVideoPublishCheckpoint(params.checkpoint);
  if (
    !checkpoint ||
    !validateExpectedFingerprint(
      checkpoint,
      params.expectedRequestFingerprint,
      params.compatibleRequestFingerprints,
    )
  ) {
    return invalidCheckpointResult("poll");
  }
  if (checkpoint.state === "published" && checkpoint.mediaId) {
    return {
      ok: true,
      phase: "poll",
      outcome: "published",
      checkpoint,
      mediaId: checkpoint.mediaId,
    };
  }
  if (checkpoint.state === "ready") {
    return { ok: true, phase: "poll", outcome: "ready", checkpoint };
  }
  if (checkpoint.state === "failed" || checkpoint.state === "publish_unknown") {
    return {
      ok: false,
      phase: "poll",
      outcome:
        checkpoint.state === "publish_unknown" ? "ambiguous" : "failed",
      error:
        checkpoint.state === "publish_unknown"
          ? "Le r\u00e9sultat de la publication Instagram est incertain."
          : "Le container Instagram est dans un \u00e9tat terminal.",
      code:
        checkpoint.state === "publish_unknown"
          ? "instagram_video_publish_unknown"
          : "instagram_video_container_terminal",
      retryable: false,
      requestMayHaveSucceeded: checkpoint.state === "publish_unknown",
      authorizationError: false,
      checkpoint,
    };
  }

  const accessToken = cleanString(params.accessToken);
  if (!accessToken) {
    return {
      ok: false,
      phase: "poll",
      outcome: "failed",
      error: "La connexion Instagram a expir\u00e9.",
      code: "instagram_video_poll_token_missing",
      retryable: false,
      requestMayHaveSucceeded: false,
      authorizationError: true,
      checkpoint,
    };
  }

  const query = new URLSearchParams({
    fields: "status,status_code",
    access_token: accessToken,
  });
  const url = `${buildMetaGraphUrl(encodeURIComponent(checkpoint.containerId))}?${query.toString()}`;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(INSTAGRAM_VIDEO_STATUS_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      phase: "poll",
      outcome: "retryable",
      error:
        error instanceof Error
          ? error.message
          : "Impossible de v\u00e9rifier le container Instagram.",
      code: "instagram_video_poll_interrupted",
      retryable: true,
      requestMayHaveSucceeded: false,
      authorizationError: false,
      retryAfterMs: INSTAGRAM_VIDEO_DEFAULT_RETRY_AFTER_MS,
      checkpoint,
    };
  }

  const data = await readJson(response);
  if (!response.ok) {
    const transient = isTransientHttpStatus(response.status);
    return {
      ok: false,
      phase: "poll",
      outcome: transient ? "retryable" : "failed",
      error: graphErrorMessage(
        data,
        "Impossible de v\u00e9rifier le container Instagram.",
      ),
      code: transient
        ? "instagram_video_poll_retryable"
        : "instagram_video_poll_rejected",
      retryable: transient,
      requestMayHaveSucceeded: false,
      authorizationError: isAuthorizationFailure(data, response.status),
      retryAfterMs: transient ? retryAfterMs(response) : undefined,
      checkpoint,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }

  const record = asRecord(data);
  const statusCode = cleanString(record.status_code).toUpperCase();
  const status = cleanString(record.status);
  const statusUpper = status.toUpperCase();
  const nextCheckpoint = withUpdatedCheckpoint(checkpoint, dependencies, {
    pollCount: checkpoint.pollCount + 1,
    lastStatusCode: statusCode || null,
    lastStatus: status || null,
  });

  if (statusCode === "FINISHED" || statusUpper.startsWith("FINISHED")) {
    const readyCheckpoint = withUpdatedCheckpoint(nextCheckpoint, dependencies, {
      state: "ready",
    });
    return {
      ok: true,
      phase: "poll",
      outcome: "ready",
      checkpoint: readyCheckpoint,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }
  if (statusCode === "PUBLISHED" || statusUpper.startsWith("PUBLISHED")) {
    const unknownCheckpoint = withUpdatedCheckpoint(
      nextCheckpoint,
      dependencies,
      { state: "publish_unknown" },
    );
    return {
      ok: false,
      phase: "poll",
      outcome: "ambiguous",
      error:
        "Instagram indique que le container est publi\u00e9 sans renvoyer le mediaId.",
      code: "instagram_video_published_media_id_unknown",
      retryable: false,
      requestMayHaveSucceeded: true,
      authorizationError: false,
      checkpoint: unknownCheckpoint,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }
  if (
    statusCode === "ERROR" ||
    statusCode === "EXPIRED" ||
    statusUpper.startsWith("ERROR") ||
    statusUpper.startsWith("EXPIRED") ||
    Object.keys(asRecord(record.error)).length > 0
  ) {
    const failedCheckpoint = withUpdatedCheckpoint(nextCheckpoint, dependencies, {
      state: "failed",
    });
    return {
      ok: false,
      phase: "poll",
      outcome: "failed",
      error: graphErrorMessage(
        data,
        statusCode === "EXPIRED"
          ? "Le container vid\u00e9o Instagram a expir\u00e9."
          : "Instagram n'a pas pu traiter la vid\u00e9o.",
      ),
      code:
        statusCode === "EXPIRED"
          ? "instagram_video_container_expired"
          : "instagram_video_container_failed",
      retryable: false,
      requestMayHaveSucceeded: false,
      authorizationError: false,
      checkpoint: failedCheckpoint,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }

  const processingCheckpoint = withUpdatedCheckpoint(
    nextCheckpoint,
    dependencies,
    { state: "processing" },
  );
  return {
    ok: true,
    phase: "poll",
    outcome: "processing",
    checkpoint: processingCheckpoint,
    retryAfterMs: retryAfterMs(response),
    diagnostics: { httpStatus: response.status, response: data },
  };
}

async function runCheckpointPhaseWithTokenFallback(
  phase: "poll" | "publish",
  params: {
    checkpoint: unknown;
    accessToken: string;
    tokenCandidates?: InstagramVideoTokenCandidate[];
    expectedRequestFingerprint?: string;
    compatibleRequestFingerprints?: string[];
    igUserId?: string;
  },
  dependencies: InstagramVideoPhaseDependencies,
) {
  const candidates = normalizeTokenCandidates(
    params.accessToken,
    params.tokenCandidates,
  );
  const attempts: NonNullable<InstagramVideoPhaseDiagnostics["attempts"]> = [];
  let lastResult: InstagramVideoPhaseResult | null = null;
  for (const candidate of candidates) {
    const result =
      phase === "poll"
        ? await instagramPollVideoCheckpoint(
            { ...params, accessToken: candidate.accessToken },
            dependencies,
          )
        : await instagramPublishVideoCheckpoint(
            {
              ...params,
              igUserId: cleanString(params.igUserId),
              accessToken: candidate.accessToken,
            },
            dependencies,
          );
    attempts.push({
      source: candidate.source,
      ok: result.ok,
      outcome: result.outcome,
      authorizationError: !result.ok && result.authorizationError,
    });
    const sourcedResult =
      result.ok && result.checkpoint
        ? ({
            ...result,
            checkpoint: {
              ...result.checkpoint,
              tokenSource: candidate.source,
            },
          } as InstagramVideoPhaseResult)
        : result;
    lastResult = sourcedResult;
    if (result.ok || !result.authorizationError || result.outcome !== "failed") {
      return withAttemptDiagnostics(sourcedResult, attempts);
    }
  }
  return withAttemptDiagnostics(
    lastResult || {
      ok: false,
      phase,
      outcome: "failed",
      error: "La connexion Instagram a expir\u00e9.",
      code: `instagram_video_${phase}_token_missing`,
      retryable: false,
      requestMayHaveSucceeded: false,
      authorizationError: true,
    },
    attempts,
  );
}

export function instagramPollVideoCheckpointWithTokenFallback(
  params: {
    checkpoint: unknown;
    accessToken: string;
    tokenCandidates?: InstagramVideoTokenCandidate[];
    expectedRequestFingerprint?: string;
    compatibleRequestFingerprints?: string[];
  },
  dependencies: InstagramVideoPhaseDependencies = {},
) {
  return runCheckpointPhaseWithTokenFallback("poll", params, dependencies);
}

export async function instagramPublishVideoCheckpoint(
  params: {
    checkpoint: unknown;
    igUserId: string;
    accessToken: string;
    expectedRequestFingerprint?: string;
    compatibleRequestFingerprints?: string[];
  },
  dependencies: InstagramVideoPhaseDependencies = {},
): Promise<InstagramVideoPhaseResult> {
  const checkpoint = parseInstagramVideoPublishCheckpoint(params.checkpoint);
  if (
    !checkpoint ||
    !validateExpectedFingerprint(
      checkpoint,
      params.expectedRequestFingerprint,
      params.compatibleRequestFingerprints,
    ) ||
    checkpoint.igUserId !== cleanString(params.igUserId)
  ) {
    return invalidCheckpointResult("publish");
  }
  if (checkpoint.state === "published" && checkpoint.mediaId) {
    return {
      ok: true,
      phase: "publish",
      outcome: "published",
      checkpoint,
      mediaId: checkpoint.mediaId,
      mediaType: checkpoint.mediaType,
    };
  }
  if (checkpoint.state === "publish_unknown") {
    return {
      ok: false,
      phase: "publish",
      outcome: "ambiguous",
      error: "Le r\u00e9sultat de la publication Instagram est incertain.",
      code: "instagram_video_publish_unknown",
      retryable: false,
      requestMayHaveSucceeded: true,
      authorizationError: false,
      checkpoint,
    };
  }
  if (checkpoint.state !== "ready") {
    return {
      ok: false,
      phase: "publish",
      outcome: checkpoint.state === "failed" ? "failed" : "retryable",
      error: "Le container vid\u00e9o Instagram n'est pas encore pr\u00eat.",
      code: "instagram_video_container_not_ready",
      retryable: checkpoint.state !== "failed",
      requestMayHaveSucceeded: false,
      authorizationError: false,
      retryAfterMs:
        checkpoint.state === "failed"
          ? undefined
          : INSTAGRAM_VIDEO_DEFAULT_RETRY_AFTER_MS,
      checkpoint,
    };
  }

  const accessToken = cleanString(params.accessToken);
  if (!accessToken) {
    return {
      ok: false,
      phase: "publish",
      outcome: "failed",
      error: "La connexion Instagram a expir\u00e9.",
      code: "instagram_video_publish_token_missing",
      retryable: false,
      requestMayHaveSucceeded: false,
      authorizationError: true,
      checkpoint,
    };
  }
  const publishParams = new URLSearchParams({
    creation_id: checkpoint.containerId,
    access_token: accessToken,
  });
  const publishUrl = `${buildMetaGraphUrl(`${encodeURIComponent(checkpoint.igUserId)}/media_publish`)}?${publishParams.toString()}`;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(publishUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(INSTAGRAM_VIDEO_MUTATION_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    const unknownCheckpoint = withUpdatedCheckpoint(checkpoint, dependencies, {
      state: "publish_unknown",
    });
    return {
      ok: false,
      phase: "publish",
      outcome: "ambiguous",
      error:
        error instanceof Error
          ? error.message
          : "La r\u00e9ponse Instagram a \u00e9t\u00e9 interrompue apr\u00e8s publication.",
      code: "instagram_video_publish_ambiguous",
      retryable: false,
      requestMayHaveSucceeded: true,
      authorizationError: false,
      checkpoint: unknownCheckpoint,
    };
  }

  const data = await readJson(response);
  if (!response.ok) {
    const ambiguous = isTransientHttpStatus(response.status);
    const resultCheckpoint = ambiguous
      ? withUpdatedCheckpoint(checkpoint, dependencies, {
          state: "publish_unknown",
        })
      : checkpoint;
    return {
      ok: false,
      phase: "publish",
      outcome: ambiguous ? "ambiguous" : "failed",
      error: graphErrorMessage(
        data,
        "Impossible de publier la vid\u00e9o Instagram.",
      ),
      code: ambiguous
        ? "instagram_video_publish_ambiguous"
        : "instagram_video_publish_rejected",
      retryable: false,
      requestMayHaveSucceeded: ambiguous,
      authorizationError: isAuthorizationFailure(data, response.status),
      checkpoint: resultCheckpoint,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }

  const mediaId = cleanString(asRecord(data).id);
  if (!mediaId) {
    const unknownCheckpoint = withUpdatedCheckpoint(checkpoint, dependencies, {
      state: "publish_unknown",
    });
    return {
      ok: false,
      phase: "publish",
      outcome: "ambiguous",
      error: "Instagram a publi\u00e9 sans renvoyer le mediaId.",
      code: "instagram_video_publish_missing_media_id",
      retryable: false,
      requestMayHaveSucceeded: true,
      authorizationError: false,
      checkpoint: unknownCheckpoint,
      diagnostics: { httpStatus: response.status, response: data },
    };
  }

  const publishedCheckpoint = withUpdatedCheckpoint(checkpoint, dependencies, {
    state: "published",
    mediaId,
  });
  return {
    ok: true,
    phase: "publish",
    outcome: "published",
    checkpoint: publishedCheckpoint,
    mediaId,
    mediaType: checkpoint.mediaType,
    diagnostics: { httpStatus: response.status, response: data },
  };
}

export function instagramPublishVideoCheckpointWithTokenFallback(
  params: {
    checkpoint: unknown;
    igUserId: string;
    accessToken: string;
    tokenCandidates?: InstagramVideoTokenCandidate[];
    expectedRequestFingerprint?: string;
    compatibleRequestFingerprints?: string[];
  },
  dependencies: InstagramVideoPhaseDependencies = {},
) {
  return runCheckpointPhaseWithTokenFallback("publish", params, dependencies);
}

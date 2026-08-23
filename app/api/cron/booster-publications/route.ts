import { NextResponse, after } from "next/server";
import {
  buildInternalCronHeaders,
  getAppOriginFromRequest,
  isAuthorizedCronRequest,
} from "@/lib/cronAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  acquireAsyncPublicationPreparationLease,
  BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
  BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS,
  BOOSTER_ASYNC_JOB_EVENT_TYPE,
  BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS,
  BOOSTER_ASYNC_PREPARATION_MAX_ATTEMPTS,
  completeAsyncPublicationPreparationLease,
  failPreparingAsyncPublicationChannels,
  finalizeAsyncPublicationIfReady,
  updateAsyncChannelEvent,
  updateAsyncPublicationJobEvent,
} from "@/lib/boosterAsyncPublication";
import { getBoosterCronSweepPlan } from "@/lib/boosterCronScheduling";

export const runtime = "nodejs";
export const maxDuration = 60;

type JsonRecord = Record<string, unknown>;
type AsyncEventRow = {
  id: string;
  user_id: string;
  payload: unknown;
  created_at?: string | null;
};
type AsyncEventCandidateRow = {
  id: string;
  user_id: string;
  created_at?: string | null;
  candidate_status?: unknown;
  candidate_updated_at?: unknown;
};
type AsyncChannelCandidateRow = AsyncEventCandidateRow & {
  candidate_channel?: unknown;
  candidate_instagram_checkpoint?: unknown;
  candidate_instagram_next_poll_at?: unknown;
  candidate_instagram_rate_limit_next_run_at?: unknown;
  candidate_youtube_checkpoint?: unknown;
  candidate_youtube_next_run_at?: unknown;
  candidate_pinterest_checkpoint?: unknown;
  candidate_pinterest_next_poll_at?: unknown;
};
type AsyncDispatchJob = {
  id: string;
  userId: string;
  status: string;
  channel: string;
  publicationId: string;
  dispatchRequest: JsonRecord;
  lastActivityAt: number;
  attempt: number;
  instagramVideoContinuation: boolean;
  instagramContinuationAttempt: number;
  instagramVideoNextPollAt: number;
  youtubeUploadContinuation: boolean;
  youtubeContinuationAttempt: number;
  youtubeUploadNextRunAt: number;
  pinterestVideoContinuation: boolean;
  pinterestContinuationAttempt: number;
  pinterestVideoNextPollAt: number;
  pinterestVideoTerminal: boolean;
};
type AsyncPreparationJob = {
  id: string;
  userId: string;
  status: string;
  preparationRequest: JsonRecord;
  channelEventIds: string[];
  lastActivityAt: number;
  attempt: number;
  lastPreparationError: string;
};

const PROCESSING_RECOVERY_GRACE_MS = 30 * 1000;
const MAX_ASYNC_DISPATCH_ATTEMPTS = 3;
const MAX_INSTAGRAM_VIDEO_CONTINUATION_ATTEMPTS = 480;
const MAX_YOUTUBE_UPLOAD_CONTINUATION_ATTEMPTS = 128;
const MAX_PINTEREST_VIDEO_CONTINUATION_ATTEMPTS = 480;
const ASYNC_CHANNEL_CANDIDATE_LIMIT = 50;
const ASYNC_PREPARATION_CANDIDATE_LIMIT = 25;
const ASYNC_FINALIZATION_CANDIDATE_LIMIT = 25;
const ASYNC_CHANNEL_EXACT_LOAD_LIMIT = ASYNC_CHANNEL_CANDIDATE_LIMIT * 2;
const ASYNC_PREPARATION_EXACT_LOAD_LIMIT =
  ASYNC_PREPARATION_CANDIDATE_LIMIT * 2;
const ASYNC_EVENT_CANDIDATE_COLUMNS = [
  "id",
  "user_id",
  "created_at",
  "candidate_status:payload->>status",
  "candidate_updated_at:payload->>updatedAt",
].join(",");
const ASYNC_CHANNEL_CANDIDATE_COLUMNS = [
  ASYNC_EVENT_CANDIDATE_COLUMNS,
  "candidate_channel:payload->>channel",
  "candidate_instagram_checkpoint:payload->instagramVideoCheckpoint",
  "candidate_instagram_next_poll_at:payload->>instagramVideoNextPollAt",
  "candidate_instagram_rate_limit_next_run_at:payload->>instagramRateLimitNextRunAt",
  "candidate_youtube_checkpoint:payload->youtubeUploadCheckpoint",
  "candidate_youtube_next_run_at:payload->>youtubeUploadNextRunAt",
  "candidate_pinterest_checkpoint:payload->pinterestVideoCheckpoint",
  "candidate_pinterest_next_poll_at:payload->>pinterestVideoNextPollAt",
].join(",");
const ASYNC_FINALIZATION_CANDIDATE_COLUMNS = "id,user_id,created_at";
const PINTEREST_VIDEO_TERMINAL_PHASES = new Set([
  "completed",
  "failed",
  "expired",
  "outcome_unknown",
]);

function timestampMs(...values: unknown[]) {
  for (const value of values) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function uniqueBoundedIds(rows: AsyncEventCandidateRow[], limit: number) {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row.id || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function candidateKey(row: Pick<AsyncEventCandidateRow, "id" | "user_id">) {
  return `${String(row.user_id || "").trim()}:${String(row.id || "").trim()}`;
}

function isChannelCandidateDue(row: AsyncChannelCandidateRow, nowMs: number) {
  const channel = String(row.candidate_channel || "").trim();
  const instagramCheckpoint = asRecord(row.candidate_instagram_checkpoint);
  const hasYoutubeCheckpoint =
    row.candidate_youtube_checkpoint !== null &&
    row.candidate_youtube_checkpoint !== undefined;
  const pinterestCheckpoint = asRecord(row.candidate_pinterest_checkpoint);
  const hasPinterestCheckpoint =
    row.candidate_pinterest_checkpoint !== null &&
    row.candidate_pinterest_checkpoint !== undefined;
  const pinterestTerminal =
    channel === "pinterest" &&
    hasPinterestCheckpoint &&
    PINTEREST_VIDEO_TERMINAL_PHASES.has(
      String(pinterestCheckpoint.phase || "").trim().toLowerCase(),
    );
  if (pinterestTerminal) return false;

  if (
    channel === "instagram" &&
    timestampMs(row.candidate_instagram_rate_limit_next_run_at) > nowMs
  ) {
    return false;
  }
  if (
    channel === "instagram" &&
    Object.keys(instagramCheckpoint).length > 0 &&
    timestampMs(row.candidate_instagram_next_poll_at) > nowMs
  ) {
    return false;
  }
  if (
    channel === "youtube_shorts" &&
    hasYoutubeCheckpoint &&
    timestampMs(row.candidate_youtube_next_run_at) > nowMs
  ) {
    return false;
  }
  if (
    channel === "pinterest" &&
    hasPinterestCheckpoint &&
    timestampMs(
      row.candidate_pinterest_next_poll_at,
      pinterestCheckpoint.nextPollAt,
    ) > nowMs
  ) {
    return false;
  }
  return true;
}

async function loadExactAsyncEventRows(params: {
  eventType: string;
  ids: string[];
  limit: number;
}) {
  const ids = Array.from(new Set(params.ids.filter(Boolean))).slice(
    0,
    params.limit,
  );
  if (!ids.length) {
    return { data: [] as AsyncEventRow[], error: null };
  }
  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("id,user_id,payload,created_at")
    .eq("type", params.eventType)
    .in("id", ids)
    .limit(params.limit);
  return { data: (data || []) as AsyncEventRow[], error };
}

function readDispatchJob(row: AsyncEventRow): AsyncDispatchJob {
  const payload = asRecord(row.payload);
  const persistedTiktokCheckpoint = asRecord(
    payload.tiktokUploadCheckpoint,
  );
  const persistedInstagramVideoCheckpoint = asRecord(
    payload.instagramVideoCheckpoint,
  );
  const rawYoutubeUploadCheckpoint = payload.youtubeUploadCheckpoint;
  const hasYoutubeUploadCheckpoint =
    rawYoutubeUploadCheckpoint !== null &&
    rawYoutubeUploadCheckpoint !== undefined;
  const rawPinterestVideoCheckpoint = payload.pinterestVideoCheckpoint;
  const hasPinterestVideoCheckpoint =
    rawPinterestVideoCheckpoint !== null &&
    rawPinterestVideoCheckpoint !== undefined;
  const persistedPinterestVideoCheckpoint = asRecord(
    rawPinterestVideoCheckpoint,
  );
  const channel = String(payload.channel || "");
  const instagramVideoContinuation =
    channel === "instagram" &&
    Object.keys(persistedInstagramVideoCheckpoint).length > 0;
  const youtubeUploadContinuation =
    channel === "youtube_shorts" && hasYoutubeUploadCheckpoint;
  const pinterestVideoTerminal =
    channel === "pinterest" &&
    hasPinterestVideoCheckpoint &&
    PINTEREST_VIDEO_TERMINAL_PHASES.has(
      String(persistedPinterestVideoCheckpoint.phase || "")
        .trim()
        .toLowerCase(),
    );
  const pinterestVideoContinuation =
    channel === "pinterest" &&
    hasPinterestVideoCheckpoint &&
    !pinterestVideoTerminal;
  return {
    id: String(row.id || ""),
    userId: String(row.user_id || "").trim(),
    status: String(payload.status || "queued").trim(),
    channel,
    publicationId: String(payload.publication_id || ""),
    dispatchRequest: {
      ...asRecord(payload.dispatchRequest),
      ...(Object.keys(persistedTiktokCheckpoint).length
        ? { _tiktokUploadCheckpoint: persistedTiktokCheckpoint }
        : {}),
      ...(Object.keys(persistedInstagramVideoCheckpoint).length
        ? {
            _instagramVideoCheckpoint:
              persistedInstagramVideoCheckpoint,
          }
        : {}),
      ...(hasYoutubeUploadCheckpoint
        ? {
            _youtubeUploadCheckpoint: rawYoutubeUploadCheckpoint,
          }
        : {}),
      ...(hasPinterestVideoCheckpoint
        ? {
            _pinterestVideoCheckpoint: rawPinterestVideoCheckpoint,
          }
        : {}),
    },
    attempt: Math.max(0, Number(payload.attempt || 0)),
    instagramVideoContinuation,
    instagramContinuationAttempt: Math.max(
      0,
      Number(payload.instagramContinuationAttempt || 0),
    ),
    instagramVideoNextPollAt: timestampMs(payload.instagramVideoNextPollAt),
    youtubeUploadContinuation,
    youtubeContinuationAttempt: Math.max(
      0,
      Number(payload.youtubeContinuationAttempt || 0),
    ),
    youtubeUploadNextRunAt: timestampMs(payload.youtubeUploadNextRunAt),
    pinterestVideoContinuation,
    pinterestContinuationAttempt: Math.max(
      0,
      Number(payload.pinterestContinuationAttempt || 0),
    ),
    pinterestVideoNextPollAt: timestampMs(
      payload.pinterestVideoNextPollAt,
      persistedPinterestVideoCheckpoint.nextPollAt,
    ),
    pinterestVideoTerminal,
    lastActivityAt: timestampMs(
      payload.updatedAt,
      payload.startedAt,
      payload.createdAt,
      row.created_at,
    ),
  };
}

function readPreparationJob(row: AsyncEventRow): AsyncPreparationJob {
  const payload = asRecord(row.payload);
  return {
    id: String(row.id || ""),
    userId: String(row.user_id || "").trim(),
    status: String(payload.status || "queued").trim(),
    preparationRequest: asRecord(payload.preparationRequest),
    channelEventIds: Object.values(asRecord(payload.channelEventIds))
      .map((value) => String(value || "").trim())
      .filter(Boolean),
    attempt: Math.max(0, Number(payload.preparationAttempt || 0)),
    lastPreparationError: String(payload.lastPreparationError || "").trim(),
    lastActivityAt: timestampMs(
      payload.updatedAt,
      payload.preparationStartedAt,
      payload.lastPreparationDispatchAt,
      payload.createdAt,
      row.created_at,
    ),
  };
}

async function exhaustPreparationJob(job: AsyncPreparationJob) {
  const lease = await acquireAsyncPublicationPreparationLease({
    userId: job.userId,
    publicationId: job.id,
  });
  if (lease.state === "running" || lease.state === "unavailable") return;
  if (lease.state === "completed") {
    await updateAsyncPublicationJobEvent({
      userId: job.userId,
      publicationId: job.id,
      patch: {
        status: "dispatching",
        stage: "channel_dispatch",
        preparationRequest: null,
      },
    });
    await finalizeAsyncPublicationIfReady({
      userId: job.userId,
      publicationId: job.id,
    });
    return;
  }

  const errorMessage =
    "La préparation des médias n'a pas pu être relancée automatiquement après plusieurs tentatives.";
  const failedChannels = await failPreparingAsyncPublicationChannels({
    userId: job.userId,
    channelEventIds: job.channelEventIds,
    error: errorMessage,
  });
  if (failedChannels.length) {
    await supabaseAdmin
      .from("publication_deliveries")
      .update({ status: "failed", error: errorMessage })
      .eq("publication_id", job.id)
      .eq("user_id", job.userId)
      .in("channel", failedChannels);
  }
  await updateAsyncPublicationJobEvent({
    userId: job.userId,
    publicationId: job.id,
    patch: {
      status: "dispatching",
      stage: "channel_dispatch",
      preparationRequest: null,
      preparationExhaustedAt: new Date().toISOString(),
      lastPreparationError: errorMessage,
    },
  });
  await completeAsyncPublicationPreparationLease({
    lockId: lease.lock?.id || null,
    publicationId: job.id,
  });
  await finalizeAsyncPublicationIfReady({
    userId: job.userId,
    publicationId: job.id,
  });
}

async function dispatchPreparationJob(job: AsyncPreparationJob, appOrigin: string) {
  const waitingForWorkspaceMedia =
    job.lastPreparationError === "workspace_media_processing" ||
    job.lastPreparationError === "workspace_media_not_ready";
  if (
    !waitingForWorkspaceMedia &&
    job.attempt >= BOOSTER_ASYNC_PREPARATION_MAX_ATTEMPTS
  ) {
    await exhaustPreparationJob(job);
    return;
  }
  // La normalisation video possede son propre budget de reprises et son etat
  // terminal. Observer `workspace_media_processing` ne constitue donc pas une
  // tentative de publication et ne doit jamais epuiser le parent. L'etape 1
  // est toutefois reservee au dispatch sans media/images : les canaux media
  // doivent avancer durablement a l'etape 2 au lieu de reboucler sur l'etape 1.
  const nextPreparationAttempt = waitingForWorkspaceMedia
    ? Math.max(2, job.attempt)
    : job.attempt + 1;
  try {
    const response = await fetch(`${appOrigin}/api/booster/publish-now`, {
      method: "POST",
      headers: buildInternalCronHeaders(job.userId),
      body: JSON.stringify({
        ...job.preparationRequest,
        _asyncPreparationAttempt: nextPreparationAttempt,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`preparation_dispatch_http_${response.status}`);
    }
  } catch (dispatchError) {
    console.warn("[booster-async-cron] preparation dispatch failed", {
      publicationId: job.id,
      message:
        dispatchError instanceof Error
          ? dispatchError.message
          : String(dispatchError || ""),
    });
  }
}

async function dispatchChannelJob(job: AsyncDispatchJob, appOrigin: string) {
  if (
    (job.instagramVideoContinuation &&
      job.instagramVideoNextPollAt > Date.now()) ||
    (job.youtubeUploadContinuation &&
      job.youtubeUploadNextRunAt > Date.now()) ||
    (job.pinterestVideoContinuation &&
      job.pinterestVideoNextPollAt > Date.now())
  ) {
    return;
  }
  const attemptsExhausted = job.instagramVideoContinuation
    ? job.instagramContinuationAttempt >=
      MAX_INSTAGRAM_VIDEO_CONTINUATION_ATTEMPTS
    : job.youtubeUploadContinuation
      ? job.youtubeContinuationAttempt >=
        MAX_YOUTUBE_UPLOAD_CONTINUATION_ATTEMPTS
      : job.pinterestVideoContinuation
        ? job.pinterestContinuationAttempt >=
          MAX_PINTEREST_VIDEO_CONTINUATION_ATTEMPTS
        : job.attempt >= MAX_ASYNC_DISPATCH_ATTEMPTS;
  if (attemptsExhausted) {
    const errorMessage =
      "Le canal n'a pas pu être relancé automatiquement après plusieurs tentatives.";
    await updateAsyncChannelEvent({
      userId: job.userId,
      eventId: job.id,
      patch: {
        status: "failed",
        result: {
          ok: false,
          code: job.instagramVideoContinuation
            ? "instagram_video_continuation_exhausted"
            : job.youtubeUploadContinuation
              ? "youtube_upload_continuation_exhausted"
              : job.pinterestVideoContinuation
                ? "pinterest_video_continuation_exhausted"
                : "async_dispatch_exhausted",
          retryable: false,
          error: errorMessage,
        },
        completedAt: new Date().toISOString(),
      },
    });
    await supabaseAdmin
      .from("publication_deliveries")
      .update({ status: "failed", error: errorMessage })
      .eq("publication_id", job.publicationId)
      .eq("user_id", job.userId)
      .eq("channel", job.channel);
    await finalizeAsyncPublicationIfReady({
      userId: job.userId,
      publicationId: job.publicationId,
    });
    return;
  }

  try {
    await updateAsyncChannelEvent({
      userId: job.userId,
      eventId: job.id,
      patch: {
        ...(job.instagramVideoContinuation
          ? {
              instagramContinuationAttempt:
                job.instagramContinuationAttempt + 1,
            }
          : job.youtubeUploadContinuation
            ? {
                youtubeContinuationAttempt:
                  job.youtubeContinuationAttempt + 1,
              }
            : job.pinterestVideoContinuation
              ? {
                  pinterestContinuationAttempt:
                    job.pinterestContinuationAttempt + 1,
                }
              : { attempt: job.attempt + 1 }),
        lastDispatchAt: new Date().toISOString(),
      },
    });
    const response = await fetch(`${appOrigin}/api/booster/publish-now`, {
      method: "POST",
      headers: buildInternalCronHeaders(job.userId),
      body: JSON.stringify({
        ...job.dispatchRequest,
        ...(job.instagramVideoContinuation
          ? {
              _instagramVideoContinuationAttempt:
                job.instagramContinuationAttempt + 1,
            }
          : {}),
        ...(job.youtubeUploadContinuation
          ? {
              _youtubeUploadContinuationAttempt:
                job.youtubeContinuationAttempt + 1,
            }
          : {}),
        ...(job.pinterestVideoContinuation
          ? {
              _pinterestVideoContinuationAttempt:
                job.pinterestContinuationAttempt + 1,
            }
          : {}),
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`channel_dispatch_http_${response.status}`);
    }
  } catch (dispatchError) {
    console.warn("[booster-async-cron] channel dispatch failed", {
      publicationId: job.publicationId,
      channel: job.channel,
      message:
        dispatchError instanceof Error
          ? dispatchError.message
          : String(dispatchError || ""),
    });
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  }
  const nowMs = Date.now();
  const sweepPlan = getBoosterCronSweepPlan(nowMs);
  const finalizationRecoveryCutoffIso = new Date(
    nowMs - 2 * 60 * 1000,
  ).toISOString();
  const channelRecoveryCutoffIso = new Date(
    nowMs -
      BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS -
      PROCESSING_RECOVERY_GRACE_MS,
  ).toISOString();
  const preparationRecoveryCutoffIso = new Date(
    nowMs -
      BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS -
      PROCESSING_RECOVERY_GRACE_MS,
  ).toISOString();

  // Queued work always has its own capacity. Never apply a shared LIMIT before
  // separating it from active recovery rows: a wall of fresh processing jobs
  // must not hide a queued job whose initial after() dispatch was lost.
  const [
    queuedChannelCandidatesQuery,
    processingChannelCandidatesQuery,
    queuedPreparationCandidatesQuery,
    activePreparationCandidatesQuery,
  ] = await Promise.all([
    supabaseAdmin
      .from("app_events")
      .select(ASYNC_CHANNEL_CANDIDATE_COLUMNS)
      .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
      .eq("payload->>status", "queued")
      .not("payload->dispatchRequest", "is", null)
      .order("created_at", { ascending: true })
      .limit(ASYNC_CHANNEL_CANDIDATE_LIMIT),
    sweepPlan.runRecoverySweep
      ? supabaseAdmin
          .from("app_events")
          .select(ASYNC_CHANNEL_CANDIDATE_COLUMNS)
          .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
          .eq("payload->>status", "processing")
          .lt("payload->>updatedAt", channelRecoveryCutoffIso)
          .order("created_at", { ascending: true })
          .limit(ASYNC_CHANNEL_CANDIDATE_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("app_events")
      .select(ASYNC_EVENT_CANDIDATE_COLUMNS)
      .eq("type", BOOSTER_ASYNC_JOB_EVENT_TYPE)
      .eq("payload->>status", "queued")
      .not("payload->preparationRequest", "is", null)
      .order("created_at", { ascending: true })
      .limit(ASYNC_PREPARATION_CANDIDATE_LIMIT),
    sweepPlan.runRecoverySweep
      ? supabaseAdmin
          .from("app_events")
          .select(ASYNC_EVENT_CANDIDATE_COLUMNS)
          .eq("type", BOOSTER_ASYNC_JOB_EVENT_TYPE)
          .in("payload->>status", ["preparing", "dispatching"])
          .lt("payload->>updatedAt", preparationRecoveryCutoffIso)
          .order("created_at", { ascending: true })
          .limit(ASYNC_PREPARATION_CANDIDATE_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const candidateQueryError = [
    queuedChannelCandidatesQuery.error,
    processingChannelCandidatesQuery.error,
    queuedPreparationCandidatesQuery.error,
    activePreparationCandidatesQuery.error,
  ].find(Boolean);
  if (candidateQueryError) {
    return NextResponse.json(
      {
        ok: false,
        error: candidateQueryError.message,
      },
      { status: 500 },
    );
  }

  const queuedChannelCandidates = (
    (queuedChannelCandidatesQuery.data || []) as unknown as AsyncChannelCandidateRow[]
  ).filter(
    (row) =>
      String(row.candidate_status || "") === "queued" &&
      isChannelCandidateDue(row, nowMs),
  );
  const processingChannelCandidates = (
    (processingChannelCandidatesQuery.data || []) as unknown as AsyncChannelCandidateRow[]
  ).filter(
    (row) =>
      String(row.candidate_status || "") === "processing" &&
      nowMs - timestampMs(row.candidate_updated_at, row.created_at) >=
        BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS + PROCESSING_RECOVERY_GRACE_MS &&
      isChannelCandidateDue(row, nowMs),
  );
  const queuedPreparationCandidates = (
    (queuedPreparationCandidatesQuery.data || []) as unknown as AsyncEventCandidateRow[]
  ).filter((row) => String(row.candidate_status || "") === "queued");
  const activePreparationCandidates = (
    (activePreparationCandidatesQuery.data || []) as unknown as AsyncEventCandidateRow[]
  ).filter(
    (row) =>
      ["preparing", "dispatching"].includes(
        String(row.candidate_status || ""),
      ) &&
      nowMs - timestampMs(row.candidate_updated_at, row.created_at) >=
        BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS +
          PROCESSING_RECOVERY_GRACE_MS,
  );

  // Full transport payloads are fetched by primary key only after the compact
  // queue rows pass status, staleness and continuation scheduling checks.
  const [channelRowsQuery, preparationRowsQuery, finalizationCandidatesQuery] =
    await Promise.all([
      loadExactAsyncEventRows({
        eventType: BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
        ids: uniqueBoundedIds(
          [...queuedChannelCandidates, ...processingChannelCandidates],
          ASYNC_CHANNEL_EXACT_LOAD_LIMIT,
        ),
        limit: ASYNC_CHANNEL_EXACT_LOAD_LIMIT,
      }),
      loadExactAsyncEventRows({
        eventType: BOOSTER_ASYNC_JOB_EVENT_TYPE,
        ids: uniqueBoundedIds(
          [...queuedPreparationCandidates, ...activePreparationCandidates],
          ASYNC_PREPARATION_EXACT_LOAD_LIMIT,
        ),
        limit: ASYNC_PREPARATION_EXACT_LOAD_LIMIT,
      }),
      sweepPlan.runFinalizationSweep
        ? supabaseAdmin
            .from("app_events")
            .select(ASYNC_FINALIZATION_CANDIDATE_COLUMNS)
            .eq("type", BOOSTER_ASYNC_JOB_EVENT_TYPE)
            .in("payload->>status", ["queued", "preparing", "dispatching"])
            .lt("payload->>updatedAt", finalizationRecoveryCutoffIso)
            .order("created_at", {
              ascending: sweepPlan.finalizationAscending,
            })
            .limit(ASYNC_FINALIZATION_CANDIDATE_LIMIT)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const exactQueryError = [
    channelRowsQuery.error,
    preparationRowsQuery.error,
    finalizationCandidatesQuery.error,
  ].find(Boolean);
  if (exactQueryError) {
    return NextResponse.json(
      { ok: false, error: exactQueryError.message },
      { status: 500 },
    );
  }

  const queuedChannelKeys = new Set(queuedChannelCandidates.map(candidateKey));
  const processingChannelKeys = new Set(
    processingChannelCandidates.map(candidateKey),
  );
  const exactDispatchJobs = (channelRowsQuery.data || []).map(readDispatchJob);
  const queuedDispatchJobs = exactDispatchJobs
    .filter(
      (job) =>
        queuedChannelKeys.has(`${job.userId}:${job.id}`) &&
        job.status === "queued",
    )
    .filter(
      (job) =>
        job.id &&
        job.userId &&
        Object.keys(job.dispatchRequest).length > 0 &&
        !job.pinterestVideoTerminal,
    );
  const recoveredDispatchJobs = exactDispatchJobs
    .filter(
      (job) =>
        processingChannelKeys.has(`${job.userId}:${job.id}`) &&
        job.status === "processing",
    )
    .filter(
      (job) =>
        job.id &&
        job.userId &&
        Object.keys(job.dispatchRequest).length > 0 &&
        !job.pinterestVideoTerminal &&
        nowMs - job.lastActivityAt >=
          BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS + PROCESSING_RECOVERY_GRACE_MS,
    );
  const dispatchJobs = [...queuedDispatchJobs, ...recoveredDispatchJobs];

  const queuedPreparationKeys = new Set(
    queuedPreparationCandidates.map(candidateKey),
  );
  const activePreparationKeys = new Set(
    activePreparationCandidates.map(candidateKey),
  );
  const exactPreparationJobs = (preparationRowsQuery.data || []).map(
    readPreparationJob,
  );
  const queuedPreparationJobs = exactPreparationJobs
    .filter((job) => queuedPreparationKeys.has(`${job.userId}:${job.id}`))
    .filter(
      (job) =>
        job.id &&
        job.userId &&
        Object.keys(job.preparationRequest).length > 0 &&
        job.status === "queued",
    );
  const recoveredPreparationJobs = exactPreparationJobs
    .filter((job) => activePreparationKeys.has(`${job.userId}:${job.id}`))
    .filter(
      (job) =>
        job.id &&
        job.userId &&
        Object.keys(job.preparationRequest).length > 0 &&
        nowMs - job.lastActivityAt >=
          BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS +
            PROCESSING_RECOVERY_GRACE_MS,
    );
  const preparationJobs = [
    ...queuedPreparationJobs,
    ...recoveredPreparationJobs,
  ];
  // Every async parent is a bounded finalization candidate, independently of
  // its preparationRequest. This heals transient finalizer failures, duplicate
  // branches that terminalized children early, and parents whose technical
  // child is missing. finalizeAsyncPublicationIfReady remains idempotent and
  // returns cheaply while any real child is still pending.
  const parentsAlreadyWorking = new Set([
    ...preparationJobs.map((job) => `${job.userId}:${job.id}`),
    ...dispatchJobs.map((job) => `${job.userId}:${job.publicationId}`),
  ]);
  const finalizationJobs = (
    (finalizationCandidatesQuery.data || []) as AsyncEventCandidateRow[]
  )
    .filter((row) => row.id && row.user_id)
    // A dispatch/exhaustion branch finalizes its own parent. Do not launch a
    // competing reconciliation for that parent in this same cron tick.
    .filter((row) => !parentsAlreadyWorking.has(candidateKey(row)))
    .slice(0, ASYNC_FINALIZATION_CANDIDATE_LIMIT)
    .map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
    }));

  if (
    dispatchJobs.length ||
    preparationJobs.length ||
    finalizationJobs.length
  ) {
    const appOrigin = getAppOriginFromRequest(request);
    after(async () => {
      await Promise.allSettled([
        ...preparationJobs.map((job) =>
          dispatchPreparationJob(job, appOrigin),
        ),
        ...dispatchJobs.map((job) => dispatchChannelJob(job, appOrigin)),
        ...finalizationJobs.map((job) =>
          finalizeAsyncPublicationIfReady({
            userId: job.userId,
            publicationId: job.id,
          }),
        ),
      ]);
    });
  }

  return NextResponse.json({
    ok: true,
    preparationsQueued: queuedPreparationJobs.length,
    preparationsRecovered: recoveredPreparationJobs.length,
    queued: queuedDispatchJobs.length,
    recovered: recoveredDispatchJobs.length,
    finalizationsChecked: finalizationJobs.length,
    recoverySweep: sweepPlan.runRecoverySweep,
    finalizationSweep: sweepPlan.runFinalizationSweep,
    publicationIds: Array.from(
      new Set(
        [
          ...preparationJobs.map((job) => job.id),
          ...dispatchJobs.map((job) => job.publicationId),
        ].filter(Boolean),
      ),
    ),
  });
}

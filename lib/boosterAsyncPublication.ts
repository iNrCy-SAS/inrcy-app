import "server-only";

import { randomUUID } from "node:crypto";
import {
  acquireExecutionIdempotencyLock,
  completeExecutionIdempotencyLock,
  completeExecutionIdempotencyLockOrThrow,
  failExecutionIdempotencyLock,
} from "@/lib/executionIdempotency";
import { syncPublicationWorkspaceContext } from "@/lib/mediaWorkspaceConsumption";
import {
  BOOSTER_PUBLICATION_CHANNEL_LABELS as CHANNEL_LABELS,
  isBoosterPublicationChannel,
  isBoosterPublishFailureRetryable,
  type BoosterPublicationChannelKey,
} from "@/lib/boosterPublicationPolicy";
import { classifyBoosterPublicationResult } from "@/lib/boosterPublicationOutcome";
import { resolveMediaPreparationDisplayState } from "@/lib/mediaPreparationDisplay";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const BOOSTER_ASYNC_JOB_EVENT_TYPE = "publish_async_job";
export const BOOSTER_ASYNC_CHANNEL_EVENT_TYPE = "publish_async_channel";
export const BOOSTER_ASYNC_CHANNEL_SCOPE = "booster_publish_channel";
export const BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS = 5 * 60 * 1000;
export const BOOSTER_ASYNC_PREPARATION_SCOPE = "booster_publish_preparation";
// A preparation worker can legitimately use most of publish-now's 180-second
// runtime. Recovery must therefore wait until that invocation cannot still be
// producing media derivatives, otherwise two FFmpeg workers could overlap.
export const BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS = 4 * 60 * 1000;
// Media normalization has its own bounded retry/terminal states. Keep enough
// publication-preparation recoveries for a long video job to finish in the
// background instead of turning a merely processing media into a global
// publication failure after two or three cron observations.
export const BOOSTER_ASYNC_PREPARATION_MAX_ATTEMPTS = 10;

export type BoosterAsyncChannelKey = BoosterPublicationChannelKey;

type JsonRecord = Record<string, unknown>;
type AppEventPayloadRow = { id: string; payload: unknown };
type AppEventParentRow = {
  id: string;
  module?: string | null;
  type?: string | null;
  payload: unknown;
  created_at?: string | null;
};

type AsyncChannelState = {
  channel: BoosterAsyncChannelKey;
  eventId: string;
  status: string;
  result: JsonRecord;
};

type AsyncJobDescriptor = {
  selected: BoosterAsyncChannelKey[];
  channelEventIds: JsonRecord;
  ids: string[];
  valid: boolean;
};

const TERMINAL_CHANNEL_STATUSES = new Set(["completed", "failed"]);
const FINALIZATION_CLAIM_ID_KEY = "_asyncFinalizationClaimId";
const FINALIZATION_CLAIMED_AT_KEY = "_asyncFinalizationClaimedAt";
const FINALIZATION_CLAIM_ID_PATH = `payload->>${FINALIZATION_CLAIM_ID_KEY}`;
const FINALIZATION_CLAIM_STALE_MS = 15_000;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function getRequestedWorkspaceMediaTypes(
  parentPayload: JsonRecord,
  selectedChannels: readonly BoosterAsyncChannelKey[],
) {
  const preparationRequest = asRecord(parentPayload.preparationRequest);
  const modes = asRecord(
    preparationRequest.mediaModeByChannel || parentPayload.mediaModeByChannel,
  );
  const requested = new Set<"image" | "video">();
  for (const channel of selectedChannels) {
    const mode = cleanString(modes[channel]);
    if (mode === "video") requested.add("video");
    if (mode === "images") requested.add("image");
  }
  if (!requested.size) {
    const fallbackMediaType = cleanString(
      preparationRequest.mediaType || parentPayload.mediaType,
    );
    if (fallbackMediaType === "video") requested.add("video");
    if (fallbackMediaType === "images" || fallbackMediaType === "image") {
      requested.add("image");
    }
  }
  return Array.from(requested);
}

function asChannel(value: unknown): BoosterAsyncChannelKey | null {
  const channel = cleanString(value);
  return isBoosterPublicationChannel(channel) ? channel : null;
}

export function buildAsyncPublicationSummary(
  results: Record<string, unknown>,
  selected: BoosterAsyncChannelKey[],
) {
  const entries = selected.map((channel) => {
    const value = asRecord(results[channel]);
    const outcome = classifyBoosterPublicationResult(value);
    const ok = outcome.ok;
    const code = cleanString(value.code) || null;
    const retryable = isBoosterPublishFailureRetryable({
      ok,
      code,
      retryable: value.retryable,
    });
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      ok,
      status: outcome.status,
      code,
      retryable,
      error: !ok ? cleanString(value.error) || "erreur" : null,
      warning: outcome.warningCode,
      warning_kind: outcome.warningKind,
      warning_message: outcome.warningMessage,
    };
  });

  const successes = entries.filter((entry) => entry.ok);
  const failures = entries.filter((entry) => !entry.ok);
  const warnings = entries.filter(
    (entry) => entry.status === "published_with_warning",
  );
  const pending = entries.filter((entry) => entry.status === "processing");
  return {
    total: entries.length,
    successCount: successes.length,
    failureCount: failures.length,
    warningCount: warnings.length,
    mediaWarningCount: warnings.filter(
      (entry) => entry.warning_kind === "media_degraded",
    ).length,
    pendingCount: pending.length,
    allSucceeded: failures.length === 0,
    allFailed: successes.length === 0,
    entries,
    successChannels: successes.map((entry) => entry.channel),
    failedChannels: failures.map((entry) => entry.channel),
  };
}

export function buildAsyncPublicationAggregate(
  results: Record<string, unknown>,
  selected: BoosterAsyncChannelKey[],
) {
  const summary = buildAsyncPublicationSummary(results, selected);
  const status = summary.allFailed
    ? "failed"
    : summary.failureCount > 0
      ? "partial"
      : "completed";
  const outcome = summary.allFailed
    ? "failed"
    : summary.failureCount > 0
      ? "partial"
      : summary.pendingCount > 0
        ? "external_processing"
        : summary.warningCount > 0
          ? "completed_with_warnings"
          : "completed";

  return { summary, status, outcome };
}

async function patchAsyncEvent(params: {
  userId: string;
  eventId: string;
  eventType: string;
  patch: JsonRecord;
}) {
  const atomicPatch = {
    ...params.patch,
    updatedAt: new Date().toISOString(),
  };
  const { data: atomicData, error: atomicError } = await supabaseAdmin.rpc(
    "inrcy_patch_app_event_payload",
    {
      p_event_id: params.eventId,
      p_user_id: params.userId,
      p_event_type: params.eventType,
      p_patch: atomicPatch,
    },
  );
  if (!atomicError) return atomicData ? asRecord(atomicData) : null;

  // Compatibilité de déploiement : le code peut précéder la migration de
  // quelques secondes. Toute autre erreur reste visible et n'est pas masquée
  // par un coûteux fallback non atomique.
  if (!["42883", "PGRST202"].includes(String(atomicError.code || ""))) {
    throw atomicError;
  }

  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("id,payload")
    .eq("id", params.eventId)
    .eq("user_id", params.userId)
    .eq("type", params.eventType)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const nextPayload = {
    ...asRecord(data.payload),
    ...atomicPatch,
  };
  const { error: updateError } = await supabaseAdmin
    .from("app_events")
    .update({ payload: nextPayload })
    .eq("id", params.eventId)
    .eq("user_id", params.userId)
    .eq("type", params.eventType);
  if (updateError) throw updateError;
  return nextPayload;
}

export async function updateAsyncChannelEvent(params: {
  userId: string;
  eventId: string;
  patch: JsonRecord;
}) {
  return patchAsyncEvent({
    ...params,
    eventType: BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
  });
}

export async function updateAsyncPublicationJobEvent(params: {
  userId: string;
  publicationId: string;
  patch: JsonRecord;
}) {
  return patchAsyncEvent({
    userId: params.userId,
    eventId: params.publicationId,
    eventType: BOOSTER_ASYNC_JOB_EVENT_TYPE,
    patch: params.patch,
  });
}

export async function materializePreparingAsyncChannelEvent(params: {
  userId: string;
  eventId: string;
  payload: JsonRecord;
}) {
  const nextPayload = {
    ...params.payload,
    updatedAt: new Date().toISOString(),
  };
  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("app_events")
    .update({ payload: nextPayload })
    .eq("id", params.eventId)
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
    .eq("payload->>status", "preparing")
    .select("id,payload");
  if (updateError) throw updateError;
  const updated = updatedRows?.[0] ?? null;
  if (updated) return asRecord(updated.payload);

  // A recovered preparation must never put an already queued/processing or
  // terminal channel back in the queue. Return its current durable state.
  const { data: current, error: currentError } = await supabaseAdmin
    .from("app_events")
    .select("id,payload")
    .eq("id", params.eventId)
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new Error("async_channel_placeholder_missing");
  return asRecord(current.payload);
}

export async function acquireAsyncPublicationPreparationLease(params: {
  userId: string;
  publicationId: string;
}) {
  return acquireExecutionIdempotencyLock({
    supabase: supabaseAdmin,
    userId: params.userId,
    scope: BOOSTER_ASYNC_PREPARATION_SCOPE,
    idempotencyKey: params.publicationId,
    ttlMs: BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS,
    metadata: {
      publicationId: params.publicationId,
      asyncPreparation: true,
    },
  });
}

export async function completeAsyncPublicationPreparationLease(params: {
  lockId?: string | null;
  publicationId: string;
}) {
  await completeExecutionIdempotencyLock({
    supabase: supabaseAdmin,
    lockId: params.lockId,
    result: {
      ok: true,
      publication_id: params.publicationId,
      preparationCompleted: true,
    },
    metadata: {
      publicationId: params.publicationId,
      asyncPreparation: true,
    },
  });
}

export async function failAsyncPublicationPreparationLease(params: {
  lockId?: string | null;
  publicationId: string;
  error: string;
}) {
  await failExecutionIdempotencyLock({
    supabase: supabaseAdmin,
    lockId: params.lockId,
    error: params.error,
    result: {
      publicationId: params.publicationId,
      preparationCompleted: false,
    },
    metadata: {
      publicationId: params.publicationId,
      asyncPreparation: true,
      stage: "media_preparation",
    },
  });
}

export async function failPreparingAsyncPublicationChannels(params: {
  userId: string;
  channelEventIds: string[];
  error: string;
}) {
  if (!params.channelEventIds.length) return [] as BoosterAsyncChannelKey[];
  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("id,payload")
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
    .in("id", params.channelEventIds)
    .eq("payload->>status", "preparing");
  if (error) throw error;

  const rows = (data || []) as AppEventPayloadRow[];
  const failedChannels = rows
    .map((row) => ({
      row,
      channel: asChannel(asRecord(row.payload).channel),
    }))
    .filter(
      (
        entry,
      ): entry is { row: AppEventPayloadRow; channel: BoosterAsyncChannelKey } =>
        Boolean(entry.channel),
    );
  await Promise.all(
    failedChannels.map(({ row, channel }) =>
      updateAsyncChannelEvent({
        userId: params.userId,
        eventId: row.id,
        patch: {
          status: "failed",
          result: {
            ok: false,
            code: "async_preparation_exhausted",
            retryable: true,
            error: params.error,
          },
          channel,
          completedAt: new Date().toISOString(),
        },
      }),
    ),
  );
  return failedChannels.map((entry) => entry.channel);
}

function readAsyncJobDescriptor(payload: JsonRecord): AsyncJobDescriptor {
  const selected = (Array.isArray(payload.channels) ? payload.channels : [])
    .map(asChannel)
    .filter((value): value is BoosterAsyncChannelKey => Boolean(value));
  const channelEventIds = asRecord(payload.channelEventIds);
  const ids = selected
    .map((channel) => cleanString(channelEventIds[channel]))
    .filter(Boolean);
  return {
    selected,
    channelEventIds,
    ids,
    valid:
      selected.length > 0 &&
      ids.length === selected.length &&
      new Set(ids).size === ids.length,
  };
}

function isFinalizationClaimFresh(payload: JsonRecord) {
  const claimId = cleanString(payload[FINALIZATION_CLAIM_ID_KEY]);
  const claimedAt = Date.parse(cleanString(payload[FINALIZATION_CLAIMED_AT_KEY]));
  if (!claimId || !Number.isFinite(claimedAt)) return false;
  const ageMs = Date.now() - claimedAt;
  return ageMs >= -5_000 && ageMs < FINALIZATION_CLAIM_STALE_MS;
}

function withoutFinalizationClaim(payload: JsonRecord) {
  const cleanPayload = { ...payload };
  delete cleanPayload[FINALIZATION_CLAIM_ID_KEY];
  delete cleanPayload[FINALIZATION_CLAIMED_AT_KEY];
  return cleanPayload;
}

async function loadAsyncPublicationParent(params: {
  userId: string;
  publicationId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("id,module,type,payload,created_at")
    .eq("id", params.publicationId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as AppEventParentRow | null;
}

async function loadAsyncChannelStates(params: {
  userId: string;
  descriptor: AsyncJobDescriptor;
}) {
  const { data, error } = params.descriptor.ids.length
    ? await supabaseAdmin
        .from("app_events")
        .select("id,payload")
        .eq("user_id", params.userId)
        .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
        .in("id", params.descriptor.ids)
    : { data: [], error: null };
  if (error) throw error;

  const eventById = new Map<string, JsonRecord>(
    ((data || []) as AppEventPayloadRow[]).map((row) => [
      String(row.id),
      asRecord(row.payload),
    ]),
  );
  return params.descriptor.selected.map<AsyncChannelState>((channel) => {
    const eventId = cleanString(params.descriptor.channelEventIds[channel]);
    const payload = eventById.get(eventId);
    if (!payload) {
      // The parent descriptor is authoritative. A missing technical child is
      // one isolated terminal failure, never an eternal synthetic queue item.
      return {
        channel,
        eventId,
        status: "failed",
        result: {
          ok: false,
          code: "async_channel_event_missing",
          retryable: true,
          error: "Le suivi technique de ce canal est introuvable.",
        },
      };
    }
    return {
      channel,
      eventId,
      status: cleanString(payload.status) || "queued",
      result: asRecord(payload.result),
    };
  });
}

async function hasPendingAsyncChannelEvent(params: {
  userId: string;
  ids: string[];
}) {
  if (!params.ids.length) return true;
  // Every channel calls the finalizer. Reading at most one pending row avoids
  // N complete N-row scans; only the claimed winner loads every result.
  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("id")
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
    .in("id", params.ids)
    .not("payload->>status", "in", '("completed","failed")')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function claimAsyncPublicationFinalization(params: {
  userId: string;
  publicationId: string;
  parentPayload: JsonRecord;
}) {
  if (isFinalizationClaimFresh(params.parentPayload)) return null;

  const previousClaimId = cleanString(
    params.parentPayload[FINALIZATION_CLAIM_ID_KEY],
  );
  const claimId = randomUUID();
  const claimedPayload = {
    ...withoutFinalizationClaim(params.parentPayload),
    [FINALIZATION_CLAIM_ID_KEY]: claimId,
    [FINALIZATION_CLAIMED_AT_KEY]: new Date().toISOString(),
  };
  let claimQuery = supabaseAdmin
    .from("app_events")
    .update({ payload: claimedPayload })
    .eq("id", params.publicationId)
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_JOB_EVENT_TYPE);
  claimQuery = previousClaimId
    ? claimQuery.eq(FINALIZATION_CLAIM_ID_PATH, previousClaimId)
    : claimQuery.is(FINALIZATION_CLAIM_ID_PATH, null);
  const { data, error } = await claimQuery.select("id");
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) return null;
  return { claimId };
}

async function releaseAsyncPublicationFinalizationClaim(params: {
  userId: string;
  publicationId: string;
  parentPayload: JsonRecord;
  claimId: string;
}) {
  const { error } = await supabaseAdmin
    .from("app_events")
    .update({ payload: withoutFinalizationClaim(params.parentPayload) })
    .eq("id", params.publicationId)
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_JOB_EVENT_TYPE)
    .eq(FINALIZATION_CLAIM_ID_PATH, params.claimId);
  if (error) {
    console.warn("[booster-async] finalization claim release failed", {
      publicationId: params.publicationId,
      message: error.message,
    });
  }
}

function pendingChannels(channelStates: AsyncChannelState[]) {
  return channelStates
    .filter((state) => !TERMINAL_CHANNEL_STATUSES.has(state.status))
    .map((state) => state.channel);
}

function buildCompletedPublicationStatus(
  publicationId: string,
  payload: JsonRecord,
) {
  return {
    ok: String(payload.status || "") !== "failed",
    done: true,
    queued: false,
    publication_id: publicationId,
    ...payload,
  };
}

function buildProcessingPublicationStatus(
  publicationId: string,
  channelStates: AsyncChannelState[],
  mediaPreparation?: {
    progress: number;
    status: string;
    mediaCount: number;
    completedCount: number;
    phase: "preparation";
    phaseProgress: number | null;
  } | null,
) {
  const entries = channelStates.map((state) => {
    const terminal = TERMINAL_CHANNEL_STATUSES.has(state.status);
    const outcome = terminal
      ? classifyBoosterPublicationResult(state.result)
      : null;
    return {
      channel: state.channel,
      label: CHANNEL_LABELS[state.channel],
      status: outcome?.status || state.status,
      technicalStatus: state.status,
      ok: terminal
        ? state.result.ok !== false && state.status !== "failed"
        : null,
      error: cleanString(state.result.error) || null,
      warning: outcome?.warningCode || null,
      warning_kind: outcome?.warningKind || null,
      warning_message: outcome?.warningMessage || null,
      ...(state.status === "preparing" && mediaPreparation
        ? { processingProgress: mediaPreparation.progress }
        : {}),
    };
  });
  const pendingCount = entries.filter(
    (entry) => !TERMINAL_CHANNEL_STATUSES.has(entry.technicalStatus),
  ).length;

  return {
    ok: true,
    done: false,
    queued: true,
    publication_id: publicationId,
    status: pendingCount > 0 ? "processing" : "finalizing",
    ...(mediaPreparation ? { mediaPreparation } : {}),
    pollAfterMs: pendingCount > 0 ? 3_000 : 1_500,
    summary: {
      total: entries.length,
      successCount: entries.filter((entry) => entry.ok === true).length,
      failureCount: entries.filter((entry) => entry.ok === false).length,
      pendingCount,
      allSucceeded: false,
      allFailed: false,
      entries,
      successChannels: entries
        .filter((entry) => entry.ok === true)
        .map((entry) => entry.channel),
      failedChannels: entries
        .filter((entry) => entry.ok === false)
        .map((entry) => entry.channel),
    },
  };
}

async function loadWorkspacePreparationProgress(params: {
  userId: string;
  workspaceId: string;
  requestedMediaTypes?: readonly ("image" | "video")[];
}) {
  if (!params.workspaceId) return null;
  const { data, error } = await supabaseAdmin
    .from("publication_workspace_media")
    .select(
      "media_id,pro_media_library!inner(user_id,media_type,size_bytes,upload_status,upload_progress,processing_status,processing_progress)",
    )
    .eq("workspace_id", params.workspaceId)
    .eq("pro_media_library.user_id", params.userId);
  if (error) throw error;

  const requestedMediaTypes = new Set(params.requestedMediaTypes || []);
  const rows = (data || []).flatMap((row: any) => {
    const media = Array.isArray(row.pro_media_library)
      ? row.pro_media_library[0]
      : row.pro_media_library;
    const mediaType = cleanString(media?.media_type);
    if (requestedMediaTypes.size > 0 && !requestedMediaTypes.has(mediaType as "image" | "video")) {
      return [];
    }
    const uploadStatus = cleanString(media?.upload_status);
    const processingStatus = cleanString(media?.processing_status);
    const progress =
      uploadStatus !== "uploaded"
        ? Math.min(20, Math.max(0, Number(media?.upload_progress || 0) * 0.2))
        : processingStatus === "ready"
          ? 100
          : Math.min(99, Math.max(1, Number(media?.processing_progress || 0)));
    return [{
      progress,
      mediaType,
      sizeBytes: Number(media?.size_bytes || 0),
      processingStatus,
      processingProgress: Number(media?.processing_progress || 0),
    }];
  });
  if (!rows.length) return null;

  const progress = Math.round(
    rows.reduce((sum, row) => sum + row.progress, 0) / rows.length,
  );
  const completedCount = rows.filter(
    (row) => row.processingStatus === "ready",
  ).length;
  const displayState = resolveMediaPreparationDisplayState(rows);
  return {
    progress,
    status: completedCount === rows.length ? "ready" : "processing",
    mediaCount: rows.length,
    completedCount,
    phase: displayState.phase,
    phaseProgress: displayState.phaseProgress,
  };
}

async function runFinalizationSideEffects(params: {
  userId: string;
  publicationId: string;
  parentPayload: JsonRecord;
  descriptor: AsyncJobDescriptor;
  results: Record<string, unknown>;
  summary: ReturnType<typeof buildAsyncPublicationSummary>;
}) {
  const operations: Array<{ name: string; promise: Promise<unknown> }> = [];
  const workspaceId = cleanString(params.parentPayload.mediaWorkspaceId);
  if (workspaceId) {
    operations.push({
      name: "workspace",
      promise: syncPublicationWorkspaceContext({
        accountId: params.userId,
        workspaceId,
        operation: "publish",
        status: params.summary.allFailed ? "failed" : "published",
        metadata: {
          publicationId: params.publicationId,
          summary: params.summary,
          successfulChannels: params.summary.successChannels,
          failureStage: params.summary.allFailed ? "publish_results" : null,
        },
      }),
    });
  }

  // Channel events are purely technical. Remove them only after the parent
  // contains the complete detailed balance consumed by iNr'Send.
  operations.push({
    name: "channel_cleanup",
    promise: Promise.resolve(
      supabaseAdmin
        .from("app_events")
        .delete()
        .eq("user_id", params.userId)
        .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
        .in("id", params.descriptor.ids),
    ).then(({ error }) => {
      if (error) throw error;
    }),
  });

  const settled = await Promise.allSettled(
    operations.map((operation) => operation.promise),
  );
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    console.warn("[booster-async] finalization side effect failed", {
      publicationId: params.publicationId,
      operation: operations[index]?.name || "unknown",
      message:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason || ""),
    });
  });
}

async function finalizeClaimedAsyncPublication(params: {
  userId: string;
  publicationId: string;
  parentPayload: JsonRecord;
  descriptor: AsyncJobDescriptor;
  channelStates: AsyncChannelState[];
  claimId: string;
}) {
  const stillPending = pendingChannels(params.channelStates);
  if (stillPending.length > 0) {
    await releaseAsyncPublicationFinalizationClaim(params);
    return { finalized: false, pendingChannels: stillPending };
  }

  const results = Object.fromEntries(
    params.channelStates.map((state) => [
      state.channel,
      Object.keys(state.result).length
        ? state.result
        : {
            ok: state.status === "completed",
            error:
              state.status === "failed"
                ? "La publication n'a pas pu être finalisée sur ce canal."
                : null,
          },
    ]),
  );
  const aggregate = buildAsyncPublicationAggregate(
    results,
    params.descriptor.selected,
  );
  const finalPayloadBase = asRecord(params.parentPayload.finalPayloadBase);
  const finalEventType =
    cleanString(params.parentPayload.finalEventType) || "publish";
  const completedAt = new Date().toISOString();
  const finalPayload = {
    ...finalPayloadBase,
    publication_id: params.publicationId,
    attemptedChannels: params.descriptor.selected,
    channels: aggregate.summary.successChannels,
    results,
    summary: aggregate.summary,
    status: aggregate.status,
    outcome: aggregate.outcome,
    completedAt,
    updatedAt: completedAt,
    asyncDispatch: true,
  };

  // The execution key is the first terminal commit. If this strict write
  // fails, the claim is released and cron retries while every child row still
  // exists. An all-failed balance is terminal too: the same key must never
  // authorize a second publication attempt.
  const parentLockId = cleanString(
    params.parentPayload.parentIdempotencyLockId,
  );
  await completeExecutionIdempotencyLockOrThrow({
    supabase: supabaseAdmin,
    lockId: parentLockId || null,
    result: {
      ok: !aggregate.summary.allFailed,
      ...(aggregate.summary.allFailed
        ? { error: "Aucun canal publié avec succès." }
        : {}),
      publication_id: params.publicationId,
      results,
      summary: aggregate.summary,
      queued: false,
      asyncDispatch: true,
    },
    metadata: {
      publicationId: params.publicationId,
      summary: aggregate.summary,
      asyncDispatch: true,
      terminalOutcome: aggregate.outcome,
    },
  });

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("app_events")
    .update({ type: finalEventType, payload: finalPayload })
    .eq("id", params.publicationId)
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_JOB_EVENT_TYPE)
    .eq(FINALIZATION_CLAIM_ID_PATH, params.claimId)
    .select("id");
  if (updateError) throw updateError;

  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    const current = await loadAsyncPublicationParent(params);
    return {
      finalized:
        Boolean(current) &&
        String(current?.type || "") !== BOOSTER_ASYNC_JOB_EVENT_TYPE,
      payload: asRecord(current?.payload),
      summary: aggregate.summary,
    };
  }

  await runFinalizationSideEffects({
    userId: params.userId,
    publicationId: params.publicationId,
    parentPayload: params.parentPayload,
    descriptor: params.descriptor,
    results,
    summary: aggregate.summary,
  });

  return {
    finalized: true,
    payload: finalPayload,
    summary: aggregate.summary,
    results,
  };
}

export async function finalizeAsyncPublicationIfReady(params: {
  userId: string;
  publicationId: string;
}) {
  const parent = await loadAsyncPublicationParent(params);
  if (!parent) return { finalized: false, missing: true };
  if (String(parent.type || "") !== BOOSTER_ASYNC_JOB_EVENT_TYPE) {
    return {
      finalized: true,
      payload: asRecord(parent.payload),
      eventType: String(parent.type || "publish"),
    };
  }

  const parentPayload = asRecord(parent.payload);
  const descriptor = readAsyncJobDescriptor(parentPayload);
  if (!descriptor.valid) return { finalized: false, invalidJob: true };
  if (isFinalizationClaimFresh(parentPayload)) {
    return { finalized: false, finalizing: true };
  }
  if (
    await hasPendingAsyncChannelEvent({
      userId: params.userId,
      ids: descriptor.ids,
    })
  ) {
    return { finalized: false, pending: true };
  }

  const claim = await claimAsyncPublicationFinalization({
    ...params,
    parentPayload,
  });
  if (!claim) return { finalized: false, finalizing: true };

  try {
    const channelStates = await loadAsyncChannelStates({
      userId: params.userId,
      descriptor,
    });
    return await finalizeClaimedAsyncPublication({
      ...params,
      parentPayload,
      descriptor,
      channelStates,
      claimId: claim.claimId,
    });
  } catch (error) {
    await releaseAsyncPublicationFinalizationClaim({
      ...params,
      parentPayload,
      claimId: claim.claimId,
    });
    throw error;
  }
}

export async function readAsyncPublicationStatus(params: {
  userId: string;
  publicationId: string;
}) {
  const parent = await loadAsyncPublicationParent(params);
  if (!parent) return null;

  const type = String(parent.type || "");
  const parentPayload = asRecord(parent.payload);
  if (type !== BOOSTER_ASYNC_JOB_EVENT_TYPE) {
    return buildCompletedPublicationStatus(params.publicationId, parentPayload);
  }

  // One coherent parent/children snapshot serves both the response and the
  // recovery finalization. The status route no longer reads both sets twice.
  const descriptor = readAsyncJobDescriptor(parentPayload);
  const channelStates = await loadAsyncChannelStates({
    userId: params.userId,
    descriptor,
  });
  if (
    descriptor.valid &&
    pendingChannels(channelStates).length === 0 &&
    !isFinalizationClaimFresh(parentPayload)
  ) {
    const claim = await claimAsyncPublicationFinalization({
      ...params,
      parentPayload,
    });
    if (claim) {
      try {
        const finalization = await finalizeClaimedAsyncPublication({
          ...params,
          parentPayload,
          descriptor,
          channelStates,
          claimId: claim.claimId,
        });
        if (finalization.finalized && finalization.payload) {
          return buildCompletedPublicationStatus(
            params.publicationId,
            asRecord(finalization.payload),
          );
        }
      } catch (error) {
        await releaseAsyncPublicationFinalizationClaim({
          ...params,
          parentPayload,
          claimId: claim.claimId,
        });
        throw error;
      }
    }
  }

  const hasPreparingChannel = channelStates.some(
    (state) => state.status === "preparing",
  );
  let mediaPreparation: Awaited<
    ReturnType<typeof loadWorkspacePreparationProgress>
  > = null;
  if (hasPreparingChannel || cleanString(parentPayload.stage) === "media_preparation") {
    const workspaceId = cleanString(parentPayload.mediaWorkspaceId);
    if (workspaceId) {
      try {
        mediaPreparation = await loadWorkspacePreparationProgress({
          userId: params.userId,
          workspaceId,
          requestedMediaTypes: getRequestedWorkspaceMediaTypes(
            parentPayload,
            channelStates.some((state) => state.status === "preparing")
              ? channelStates
                  .filter((state) => state.status === "preparing")
                  .map((state) => state.channel)
              : descriptor.selected,
          ),
        });
      } catch (error) {
        console.warn("[booster-async] workspace progress unavailable", {
          publicationId: params.publicationId,
          workspaceId,
          error,
        });
      }
    }
  }

  return buildProcessingPublicationStatus(
    params.publicationId,
    channelStates,
    mediaPreparation,
  );
}

import "server-only";

import { randomUUID } from "node:crypto";
import {
  acquireExecutionIdempotencyLock,
  buildCompletedExecutionResponse,
} from "@/lib/executionIdempotency";
import {
  BOOSTER_PUBLICATION_CHANNEL_LABELS,
  type BoosterPublicationChannelKey,
} from "@/lib/boosterPublicationPolicy";
import {
  BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
  BOOSTER_ASYNC_JOB_EVENT_TYPE,
} from "@/lib/boosterAsyncPublication";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type JsonRecord = Record<string, unknown>;

type ExistingParentRow = {
  id: string;
  payload: unknown;
};

export type BoosterPublicationIngressAccepted = {
  state: "accepted";
  publicationId: string;
  preparationRequest: JsonRecord;
  response: JsonRecord;
};

export type BoosterPublicationIngressResult =
  | BoosterPublicationIngressAccepted
  | { state: "completed"; response: JsonRecord }
  | { state: "error"; status: number; response: JsonRecord };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function normalizeClientPreflightFailuresByChannel(
  value: unknown,
  channels: BoosterPublicationChannelKey[],
) {
  const source = asRecord(value);
  return Object.fromEntries(
    channels.flatMap((channel) => {
      const raw = asRecord(source[channel]);
      if (!Object.keys(raw).length) return [];
      const code = String(raw.code || "prepublish_validation_failed")
        .trim()
        .slice(0, 100);
      const error = String(
        raw.error || raw.message || "Ce canal n'est pas prêt à publier.",
      )
        .trim()
        .slice(0, 600);
      if (!error) return [];
      return [
        [
          channel,
          {
            ok: false,
            code: code || "prepublish_validation_failed",
            error,
            retryable: false,
            source: "client_preflight",
          },
        ],
      ];
    }),
  ) as Partial<Record<BoosterPublicationChannelKey, JsonRecord>>;
}

function buildDurablePreparationInput(body: JsonRecord) {
  return {
    workflowTool: body.workflowTool,
    workflowAction: body.workflowAction,
    workflowTrackType: body.workflowTrackType,
    source: body.source,
    origin: body.origin,
    automationKey: body.automationKey,
    inrAgentActionId: body.inrAgentActionId,
    idea: body.idea,
    post: body.post,
    postByChannel: body.postByChannel,
    mediaWorkspaceId: body.mediaWorkspaceId,
    mediaPipelineCutoverV1: body.mediaPipelineCutoverV1,
    mediaType: body.mediaType,
    mediaModeByChannel: body.mediaModeByChannel,
    videoSettingsByChannel: body.videoSettingsByChannel,
    videoFormatByChannel: body.videoFormatByChannel,
    videoAdaptationModeByChannel: body.videoAdaptationModeByChannel,
    video: body.video,
    images: body.images,
    imagesByChannel: body.imagesByChannel,
    imageSettingsByChannel: body.imageSettingsByChannel,
    tiktokPublicationSettings: body.tiktokPublicationSettings,
    instagramPublicationSettings: body.instagramPublicationSettings,
    facebookPublicationSettings: body.facebookPublicationSettings,
    pinterestPublicationSettings: body.pinterestPublicationSettings,
    skipScheduledDuplicateCheck: body.skipScheduledDuplicateCheck,
    allowDuplicateImmediatePublish: body.allowDuplicateImmediatePublish,
  };
}

function queuedSummary(
  channels: BoosterPublicationChannelKey[],
  failuresByChannel: Partial<Record<BoosterPublicationChannelKey, JsonRecord>>,
) {
  const entries = channels.map((channel) => ({
    channel,
    label: BOOSTER_PUBLICATION_CHANNEL_LABELS[channel],
    ok: failuresByChannel[channel] ? false : null,
    status: failuresByChannel[channel] ? "failed" : "preparing",
    technicalStatus: failuresByChannel[channel] ? "failed" : "preparing",
    code: failuresByChannel[channel]?.code || null,
    retryable: failuresByChannel[channel]?.retryable === true,
    error: failuresByChannel[channel]?.error || null,
    warning: null,
    warning_message: null,
  }));
  const failedChannels = entries
    .filter((entry) => entry.ok === false)
    .map((entry) => entry.channel);
  const pendingCount = entries.filter((entry) => entry.ok === null).length;
  return {
    total: entries.length,
    successCount: 0,
    failureCount: failedChannels.length,
    pendingCount,
    allSucceeded: false,
    allFailed: pendingCount === 0,
    entries,
    successChannels: [] as BoosterPublicationChannelKey[],
    failedChannels,
  };
}

function acceptedResponse(
  publicationId: string,
  channels: BoosterPublicationChannelKey[],
  idempotencyKey: string,
  failuresByChannel: Partial<Record<BoosterPublicationChannelKey, JsonRecord>>,
) {
  return {
    ok: true,
    done: false,
    queued: true,
    asyncDispatch: true,
    status: "preparing",
    phase: "media_preparation",
    publication_id: publicationId,
    idempotencyKey: idempotencyKey || null,
    results: Object.fromEntries(
      channels.map((channel) => [
        channel,
        failuresByChannel[channel] || {
          ok: true,
          queued: true,
          status: "preparing",
        },
      ]),
    ),
    summary: queuedSummary(channels, failuresByChannel),
  };
}

async function loadParent(userId: string, publicationId: string) {
  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("id,payload")
    .eq("id", publicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as ExistingParentRow | null;
}

function acceptedFromParent(params: {
  publicationId: string;
  parent: ExistingParentRow;
  fallbackChannels: BoosterPublicationChannelKey[];
  idempotencyKey: string;
}): BoosterPublicationIngressAccepted {
  const payload = asRecord(params.parent.payload);
  const preparationRequest = asRecord(payload.preparationRequest);
  const persistedChannels = (Array.isArray(payload.channels)
    ? payload.channels
    : params.fallbackChannels) as BoosterPublicationChannelKey[];
  const failuresByChannel = normalizeClientPreflightFailuresByChannel(
    payload.clientPreflightFailuresByChannel,
    persistedChannels,
  );
  return {
    state: "accepted",
    publicationId: params.publicationId,
    preparationRequest,
    response: {
      ...acceptedResponse(
        params.publicationId,
        persistedChannels,
        params.idempotencyKey,
        failuresByChannel,
      ),
      idempotent: true,
    },
  };
}

/**
 * Durable ingress boundary for publish-now.
 *
 * The parent and every per-channel placeholder are inserted in one Postgres
 * statement. Once this function returns `accepted`, neither the browser nor
 * the originating HTTP request is needed to prepare or dispatch the post.
 */
export async function enqueueBoosterPublication(params: {
  userId: string;
  body: JsonRecord;
  channels: BoosterPublicationChannelKey[];
  module: string;
  finalEventType: string;
  workspacePurpose: "publish" | "schedule";
  idempotencyScope: string;
  idempotencyKey: string;
  idempotencyTtlMs: number;
  idempotencyMetadata: JsonRecord;
}): Promise<BoosterPublicationIngressResult> {
  const candidatePublicationId = randomUUID();
  const lockResult = await acquireExecutionIdempotencyLock({
    supabase: supabaseAdmin,
    userId: params.userId,
    scope: params.idempotencyScope,
    idempotencyKey: params.idempotencyKey,
    ttlMs: params.idempotencyTtlMs,
    metadata: {
      ...params.idempotencyMetadata,
      publicationId: candidatePublicationId,
      durableIngress: true,
    },
  });

  if (lockResult.state === "unavailable") {
    return {
      state: "error",
      status: 503,
      response: {
        ok: false,
        code: "publication_ingress_unavailable",
        retryable: true,
        error:
          "La publication ne peut pas encore être enregistrée de façon sûre. Réessayez dans quelques instants.",
      },
    };
  }

  if (lockResult.state === "completed") {
    return {
      state: "completed",
      response: buildCompletedExecutionResponse(lockResult.lock),
    };
  }

  const lockMetadata = asRecord(lockResult.lock?.metadata);
  const publicationId = String(
    lockMetadata.publicationId || candidatePublicationId,
  ).trim();
  const parentLockId = String(lockResult.lock?.id || "").trim() || null;

  if (!publicationId) {
    return {
      state: "error",
      status: 425,
      response: {
        ok: false,
        code: "publication_ingress_pending",
        retryable: true,
        error:
          "Cette publication est déjà en cours d’enregistrement. Réessayez dans quelques secondes.",
      },
    };
  }

  if (lockResult.state === "running") {
    const existingParent = await loadParent(params.userId, publicationId);
    if (existingParent) {
      const accepted = acceptedFromParent({
        publicationId,
        parent: existingParent,
        fallbackChannels: params.channels,
        idempotencyKey: params.idempotencyKey,
      });
      return accepted;
    }
  }

  const nowIso = new Date().toISOString();
  const channelEventIds = Object.fromEntries(
    params.channels.map((channel) => [channel, randomUUID()]),
  );
  const deliveryIds = Object.fromEntries(
    params.channels.map((channel) => [channel, randomUUID()]),
  );
  const durableBody = buildDurablePreparationInput(params.body);
  const clientPreflightFailuresByChannel =
    normalizeClientPreflightFailuresByChannel(
      params.body.clientPreflightFailuresByChannel,
      params.channels,
    );
  const preparationRequest = {
    ...durableBody,
    channels: params.channels,
    clientPreflightFailuresByChannel,
    _asyncPreparationDispatch: true,
    _asyncPublicationId: publicationId,
    _asyncParentEventId: publicationId,
    _asyncChannelEventIds: channelEventIds,
    _asyncDeliveryIds: deliveryIds,
    _asyncPreparationAttempt: 1,
    _asyncParentIdempotencyLockId: parentLockId,
    _asyncParentIdempotencyKey: params.idempotencyKey || null,
    _asyncWorkspacePurpose: params.workspacePurpose,
  };
  const parentPayload = {
    status: "queued",
    stage: "media_preparation",
    asyncVersion: 2,
    publication_id: publicationId,
    channels: params.channels,
    clientPreflightFailuresByChannel,
    channelEventIds,
    deliveryIds,
    finalEventType: params.finalEventType,
    finalPayloadBase: {
      idea: String(params.body.idea || ""),
      post: asRecord(params.body.post),
      postByChannel: asRecord(params.body.postByChannel),
      attemptedChannels: params.channels,
      idempotencyKey: params.idempotencyKey || null,
    },
    preparationRequest,
    preparationAttempt: 1,
    parentIdempotencyLockId: parentLockId,
    parentIdempotencyKey: params.idempotencyKey || null,
    mediaWorkspaceId: String(params.body.mediaWorkspaceId || "").trim() || null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const rows = [
    {
      id: publicationId,
      user_id: params.userId,
      module: params.module,
      type: BOOSTER_ASYNC_JOB_EVENT_TYPE,
      payload: parentPayload,
    },
    ...params.channels.map((channel) => ({
      id: channelEventIds[channel],
      user_id: params.userId,
      module: params.module,
      type: BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
      payload: {
        status: clientPreflightFailuresByChannel[channel]
          ? "failed"
          : "preparing",
        publication_id: publicationId,
        parentEventId: publicationId,
        channel,
        attempt: 0,
        ...(clientPreflightFailuresByChannel[channel]
          ? {
              result: clientPreflightFailuresByChannel[channel],
              completedAt: nowIso,
            }
          : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    })),
  ];

  const { error: insertError } = await supabaseAdmin.from("app_events").insert(rows);
  if (insertError) {
    // Two identical HTTP retries can observe the running lock before the first
    // insert is visible. The shared publication UUID makes the race harmless.
    const winner = await loadParent(params.userId, publicationId).catch(() => null);
    if (winner) {
      const accepted = acceptedFromParent({
        publicationId,
        parent: winner,
        fallbackChannels: params.channels,
        idempotencyKey: params.idempotencyKey,
      });
      return accepted;
    }

    // Keep the lock running with the same publicationId. A concurrent
    // request may already be committing these exact rows; marking this lock
    // failed would let a later retry recover it with a fresh UUID and create a
    // duplicate publication. The next retry safely reuses this publicationId.
    return {
      state: "error",
      status: 500,
      response: {
        ok: false,
        code: "publication_ingress_failed",
        retryable: true,
        error: "Impossible d’enregistrer la publication pour le moment.",
      },
    };
  }

  return {
    state: "accepted",
    publicationId,
    preparationRequest,
    response: acceptedResponse(
      publicationId,
      params.channels,
      params.idempotencyKey,
      clientPreflightFailuresByChannel,
    ),
  };
}

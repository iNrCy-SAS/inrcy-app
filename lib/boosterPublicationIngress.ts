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
import {
  buildBoosterPublicationTargets,
  stripMetaStoryOnlyPostContent,
} from "@/lib/metaPublicationTargets";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPublicationTargetPredecessor } from "@/lib/boosterPublicationSequence";

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

/** Optional placements fail independently from the other formats on a channel. */
export function normalizeClientPreflightFailuresByTarget(
  value: unknown,
  channels: BoosterPublicationChannelKey[],
) {
  const source = asRecord(value);
  const failures: Record<string, JsonRecord> = {};
  for (const channel of channels) {
    if (channel !== "facebook" && channel !== "instagram") continue;
    for (const placement of ["classic", "reel", "story"]) {
      const key = `${channel}:${placement}`;
      const raw = asRecord(source[key]);
      if (!Object.keys(raw).length) continue;
      failures[key] = {
        ok: false,
        code: String(raw.code || "prepublish_validation_failed").slice(0, 100),
        error: String(raw.error || raw.message || "Ce format n'est pas prêt à publier.").slice(0, 600),
        retryable: false,
        source: "client_preflight",
        placement,
      };
    }
  }
  return failures;
}

export function buildDurablePreparationInput(body: JsonRecord) {
  const rawPostsByChannel = asRecord(body.postByChannel);
  const facebookPost = asRecord(rawPostsByChannel.facebook);
  const instagramPost = asRecord(rawPostsByChannel.instagram);
  const postByChannel = {
    ...rawPostsByChannel,
    ...(Object.keys(facebookPost).length
      ? {
          facebook: stripMetaStoryOnlyPostContent(
            facebookPost,
            body.facebookPublicationSettings,
          ),
        }
      : {}),
    ...(Object.keys(instagramPost).length
      ? {
          instagram: stripMetaStoryOnlyPostContent(
            instagramPost,
            body.instagramPublicationSettings,
          ),
        }
      : {}),
  };
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
    postByChannel,
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
    imagesByPlacement: body.imagesByPlacement,
    imageSettingsByChannel: body.imageSettingsByChannel,
    tiktokPublicationSettings: body.tiktokPublicationSettings,
    instagramPublicationSettings: body.instagramPublicationSettings,
    facebookPublicationSettings: body.facebookPublicationSettings,
    publicationTargets: body.publicationTargets,
    clientPreflightFailuresByTarget: body.clientPreflightFailuresByTarget,
    storySequenceResumeByChannel: body.storySequenceResumeByChannel,
    soundtrackId: body.soundtrackId,
    soundtrackByChannel: body.soundtrackByChannel,
    threadsPublicationSettings: body.threadsPublicationSettings,
    pinterestPublicationSettings: body.pinterestPublicationSettings,
    skipScheduledDuplicateCheck: body.skipScheduledDuplicateCheck,
    allowDuplicateImmediatePublish: body.allowDuplicateImmediatePublish,
  };
}

function queuedSummary(
  channels: BoosterPublicationChannelKey[],
  failuresByChannel: Partial<Record<BoosterPublicationChannelKey, JsonRecord>>,
  targets: Array<{ key: string; channel: BoosterPublicationChannelKey; placement: string | null }> = channels.map(channel => ({ key: channel, channel, placement: null })),
  failuresByTarget: Record<string, JsonRecord> = {},
  threadsMode: unknown = "classic",
) {
  const entries = targets.map(target => {
    const channel = target.channel;
    const placement = channel === "facebook" || channel === "instagram" ? target.placement || "classic" : null;
    const failure = failuresByTarget[`${channel}:${placement}`] || failuresByChannel[channel];
    return {
    channel,
    targetKey: placement ? `${channel}:${placement}` : channel,
    placement,
    ...(channel === "threads" ? { threads_publication_mode: threadsMode || "classic" } : {}),
    label: BOOSTER_PUBLICATION_CHANNEL_LABELS[channel],
    ok: failure ? false : null,
    status: failure ? "failed" : "preparing",
    technicalStatus: failure ? "failed" : "preparing",
    code: failure?.code || null,
    retryable: failure?.retryable === true,
    error: failure?.error || null,
    warning: null,
    warning_message: null,
    };
  });
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
    failedChannels: Array.from(new Set(failedChannels)),
  };
}

function acceptedResponse(
  publicationId: string,
  channels: BoosterPublicationChannelKey[],
  idempotencyKey: string,
  failuresByChannel: Partial<Record<BoosterPublicationChannelKey, JsonRecord>>,
  targets?: Array<{ key: string; channel: BoosterPublicationChannelKey; placement: string | null }>,
  failuresByTarget: Record<string, JsonRecord> = {},
  threadsMode: unknown = "classic",
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
    summary: queuedSummary(channels, failuresByChannel, targets, failuresByTarget, threadsMode),
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
        Array.isArray(payload.publicationTargets) ? payload.publicationTargets as Array<{ key: string; channel: BoosterPublicationChannelKey; placement: string | null }> : undefined,
        normalizeClientPreflightFailuresByTarget(payload.clientPreflightFailuresByTarget, persistedChannels),
        asRecord(preparationRequest.threadsPublicationSettings).mode,
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
  const publicationTargets = buildBoosterPublicationTargets({
    channels: params.channels,
    instagramPublicationSettings: params.body.instagramPublicationSettings,
    facebookPublicationSettings: params.body.facebookPublicationSettings,
  });
  const channelEventIds = Object.fromEntries(
    publicationTargets.map((target) => [target.key, randomUUID()]),
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
  const clientPreflightFailuresByTarget = normalizeClientPreflightFailuresByTarget(
    params.body.clientPreflightFailuresByTarget, params.channels,
  );
  const preparationRequest = {
    ...durableBody,
    channels: params.channels,
    clientPreflightFailuresByChannel,
    clientPreflightFailuresByTarget,
    _asyncPreparationDispatch: true,
    _asyncPublicationId: publicationId,
    _asyncParentEventId: publicationId,
    _asyncChannelEventIds: channelEventIds,
    _asyncPublicationTargets: publicationTargets,
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
    publicationTargets,
    clientPreflightFailuresByChannel,
    clientPreflightFailuresByTarget,
    channelEventIds,
    deliveryIds,
    finalEventType: params.finalEventType,
    finalPayloadBase: {
      idea: String(params.body.idea || ""),
      post: asRecord(params.body.post),
      postByChannel: asRecord(durableBody.postByChannel),
      attemptedChannels: params.channels,
      threadsPublicationSettings: durableBody.threadsPublicationSettings,
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
    ...publicationTargets.map((target) => ({
      id: channelEventIds[target.key],
      user_id: params.userId,
      module: params.module,
      type: BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
      payload: {
        status: (clientPreflightFailuresByTarget[`${target.channel}:${target.placement}`] || clientPreflightFailuresByChannel[target.channel])
          ? "failed"
          : "preparing",
        publication_id: publicationId,
        parentEventId: publicationId,
        channel: target.channel,
        ...(target.channel === "threads" ? { threadsPublicationMode: asRecord(durableBody.threadsPublicationSettings).mode || "classic" } : {}),
        targetKey: target.key,
        placement: target.placement,
        dependsOnEventId: getPublicationTargetPredecessor(target, publicationTargets, channelEventIds),
        targetCount: publicationTargets.filter(
          (candidate) => candidate.channel === target.channel,
        ).length,
        attempt: 0,
        ...((clientPreflightFailuresByTarget[`${target.channel}:${target.placement}`] || clientPreflightFailuresByChannel[target.channel])
          ? {
              result: clientPreflightFailuresByTarget[`${target.channel}:${target.placement}`] || clientPreflightFailuresByChannel[target.channel],
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
      publicationTargets,
      clientPreflightFailuresByTarget,
      asRecord(durableBody.threadsPublicationSettings).mode,
    ),
  };
}

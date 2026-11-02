import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { updateAsyncChannelEvent } from "@/lib/boosterAsyncPublication";
import { failExecutionIdempotencyLock } from "@/lib/executionIdempotency";
import type { TikTokVideoUploadCheckpoint } from "@/lib/tiktokRangeUpload";
import type { InstagramVideoPublishCheckpoint, InstagramVideoPhaseResult } from "@/lib/instagramVideoPublishPhases";
import type { YoutubeResumableUploadCheckpoint, YoutubeResumableUploadPhaseResult } from "@/lib/youtubeShortsPublish";
import type { PinterestVideoProtocolCheckpoint, PinterestVideoDurableStepResult } from "@/lib/pinterestVideoProtocol";
import type { ChannelKey, JsonRecord } from "./publishNow.foundations";

type PublishNowContinuationContext = {
  userId: string;
  publicationId: string;
  internalAsyncDispatch: boolean;
  asyncChannelEventId: string;
  asyncChannelLockId: string | null;
  setDelivery: (channel: ChannelKey, patch: JsonRecord) => Promise<void>;
  clearAsyncFailureContext: () => void;
};

/** Binds one claimed dispatch to its durable checkpoint and continuation protocol. */
export function createPublishNowContinuations({
  userId, publicationId, internalAsyncDispatch, asyncChannelEventId, asyncChannelLockId,
  setDelivery, clearAsyncFailureContext,
}: PublishNowContinuationContext) {
  async function persistTikTokUploadCheckpoint(
    checkpoint: TikTokVideoUploadCheckpoint,
  ) {
    if (!internalAsyncDispatch || !asyncChannelEventId) return;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await updateAsyncChannelEvent({
          userId,
          eventId: asyncChannelEventId,
          patch: { tiktokUploadCheckpoint: checkpoint },
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * 2 ** attempt),
          );
        }
      }
    }
    throw lastError || new Error("tiktok_checkpoint_persist_failed");
  }

  async function persistInstagramVideoCheckpoint(
    checkpoint: InstagramVideoPublishCheckpoint,
    patch: JsonRecord = {},
  ) {
    if (!internalAsyncDispatch || !asyncChannelEventId) {
      throw new Error("instagram_video_checkpoint_requires_async_worker");
    }
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await updateAsyncChannelEvent({
          userId,
          eventId: asyncChannelEventId,
          patch: {
            ...patch,
            instagramVideoCheckpoint: checkpoint,
            instagramVideoPhase: checkpoint.state,
          },
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 200 * 2 ** attempt),
          );
        }
      }
    }
    throw lastError || new Error("instagram_video_checkpoint_persist_failed");
  }

  async function queueInstagramVideoContinuation(params: {
    checkpoint: InstagramVideoPublishCheckpoint;
    phaseResult: InstagramVideoPhaseResult;
  }) {
    const requestedRetryAfterMs =
      "retryAfterMs" in params.phaseResult
        ? Number(params.phaseResult.retryAfterMs || 0)
        : 0;
    const retryAfterMs = Math.max(
      1_000,
      Math.min(60_000, requestedRetryAfterMs || 3_000),
    );
    await persistInstagramVideoCheckpoint(params.checkpoint, {
      status: "queued",
      instagramVideoContinuation: true,
      instagramVideoNextPollAt: new Date(
        Date.now() + retryAfterMs,
      ).toISOString(),
      lastInstagramVideoPhaseResult: {
        ok: params.phaseResult.ok,
        phase: params.phaseResult.phase,
        outcome: params.phaseResult.outcome,
        code: params.phaseResult.ok ? null : params.phaseResult.code,
      },
    });
    await setDelivery("instagram", { status: "processing", error: null });
    await failExecutionIdempotencyLock({
      supabase: supabaseAdmin,
      lockId: asyncChannelLockId,
      error: "instagram_video_continuation",
      result: {
        ok: true,
        pending: true,
        code: "instagram_video_processing",
        publication_id: publicationId,
        channel: "instagram",
        container_id: params.checkpoint.containerId,
        phase: params.checkpoint.state,
      },
      metadata: {
        publicationId,
        channel: "instagram",
        asyncDispatch: true,
        continuation: true,
      },
    });
    clearAsyncFailureContext();
    const pendingResult = {
      ok: true,
      pending: true,
      status: "processing",
      code: "instagram_video_processing",
      container_id: params.checkpoint.containerId,
      phase: params.checkpoint.state,
    };
    return NextResponse.json(
      {
        ok: true,
        done: false,
        queued: true,
        asyncDispatch: true,
        publication_id: publicationId,
        channel: "instagram",
        pollAfterMs: retryAfterMs,
        results: { instagram: pendingResult },
      },
      {
        status: 202,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
        },
      },
    );
  }

  async function queueInstagramRateLimitRetry(params: {
    error: string;
    retryAfterMs?: number;
  }) {
    if (!internalAsyncDispatch || !asyncChannelEventId) return null;
    const retryAfterMs = Math.max(
      30_000,
      Math.min(5 * 60_000, Number(params.retryAfterMs || 60_000)),
    );
    const nextRunAt = new Date(Date.now() + retryAfterMs).toISOString();

    await updateAsyncChannelEvent({
      userId,
      eventId: asyncChannelEventId,
      patch: {
        status: "queued",
        instagramRateLimitNextRunAt: nextRunAt,
        lastInstagramRateLimitError: params.error,
      },
    });
    await setDelivery("instagram", { status: "processing", error: null });
    await failExecutionIdempotencyLock({
      supabase: supabaseAdmin,
      lockId: asyncChannelLockId,
      error: "instagram_rate_limited",
      result: {
        ok: true,
        pending: true,
        code: "instagram_rate_limited",
        retryable: true,
        publication_id: publicationId,
        channel: "instagram",
        next_run_at: nextRunAt,
      },
      metadata: {
        publicationId,
        channel: "instagram",
        asyncDispatch: true,
        retryReason: "meta_rate_limit",
      },
    });
    console.info("[instagram-publish] Meta limit; automatic retry queued", {
      publicationId,
      retryAfterMs,
    });
    clearAsyncFailureContext();

    const pendingResult = {
      ok: true,
      pending: true,
      status: "processing",
      code: "instagram_rate_limited",
      retryable: true,
      next_run_at: nextRunAt,
    };
    return NextResponse.json(
      {
        ok: true,
        done: false,
        queued: true,
        asyncDispatch: true,
        publication_id: publicationId,
        channel: "instagram",
        pollAfterMs: retryAfterMs,
        results: { instagram: pendingResult },
      },
      {
        status: 202,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
        },
      },
    );
  }

  async function persistYoutubeUploadCheckpoint(
    checkpoint: YoutubeResumableUploadCheckpoint,
    patch: JsonRecord = {},
  ) {
    if (!internalAsyncDispatch || !asyncChannelEventId) {
      throw new Error("youtube_upload_checkpoint_requires_async_worker");
    }
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await updateAsyncChannelEvent({
          userId,
          eventId: asyncChannelEventId,
          patch: {
            ...patch,
            youtubeUploadCheckpoint: checkpoint,
            youtubeUploadPhase: checkpoint.state,
            youtubeUploadOffset: checkpoint.offset,
            youtubeUploadTotalBytes: checkpoint.totalBytes,
          },
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 200 * 2 ** attempt),
          );
        }
      }
    }
    throw lastError || new Error("youtube_upload_checkpoint_persist_failed");
  }

  async function queueYoutubeUploadContinuation(params: {
    checkpoint: YoutubeResumableUploadCheckpoint;
    phaseResult: YoutubeResumableUploadPhaseResult;
  }) {
    const requestedRetryAfterMs = Number(
      "retryAfterMs" in params.phaseResult
        ? params.phaseResult.retryAfterMs || 0
        : 0,
    );
    const retryAfterMs = Math.max(
      1_000,
      Math.min(60_000, requestedRetryAfterMs || 2_000),
    );
    await persistYoutubeUploadCheckpoint(params.checkpoint, {
      status: "queued",
      youtubeUploadContinuation: true,
      youtubeUploadNextRunAt: new Date(
        Date.now() + retryAfterMs,
      ).toISOString(),
      lastYoutubeUploadPhaseResult: {
        ok: params.phaseResult.ok,
        phase: params.phaseResult.phase,
        outcome: params.phaseResult.outcome,
        code: params.phaseResult.ok ? null : params.phaseResult.code,
      },
    });
    await setDelivery("youtube_shorts", {
      status: "processing",
      error: null,
    });
    await failExecutionIdempotencyLock({
      supabase: supabaseAdmin,
      lockId: asyncChannelLockId,
      error: "youtube_upload_continuation",
      result: {
        ok: true,
        pending: true,
        code: "youtube_upload_processing",
        publication_id: publicationId,
        channel: "youtube_shorts",
        offset: params.checkpoint.offset,
        total_bytes: params.checkpoint.totalBytes,
      },
      metadata: {
        publicationId,
        channel: "youtube_shorts",
        asyncDispatch: true,
        continuation: true,
      },
    });
    clearAsyncFailureContext();
    return NextResponse.json(
      {
        ok: true,
        done: false,
        queued: true,
        asyncDispatch: true,
        publication_id: publicationId,
        channel: "youtube_shorts",
        pollAfterMs: retryAfterMs,
        results: {
          youtube_shorts: {
            ok: true,
            pending: true,
            status: "processing",
            code: "youtube_upload_processing",
            offset: params.checkpoint.offset,
            total_bytes: params.checkpoint.totalBytes,
          },
        },
      },
      {
        status: 202,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
        },
      },
    );
  }

  async function persistPinterestVideoCheckpoint(
    checkpoint: PinterestVideoProtocolCheckpoint,
    patch: JsonRecord = {},
  ) {
    if (!internalAsyncDispatch || !asyncChannelEventId) {
      throw new Error("pinterest_video_checkpoint_requires_async_worker");
    }
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await updateAsyncChannelEvent({
          userId,
          eventId: asyncChannelEventId,
          patch: {
            pinterestVideoCheckpoint: checkpoint,
            pinterestVideoPhase: checkpoint.phase,
            pinterestVideoNextPollAt: checkpoint.nextPollAt || null,
            ...patch,
          },
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 200 * 2 ** attempt),
          );
        }
      }
    }
    throw lastError || new Error("pinterest_video_checkpoint_persist_failed");
  }

  async function queuePinterestVideoContinuation(params: {
    step: PinterestVideoDurableStepResult;
  }) {
    const requestedNextRunAt = Date.parse(
      String(
        params.step.retryAt ||
          params.step.checkpoint.nextPollAt ||
          "",
      ),
    );
    const nextRunAt = new Date(
      Number.isFinite(requestedNextRunAt) && requestedNextRunAt > Date.now()
        ? requestedNextRunAt
        : Date.now() + 1_000,
    ).toISOString();
    await persistPinterestVideoCheckpoint(params.step.checkpoint, {
      status: "queued",
      pinterestVideoContinuation: true,
      pinterestVideoNextPollAt: nextRunAt,
      lastPinterestVideoStepState: params.step.state,
    });
    await setDelivery("pinterest", { status: "processing", error: null });
    await failExecutionIdempotencyLock({
      supabase: supabaseAdmin,
      lockId: asyncChannelLockId,
      error: "pinterest_video_continuation",
      result: {
        ok: true,
        pending: true,
        code: "pinterest_video_processing",
        publication_id: publicationId,
        channel: "pinterest",
        phase: params.step.checkpoint.phase,
        media_id: params.step.checkpoint.mediaId || null,
      },
      metadata: {
        publicationId,
        channel: "pinterest",
        asyncDispatch: true,
        continuation: true,
      },
    });
    clearAsyncFailureContext();
    const retryAfterMs = Math.max(
      1_000,
      Date.parse(nextRunAt) - Date.now(),
    );
    return NextResponse.json(
      {
        ok: true,
        done: false,
        queued: true,
        asyncDispatch: true,
        publication_id: publicationId,
        channel: "pinterest",
        pollAfterMs: retryAfterMs,
        results: {
          pinterest: {
            ok: true,
            pending: true,
            status: "processing",
            code: "pinterest_video_processing",
            phase: params.step.checkpoint.phase,
            media_id: params.step.checkpoint.mediaId || null,
          },
        },
      },
      {
        status: 202,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
        },
      },
    );
  }

  return {
    persistTikTokUploadCheckpoint,
    persistInstagramVideoCheckpoint,
    queueInstagramVideoContinuation,
    queueInstagramRateLimitRetry,
    persistYoutubeUploadCheckpoint,
    queueYoutubeUploadContinuation,
    persistPinterestVideoCheckpoint,
    queuePinterestVideoContinuation,
  };
}

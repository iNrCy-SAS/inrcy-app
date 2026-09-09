import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GoogleGenAI } from "@google/genai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { getAiMediaVideoSegmentDurations } from "@/lib/aiMediaVideoTimeline";
import {
  extractAiMediaVideoContinuityFrame,
  type AiMediaVideoContinuityFrame,
} from "./aiMediaVideoContinuity.ts";
import { redactAiMediaSensitiveText } from "@/lib/aiMediaSensitiveText";
import {
  buildGoogleVideoSafetyFallbackPrompt,
  buildGoogleVideoScenePrompt,
  googleVeoVideoProvider,
} from "@/lib/aiVideoProviderGoogleVeo";
import { classifyVeoFailure } from "@/lib/aiVideoReliability";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "@/lib/mediaVideoNormalizer";
import {
  AiVideoProviderBillableFailure,
  assertAiVideoReferenceTeamGoogleEgress,
  isAiVideoProviderBillableFailure,
  type AiVideoProvider,
  type AiVideoProviderClip,
  type AiVideoProviderGenerationArgs,
  type AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

const PROVIDER_ID = "google-gemini-omni";
const DEFAULT_OMNI_MODEL = "gemini-omni-1.1-flash";
const DEFAULT_COST_MICRO_USD_PER_SECOND = 100_000;
const DEFAULT_TIMEOUT_MS = 420_000;
const DEFAULT_GENERATION_ATTEMPTS = 3;
const DEFAULT_DOWNLOAD_ATTEMPTS = 3;
const DEFAULT_FILE_POLL_MS = 2_000;
// Independent acts use the existing parallel path unless scene connections
// are explicitly requested. Stateful continuation remains an internal opt-in.
const DEFAULT_CONCURRENCY = 3;
const MAX_CLIP_BYTES = 128 * 1024 * 1024;

function compact(value: unknown, max = 500) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function positiveInt(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

function apiKey() {
  const value = String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      "",
  ).trim();
  if (!value) throw new Error("ai_video_omni_credentials_missing");
  return value;
}

function modelId() {
  return compact(process.env.AI_MEDIA_OMNI_MODEL, 160) || DEFAULT_OMNI_MODEL;
}

function costMicroUsdPerSecond() {
  return positiveInt(
    process.env.AI_MEDIA_OMNI_COST_MICRO_USD_PER_SECOND,
    DEFAULT_COST_MICRO_USD_PER_SECOND,
    1_000_000,
  );
}

function aspectRatio(
  format: AiVideoProviderGenerationArgs["request"]["format"],
): "16:9" | "9:16" {
  return format === "landscape" ? "16:9" : "9:16";
}

function generationCancelledError() {
  const error = new Error("ai_media_generation_cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw generationCancelledError();
}

function delay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(generationCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayMs(error: unknown, attempt: number) {
  const details = classifyVeoFailure(error).details;
  const explicitSeconds = details.match(
    /(?:retry(?:Delay)?|retry\s+in)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*s/i,
  );
  if (explicitSeconds) {
    return Math.min(
      30_000,
      Math.max(1_000, Number(explicitSeconds[1]) * 1_000),
    );
  }
  const schedule = [800, 2_000, 5_000] as const;
  const base = schedule[Math.min(attempt, schedule.length - 1)];
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

function safetyFilteredError(details: unknown) {
  const reason = compact(
    typeof details === "string" ? details : JSON.stringify(details),
    700,
  );
  return new Error(
    reason
      ? `ai_video_omni_safety_filtered:${reason}`
      : "ai_video_omni_safety_filtered",
  );
}

function normalizedProviderError(error: unknown) {
  const failure = classifyVeoFailure(error);
  const details = compact(failure.details, 700);
  if (failure.kind === "cancelled") return generationCancelledError();
  if (failure.kind === "safety") return safetyFilteredError(details);
  const codes: Partial<Record<typeof failure.kind, string>> = {
    invalid_argument: "ai_video_omni_configuration_rejected",
    rate_limited: "ai_video_omni_rate_limited",
    unavailable: "ai_video_omni_unavailable",
    timeout: "ai_video_omni_timeout",
    authentication: "ai_video_omni_credentials_rejected",
    permission: "ai_video_omni_permission_denied",
    not_found: "ai_video_omni_model_unavailable",
    network: "ai_video_omni_network_failed",
  };
  const code = codes[failure.kind] || "ai_video_omni_operation_failed";
  return new Error(details ? `${code}:${details}` : code);
}

function isSafetyFiltered(error: unknown) {
  return compact(
    error instanceof Error ? error.message : error,
    1_000,
  ).includes("ai_video_omni_safety_filtered");
}

function veoFallbackEnabled() {
  return !["0", "false", "off", "no"].includes(
    compact(process.env.AI_MEDIA_OMNI_FALLBACK_TO_VEO, 16).toLowerCase(),
  );
}

function statefulContinuationEnabled() {
  return ["1", "true", "on", "yes"].includes(
    compact(
      process.env.AI_MEDIA_OMNI_STATEFUL_CONTINUATION_ENABLED,
      16,
    ).toLowerCase(),
  );
}

function mayUseVeoFallback(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  const details = compact(
    error instanceof Error ? error.message : error,
    1_000,
  ).toLowerCase();
  return !(
    details.includes("ai_media_generation_cancelled") ||
    details.includes("aborterror") ||
    details.includes("ai_video_omni_clip_billable_failure") ||
    details.includes("ai_video_omni_credentials") ||
    details.includes("ai_video_omni_permission")
  );
}

function preservesIdentityReferences(
  request: AiVideoProviderGenerationArgs["request"],
) {
  return (
    request.inspirationImages.length > 0 &&
    (request.teamVideoMode === "cinematic" ||
      request.videoCharacterMode === "professional" ||
      request.videoCharacterMode === "brand_avatar" ||
      request.videoCharacterMode === "reference_team")
  );
}

function identityReferenceRejectedError(error: unknown) {
  const details = compact(classifyVeoFailure(error).details, 620);
  return new Error(
    details
      ? `ai_video_identity_reference_rejected:${details}`
      : "ai_video_identity_reference_rejected",
  );
}

function isIdentityReferenceRejected(error: unknown) {
  return compact(
    error instanceof Error ? error.message : error,
    1_000,
  ).includes("ai_video_identity_reference_rejected");
}

function assertMp4Clip(buffer: Buffer) {
  if (!buffer.length) throw new Error("ai_video_omni_clip_empty");
  if (buffer.length > MAX_CLIP_BYTES) {
    throw new Error("ai_video_omni_clip_too_large");
  }
  const signatureOffset = buffer.indexOf(Buffer.from("ftyp"), 0);
  if (signatureOffset < 4 || signatureOffset > 24) {
    throw new Error("ai_video_omni_clip_not_mp4");
  }
}

async function downloadVideoUri(args: {
  uri: string;
  key: string;
  signal: AbortSignal;
}) {
  if (!/^https:\/\//i.test(args.uri)) {
    throw new Error("ai_video_omni_download_uri_invalid");
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < DEFAULT_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(args.uri, {
        cache: "no-store",
        headers: { "x-goog-api-key": args.key },
        signal: args.signal,
      });
      if (!response.ok) {
        throw new Error(`omni_download_http_${response.status}`);
      }
      const declaredLength = Number(
        response.headers.get("content-length") || 0,
      );
      if (declaredLength > MAX_CLIP_BYTES) {
        throw new Error("ai_video_omni_clip_too_large");
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      assertMp4Clip(buffer);
      return buffer;
    } catch (error) {
      lastError = error;
      throwIfAborted(args.signal);
      const retryable =
        classifyVeoFailure(error).retryable ||
        /omni_download_http_(?:408|409|425|429|5\d\d)|ai_video_omni_clip_(?:empty|not_mp4)/.test(
          compact(error instanceof Error ? error.message : error, 240),
        );
      if (attempt >= DEFAULT_DOWNLOAD_ATTEMPTS - 1 || !retryable) break;
      await delay(retryDelayMs(error, attempt), args.signal);
    }
  }
  const details = compact(classifyVeoFailure(lastError).details, 700);
  throw new Error(
    details
      ? `ai_video_omni_download_failed:${details}`
      : "ai_video_omni_download_failed",
  );
}

function googleFileNameFromUri(uri: string) {
  const match = decodeURIComponent(uri).match(/(?:^|\/)(files\/[a-z0-9-]+)/i);
  if (!match?.[1]) throw new Error("ai_video_omni_file_uri_invalid");
  return match[1];
}

async function waitForVideoFile(args: {
  ai: GoogleGenAI;
  uri: string;
  signal: AbortSignal;
}) {
  const name = googleFileNameFromUri(args.uri);
  const pollMs = positiveInt(
    process.env.AI_MEDIA_OMNI_FILE_POLL_MS,
    DEFAULT_FILE_POLL_MS,
    10_000,
  );
  let transientFailures = 0;

  while (true) {
    throwIfAborted(args.signal);
    try {
      const file = await args.ai.files.get({
        name,
        config: { abortSignal: args.signal },
      });
      transientFailures = 0;
      const state = compact(file.state, 40).toUpperCase();
      if (state === "ACTIVE") return file.downloadUri || args.uri;
      if (state === "FAILED") {
        const details = compact(file.error?.message, 700);
        throw new Error(
          details
            ? `ai_video_omni_file_failed:${details}`
            : "ai_video_omni_file_failed",
        );
      }
      await delay(pollMs, args.signal);
    } catch (error) {
      throwIfAborted(args.signal);
      const message = compact(
        error instanceof Error ? error.message : error,
        900,
      );
      if (message.includes("ai_video_omni_file_failed")) throw error;
      const failure = classifyVeoFailure(error);
      transientFailures += 1;
      if (
        !failure.retryable ||
        transientFailures >= DEFAULT_DOWNLOAD_ATTEMPTS
      ) {
        throw error;
      }
      await delay(retryDelayMs(error, transientFailures - 1), args.signal);
    }
  }
}

async function readOutputVideo(args: {
  ai: GoogleGenAI;
  output: { data?: string; mime_type?: string; uri?: string };
  key: string;
  signal: AbortSignal;
}) {
  let uriError: unknown = null;
  // At 720p an eight-second MP4 commonly exceeds the 4 MB inline response
  // limit. URI delivery plus File API polling is Google's supported path and
  // avoids receiving a truncated, non-MP4 payload.
  if (args.output.uri) {
    try {
      const downloadUri = await waitForVideoFile({
        ai: args.ai,
        uri: args.output.uri,
        signal: args.signal,
      });
      return {
        buffer: await downloadVideoUri({
          uri: downloadUri,
          key: args.key,
          signal: args.signal,
        }),
        mediaType: "video/mp4",
      };
    } catch (error) {
      uriError = error;
      if (!args.output.data) throw error;
    }
  }
  if (args.output.data) {
    try {
      const buffer = Buffer.from(args.output.data, "base64");
      assertMp4Clip(buffer);
      return { buffer, mediaType: "video/mp4" };
    } catch (error) {
      throw uriError || error;
    }
  }
  throw uriError || new Error("ai_video_omni_video_missing");
}

async function probeDownloadedVideoDuration(args: {
  buffer: Buffer;
  signal?: AbortSignal;
}) {
  const directory = await mkdtemp(join(tmpdir(), "inrcy-omni-probe-"));
  const inputPath = join(directory, "continuation.mp4");
  try {
    args.signal?.throwIfAborted();
    await writeFile(inputPath, args.buffer);
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    const metadata = await probeVideoSource({
      ffmpegPath,
      inputPath,
      timeoutMs: 60_000,
    });
    return metadata.durationSeconds;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function generateClip(args: {
  ai: GoogleGenAI;
  key: string;
  model: string;
  generationArgs: AiVideoProviderGenerationArgs;
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  inspirationImages: AiVideoProviderGenerationArgs["request"]["inspirationImages"];
  preserveIdentityReferences: boolean;
  continuityFrame?: AiMediaVideoContinuityFrame;
  previousInteractionId?: string;
  timeoutMs: number;
  onBillable: () => void;
}): Promise<AiVideoProviderClip> {
  throwIfAborted(args.generationArgs.signal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(generationCancelledError());
  args.generationArgs.signal?.addEventListener("abort", abortFromCaller, {
    once: true,
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("ai_video_omni_timeout"));
  }, args.timeoutMs);

  try {
    const contentAttempts =
      args.preserveIdentityReferences || args.continuityFrame
        ? [
            {
              prompt: args.prompt,
              images: args.inspirationImages,
              warning: "",
            },
          ]
        : args.inspirationImages.length
        ? [
            {
              prompt: args.prompt,
              images: args.inspirationImages,
              warning: "",
            },
            {
              prompt: args.prompt,
              images: [],
              warning: "omni_inspiration_downgraded",
            },
            {
              prompt: buildGoogleVideoSafetyFallbackPrompt(args.prompt),
              images: [],
              warning: "omni_safety_prompt_recovery",
            },
          ]
        : [
            { prompt: args.prompt, images: [], warning: "" },
            {
              prompt: buildGoogleVideoSafetyFallbackPrompt(args.prompt),
              images: [],
              warning: "omni_safety_prompt_recovery",
            },
          ];
    const warnings: string[] = [];
    let lastError: unknown = null;

    for (
      let contentIndex = 0;
      contentIndex < contentAttempts.length;
      contentIndex += 1
    ) {
      const contentAttempt = contentAttempts[contentIndex];
      for (
        let transientAttempt = 0;
        transientAttempt < DEFAULT_GENERATION_ATTEMPTS;
        transientAttempt += 1
      ) {
        let billableOutputExists = false;
        try {
          const input = [
            ...(args.continuityFrame ? [{
              type: "image" as const,
              data: args.continuityFrame.data,
              mime_type: args.continuityFrame.mimeType,
            }] : []),
            ...contentAttempt.images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mime_type: image.mimeType,
            })),
            { type: "text" as const, text: contentAttempt.prompt },
          ];
          const interaction = await args.ai.interactions.create(
            {
              model: args.model,
              input,
              ...(args.previousInteractionId
                ? { previous_interaction_id: args.previousInteractionId }
                : {}),
              response_format: {
                type: "video",
                aspect_ratio: args.aspectRatio,
                resolution: "720p",
                duration: `${args.durationSeconds}s`,
                delivery: "uri",
              },
              background: false,
              // Gemini requires stored interactions when a generated video is
              // delivered through the Files API. Sending `store: false` with
              // `delivery: "uri"` is rejected with HTTP 400 before generation.
              store: true,
              stream: false,
            },
            {
              signal: controller.signal,
              timeout_ms: args.timeoutMs,
              retries: { strategy: "none" },
            },
          );
          if (!interaction.output_video) {
            const details = compact(
              JSON.stringify(interaction.errors || interaction.status),
              700,
            );
            if (/safety|rai|responsible|blocked|prohibited/i.test(details)) {
              throw safetyFilteredError(details);
            }
            throw new Error(
              details
                ? `ai_video_omni_video_missing:${details}`
                : "ai_video_omni_video_missing",
            );
          }
          // From this point Google returned a generated asset. Mark it before
          // any local validation so a corrupt download or missing metadata can
          // never trigger a second paid generation through the Veo fallback.
          billableOutputExists = true;
          args.onBillable();
          const requestId = compact(interaction.id, 220);
          if (!requestId) {
            throw new Error("ai_video_omni_interaction_id_missing");
          }
          const downloaded = await readOutputVideo({
            ai: args.ai,
            output: interaction.output_video,
            key: args.key,
            signal: controller.signal,
          });
          if (contentAttempt.warning) warnings.push(contentAttempt.warning);
          return {
            ...downloaded,
            durationSeconds: args.durationSeconds,
            requestId,
            model: args.model,
            warnings: Array.from(new Set(warnings)),
          };
        } catch (error) {
          if (billableOutputExists) {
            const details = compact(
              error instanceof Error ? error.message : error,
              700,
            );
            throw new Error(
              `ai_video_omni_clip_billable_failure:${
                details || "output_processing_failed"
              }`,
            );
          }
          lastError = normalizedProviderError(error);
          const failure = classifyVeoFailure(lastError);
          if (
            transientAttempt < DEFAULT_GENERATION_ATTEMPTS - 1 &&
            failure.retryable
          ) {
            await delay(
              retryDelayMs(lastError, transientAttempt),
              controller.signal,
            );
            continue;
          }
          break;
        }
      }

      const failure = classifyVeoFailure(lastError);
      const nextAttempt = contentAttempts[contentIndex + 1];
      if (
        args.preserveIdentityReferences &&
        (failure.kind === "invalid_argument" || failure.kind === "safety")
      ) {
        throw isIdentityReferenceRejected(lastError)
          ? lastError
          : identityReferenceRejectedError(lastError);
      }
      const canDropInspiration =
        !args.preserveIdentityReferences &&
        contentAttempt.images.length > 0 &&
        (failure.kind === "invalid_argument" || failure.kind === "safety");
      const canUseSafetyPrompt =
        isSafetyFiltered(lastError) &&
        nextAttempt?.prompt !== contentAttempt.prompt;
      if (canDropInspiration || canUseSafetyPrompt) continue;
      break;
    }
    throw lastError || new Error("ai_video_omni_operation_failed");
  } catch (error) {
    if (timedOut) throw new Error("ai_video_omni_timeout");
    if (args.generationArgs.signal?.aborted) throw generationCancelledError();
    throw error;
  } finally {
    clearTimeout(timeout);
    args.generationArgs.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export const googleOmniVideoProvider: AiVideoProvider = {
  id: PROVIDER_ID,
  get model() {
    return modelId();
  },
  async generate(args): Promise<AiVideoProviderResult> {
    throwIfAborted(args.signal);
    assertAiVideoReferenceTeamGoogleEgress(args);
    const key = apiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const model = modelId();
    const timeoutMs = positiveInt(
      process.env.AI_MEDIA_VIDEO_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      600_000,
    );
    const preserveIdentityReferences = preservesIdentityReferences(
      args.request,
    );
    const durations: Array<4 | 6 | 8> = [
      ...getAiMediaVideoSegmentDurations(args.request.durationSeconds || 16),
    ];
    if (args.plan.scenes.length !== durations.length) {
      throw new Error("ai_video_omni_scene_count_invalid");
    }
    const connectScenes = durations.length > 1 && args.request.connectScenes === true;
    const configuredConcurrency = positiveInt(
      process.env.AI_MEDIA_OMNI_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      4,
    );
    const generationDeadline = Date.now() + Math.min(600_000, timeoutMs * durations.length);
    const continuationMode =
      connectScenes && statefulContinuationEnabled();
    let actualCostMicroUsd = 0;
    let fallbackCostMicroUsd = 0;
    const fallbackModels = new Set<string>();
    const providerWarnings: string[] = [];

    try {
      const clips = new Array<AiVideoProviderClip | undefined>(
        durations.length,
      );
      let cursor = 0;
      let stopped = false;
      let firstError: unknown = null;
      let previousInteractionId: string | undefined;
      const worker = async () => {
        while (!stopped && cursor < durations.length) {
          throwIfAborted(args.signal);
          const index = cursor;
          cursor += 1;
          const durationSeconds = durations[index];
          const isContinuation = continuationMode && index > 0;
          if (isContinuation && !previousInteractionId) {
            stopped = true;
            firstError ||= new Error(
              "ai_video_omni_continuation_context_missing",
            );
            continue;
          }
          const sceneCostMicroUsd = durationSeconds * costMicroUsdPerSecond();
          let sceneReservation: Awaited<
            ReturnType<typeof reserveAiGatewayAccountAttempt>
          > | null = null;
          let sceneBillable = false;
          try {
            const previousClip = connectScenes && !continuationMode && index > 0 ? clips[index - 1] : undefined;
            if (connectScenes && !continuationMode && index > 0 && !previousClip) {
              throw new Error("ai_video_continuity_context_missing");
            }
            const continuityFrame = previousClip
              ? await extractAiMediaVideoContinuityFrame({ ...previousClip, signal: args.signal })
              : undefined;
            const remainingMs = generationDeadline - Date.now();
            if (remainingMs <= 0) throw new Error("ai_video_omni_timeout");
            // Reserve each scene independently. If Omni rejects a scene before
            // returning an asset, its reservation is released before the Veo
            // fallback reserves the same scene. This prevents a temporary
            // double reservation from blocking an otherwise valid fallback.
            sceneReservation = await reserveAiGatewayAccountAttempt(
              args.accountId,
              {
                estimatedInputTokens: 0,
                reservedOutputTokens: 0,
                estimatedCostMicroUsd: sceneCostMicroUsd,
              },
            );
            const clip = await generateClip({
              ai,
              key,
              model,
              generationArgs: args,
              prompt: buildGoogleVideoScenePrompt(
                args,
                index,
                durationSeconds,
                { continuation: isContinuation, continuationFrame: Boolean(continuityFrame), firstFrameTag: true },
              ),
              durationSeconds,
              aspectRatio: aspectRatio(args.request.format),
              inspirationImages:
                index === 0 || (!connectScenes && preserveIdentityReferences)
                  ? args.request.inspirationImages
                  : [],
              continuityFrame,
              preserveIdentityReferences,
              previousInteractionId,
              timeoutMs: Math.min(timeoutMs, remainingMs),
              onBillable: () => {
                if (sceneBillable) return;
                sceneBillable = true;
                actualCostMicroUsd += sceneCostMicroUsd;
              },
            });
            clips[index] = continuityFrame
              ? { ...clip, warnings: [...clip.warnings, "video_last_frame_continuity"] }
              : clip;
            if (continuationMode) previousInteractionId = clip.requestId;
            await commitAiGatewayAccountAttempt({
              reservation: sceneReservation,
              feature: "media.video",
              model,
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              actualCostMicroUsd: sceneCostMicroUsd,
            });
          } catch (error) {
            if (sceneReservation) {
              if (sceneBillable) {
                await commitAiGatewayAccountAttempt({
                  reservation: sceneReservation,
                  feature: "media.video",
                  model,
                  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                  actualCostMicroUsd: sceneCostMicroUsd,
                }).catch(() => undefined);
              } else {
                await rollbackAiGatewayAccountAttempt(sceneReservation).catch(
                  () => undefined,
                );
              }
            }
            const effectiveError = sceneBillable
              ? new Error(
                  `ai_video_omni_clip_billable_failure:${
                    compact(
                      error instanceof Error ? error.message : error,
                      700,
                    ) || "output_processing_failed"
                  }`,
                )
              : error;
            const omniFailure = classifyVeoFailure(effectiveError);
            console.warn("[ai-media] Omni scene failed", {
              scene: index + 1,
              durationSeconds,
              model,
              billableOutputExists: sceneBillable,
              failureKind: omniFailure.kind,
              details: redactAiMediaSensitiveText(omniFailure.details, 500),
            });
            if (
              durations.length === 1 &&
              !continuationMode &&
              durationSeconds === 8 &&
              veoFallbackEnabled() &&
              mayUseVeoFallback(effectiveError, args.signal)
            ) {
              try {
                const fallback = await googleVeoVideoProvider.generate({
                  ...args,
                  request: {
                    ...args.request,
                    videoEngine: "veo",
                    durationSeconds,
                    inspirationImages:
                      preserveIdentityReferences || index === 0
                        ? args.request.inspirationImages
                        : [],
                  },
                  plan: {
                    ...args.plan,
                    scenes: [args.plan.scenes[index]],
                  },
                });
                const fallbackClip = fallback.clips[0];
                if (!fallbackClip || fallback.clips.length !== 1) {
                  throw new Error("ai_video_omni_veo_fallback_contract_failed");
                }
                clips[index] = fallbackClip;
                fallbackCostMicroUsd += fallback.estimatedCostMicroUsd;
                fallbackModels.add(fallback.model);
                providerWarnings.push(
                  `omni_scene_failure:${index + 1}:${omniFailure.kind}`,
                  `omni_scene_fallback_to_veo:${index + 1}`,
                  ...fallback.warnings,
                );
                continue;
              } catch (fallbackError) {
                stopped = true;
                firstError ||= fallbackError;
                continue;
              }
            }
            stopped = true;
            firstError ||= effectiveError;
          }
        }
      };
      const concurrency = connectScenes ? 1 : Math.min(configuredConcurrency, durations.length);
      // An in-flight act may still return a billable asset after another fails.
      // Settle every worker before exposing the failure to any outer fallback.
      const workers = await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
      for (const result of workers) {
        if (result.status === "rejected") firstError ||= result.reason;
      }
      if (firstError) throw firstError;
      if (clips.some((clip) => !clip)) {
        throw new Error("ai_video_omni_clip_set_incomplete");
      }
      let completedClips = clips as AiVideoProviderClip[];
      if (
        durations.length > 1 &&
        completedClips.some((clip) => clip.model !== model)
      ) {
        throw new Error("ai_video_omni_film_model_mixed");
      }
      if (continuationMode) {
        // Omni may return either the complete extended timeline or only the
        // newly appended delta, depending on the serving route. Probe instead
        // of guessing: a cumulative result is sliced logically for the
        // existing per-act overlays; delta results are concatenated directly.
        const finalClip = completedClips[completedClips.length - 1]!;
        const totalDurationSeconds = durations.reduce(
          (total, duration) => total + duration,
          0,
        );
        const finalDurationSeconds = await probeDownloadedVideoDuration({
          buffer: finalClip.buffer,
          signal: args.signal,
        });
        if (finalDurationSeconds >= totalDurationSeconds - 0.35) {
          let sourceStartSeconds = 0;
          completedClips = completedClips.map((clip, index) => {
            const logicalClip: AiVideoProviderClip = {
              ...finalClip,
              durationSeconds: durations[index],
              sourceStartSeconds,
              requestId: clip.requestId,
              warnings: Array.from(
                new Set([
                  ...finalClip.warnings,
                  "omni_stateful_continuation",
                  "omni_cumulative_continuation_output",
                ]),
              ),
            };
            sourceStartSeconds += durations[index];
            return logicalClip;
          });
        } else {
          const measuredDurations = await Promise.all(
            completedClips.map((clip) =>
              probeDownloadedVideoDuration({
                buffer: clip.buffer,
                signal: args.signal,
              }),
            ),
          );
          if (
            measuredDurations.some(
              (measured, index) => measured < durations[index] - 0.35,
            )
          ) {
            throw new Error("ai_video_omni_continuation_duration_invalid");
          }
          completedClips = completedClips.map((clip) => ({
            ...clip,
            sourceStartSeconds: 0,
            warnings: Array.from(
              new Set([
                ...clip.warnings,
                "omni_stateful_continuation",
                "omni_delta_continuation_output",
              ]),
            ),
          }));
        }
      }
      const usedFallbackModels = Array.from(fallbackModels);
      return {
        provider: usedFallbackModels.length
          ? `${PROVIDER_ID}+${googleVeoVideoProvider.id}`
          : PROVIDER_ID,
        model: [model, ...usedFallbackModels].join("+"),
        clips: completedClips,
        estimatedCostMicroUsd: actualCostMicroUsd + fallbackCostMicroUsd,
        warnings: Array.from(
          new Set([
            ...completedClips.flatMap((clip) => clip.warnings),
            ...providerWarnings,
          ]),
        ),
      };
    } catch (error) {
      await recordAiGatewayAccountFailure({
        accountId: args.accountId,
        feature: "media.video",
        model,
      }).catch(() => undefined);
      if (actualCostMicroUsd > 0) {
        if (isAiVideoProviderBillableFailure(error)) throw error;
        throw new AiVideoProviderBillableFailure({
          provider: PROVIDER_ID,
          model,
          stage: "film_incomplete",
          details: redactAiMediaSensitiveText(
            error instanceof Error ? error.message : error,
            700,
          ),
          cause: error,
        });
      }
      throw error;
    }
  },
};

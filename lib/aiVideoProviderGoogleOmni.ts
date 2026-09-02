import "server-only";

import { GoogleGenAI } from "@google/genai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { getAiMediaVideoSegmentDurations } from "@/lib/aiMediaVideoTimeline";
import {
  buildGoogleVideoSafetyFallbackPrompt,
  buildGoogleVideoScenePrompt,
  googleVeoVideoProvider,
} from "@/lib/aiVideoProviderGoogleVeo";
import { classifyVeoFailure } from "@/lib/aiVideoReliability";
import type {
  AiVideoProvider,
  AiVideoProviderClip,
  AiVideoProviderGenerationArgs,
  AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

const PROVIDER_ID = "google-gemini-omni";
const DEFAULT_OMNI_MODEL = "gemini-omni-1.1-flash";
const DEFAULT_COST_MICRO_USD_PER_SECOND = 100_000;
const DEFAULT_TIMEOUT_MS = 420_000;
const DEFAULT_GENERATION_ATTEMPTS = 3;
const DEFAULT_DOWNLOAD_ATTEMPTS = 3;
// An 8/16/24 s request contains at most three independent 8 s shots. Omni is
// synchronous, so launching all three is the shortest 24 s path. Transient
// quota errors are retried with jitter and the provider-level Veo fallback is
// still available if no Omni output has been billed.
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
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
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
  return compact(error instanceof Error ? error.message : error, 1_000).includes(
    "ai_video_omni_safety_filtered",
  );
}

function veoFallbackEnabled() {
  return !["0", "false", "off", "no"].includes(
    compact(process.env.AI_MEDIA_OMNI_FALLBACK_TO_VEO, 16).toLowerCase(),
  );
}

function mayUseVeoFallback(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  const details = compact(error instanceof Error ? error.message : error, 1_000)
    .toLowerCase();
  return !(
    details.includes("ai_media_generation_cancelled") ||
    details.includes("aborterror") ||
    details.includes("ai_video_omni_clip_billable_failure") ||
    details.includes("ai_video_omni_credentials") ||
    details.includes("ai_video_omni_permission")
  );
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
      const declaredLength = Number(response.headers.get("content-length") || 0);
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

async function readOutputVideo(args: {
  output: { data?: string; mime_type?: string; uri?: string };
  key: string;
  signal: AbortSignal;
}) {
  let inlineError: unknown = null;
  if (args.output.data) {
    try {
      const buffer = Buffer.from(args.output.data, "base64");
      assertMp4Clip(buffer);
      return { buffer, mediaType: "video/mp4" };
    } catch (error) {
      inlineError = error;
      if (!args.output.uri) throw error;
    }
  }
  if (!args.output.uri) {
    throw inlineError || new Error("ai_video_omni_video_missing");
  }
  return {
    buffer: await downloadVideoUri({
      uri: args.output.uri,
      key: args.key,
      signal: args.signal,
    }),
    mediaType: "video/mp4",
  };
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
    const contentAttempts = args.inspirationImages.length
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

    for (let contentIndex = 0; contentIndex < contentAttempts.length; contentIndex += 1) {
      const contentAttempt = contentAttempts[contentIndex];
      for (let transientAttempt = 0; transientAttempt < DEFAULT_GENERATION_ATTEMPTS; transientAttempt += 1) {
        let billableOutputExists = false;
        try {
          const input = [
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
              response_format: {
                type: "video",
                aspect_ratio: args.aspectRatio,
                resolution: "720p",
                duration: `${args.durationSeconds}s`,
                delivery: "inline",
              },
              background: false,
              store: false,
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
              `ai_video_omni_clip_billable_failure:${details || "output_processing_failed"}`,
            );
          }
          lastError = normalizedProviderError(error);
          const failure = classifyVeoFailure(lastError);
          if (
            transientAttempt < DEFAULT_GENERATION_ATTEMPTS - 1 &&
            failure.retryable
          ) {
            await delay(retryDelayMs(lastError, transientAttempt), controller.signal);
            continue;
          }
          break;
        }
      }

      const failure = classifyVeoFailure(lastError);
      const nextAttempt = contentAttempts[contentIndex + 1];
      const canDropInspiration =
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
    const key = apiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const model = modelId();
    const timeoutMs = positiveInt(
      process.env.AI_MEDIA_VIDEO_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      600_000,
    );
    const configuredConcurrency = positiveInt(
      process.env.AI_MEDIA_OMNI_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      4,
    );
    const durations: Array<4 | 6 | 8> = [
      ...getAiMediaVideoSegmentDurations(args.request.durationSeconds || 16),
    ];
    if (args.plan.scenes.length !== durations.length) {
      throw new Error("ai_video_omni_scene_count_invalid");
    }
    let actualCostMicroUsd = 0;
    let fallbackCostMicroUsd = 0;
    const fallbackModels = new Set<string>();
    const providerWarnings: string[] = [];

    try {
      const clips = new Array<AiVideoProviderClip | undefined>(durations.length);
      let cursor = 0;
      let stopped = false;
      let firstError: unknown = null;
      const worker = async () => {
        while (!stopped && cursor < durations.length) {
          throwIfAborted(args.signal);
          const index = cursor;
          cursor += 1;
          const durationSeconds = durations[index];
          const sceneCostMicroUsd =
            durationSeconds * costMicroUsdPerSecond();
          let sceneReservation: Awaited<
            ReturnType<typeof reserveAiGatewayAccountAttempt>
          > | null = null;
          let sceneBillable = false;
          try {
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
            clips[index] = await generateClip({
              ai,
              key,
              model,
              generationArgs: args,
              prompt: buildGoogleVideoScenePrompt(args, index, durationSeconds),
              durationSeconds,
              aspectRatio: aspectRatio(args.request.format),
              inspirationImages:
                index === 0 ? args.request.inspirationImages : [],
              timeoutMs,
              onBillable: () => {
                if (sceneBillable) return;
                sceneBillable = true;
                actualCostMicroUsd += sceneCostMicroUsd;
              },
            });
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
                  `ai_video_omni_clip_billable_failure:${compact(
                    error instanceof Error ? error.message : error,
                    700,
                  ) || "output_processing_failed"}`,
                )
              : error;
            if (
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
                      index === 0 ? args.request.inspirationImages : [],
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
      const concurrency = Math.min(configuredConcurrency, durations.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (firstError) throw firstError;
      if (clips.some((clip) => !clip)) {
        throw new Error("ai_video_omni_clip_set_incomplete");
      }
      const completedClips = clips as AiVideoProviderClip[];
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
        const details = compact(error instanceof Error ? error.message : error, 700);
        throw new Error(
          `ai_video_omni_billable_failure:${details || "output_processing_failed"}`,
        );
      }
      throw error;
    }
  },
};

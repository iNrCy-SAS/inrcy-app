import "server-only";

import { createDownload, experimental_generateVideo as generateVideo } from "ai";
import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { bufferFromUint8ArrayView } from "./aiMediaBuffer.ts";
import { AiMediaRequestValidationError } from "@/lib/aiMediaGenerationContracts";
import {
  getAiMediaVideoModel,
  getAiMediaVideoResolution,
  type AiMediaVideoEngine,
} from "./aiMediaModelCatalog.ts";
import { getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";
import { extractAiMediaVideoContinuityFrame, type AiMediaVideoContinuityFrame } from "./aiMediaVideoContinuity.ts";
import { createAiMediaVideoTemporaryImageStore } from "./aiMediaVideoTemporaryImages.ts";
import { redactAiMediaSensitiveText } from "@/lib/aiMediaSensitiveText";
import { assertAiMediaVideoProviderBoundary } from "./aiMediaVideoProviderContract.ts";
import { buildGoogleVideoScenePrompt, buildGoogleVideoTeamSpeechDirection } from "@/lib/aiVideoProviderGoogleVeo";
import {
  AiVideoProviderBillableFailure,
  assertAiVideoReferenceTeamProviderEgress,
  type AiVideoProvider,
  type AiVideoProviderGenerationArgs,
  type AiVideoProviderResult,
  type AiVideoProviderClip,
} from "@/lib/aiVideoProviderTypes";

const MAX_CLIP_BYTES = 128 * 1024 * 1024;
const downloadClip = createDownload({ maxBytes: MAX_CLIP_BYTES });
const diagnostic = (value: unknown) => redactAiMediaSensitiveText(value, 1000)
  .replace(/https?:\/\/[^\s"'<>]+/gi, "[provider-url-redacted]");

/** Dense Wan transport retains the complete user contract and exact spoken line. */
export function buildWanFlashVideoPrompt(args: AiVideoProviderGenerationArgs, validatedPrompt: string, index = 0, duration = args.request.durationSeconds ?? 8): string {
  const { providerContract: contract } = args;
  const user = contract.instruction;
  const subject = contract.subject && contract.subject !== user && !user.includes(contract.subject) ? contract.subject : "";
  const scene = String(args.plan.scenes[index]?.visualBrief || "").trim();
  const action = scene.length <= 150 ? scene : `${scene.slice(0, 100).replace(/\s+\S*$/, "")}… ${scene.slice(-40).replace(/^\S*\s/, "")}`;
  const audio = args.request.creationMode === "free"
    ? validatedPrompt.split("\n").filter((line) => /^(?:NATIVE DIALOGUE:|NATIVE VOICEOVER:|No native voices)/.test(line)).join("\n")
    : buildGoogleVideoTeamSpeechDirection(args, index);
  const prompt = [
    `SHOT ${index + 1}/${args.plan.scenes.length}; ${duration}s. Animate continuously from the first frame.`,
    subject ? `SUBJECT: ${subject}` : "",
    `USER: ${user}`,
    `PARAMS: ${contract.parameters}`,
    `REFERENCES: ${contract.references}`,
    action ? `ACTION: ${action}` : "",
    audio,
    `Speech language: ${args.contentLanguage || "fr"}. No repeated lines.`,
    args.request.creationMode === "free"
      ? "Draw words only when explicitly requested; speech is never visual text."
      : "No visual text, numbers, UI, logos or technical annotations; iNrCy adds overlays.",
  ].filter(Boolean).join("\n");
  if (prompt.length > 1500) throw new Error(`ai_video_instruction_contract_too_long:${prompt.length}:1500`);
  return prompt;
}

/** Build and validate everything before any request or economic reservation. */
export function buildGatewayAiVideoRequest(args: AiVideoProviderGenerationArgs, index = 0, continuityFrame?: AiMediaVideoContinuityFrame, signedImageUrls?: readonly string[]) {
  assertAiMediaVideoProviderBoundary(args);
  const model = getAiMediaVideoModel(args.request.videoEngine);
  if (model.transport !== "gateway") throw new Error("ai_video_gateway_engine_invalid");
  const resolution = getAiMediaVideoResolution(model.id, args.request.videoResolution);
  let durations: readonly number[];
  try { durations = getAiMediaVideoSegmentDurations(args.request.durationSeconds ?? 8, model.id, resolution, args.request.sceneMode); }
  catch { throw new Error("ai_media_video_duration_invalid"); }
  if (args.plan.scenes.length !== durations.length || index < 0 || index >= durations.length) throw new Error("ai_video_gateway_scene_count_invalid");
  const duration = durations[index];
  const references = continuityFrame ? [continuityFrame] : args.request.inspirationImages;
  if (!references.length && !model.supportsTextToVideo) throw new Error("ai_media_video_reference_required");
  if (references.length && (!model.supportsImageToVideo || references.length > model.maxReferenceImages)) throw new Error("ai_media_video_references_unsupported");
  if (model.id === "grok" && resolution === "1080p" && references.length > 1) {
    throw new AiMediaRequestValidationError("Grok Imagine 1.5 accepte plusieurs références en 720p uniquement. Choisissez 720p ou une seule image de référence pour générer en 1080p.");
  }
  assertAiVideoReferenceTeamProviderEgress(args, model.provider);
  const completePrompt = buildGoogleVideoScenePrompt(args, index, duration, { continuationFrame: Boolean(continuityFrame) });
  const text = model.id === "wan-flash" ? buildWanFlashVideoPrompt(args, completePrompt, index, duration) : completePrompt;
  const aspectRatio = model.provider === "google"
    ? (args.request.format === "story" || args.request.format === "portrait" ? "9:16" : "16:9")
    : args.request.format === "square" ? "1:1"
      : args.request.format === "story" ? "9:16"
        : args.request.format === "portrait" ? "3:4" : "16:9";
  const shortSide = resolution === "1080p" ? 1080 : resolution === "768p" ? 768 : 720;
  const [aspectWidth, aspectHeight] = aspectRatio.split(":").map(Number);
  const width = aspectWidth >= aspectHeight ? Math.round(shortSide * aspectWidth / aspectHeight / 2) * 2 : shortSide;
  const height = aspectHeight >= aspectWidth ? Math.round(shortSide * aspectHeight / aspectWidth / 2) * 2 : shortSide;
  if (signedImageUrls && signedImageUrls.length !== references.length) throw new Error("ai_video_input_storage_count_invalid");
  const imageInputs = references.map((image, imageIndex) => ({
    data: signedImageUrls ? signedImageUrls[imageIndex] : Buffer.from(image.data, "base64"), mediaType: image.mimeType,
  }));
  return {
    model: model.modelId,
    prompt: imageInputs.length === 1 ? { image: imageInputs[0].data, text } : text,
    ...(imageInputs.length > 1 ? { inputReferences: imageInputs } : {}),
    duration,
    // xAI expects its native resolution tier independently of orientation.
    ...(model.provider === "spacexai"
      ? { providerOptions: { xai: { resolution } } }
      : { resolution: `${width}x${height}` as `${number}x${number}` }),
    ...(model.id !== "wan-flash" ? { aspectRatio: aspectRatio as `${number}:${number}` } : {}),
    ...(model.id !== "minimax-h3" ? { generateAudio: model.nativeAudio } : {}),
    n: 1,
    // An uncertain timeout must never cause a second paid submission.
    maxRetries: 0,
  };
}

export function createGatewayAiVideoProvider(engine: AiMediaVideoEngine): AiVideoProvider {
  const model = getAiMediaVideoModel(engine);
  if (model.transport !== "gateway") throw new Error("ai_video_gateway_engine_invalid");
  const providerId = `vercel-ai-gateway:${model.provider}`;
  return {
    id: providerId,
    model: model.modelId,
    async generate(args): Promise<AiVideoProviderResult> {
      if (args.signal?.aborted) throw args.signal.reason ?? new Error("ai_media_generation_cancelled");
      if (args.request.videoEngine !== engine) throw new Error("ai_video_gateway_engine_mismatch");
      const durations = getAiMediaVideoSegmentDurations(args.request.durationSeconds ?? 8, engine, args.request.videoResolution, args.request.sceneMode);
      const connectScenes = durations.length > 1 && args.request.sceneMode !== "multi";
      // Compile both scene contracts before spending, including a placeholder for the later frame.
      const preflight = durations.map((_, index) => buildGatewayAiVideoRequest(args, index,
        connectScenes && index > 0 ? { data: "", mimeType: "image/jpeg" } : undefined));
      if (!String(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "").trim()) throw new Error("ai_gateway_credentials_missing");
      const controller = new AbortController();
      // These exact upstream models accept hosted image sources only (public catalogue).
      const temporaryImages = model.id === "minimax-h3" || model.id === "wan-flash"
        ? createAiMediaVideoTemporaryImageStore({ accountId: args.accountId, signal: controller.signal }) : null;
      const cancel = () => controller.abort(args.signal?.reason ?? new Error("ai_media_generation_cancelled"));
      args.signal?.addEventListener("abort", cancel, { once: true });
      if (args.signal?.aborted) cancel();
      const timeout = setTimeout(() => controller.abort(new Error("ai_video_gateway_timeout")), 600_000);
      const clips: AiVideoProviderClip[] = [];
      const warnings: string[] = [];
      let filmBillable = false;
      let estimatedCostMicroUsd = 0;
      try {
        if (connectScenes) await temporaryImages?.assertPrivateBucket();
        const originalImageUrls = temporaryImages ? await temporaryImages.uploadImages(args.request.inspirationImages) : undefined;
        // SDK 6 uses one SSE request per native clip. No uncertain submission is retried.
        for (let index = 0; index < durations.length; index += 1) {
          controller.signal.throwIfAborted();
          const continuityFrame = connectScenes && index > 0
            ? await extractAiMediaVideoContinuityFrame({ ...clips[index - 1], signal: controller.signal }) : undefined;
          const imageUrls = continuityFrame && temporaryImages ? await temporaryImages.uploadImages([continuityFrame]) : originalImageUrls;
          const input = continuityFrame || imageUrls ? buildGatewayAiVideoRequest(args, index, continuityFrame, imageUrls) : preflight[index];
          controller.signal.throwIfAborted();
          const resolution = getAiMediaVideoResolution(engine, args.request.videoResolution);
          const rate = model.pricingUsdPerSecond[resolution];
          if (rate === undefined) throw new Error("ai_media_video_supplier_rate_missing");
          const referenceCount = continuityFrame ? 1 : args.request.inspirationImages.length;
          const clipCost = Math.ceil((input.duration * rate + (model.provider === "spacexai" ? referenceCount * 0.01 : 0)) * 1_000_000);
          const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
            feature: "media.video", estimatedInputTokens: 0, reservedOutputTokens: 0, estimatedCostMicroUsd: clipCost,
          });
          let billable = false;
          let committed = false;
          const commit = async () => {
            if (committed) return;
            await commitAiGatewayAccountAttempt({
              reservation, feature: "media.video", model: model.modelId,
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: clipCost,
            });
            committed = true;
          };
          try {
            const result = await generateVideo({
              ...input, abortSignal: controller.signal,
              download: async (options) => { billable = true; filmBillable = true; return downloadClip(options); },
            });
            billable ||= result.videos.length > 0;
            filmBillable ||= billable;
            if (result.videos.length !== 1) throw new Error("ai_video_gateway_output_count_invalid");
            const buffer = bufferFromUint8ArrayView(result.videos[0].uint8Array);
            if (!buffer.byteLength || buffer.byteLength > MAX_CLIP_BYTES || buffer.subarray(4, 8).toString("ascii") !== "ftyp") throw new Error("ai_video_gateway_mp4_invalid");
            await commit();
            estimatedCostMicroUsd += clipCost;
            const clipWarnings = result.warnings.map((warning) => `gateway:${diagnostic(warning)}`).slice(0, 30);
            if (continuityFrame) clipWarnings.push("video_last_frame_continuity");
            warnings.push(...clipWarnings);
            clips.push({ buffer, mediaType: "video/mp4", durationSeconds: input.duration,
              requestId: args.request.requestId, model: model.modelId, warnings: clipWarnings });
          } catch (error) {
            if (billable) await commit().catch(() => undefined);
            else await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
            throw error;
          }
        }
        return { provider: providerId, model: model.modelId, estimatedCostMicroUsd, warnings, clips };
      } catch (error) {
        await recordAiGatewayAccountFailure({ accountId: args.accountId, feature: "media.video", model: model.modelId }).catch(() => undefined);
        if (filmBillable) throw new AiVideoProviderBillableFailure({
          provider: providerId, model: model.modelId, stage: "gateway_output_processing",
          details: diagnostic(error), cause: new Error(diagnostic(error)),
        });
        throw new Error(diagnostic(error));
      } finally {
        clearTimeout(timeout);
        args.signal?.removeEventListener("abort", cancel);
        await temporaryImages?.cleanup();
      }
    },
  };
}

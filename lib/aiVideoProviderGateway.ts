import "server-only";

import { createDownload, experimental_generateVideo as generateVideo } from "ai";
import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { bufferFromUint8ArrayView } from "./aiMediaBuffer.ts";
import { AI_MEDIA_FREE_VIDEO_PRESENTATION_CONTRACT, splitAiMediaFreeQuotedSpeech } from "./aiMediaFreeGenerationPrompt.ts";
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
  getAiVideoProviderRecoverableStatus,
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
  const separateVoiceover = args.request.creationMode === "free" && args.request.teamVideoSpeechMode !== "characters";
  const user = separateVoiceover ? splitAiMediaFreeQuotedSpeech(contract.instruction).visualPrompt : contract.instruction;
  const visualSubject = separateVoiceover ? splitAiMediaFreeQuotedSpeech(contract.subject).visualPrompt : contract.subject;
  const subject = visualSubject && visualSubject !== user && !user.includes(visualSubject) ? visualSubject : "";
  const scene = String(args.plan.scenes[index]?.visualBrief || "").trim();
  const action = scene.length <= 150 ? scene : `${scene.slice(0, 100).replace(/\s+\S*$/, "")}… ${scene.slice(-40).replace(/^\S*\s/, "")}`;
  const visualSpeech = args.request.creationMode === "free"
    ? validatedPrompt.split("\n").find((line) => line.startsWith("VISUAL SPEECH:")) || ""
    : "";
  // Wan has only 1,500 characters. Compress our envelope, never the user's
  // wording, so the new silence rule does not crowd out previously valid briefs.
  const compactSilence = separateVoiceover && Boolean(visualSpeech);
  const audio = args.request.creationMode === "free"
    ? validatedPrompt.split("\n").filter((line) => /^(?:NATIVE DIALOGUE:|NATIVE VOICEOVER:|No native voices)/.test(line)).join("\n")
    : buildGoogleVideoTeamSpeechDirection(args, index);
  const prompt = [
    `SHOT ${index + 1}/${args.plan.scenes.length}; ${duration}s. Motion from frame 1; fill frame, no bars.`,
    compactSilence ? "VISUAL SPEECH: No speaking/articulation/mimed speech/lip-sync; natural gestures, gaze, smiles. Overrides speaking below." : visualSpeech,
    subject ? `SUBJECT: ${subject}` : "",
    `USER: ${user}`,
    `PARAMS: ${contract.parameters}`,
    `REFERENCES: ${contract.references}`,
    action ? `ACTION: ${action}` : "",
    audio,
    compactSilence ? "" : `Speech language: ${args.contentLanguage || "fr"}. No repeated lines.`,
    args.request.creationMode === "free"
      ? compactSilence
        ? "Fill frame, no borders/bars/matte. No split/panels/collage/duplicate views unless asked. Speech is audio: no subtitles/captions/quote cards unless asked. Exact text; wording only if asked."
        : AI_MEDIA_FREE_VIDEO_PRESENTATION_CONTRACT
      : "No visual text, numbers, UI, logos or technical annotations; iNrCy adds overlays.",
  ].filter(Boolean).join("\n");
  if (prompt.length > 1500) throw new Error(`ai_video_instruction_contract_too_long:${prompt.length}:1500`);
  return prompt;
}

/** Build and validate everything before any request or economic reservation. */
export function buildGatewayAiVideoRequest(
  args: AiVideoProviderGenerationArgs,
  index = 0,
  continuityFrame?: AiMediaVideoContinuityFrame,
  signedImageUrls?: readonly string[],
  signedVoiceUrls?: readonly (string | null)[],
  signedContinuityUrl?: string,
) {
  assertAiMediaVideoProviderBoundary(args);
  const model = getAiMediaVideoModel(args.request.videoEngine);
  if (model.transport !== "gateway") throw new Error("ai_video_gateway_engine_invalid");
  const resolution = getAiMediaVideoResolution(model.id, args.request.videoResolution);
  let durations: readonly number[];
  try { durations = getAiMediaVideoSegmentDurations(args.request.durationSeconds ?? 8, model.id, resolution, args.request.sceneMode); }
  catch { throw new Error("ai_media_video_duration_invalid"); }
  if (args.plan.scenes.length !== durations.length || index < 0 || index >= durations.length) throw new Error("ai_video_gateway_scene_count_invalid");
  const duration = durations[index];
  const nativeSubjectReferences = model.id === "wan27";
  const references = nativeSubjectReferences ? args.request.inspirationImages : continuityFrame ? [continuityFrame] : args.request.inspirationImages;
  if (!references.length && !model.supportsTextToVideo) throw new Error("ai_media_video_reference_required");
  if (references.length && (!model.supportsImageToVideo || references.length > model.maxReferenceImages)) throw new Error("ai_media_video_references_unsupported");
  if (model.id === "heygen" && !signedImageUrls && references.some((image) => Buffer.byteLength(image.data, "base64") > 5_000_000)) {
    throw new AiMediaRequestValidationError("L’image transmise à HeyGen dépasse 5 Mo. Réduisez sa taille avant de générer.");
  }
  if (model.id === "grok" && resolution === "1080p" && references.length > 1) {
    throw new AiMediaRequestValidationError("Grok Imagine 1.5 accepte plusieurs références en 720p uniquement. Choisissez 720p ou une seule image de référence pour générer en 1080p.");
  }
  assertAiVideoReferenceTeamProviderEgress(args, model.provider);
  const completePrompt = buildGoogleVideoScenePrompt(args, index, duration, { continuationFrame: Boolean(continuityFrame) });
  let text = model.id === "wan-flash" ? buildWanFlashVideoPrompt(args, completePrompt, index, duration) : completePrompt;
  if (nativeSubjectReferences) {
    const characterMap = args.request.inspirationImages.flatMap((image, imageIndex) => image.role === "character"
      ? [`Image ${imageIndex + 1} = character${imageIndex + 1}${image.characterIndex ? ` = Studio character ${image.characterIndex}` : ""}; ${image.voiceMode === "provided" ? "use only its attached referenceVoice" : "use a stable AI voice"}`]
      : []);
    if (characterMap.length) text += `\nCHARACTER REFERENCES: ${characterMap.join(". ")}. Never exchange faces or voice assignments.`;
    if (text.length > 5_000) throw new AiMediaRequestValidationError("La consigne complète dépasse la limite de 5 000 caractères de Wan 2.7. Raccourcissez le brief avant de générer.");
  }
  const requestedAspectRatio = model.provider === "google"
    ? (args.request.format === "story" || args.request.format === "portrait" ? "9:16" : "16:9")
    : args.request.format === "square" ? "1:1"
      : args.request.format === "story" ? "9:16"
        : args.request.format === "portrait" ? "3:4" : "16:9";
  // HeyGen 1080p text-to-video only accepts landscape/vertical. The final
  // composer crops centrally, so protect the requested canvas in the prompt.
  const aspectRatio = model.id === "heygen" && resolution === "1080p"
    ? (args.request.format === "story" || args.request.format === "portrait" ? "9:16" : "16:9")
    : requestedAspectRatio;
  if (model.id === "heygen" && !references.length && resolution === "1080p" && requestedAspectRatio !== aspectRatio) {
    text += args.request.format === "square"
      ? "\nFINAL 1:1 SAFE FRAME: keep every essential subject, full face and important detail inside the central square (middle 56% of the width); the sides will be cropped. This is a composition instruction, never on-screen text."
      : "\nFINAL 4:5 SAFE FRAME: keep every essential subject, full face and important detail inside the centred 4:5 area (middle 70% of the height); the top and bottom will be cropped. This is a composition instruction, never on-screen text.";
  }
  if (model.id === "heygen" && text.length > 32_000) {
    throw new AiMediaRequestValidationError("La consigne complète dépasse la limite de 32 000 caractères de HeyGen. Raccourcissez le brief avant de générer.");
  }
  const shortSide = resolution === "1080p" ? 1080 : resolution === "768p" ? 768 : 720;
  const [aspectWidth, aspectHeight] = aspectRatio.split(":").map(Number);
  const width = aspectWidth >= aspectHeight ? Math.round(shortSide * aspectWidth / aspectHeight / 2) * 2 : shortSide;
  const height = aspectHeight >= aspectWidth ? Math.round(shortSide * aspectHeight / aspectWidth / 2) * 2 : shortSide;
  if (signedImageUrls && signedImageUrls.length !== references.length) throw new Error("ai_video_input_storage_count_invalid");
  const imageInputs = references.map((image, imageIndex) => ({
    data: signedImageUrls ? signedImageUrls[imageIndex] : Buffer.from(image.data, "base64"), mediaType: image.mimeType,
  }));
  let providerOptions: NonNullable<Parameters<typeof generateVideo>[0]["providerOptions"]> | undefined;
  if (nativeSubjectReferences) {
    if (signedVoiceUrls && signedVoiceUrls.length !== references.length) throw new Error("ai_video_reference_voice_count_invalid");
    const media: Array<{ type: "reference_image" | "first_frame"; url: string; referenceVoice?: string }> = references.map((image, imageIndex) => {
      const originalImage = args.request.inspirationImages[imageIndex];
      const voiceUrl = signedVoiceUrls?.[imageIndex];
      if (originalImage.voiceMode === "provided" && (!originalImage.voiceSample || !voiceUrl)) throw new Error("ai_video_reference_voice_url_missing");
      if (voiceUrl && (originalImage.role !== "character" || originalImage.voiceMode !== "provided")) throw new Error("ai_video_reference_voice_assignment_invalid");
      return {
        type: "reference_image",
        url: signedImageUrls?.[imageIndex] || `data:${image.mimeType};base64,${image.data}`,
        ...(voiceUrl ? { referenceVoice: voiceUrl } : {}),
      };
    });
    if (continuityFrame) {
      if (media.length >= model.maxReferenceImages) throw new Error("ai_media_video_references_unsupported");
      if (!signedContinuityUrl) throw new Error("ai_video_continuity_url_missing");
      // A distinct first frame preserves every original image/voice binding.
      media.push({ type: "first_frame", url: signedContinuityUrl });
    }
    providerOptions = { alibaba: { media, ratio: aspectRatio, promptExtend: false } };
  }
  if (model.provider === "spacexai") providerOptions = { xai: { resolution } };
  if (model.provider === "heygen") providerOptions = { heygen: {
    resolution,
    mode: imageInputs.length ? "image_to_video" : "text_to_video",
    // Preserve the already-reviewed prompt, including exact dialogue.
    promptEnhancement: "disabled",
  } };
  return {
    model: model.modelId,
    prompt: !nativeSubjectReferences && imageInputs.length === 1 ? { image: imageInputs[0].data, text } : text,
    ...(!nativeSubjectReferences && imageInputs.length > 1 ? { inputReferences: imageInputs } : {}),
    duration,
    // xAI/HeyGen accept explicit tiers. HeyGen's actual frame dimensions differ
    // from a mathematical 16:9 canvas, so do not infer width/height for its API.
    ...(providerOptions ? { providerOptions } : {}),
    ...(!providerOptions || nativeSubjectReferences
      ? { resolution: model.provider === "google" || nativeSubjectReferences
        ? (resolution === "1080p" ? "1920x1080" : "1280x720")
        : `${width}x${height}` as `${number}x${number}` } : {}),
    // HeyGen image-to-video follows its first frame; aspectRatio is ignored
    // with a provider warning, so do not send a contradictory shape.
    ...(model.id !== "wan-flash" && !nativeSubjectReferences && !(model.id === "heygen" && imageInputs.length)
      ? { aspectRatio: aspectRatio as `${number}:${number}` } : {}),
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
      const nativeSubjectReferences = model.id === "wan27";
      const canAttachContinuityFrame = !nativeSubjectReferences || args.request.inspirationImages.length < model.maxReferenceImages;
      const voicePlaceholders = nativeSubjectReferences ? args.request.inspirationImages.map((image, imageIndex) =>
        image.voiceMode === "provided" ? `https://provider-input.invalid/voice-${imageIndex + 1}.wav` : null) : undefined;
      // Compile both scene contracts before spending, including a placeholder for the later frame.
      const preflight = durations.map((_, index) => buildGatewayAiVideoRequest(args, index,
        connectScenes && canAttachContinuityFrame && index > 0 ? { data: "", mimeType: "image/jpeg" } : undefined,
        undefined, voicePlaceholders, nativeSubjectReferences ? "https://provider-input.invalid/continuity.jpg" : undefined));
      if (!String(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "").trim()) throw new Error("ai_gateway_credentials_missing");
      const controller = new AbortController();
      // These exact upstream models accept hosted image sources only (public catalogue).
      const temporaryImages = model.id === "minimax-h3" || model.id === "wan-flash" || nativeSubjectReferences
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
        const originalVoiceUrls = nativeSubjectReferences
          ? await (await import("@/lib/aiMediaCharacterVoiceStorage")).getAiMediaCharacterVoiceSignedUrls({ accountId: args.accountId, images: args.request.inspirationImages, signal: controller.signal })
          : undefined;
        const originalImageUrls = temporaryImages ? await temporaryImages.uploadImages(args.request.inspirationImages) : undefined;
        // SDK 6 uses one SSE request per native clip. No uncertain submission is retried.
        for (let index = 0; index < durations.length; index += 1) {
          controller.signal.throwIfAborted();
          const continuityFrame = connectScenes && canAttachContinuityFrame && index > 0
            ? await extractAiMediaVideoContinuityFrame({ ...clips[index - 1], signal: controller.signal }) : undefined;
          const continuityUrls = continuityFrame && temporaryImages ? await temporaryImages.uploadImages([continuityFrame]) : undefined;
          const imageUrls = nativeSubjectReferences ? originalImageUrls : continuityUrls || originalImageUrls;
          const input = continuityFrame || imageUrls ? buildGatewayAiVideoRequest(args, index, continuityFrame, imageUrls, originalVoiceUrls, continuityUrls?.[0]) : preflight[index];
          controller.signal.throwIfAborted();
          const resolution = getAiMediaVideoResolution(engine, args.request.videoResolution);
          const rate = model.pricingUsdPerSecond[resolution];
          if (rate === undefined) throw new Error("ai_media_video_supplier_rate_missing");
          const referenceCount = nativeSubjectReferences
            ? args.request.inspirationImages.length + (continuityFrame ? 1 : 0)
            : continuityFrame ? 1 : args.request.inspirationImages.length;
          const clipCost = Math.ceil(input.duration * rate * 1_000_000) + referenceCount * model.supplierReferenceCostMicroUsd;
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
            if (model.id === "heygen" && !referenceCount && resolution === "1080p" &&
              (args.request.format === "square" || args.request.format === "portrait")) {
              clipWarnings.push(`video_provider_aspect_ratio_adapted:${args.request.format}:${input.aspectRatio}`);
            }
            if (continuityFrame) clipWarnings.push("video_last_frame_continuity");
            if (nativeSubjectReferences && connectScenes && index > 0 && !canAttachContinuityFrame) clipWarnings.push("video_continuity_original_subject_references_preserved_at_capacity");
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
        // Retain only safe retry evidence. SDK errors may contain prompts,
        // private reference URLs and credentials in their request bodies.
        throw Object.assign(new Error(diagnostic(error)), { statusCode: getAiVideoProviderRecoverableStatus(error) });
      } finally {
        clearTimeout(timeout);
        args.signal?.removeEventListener("abort", cancel);
        await temporaryImages?.cleanup();
      }
    },
  };
}

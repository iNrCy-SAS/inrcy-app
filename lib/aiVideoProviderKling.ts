import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { createDownload } from "ai";
import { reserveAiGatewayAccountAttempt, commitAiGatewayAccountAttempt, rollbackAiGatewayAccountAttempt, recordAiGatewayAccountFailure } from "@/lib/aiGatewayAccountGuard";
import { prepareAiMediaIdentityReferences } from "./aiMediaIdentityReferences.ts";
import { getAiMediaCharacterVoiceSignedUrls } from "./aiMediaCharacterVoiceStorage.ts";
import { createAiMediaVideoTemporaryImageStore } from "./aiMediaVideoTemporaryImages.ts";
import { getAiMediaVideoResolution, getAiMediaVideoSupplierRate } from "./aiMediaModelCatalog.ts";
import { hasTooShortAiMediaCharacterVoice } from "./aiMediaCharacterVoices.ts";
import { getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";
import { assertAiMediaVideoProviderBoundary } from "./aiMediaVideoProviderContract.ts";
import { buildAiMediaFreeVideoScenePrompt, buildAiMediaVideoCharacterReferenceDirection } from "./aiMediaFreeGenerationPrompt.ts";
import { buildGoogleVideoScenePrompt } from "./aiVideoProviderGoogleVeo.ts";
import { AiVideoProviderBillableFailure, assertAiVideoReferenceTeamProviderEgress, type AiVideoProvider, type AiVideoProviderGenerationArgs, type AiVideoProviderClip } from "./aiVideoProviderTypes.ts";
import { createKlingApiClient, getExpiredKlingTemporaryVoiceIds, KlingApiError, KLING_TEMPORARY_VOICE_PREFIX, type KlingVideoRequest } from "./aiVideoKlingApi.ts";

const MODEL = "kling-4.0-omni";
const PROVIDER = "kling-direct";
const downloadClip = createDownload({ maxBytes: 128 * 1024 * 1024 });
const VOICE_COST_MICRO_USD = 10_000; // Conservative bound above the official $0.007/profile.
const failureCode = (error: unknown) => error instanceof KlingApiError ? error.message
  : error instanceof Error && /^ai_[a-z0-9_:.-]+$/.test(error.message) ? error.message : "ai_video_kling_processing_failed";

export function klingVideoExternalId(args: Pick<AiVideoProviderGenerationArgs, "accountId" | "request">) {
  // Leave room for the voice/attempt suffix while staying below 64 characters.
  return KLING_TEMPORARY_VOICE_PREFIX + createHash("sha256").update(`${args.accountId}:${args.request.requestId}:kling-4.0`).digest("hex").slice(0, 32);
}

/** Read-only credential/capability check before creative planning can spend anything. */
export async function preflightKlingAiVideoAccess(args: Pick<AiVideoProviderGenerationArgs, "accountId" | "request" | "signal">) {
  if (args.request.videoEngine !== "kling") return;
  const apiKey = String(process.env.KLING_API_KEY || "").trim();
  if (!apiKey) throw new Error("ai_video_kling_credentials_missing");
  await createKlingApiClient({ apiKey }).findVideo(`${klingVideoExternalId(args)}-1`, args.signal);
}

/** The same image index identifies the photo, its voice and its prompt binding. */
export function buildKlingAiVideoRequest(args: AiVideoProviderGenerationArgs, index: number,
  imageUrls: readonly string[], voiceIds: readonly (string | null)[]): KlingVideoRequest {
  assertAiMediaVideoProviderBoundary(args);
  if (args.request.videoEngine !== "kling") throw new Error("ai_video_kling_engine_mismatch");
  assertAiVideoReferenceTeamProviderEgress(args, "kling");
  const images = args.request.inspirationImages;
  const durations = getAiMediaVideoSegmentDurations(args.request.durationSeconds ?? 8, "kling", args.request.videoResolution, args.request.sceneMode);
  if (index < 0 || index >= durations.length || args.plan.scenes.length !== durations.length) throw new Error("ai_video_kling_scene_count_invalid");
  if (images.length > 5 || imageUrls.length !== images.length || voiceIds.length !== images.length) throw new Error("ai_video_kling_reference_count_invalid");
  if (images.filter(image => image.voiceMode === "provided").length > 3) throw new Error("ai_media_character_voice_count_invalid");
  if (hasTooShortAiMediaCharacterVoice("kling", images)) throw new Error("ai_media_character_voice_kling_duration_invalid");
  const resolution = getAiMediaVideoResolution("kling", args.request.videoResolution);
  if (resolution !== "720p" && resolution !== "1080p") throw new Error("ai_media_video_resolution_invalid");
  const aspectRatio = args.request.format === "story" ? "9:16" : args.request.format === "landscape" ? "16:9" : "1:1";
  const scenePrompt = args.request.creationMode === "free"
    ? buildAiMediaFreeVideoScenePrompt(args, index, durations[index])
    : buildGoogleVideoScenePrompt(args, index, durations[index]);
  const prompt = [scenePrompt,
    images.length ? `INPUT IDS: ${images.map((image, i) => `#${i + 1}=@image_${i + 1} (${image.role || "inspiration"}/${image.usage || "inspiration"})`).join("; ")}.` : "",
    buildAiMediaVideoCharacterReferenceDirection(args.request),
    args.request.format === "portrait" ? "Final output is cropped to 4:5: keep every face, hand and important object within the central 80% of the frame width. No borders." : "",
  ].filter(Boolean).join("\n");
  // Below Kling's 11k ceiling even for entirely non-English text. Never truncate dialogue.
  if (prompt.length > 11_000) throw new Error(`ai_video_instruction_contract_too_long:${prompt.length}:11000`);
  const contents: KlingVideoRequest["contents"] = [{ type: "prompt", text: prompt }];
  images.forEach((image, imageIndex) => {
    const url = new URL(imageUrls[imageIndex]);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("ai_video_kling_input_url_invalid");
    contents.push({ type: "refer_image", url: url.toString(), id: `image_${imageIndex + 1}` });
    const voiceId = voiceIds[imageIndex];
    if (image.voiceMode === "provided") {
      if (image.role !== "character" || !image.voiceSample || !voiceId || !/^[a-zA-Z0-9_-]{1,180}$/.test(voiceId)) throw new Error("ai_video_kling_reference_voice_missing");
      contents.push({ type: "voice", voice_id: voiceId, id: `voice_${imageIndex + 1}` });
    } else if (voiceId !== null) throw new Error("ai_video_kling_reference_voice_mismatch");
  });
  return { contents, settings: { resolution, aspect_ratio: aspectRatio, duration: durations[index], audio: "native" },
    options: { external_task_id: `${klingVideoExternalId(args)}-${index + 1}` } };
}

export const klingAiVideoProvider: AiVideoProvider = {
  id: PROVIDER, model: MODEL,
  async generate(args) {
    args.signal?.throwIfAborted();
    const images = args.request.inspirationImages;
    const durations = getAiMediaVideoSegmentDurations(args.request.durationSeconds ?? 8, "kling", args.request.videoResolution, args.request.sceneMode);
    // Validate the entire plan, consent and association before any paid request.
    const placeholderImages = images.map((_, i) => `https://provider-input.invalid/image-${i + 1}.png`);
    const placeholderVoices = images.map((image, i) => image.voiceMode === "provided" ? `voice-${i + 1}` : null);
    durations.forEach((_, i) => buildKlingAiVideoRequest(args, i, placeholderImages, placeholderVoices));
    const apiKey = String(process.env.KLING_API_KEY || "").trim();
    if (!apiKey) throw new Error("ai_video_kling_credentials_missing");
    const budgetMs = Math.min(715_000, (args.deadlineAt ?? Date.now() + 600_000) - Date.now());
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("ai_video_kling_timeout");
    const signal = AbortSignal.any([...(args.signal ? [args.signal] : []), AbortSignal.timeout(budgetMs)]);
    const client = createKlingApiClient({ apiKey });
    const store = createAiMediaVideoTemporaryImageStore({ accountId: args.accountId, signal });
    const voiceIds: (string | null)[] = images.map(() => null);
    const voiceAttempt = randomUUID().replace(/-/g, "").slice(0, 12);
    let stage = "input_validation";
    let billableVideo = false;
    let pendingVideo = false;
    let estimatedCostMicroUsd = 0;
    const clips: AiVideoProviderClip[] = [];
    const paid = async <T>(cost: number, operation: () => Promise<T>, video: boolean): Promise<T> => {
      signal.throwIfAborted();
      const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
        feature: "media.video", estimatedInputTokens: 0, reservedOutputTokens: 0, estimatedCostMicroUsd: cost,
      });
      let committed = false;
      let attempted = false;
      const commit = async () => {
        if (committed) return;
        await commitAiGatewayAccountAttempt({ reservation, feature: "media.video", model: video ? MODEL : "kling-custom-voice",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: cost });
        committed = true;
      };
      try {
        signal.throwIfAborted();
        attempted = true;
        const result = await operation();
        await commit(); estimatedCostMicroUsd += cost;
        return result;
      } catch (error) {
        const definitelyRejected = error instanceof KlingApiError && !error.uncertain &&
          (["task_failed", "voice_failed"].includes(error.phase) ||
            (["request_rejected", "credentials_rejected"].includes(error.phase) && (!video || stage === "provider_submission")));
        // A lost ACK or timeout can still become chargeable. No resubmission or fallback.
        if (attempted && !definitelyRejected) {
          if (video) billableVideo = true;
          await commit().catch(() => undefined);
        } else {
          if (video) pendingVideo = false;
          await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
        }
        throw error;
      }
    };
    try {
      const prepared = await prepareAiMediaIdentityReferences(images, { format: "png", signal });
      for (const buffer of prepared.buffers) {
        const metadata = await sharp(buffer).metadata();
        if (!metadata.width || !metadata.height || metadata.width < 300 || metadata.height < 300 ||
          metadata.width / metadata.height < 0.4 || metadata.width / metadata.height > 2.5) throw new Error("ai_media_kling_reference_dimensions_invalid");
      }
      const voiceUrls = await getAiMediaCharacterVoiceSignedUrls({ accountId: args.accountId, images, videoEngine: "kling", signal });
      // Recover by a deterministic account/request ID before provisioning anything.
      const existingTasks = await Promise.all(durations.map((_, i) => client.findVideo(`${klingVideoExternalId(args)}-${i + 1}`, signal)));
      const needsNewVideo = existingTasks.some(task => !task);
      const imageUrls = needsNewVideo ? await store.uploadImages(prepared.providerImages) : [];
      if (needsNewVideo) {
        stage = "voice_setup";
        for (let i = 0; i < images.length; i++) {
          if (!voiceUrls[i]) continue;
          voiceIds[i] = await paid(VOICE_COST_MICRO_USD, () => client.createVoice({ url: voiceUrls[i]!,
            externalTaskId: `${klingVideoExternalId(args)}-voice-${i + 1}-${voiceAttempt}`, signal }), false);
        }
      }
      for (let index = 0; index < durations.length; index++) {
        signal.throwIfAborted();
        stage = "provider_submission";
        const generate = async () => {
          pendingVideo = true;
          const task = existingTasks[index] ?? await client.submitVideo(buildKlingAiVideoRequest(args, index, imageUrls, voiceIds), signal);
          stage = "provider_polling";
          let completed;
          try { completed = await client.waitVideo(task, signal); }
          catch (error) { if (error instanceof KlingApiError && error.phase === "task_failed") pendingVideo = false; throw error; }
          pendingVideo = false; billableVideo = true;
          stage = "asset_download";
          const result = await downloadClip({ url: new URL(completed.outputs[0].url), abortSignal: signal });
          const buffer = Buffer.from(result.data);
          stage = "output_validation";
          if (!buffer.length || buffer.subarray(4, 8).toString("ascii") !== "ftyp" ||
            Math.abs(completed.outputs[0].duration - durations[index]) > 1) throw new Error("ai_video_kling_output_invalid");
          return { buffer, mediaType: "video/mp4", durationSeconds: durations[index], requestId: completed.id, model: MODEL,
            warnings: args.request.format === "portrait" ? ["video_provider_aspect_ratio_adapted:portrait:1:1"] : [] };
        };
        const cost = Math.ceil(durations[index] * getAiMediaVideoSupplierRate("kling", getAiMediaVideoResolution("kling", args.request.videoResolution), args.request) * 1_000_000);
        if (existingTasks[index]) { clips.push(await generate()); estimatedCostMicroUsd += cost; }
        else clips.push(await paid(cost, generate, true));
      }
      return { provider: PROVIDER, model: MODEL, clips, estimatedCostMicroUsd, warnings: clips.flatMap(clip => clip.warnings) };
    } catch (error) {
      await recordAiGatewayAccountFailure({ accountId: args.accountId, feature: "media.video", model: MODEL }).catch(() => undefined);
      const details = signal.aborted ? "ai_video_kling_timeout_or_cancelled" : failureCode(error);
      if (billableVideo || pendingVideo) throw new AiVideoProviderBillableFailure({ provider: PROVIDER, model: MODEL, stage, details });
      throw new Error(details);
    } finally {
      // Pending tasks retain their profiles; the bounded daily cleanup expires them.
      if (!pendingVideo) for (const voiceId of voiceIds) {
        if (!voiceId) continue;
        try { await client.deleteVoice(voiceId, AbortSignal.timeout(5_000)); }
        catch { console.warn("[ai-media] kling_temporary_voice_cleanup_deferred"); }
      }
      if (!pendingVideo) await store.cleanup();
    }
  },
};

export async function purgeExpiredKlingCustomVoices(): Promise<{ removed: number; errors: string[] }> {
  const apiKey = String(process.env.KLING_API_KEY || "").trim();
  if (!apiKey) return { removed: 0, errors: [] };
  const client = createKlingApiClient({ apiKey });
  const signal = AbortSignal.timeout(20_000);
  const ids: string[] = [];
  // Enumerate before deleting to avoid shifting paginated results.
  for (let page = 1; page <= 10; page++) {
    const tasks = await client.listVoiceTasks(page, signal);
    ids.push(...getExpiredKlingTemporaryVoiceIds(tasks));
    if (tasks.length < 100) break;
  }
  let removed = 0;
  const errors: string[] = [];
  for (const voiceId of [...new Set(ids)].slice(0, 100)) {
    try { await client.deleteVoice(voiceId, signal); removed++; }
    catch { errors.push("kling_temporary_voice_cleanup_deferred"); break; }
  }
  return { removed, errors };
}

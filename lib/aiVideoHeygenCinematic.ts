import { buildAiMediaNativeNarratorVoiceDirection } from "./aiMediaNarrationVoices.ts";
import "server-only";
import { createHash } from "node:crypto";
import {
  reserveAiGatewayAccountAttempt, commitAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt, recordAiGatewayAccountFailure,
} from "@/lib/aiGatewayAccountGuard";
import { createHeygenApiClient, HeygenApiError, type HeygenAsset } from "./aiVideoHeygenApi.ts";
import { AiVideoProviderPending, isAiMediaPendingVideo, type AiMediaPendingVideo } from "./aiMediaPendingVideo.ts";
import { getHeygenCinematicSettings } from "./aiMediaHeygenRoute.ts";
import { prepareAiMediaIdentityReferences } from "./aiMediaIdentityReferences.ts";
import { prepareHeygenAvatarImage as prepareHeygenReferenceImage } from "./aiVideoHeygenBackground.ts";
import { assertAiMediaVideoProviderBoundary } from "./aiMediaVideoProviderContract.ts";
import { AiVideoProviderBillableFailure, assertAiVideoReferenceTeamProviderEgress, type AiVideoProviderGenerationArgs } from "./aiVideoProviderTypes.ts";

// Conservative supplier reservation above the currently published cinematic rates.
const SUPPLIER_RESERVE_MICRO_USD_PER_SECOND = 160_000;

/** The submitted visual brief stays verbatim; technical/audio choices are separate. */
export function buildHeygenCinematicPrompt(args: AiVideoProviderGenerationArgs): string {
  const request = args.request;
  const brief = request.freePrompt?.trim() ? request.freePrompt
    : args.creativeBrief || args.providerContract.subject;
  if (!brief?.trim()) throw new Error("ai_media_heygen_cinematic_prompt_missing");
  const exact = request.exactDialogue?.map(turn => turn.text).join("\n") ??
    request.spokenScript ?? args.nativeNarrationLines?.filter(Boolean).join("\n") ?? "";
  const explicitlySilent = request.spokenScript === "" && !request.exactDialogue?.length;
  const characterSpeech = request.teamVideoSpeechMode === "characters" && !explicitlySilent;
  const narrationSpeech = request.withNarration === true && !explicitlySilent;
  const speech = characterSpeech || narrationSpeech;
  const language = args.contentLanguage || "fr";
  const knownCaptions = Boolean(exact.trim() || args.subtitleLines?.some(line => line.trim()));
  const referenceDirections = request.inspirationImages.map((image, index) =>
    "<Picture " + (index + 1) + "> is the original " + (image.role || "inspiration") +
    (image.characterIndex ? " reference for character " + image.characterIndex : "") + ".");
  const prompt = [
    "VISUAL BRIEF (verbatim):\n" + brief,
    "Create a real moving video, with actions unfolding in time. Fill the whole output frame; no white or black borders, still-image slideshow, panels or collage.",
    ...(referenceDirections.length ? ["REFERENCE MAPPING:\n" + referenceDirections.join("\n"),
      "Retain the supplied people, products and places in their assigned roles. Follow the brief for their actions and the setting."] : []),
    ...(args.businessDnaDirection ? ["BUSINESS CONTEXT:\n" + args.businessDnaDirection] : []),
    ...(args.providerContract.globalMediaConstraints ? ["ACCOUNT DIRECTIONS:\n" + args.providerContract.globalMediaConstraints] : []),
    speech
      ? (narrationSpeech && !characterSpeech
        ? "AUDIO: An unseen off-screen narrator speaks in " + language + ". Visible people do not lip-sync the narrator."
        : "AUDIO: The visible characters speak naturally in " + language + ", in the specified order.")
      : "AUDIO: No dialogue, voice-over or intelligible speech. Only natural location ambience.",
    ...(narrationSpeech && !characterSpeech && request.narrationVoiceMode !== "provided"
      ? ["NARRATOR VOICE DIRECTION: " + buildAiMediaNativeNarratorVoiceDirection(request)] : []),
    ...(speech && exact.trim() ? ["SPOKEN WORDS (verbatim, once, in order):\n" + exact]
      : speech ? ["Write concise natural speech matching the brief and selected duration."] : []),
    request.withMusic ? "No generated music; the selected soundtrack is added separately." : "No music.",
    request.withSubtitles && speech && !knownCaptions
      ? "Add synchronized subtitles faithful to the generated speech, in " + language + "."
      : request.withSubtitles && knownCaptions ? "Do not burn captions into this clip; exact selected subtitles are added separately."
      : "No subtitles or speech captions, even if the brief requests them; preserve other explicitly requested visual lettering.",
  ].join("\n\n");
  if (Array.from(prompt).length > 16_000) throw new RangeError("ai_media_heygen_cinematic_prompt_too_long");
  return prompt;
}

/** One native cinematic submission, followed only by durable read-only recovery. */
export async function generateHeygenCinematicVideo(args: AiVideoProviderGenerationArgs): Promise<never> {
  args.signal?.throwIfAborted();
  assertAiVideoReferenceTeamProviderEgress(args, "heygen");
  assertAiMediaVideoProviderBoundary(args);
  const settings = getHeygenCinematicSettings(args.request);
  const prompt = buildHeygenCinematicPrompt(args);
  if (args.request.inspirationImages.length > 5) throw new RangeError("ai_media_heygen_cinematic_references_unsupported");
  const client = createHeygenApiClient({ apiKey: process.env.HEYGEN_API_KEY || "" });
  const key = "inrcy-cinematic-" + createHash("sha256")
    .update(args.accountId + ":" + (args.jobId || args.canonicalPromptSha256)).digest("hex").slice(0, 40);
  const estimatedCostMicroUsd = settings.duration * SUPPLIER_RESERVE_MICRO_USD_PER_SECOND;
  const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
    feature: "media.video", estimatedInputTokens: 0, reservedOutputTokens: 0, estimatedCostMicroUsd,
  });
  const temporaryAssetIds: string[] = [];
  let submitted = false, postAttempted = false, uncertain = false, committed = false;
  const commit = async () => {
    if (committed) return;
    await commitAiGatewayAccountAttempt({ reservation, feature: "media.video", model: "heygen-video-1",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: estimatedCostMicroUsd });
    committed = true;
  };
  try {
    const references: HeygenAsset[] = [];
    if (args.request.inspirationImages.length) {
      const prepared = await prepareAiMediaIdentityReferences(args.request.inspirationImages, { format: "png", signal: args.signal });
      for (const image of prepared.buffers) {
        args.signal?.throwIfAborted();
        const asset = await client.uploadImage(await prepareHeygenReferenceImage(image, args.request.format), args.signal);
        temporaryAssetIds.push(asset.asset_id); references.push(asset);
      }
    }
    const task: AiMediaPendingVideo = { provider: "heygen-direct", model: "heygen-video-1", videoId: "not-submitted",
      temporaryVoiceIds: [], temporaryAvatarGroupIds: [], temporaryAssetIds, estimatedCostMicroUsd };
    if (!isAiMediaPendingVideo(task)) throw new Error("ai_media_pending_video_invalid");
    const common = { model: "heygen-video-1" as const, prompt, duration: settings.duration,
      resolution: settings.resolution, aspect_ratio: settings.aspectRatio, prompt_enhancement: "quality" as const };
    postAttempted = true;
    const videoId = await client.submitCinematicVideo(references.length
      ? { ...common, mode: "reference_to_video", reference_images: references }
      : { ...common, mode: "text_to_video" }, key, args.signal);
    submitted = true;
    // Expose the accepted identifier before any other await. The caller persists
    // it first, then records supplier accounting through this runtime callback.
    throw new AiVideoProviderPending({ ...task, videoId }, async () => {
      await commit().catch(() => console.warn("[ai-media] HeyGen supplier accounting pending", { jobId: args.jobId }));
    });
  } catch (error) {
    if (error instanceof AiVideoProviderPending) throw error;
    await recordAiGatewayAccountFailure({ accountId: args.accountId, feature: "media.video", model: "heygen-video-1" }).catch(() => undefined);
    if (submitted || postAttempted && (!(error instanceof HeygenApiError) || error.uncertain)) {
      uncertain = true;
      await commit().catch(() => undefined);
      throw new AiVideoProviderBillableFailure({ provider: "heygen-direct", model: "heygen-video-1",
        stage: "provider_submission", details: "ai_video_heygen_submission_uncertain" });
    }
    await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
    throw error instanceof HeygenApiError ? error : new Error("ai_video_heygen_preparation_failed");
  } finally {
    if (!submitted && !uncertain) for (const id of temporaryAssetIds) await client.deleteAsset(id, AbortSignal.timeout(20_000)).catch(() => undefined);
  }
}

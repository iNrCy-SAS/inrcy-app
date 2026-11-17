import "server-only";
import { createHash } from "node:crypto";
import {
  reserveAiGatewayAccountAttempt, commitAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt, recordAiGatewayAccountFailure,
} from "@/lib/aiGatewayAccountGuard";
import { createHeygenApiClient, HeygenApiError, type HeygenAsset, type HeygenStudioScene } from "./aiVideoHeygenApi.ts";
import { AiVideoProviderPending, isAiMediaPendingVideo, AI_MEDIA_HEYGEN_MAX_ESTIMATED_COST_MICRO_USD, type AiMediaPendingVideo } from "./aiMediaPendingVideo.ts";
import { estimateHeygenBillableDurationSeconds } from "./aiMediaHeygenBilling.ts";
import { usesHeygenAvatarRoute } from "./aiMediaHeygenRoute.ts";
import { generateHeygenCinematicVideo } from "./aiVideoHeygenCinematic.ts";
import { prepareAiMediaIdentityReferences } from "./aiMediaIdentityReferences.ts";
import { prepareHeygenBackground, prepareHeygenAvatarImage, createHeygenSilenceWav } from "./aiVideoHeygenBackground.ts";
import { getAiMediaCharacterVoiceSignedUrls } from "./aiMediaCharacterVoiceStorage.ts";
import { getAiMediaVideoResolution, getAiMediaVideoSupplierRate } from "./aiMediaModelCatalog.ts";
import { AiVideoProviderBillableFailure, assertAiVideoReferenceTeamProviderEgress, type AiVideoProvider, type AiVideoProviderGenerationArgs } from "./aiVideoProviderTypes.ts";

type Turn = { reference: number; text: string; offscreen: boolean; motion: string; providedOffscreen?: boolean };

/** Speaker identity is explicit data. Never guess it from a name, a photo or array order. */
export function buildHeygenDialogueTurns(args: AiVideoProviderGenerationArgs): Turn[] {
  const request = args.request;
  const characters = request.inspirationImages.flatMap((image, i) => image.role === "character" ? [{ reference: i + 1, slot: image.characterIndex }] : []);
  const silentTurns = (motion: string): Turn[] => characters.length
    ? characters.map(character => ({ reference: character.reference, text: "", offscreen: false, motion }))
    : [{ reference: 0, text: "", offscreen: true, motion }];
  let turns: Turn[];
  if (request.exactDialogue?.length && request.teamVideoSpeechMode === "characters") {
    turns = request.exactDialogue.map(turn => {
      const character = turn.speaker === "character" ? characters.find(item => item.slot === turn.characterIndex) : null;
      if (turn.speaker === "character" && !character) throw new Error("ai_media_heygen_speaker_missing");
      return { reference: character?.reference ?? 0, text: turn.text, offscreen: turn.speaker !== "character", motion: "",
        providedOffscreen: turn.speaker === "provided_voice" };
    });
  } else if (request.teamVideoSpeechMode !== "characters") {
    // Studio narration is mixed separately. Silent avatar plans keep every
    // selected person visible without making them articulate the narrator.
    turns = args.plan.scenes.flatMap((scene, index) => {
      const text = args.nativeNarrationLines?.[index] || "";
      return text.trim() ? [{ reference: 0, text, offscreen: true, motion: scene.visualBrief }]
        : silentTurns(scene.visualBrief);
    });
  } else {
    turns = args.plan.scenes.flatMap(scene => scene.spokenTurns?.length
      ? scene.spokenTurns.map(turn => ({ reference: turn.reference, text: turn.text, offscreen: turn.reference === 0, motion: scene.visualBrief }))
      : !scene.spokenLine?.trim() ? silentTurns(scene.visualBrief)
      : [{ reference: characters.length === 1 ? characters[0].reference : characters.length === 0 ? 0 : -1,
        text: scene.spokenLine, offscreen: false, motion: scene.visualBrief }]);
  }
  if (turns.some(turn => turn.reference < 0 || turn.reference > request.inspirationImages.length ||
      (turn.reference > 0 && request.inspirationImages[turn.reference - 1].role !== "character"))) throw new Error("ai_media_heygen_speaker_missing");
  // HeyGen Studio accepts up to 50 scenes. The editor separately caps exact
  // user turns at 12; automatic turns may span two native segments.
  if (!turns.length || turns.length > 50) throw new Error("ai_media_heygen_dialogue_missing");
  return turns;
}

export const heygenAiVideoProvider: AiVideoProvider = {
  id: "heygen-direct", model: "heygen-avatar-iv",
  async generate(args) {
    if (args.request.videoEngine !== "heygen-avatar") throw new Error("ai_video_heygen_engine_mismatch");
    args.signal?.throwIfAborted();
    assertAiVideoReferenceTeamProviderEgress(args, "heygen");
    if (!usesHeygenAvatarRoute(args.request)) return generateHeygenCinematicVideo(args);
    const turns = buildHeygenDialogueTurns(args);
    const language = (args.contentLanguage || "fr").split(/[-_]/)[0];
    const client = createHeygenApiClient({ apiKey: process.env.HEYGEN_API_KEY || "" });
    const key = `inrcy-${createHash("sha256").update(`${args.accountId}:${args.jobId || args.canonicalPromptSha256}`).digest("hex").slice(0,40)}`;
    const resolution = getAiMediaVideoResolution("heygen-avatar", args.request.videoResolution);
    const duration = args.request.durationSeconds || 8;
    const spokenTurns = turns.filter(turn => turn.text.trim());
    const estimatedBillingSeconds = estimateHeygenBillableDurationSeconds({ durationSeconds: duration,
      script: spokenTurns.map(turn => turn.text).join("\n"), turnCount: Math.max(1, spokenTurns.length), language: args.contentLanguage,
      silentSeconds: duration / turns.length * (turns.length - spokenTurns.length) });
    const estimatedCostMicroUsd = Math.ceil(estimatedBillingSeconds * getAiMediaVideoSupplierRate("heygen-avatar", resolution, args.request) * 1_000_000);
    if (!Number.isSafeInteger(estimatedCostMicroUsd) || estimatedCostMicroUsd < 0 || estimatedCostMicroUsd > AI_MEDIA_HEYGEN_MAX_ESTIMATED_COST_MICRO_USD) {
      throw new Error("ai_media_heygen_billing_cost_invalid");
    }
    const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
      feature: "media.video", estimatedInputTokens: 0, reservedOutputTokens: 0, estimatedCostMicroUsd,
    });
    const temporaryVoiceIds: string[] = [], temporaryAvatarGroupIds: string[] = [], temporaryAssetIds: string[] = [];
    let videoSubmitted = false;
    let postAttempted = false;
    let uncertainSubmission = false;
    let committed = false;
    const commit = async () => {
      if (committed) return;
      await commitAiGatewayAccountAttempt({ reservation, feature: "media.video", model: "heygen-avatar-iv",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: estimatedCostMicroUsd });
      committed = true;
    };
    try {
      const prepared = await prepareAiMediaIdentityReferences(args.request.inspirationImages, { format: "png", signal: args.signal });
      const backgroundAsset = await client.uploadImage(await prepareHeygenBackground(args, prepared.buffers), args.signal);
      temporaryAssetIds.push(backgroundAsset.asset_id);
      const speakingReferences = new Set(turns.filter(turn => !turn.offscreen && turn.text.trim()).map(turn => turn.reference));
      const voices = await getAiMediaCharacterVoiceSignedUrls({ accountId: args.accountId,
        images: args.request.inspirationImages.map((image, index) => speakingReferences.has(index + 1) ? image
          : { ...image, voiceMode: "ai" as const, voiceSample: undefined }), videoEngine: "heygen-avatar", signal: args.signal });
      const needsPublicVoice = turns.some(turn => turn.text.trim() &&
        (turn.offscreen ? !turn.providedOffscreen : !voices[turn.reference - 1]));
      const publicVoices = needsPublicVoice ? await client.publicVoices(language, args.signal) : [];
      const voiceIds = new Map<number, string>();
      const avatars = new Map<number, string>();
      const references = [...new Set(turns.map(turn => turn.reference).filter(reference => reference > 0))];
      for (const reference of references) {
        args.signal?.throwIfAborted();
        const asset = await client.uploadImage(await prepareHeygenAvatarImage(prepared.buffers[reference - 1],args.request.format), args.signal);
        temporaryAssetIds.push(asset.asset_id);
        const avatar = await client.createPhotoAvatar(asset, `${key}-person-${reference}`, `${key}-avatar-${reference}`, args.signal);
        temporaryAvatarGroupIds.push(avatar.groupId); avatars.set(reference, avatar.id);
        if (turns.some(turn => turn.reference === reference && !turn.offscreen && turn.text.trim())) {
          const voiceUrl = voices[reference - 1];
          if (voiceUrl) {
            const voiceId = await client.createVoice(voiceUrl, `${key}-voice-${reference}`, language, `${key}-voice-${reference}`, args.signal,
              id => temporaryVoiceIds.push(id));
            voiceIds.set(reference, voiceId);
          } else voiceIds.set(reference, publicVoices[(reference - 1) % publicVoices.length]);
        }
      }
      // Only narration's selected recording can supply a real offscreen voice.
      let providedNarratorVoice: string | undefined;
      if (turns.some(turn => turn.providedOffscreen && turn.text.trim()) && args.request.narrationVoiceSample) {
        const [voiceUrl] = await getAiMediaCharacterVoiceSignedUrls({ accountId: args.accountId, videoEngine: "heygen-avatar", signal: args.signal,
          images: [{ role: "character", voiceMode: "provided", voiceSample: args.request.narrationVoiceSample }] });
        if (!voiceUrl) throw new Error("ai_media_heygen_voice_missing");
        providedNarratorVoice = await client.createVoice(voiceUrl, `${key}-narrator`, language, `${key}-narrator`, args.signal,
          id => temporaryVoiceIds.push(id));
      }
      const publicAvatar = turns.some(turn => !turn.reference && !turn.offscreen && turn.text.trim()) ? await client.publicAvatar(args.signal) : null;
      const silentDuration = duration / turns.length;
      let silentAsset: HeygenAsset | undefined;
      if (turns.some(turn => turn.reference > 0 && !turn.text.trim())) {
        // A single PCM asset is shared by all silent portraits in this job.
        // Studio then animates the original photo against the chosen decor.
        silentAsset = await client.uploadAudio(createHeygenSilenceWav(silentDuration), args.signal);
        temporaryAssetIds.push(silentAsset.asset_id);
      }
      const scenes: HeygenStudioScene[] = turns.map(turn => {
        if (turn.offscreen && turn.text.trim()) {
          if (turn.providedOffscreen && !providedNarratorVoice) throw new Error("ai_media_heygen_voice_missing");
          return { type: "image", source: backgroundAsset, script: turn.text,
            voice_id: turn.providedOffscreen ? providedNarratorVoice! : publicVoices[0] };
        }
        const avatarId = avatars.get(turn.reference) || publicAvatar;
        if (!turn.text.trim() && !avatarId) return { type: "image", source: backgroundAsset, duration: silentDuration };
        if (!avatarId) throw new Error("ai_media_heygen_speaker_missing");
        const visualInput = { type: "avatar" as const, avatar_id: avatarId,
          background: { type: "image" as const, source: backgroundAsset }, remove_background: true,
          ...(turn.reference > 0 ? { expressiveness: "low" as const } : {}) };
        if (!turn.text.trim()) {
          if (!silentAsset) throw new Error("ai_media_heygen_silence_missing");
          return { type: "avatar_video", input: { ...visualInput, audio_asset_id: silentAsset.asset_id } };
        }
        return { type: "avatar_video", input: { ...visualInput,
          script: turn.text, voice_id: voiceIds.get(turn.reference) || publicVoices[0] } };
      });
      // Creating a photo avatar acknowledges its ID before training finishes.
      // Wait by read-only status checks before the one billable video submission.
      await Promise.all([...avatars.values()].map(id => client.waitForAvatar(id,args.signal)));
      const pendingTask: AiMediaPendingVideo = { provider: "heygen-direct", model: "heygen-avatar-iv", videoId: "not-submitted",
        temporaryVoiceIds, temporaryAvatarGroupIds, temporaryAssetIds, estimatedCostMicroUsd };
      // Validate every persisted identifier and bound before the paid render POST.
      if (!isAiMediaPendingVideo(pendingTask)) throw new Error("ai_media_pending_video_invalid");
      postAttempted = true;
      const videoId = await client.submitVideo({ title: key, resolution, scenes,
        aspect_ratio: ({ square: "1:1", portrait: "4:5", story: "9:16", landscape: "16:9" } as const)[args.request.format] }, key, args.signal);
      videoSubmitted = true;

      // The caller persists the montage inputs and returns immediately. Only GET
      // status/download requests will run in recovery; no second video is submitted.
      throw new AiVideoProviderPending({ ...pendingTask, videoId }, async () => {
        await commit().catch(() => console.warn("[ai-media] HeyGen supplier accounting pending", { jobId: args.jobId }));
      });
    } catch (error) {
      if (error instanceof AiVideoProviderPending) throw error;
      await recordAiGatewayAccountFailure({ accountId: args.accountId, feature: "media.video", model: "heygen-avatar-iv" }).catch(() => undefined);
      if (videoSubmitted || postAttempted && (!(error instanceof HeygenApiError) || error.uncertain)) {
        uncertainSubmission = true;
        await commit().catch(() => undefined);
        throw new AiVideoProviderBillableFailure({ provider: "heygen-direct", model: "heygen-avatar-iv", stage: "provider_submission", details: "ai_video_heygen_submission_uncertain" });
      }
      await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
      const safeError = error instanceof HeygenApiError ? error : new Error("ai_video_heygen_preparation_failed");
      throw safeError;
    } finally {
      if (!videoSubmitted && !uncertainSubmission) await cleanupHeygenTemporaryResources({ provider: "heygen-direct", model: "heygen-avatar-iv", videoId: "not-submitted",
        temporaryVoiceIds, temporaryAvatarGroupIds, temporaryAssetIds, estimatedCostMicroUsd }).catch(() => undefined);
    }
  },
};

/** Only identifiers created for this private job may enter this cleanup list. */
export async function cleanupHeygenTemporaryResources(task: AiMediaPendingVideo) {
  const client = createHeygenApiClient({ apiKey: process.env.HEYGEN_API_KEY || "" });
  const signal = AbortSignal.timeout(20_000);
  for (const id of task.temporaryVoiceIds) await client.deleteVoice(id, signal).catch(() => undefined);
  for (const id of task.temporaryAvatarGroupIds) await client.deleteAvatarGroup(id, signal).catch(() => undefined);
  for (const id of task.temporaryAssetIds) await client.deleteAsset(id, signal).catch(() => undefined);
}

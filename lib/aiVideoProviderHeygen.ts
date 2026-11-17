import "server-only";
import { createHash } from "node:crypto";
import {
  reserveAiGatewayAccountAttempt, commitAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt, recordAiGatewayAccountFailure,
} from "@/lib/aiGatewayAccountGuard";
import { createHeygenApiClient, HeygenApiError, type HeygenAsset, type HeygenStudioScene } from "./aiVideoHeygenApi.ts";
import { AiVideoProviderPending, type AiMediaPendingVideo } from "./aiMediaPendingVideo.ts";
import { prepareAiMediaIdentityReferences } from "./aiMediaIdentityReferences.ts";
import { getAiMediaCharacterVoiceSignedUrls } from "./aiMediaCharacterVoiceStorage.ts";
import { getAiMediaVideoResolution, getAiMediaVideoSupplierRate } from "./aiMediaModelCatalog.ts";
import { AiVideoProviderBillableFailure, assertAiVideoReferenceTeamProviderEgress, type AiVideoProvider, type AiVideoProviderGenerationArgs } from "./aiVideoProviderTypes.ts";

type Turn = { reference: number; text: string; offscreen: boolean; motion: string; providedOffscreen?: boolean };

/** Speaker identity is explicit data. Never guess it from a name, a photo or array order. */
export function buildHeygenDialogueTurns(args: AiVideoProviderGenerationArgs): Turn[] {
  const request = args.request;
  const characters = request.inspirationImages.flatMap((image, i) => image.role === "character" ? [{ reference: i + 1, slot: image.characterIndex }] : []);
  if (request.exactDialogue?.length && request.teamVideoSpeechMode === "characters") return request.exactDialogue.map(turn => {
    const character = turn.speaker === "character" ? characters.find(item => item.slot === turn.characterIndex) : null;
    if (turn.speaker === "character" && !character) throw new Error("ai_media_heygen_speaker_missing");
    return { reference: character?.reference ?? 0, text: turn.text, offscreen: turn.speaker !== "character", motion: "",
      providedOffscreen: turn.speaker === "provided_voice" };
  });
  if (request.teamVideoSpeechMode !== "characters") return args.plan.scenes.map((scene, index) => ({
    reference: characters[0]?.reference ?? 0, text: args.nativeNarrationLines?.[index] || "", offscreen: true, motion: scene.visualBrief,
  }));
  const turns = args.plan.scenes.flatMap(scene => scene.spokenTurns?.length
    ? scene.spokenTurns.map(turn => ({ reference: turn.reference, text: turn.text, offscreen: turn.reference === 0, motion: scene.visualBrief }))
    : [{ reference: characters.length === 1 ? characters[0].reference : characters.length === 0 ? 0 : -1,
      text: scene.spokenLine || "", offscreen: false, motion: scene.visualBrief }]);
  if (turns.some(turn => turn.reference < 0 || turn.reference > request.inspirationImages.length ||
      (turn.reference > 0 && request.inspirationImages[turn.reference - 1].role !== "character"))) throw new Error("ai_media_heygen_speaker_missing");
  if (turns.length > 12 || !turns.some(turn => turn.text.trim()) && request.withNarration) throw new Error("ai_media_heygen_dialogue_missing");
  return turns;
}

export const heygenAiVideoProvider: AiVideoProvider = {
  id: "heygen-direct", model: "heygen-avatar-iv",
  async generate(args) {
    if (args.request.videoEngine !== "heygen-avatar") throw new Error("ai_video_heygen_engine_mismatch");
    args.signal?.throwIfAborted();
    assertAiVideoReferenceTeamProviderEgress(args, "heygen");
    const turns = buildHeygenDialogueTurns(args);
    const language = (args.contentLanguage || "fr").split(/[-_]/)[0];
    const client = createHeygenApiClient({ apiKey: process.env.HEYGEN_API_KEY || "" });
    const key = `inrcy-${createHash("sha256").update(`${args.accountId}:${args.jobId || args.canonicalPromptSha256}`).digest("hex").slice(0,40)}`;
    const resolution = getAiMediaVideoResolution("heygen-avatar", args.request.videoResolution);
    const duration = args.request.durationSeconds || 8;
    const estimatedCostMicroUsd = Math.ceil(duration * getAiMediaVideoSupplierRate("heygen-avatar", resolution, args.request) * 1_000_000);
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
      const voices = await getAiMediaCharacterVoiceSignedUrls({ accountId: args.accountId,
        images: args.request.inspirationImages, videoEngine: "heygen-avatar", signal: args.signal });
      const needsPublicVoice = turns.some(turn => turn.text.trim() &&
        (turn.offscreen ? !turn.providedOffscreen : !voices[turn.reference - 1]));
      const publicVoices = needsPublicVoice ? await client.publicVoices(language, args.signal) : [];
      const voiceIds = new Map<number, string>();
      const avatars = new Map<number, string>();
      const assets = new Map<number, HeygenAsset>();
      const references = [...new Set(turns.map(turn => turn.reference).filter(reference => reference > 0))];
      for (const reference of references) {
        args.signal?.throwIfAborted();
        const asset = await client.uploadImage(prepared.buffers[reference - 1], args.signal);
        temporaryAssetIds.push(asset.asset_id); assets.set(reference, asset);
        if (turns.some(turn => turn.reference === reference && !turn.offscreen && turn.text.trim())) {
          const avatar = await client.createPhotoAvatar(asset, `${key}-person-${reference}`, `${key}-avatar-${reference}`, args.signal);
          temporaryAvatarGroupIds.push(avatar.groupId); avatars.set(reference, avatar.id);
        }
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
      const publicAvatar = turns.some(turn => !turn.reference && !turn.offscreen) ? await client.publicAvatar(args.signal) : null;
      // A neutral frame is only used for an explicitly offscreen voice with no image.
      // It never stands in for a requested character or a failed generation.
      let fallbackAsset: HeygenAsset | undefined;
      if (turns.some(turn => (turn.offscreen || !turn.text.trim()) && !assets.has(turn.reference))) {
        const firstAsset = assets.values().next().value;
        if (firstAsset) fallbackAsset = firstAsset;
        else {
          const { default: sharp } = await import("sharp");
          const background = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: args.brandColors[0] || "#0b1220" } }).png().toBuffer();
          fallbackAsset = await client.uploadImage(background, args.signal); temporaryAssetIds.push(fallbackAsset.asset_id);
        }
      }
      const scenes: HeygenStudioScene[] = turns.map(turn => {
        if (turn.offscreen || !turn.text.trim()) {
          const source = assets.get(turn.reference) || fallbackAsset || assets.values().next().value;
          if (!source) throw new Error("ai_media_heygen_image_missing");
          if (turn.providedOffscreen && turn.text.trim() && !providedNarratorVoice) throw new Error("ai_media_heygen_voice_missing");
          return { type: "image", source, ...(turn.text.trim() ? { script: turn.text, voice_id: turn.providedOffscreen ? providedNarratorVoice! : publicVoices[0] } : { duration: duration / turns.length }) };
        }
        const avatarId = avatars.get(turn.reference) || publicAvatar;
        if (!avatarId) throw new Error("ai_media_heygen_speaker_missing");
        return { type: "avatar_video", input: { type: "avatar", avatar_id: avatarId,
          script: turn.text, voice_id: voiceIds.get(turn.reference) || publicVoices[0],
          ...(turn.reference > 0 ? { expressiveness: "low", ...(turn.motion ? { motion_prompt: turn.motion.slice(0,1200) } : {}) } : {}) } };
      });
      postAttempted = true;
      const videoId = await client.submitVideo({ title: key, resolution, scenes,
        aspect_ratio: ({ square: "1:1", portrait: "4:5", story: "9:16", landscape: "16:9" } as const)[args.request.format] }, key, args.signal);
      videoSubmitted = true;
      await commit().catch(() => console.warn("[ai-media] HeyGen supplier accounting pending", { jobId: args.jobId }));
      // The caller persists the montage inputs and returns immediately. Only GET
      // status/download requests will run in recovery; no second video is submitted.
      throw new AiVideoProviderPending({ provider: "heygen-direct", model: "heygen-avatar-iv", videoId,
        temporaryVoiceIds, temporaryAvatarGroupIds, temporaryAssetIds, estimatedCostMicroUsd });
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

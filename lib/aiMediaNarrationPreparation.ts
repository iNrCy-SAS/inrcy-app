import "server-only";

import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { writeAiMediaFreeNarration } from "@/lib/aiMediaFreeGenerationPlan";
import { writeAiMediaNarration } from "@/lib/aiMediaNarration";
import { generateAiMediaNarrationAudio } from "@/lib/aiMediaNarrationAudio";
import { AiMediaNarrationTooLongError, prepareAiMediaNarrationAudioForVideo } from "@/lib/aiMediaGeneratedVideo";
import { safeAiMediaErrorMessage } from "@/lib/aiMediaSensitiveText";
import { extractAiMediaPronunciationAliases } from "./aiMediaPronunciation.ts";
import type { PreparedAiMediaNarrationVoice } from "./aiMediaNarrationVoicePreflight.ts";

type NarrationInput = Parameters<typeof writeAiMediaNarration>[0];
type FreeNarrationInput = Parameters<typeof writeAiMediaFreeNarration>[0];

/** Prepares complete, duration-checked speech before the caller starts paid video work. */
export async function prepareAiMediaNarration(args: {
  context: Readonly<{ accountId: string; signal?: AbortSignal }>;
  narrationRequest: AiMediaGenerationRequest;
  preparedNativeNarration: Awaited<ReturnType<typeof writeAiMediaFreeNarration>>;
  isFreeCreation: boolean;
  profile: NarrationInput["profile"];
  creativePlan: NarrationInput["plan"];
  businessDnaContext: FreeNarrationInput["businessDnaContext"];
  recentPublications: NarrationInput["recentPublications"];
  durationSeconds: number;
  narrationSignal: AbortSignal;
  providedVoice?: PreparedAiMediaNarrationVoice | null;
  measure: <T>(stage: string, action: () => Promise<T>) => Promise<T>;
}) {
  const { context, narrationRequest, preparedNativeNarration, isFreeCreation, profile, creativePlan,
    businessDnaContext, recentPublications, durationSeconds, narrationSignal, measure } = args;
  try {
    let maximumSpeechUnits: number | undefined;
    for (let preflightAttempt = 0; preflightAttempt < 3; preflightAttempt += 1) {
      const stageSuffix = preflightAttempt ? `_rewrite_${preflightAttempt}` : "";
      const narration = preparedNativeNarration && preflightAttempt === 0
        ? preparedNativeNarration
        : await measure(`narration_copy${stageSuffix}`, () =>
        isFreeCreation ? writeAiMediaFreeNarration({ accountId: context.accountId, request: narrationRequest, profile, plan: creativePlan, maximumSpeechUnits, businessDnaContext }) : writeAiMediaNarration({
          accountId: context.accountId,
          request: narrationRequest,
          profile,
          plan: creativePlan,
          recentPublications: recentPublications,
          maximumSpeechUnits,
        })
      );
      context.signal?.throwIfAborted();
      if (!narration) {
        throw new Error("ai_media_narration_copy_unavailable");
      }
      const audio = await measure(`narration_audio${stageSuffix}`, () =>
        narrationRequest.narrationVoiceMode === "provided" ? (async () => {
          if (!args.providedVoice || narrationRequest.narrationVoiceConsent !== true) throw new Error("ai_media_voice_clone_reference_missing");
          const { generateAiMediaClonedNarrationAudio } = await import("./aiMediaNarrationVoiceClone.ts");
          return generateAiMediaClonedNarrationAudio({
            accountId: context.accountId, narration, reference: args.providedVoice,
            narrationVoiceConsent: true, narrationVoiceGender: narrationRequest.narrationVoiceGender || "auto",
            durationSeconds, signal: narrationSignal,
          });
        })() :
        generateAiMediaNarrationAudio({
          accountId: context.accountId,
          narration,
          durationSeconds,
          narrationVoice: narrationRequest.narrationVoice || "female",
          narrationVoiceVariant: narrationRequest.narrationVoiceVariant,
          pronunciationAliases: isFreeCreation ? extractAiMediaPronunciationAliases(narrationRequest.freePrompt || "") : undefined,
          signal: narrationSignal,
        })
      );
      try {
        const prepared = await measure(
          `narration_audio_preflight${stageSuffix}`,
          () =>
            prepareAiMediaNarrationAudioForVideo({
              audio,
              durationSeconds,
              signal: narrationSignal,
            })
        );
        return {
          narration,
          audio: prepared.audio,
          warnings: prepared.silenceCompacted
            ? ["narration_silence_compacted_before_video"]
            : ([] as string[]),
        };
      } catch (error) {
        context.signal?.throwIfAborted();
        if (
          error instanceof AiMediaNarrationTooLongError &&
          !(narrationRequest.narrationVoiceMode === "provided" && narrationRequest.spokenScript?.trim()) &&
          preflightAttempt < 2
        ) {
          // Réécrire une vraie phrase plus concise, puis la resynthétiser,
          // plutôt que couper des mots, accélérer artificiellement la voix
          // ou payer une vidéo qui devrait ensuite être livrée muette.
          const suggestedMaximum = Math.max(
            1,
            Math.min(
              narration.wordCount - 1,
              Math.floor(
                (narration.wordCount / error.requiredTempo) * 0.96
              )
            )
          );
          maximumSpeechUnits = maximumSpeechUnits
            ? Math.min(maximumSpeechUnits - 1, suggestedMaximum)
            : suggestedMaximum;
          continue;
        }
        throw new Error(
          `ai_media_narration_audio_preflight_failed:${safeAiMediaErrorMessage(
            error,
            320
          )}`,
          { cause: error }
        );
      }
    }
    throw new Error("ai_media_narration_audio_preflight_exhausted");
  } catch (error) {
    context.signal?.throwIfAborted();
    if (narrationRequest.withNarration) {
      throw new Error(
        `ai_media_narration_unavailable:${safeAiMediaErrorMessage(
          error,
          400
        )}`,
        { cause: error }
      );
    }
    return {
      narration: null,
      audio: null,
      warnings: ["narration_unavailable_video_continued"],
    };
  }
}

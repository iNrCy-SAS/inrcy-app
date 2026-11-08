import "server-only";

import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { writeAiMediaFreeNarration } from "@/lib/aiMediaFreeGenerationPlan";
import { writeAiMediaNarration, type AiMediaNarration } from "@/lib/aiMediaNarration";
import { generateAiMediaNarrationAudio } from "@/lib/aiMediaNarrationAudio";
import { AiMediaNarrationTooLongError, prepareAiMediaNarrationAudioForVideo } from "@/lib/aiMediaGeneratedVideo";
import { safeAiMediaErrorMessage } from "@/lib/aiMediaSensitiveText";
import { extractAiMediaPronunciationAliases } from "./aiMediaPronunciation.ts";
import { getAiMediaFreeSpeechBudget } from "./aiMediaVideoSpeechBudget.ts";
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
    const exactProvidedStudioClone = isFreeCreation && narrationRequest.source === "studio" &&
      narrationRequest.narrationVoiceMode === "provided" && Boolean(narrationRequest.spokenScript?.trim());
    let cloneQualityRetryNarration: AiMediaNarration | null = null;
    let cloneQualitySignal: AbortSignal | undefined;
    for (let preflightAttempt = 0; preflightAttempt < 3; preflightAttempt += 1) {
      const stageSuffix: string = cloneQualityRetryNarration ? "_quality_retry_1" : preflightAttempt ? `_rewrite_${preflightAttempt}` : "";
      const narration: AiMediaNarration | null = cloneQualityRetryNarration || (preparedNativeNarration && preflightAttempt === 0
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
      ));
      context.signal?.throwIfAborted();
      cloneQualitySignal?.throwIfAborted();
      if (!narration) {
        throw new Error("ai_media_narration_copy_unavailable");
      }
      const audio = await measure(`narration_audio${stageSuffix}`, () =>
        narrationRequest.narrationVoiceMode === "provided" ? (async () => {
          if (!args.providedVoice || narrationRequest.narrationVoiceConsent !== true) throw new Error("ai_media_voice_clone_reference_missing");
          const { generateAiMediaClonedNarrationAudio, AI_MEDIA_CLONED_NARRATION_TIMEOUT_MS } = await import("./aiMediaNarrationVoiceClone.ts");
          if (exactProvidedStudioClone) {
            // A completed but overlong clone may be synthesized once more.
            // Both attempts and their duration checks share the original cap.
            cloneQualitySignal ||= AbortSignal.any([narrationSignal, AbortSignal.timeout(AI_MEDIA_CLONED_NARRATION_TIMEOUT_MS)]);
          }
          cloneQualitySignal?.throwIfAborted();
          return generateAiMediaClonedNarrationAudio({
            accountId: context.accountId, narration, reference: args.providedVoice,
            narrationVoiceConsent: true, narrationVoiceGender: narrationRequest.narrationVoiceGender || "auto",
            durationSeconds, signal: cloneQualitySignal || narrationSignal,
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
              signal: cloneQualitySignal || narrationSignal,
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
        // Only an entirely received, duration-rejected clone permits another
        // synthesis. Transport errors never enter this quality-only branch.
        if (error instanceof AiMediaNarrationTooLongError && exactProvidedStudioClone) {
          cloneQualitySignal?.throwIfAborted();
          const budget = getAiMediaFreeSpeechBudget(durationSeconds, narration.language, narration.script);
          if (budget.units <= budget.maxUnits && narration.script.length <= budget.maxCharacters) {
            if (!cloneQualityRetryNarration) {
              cloneQualityRetryNarration = narration;
              continue;
            }
            throw new Error("ai_media_voice_clone_duration_invalid", { cause: error });
          }
        }
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

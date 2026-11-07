import "server-only";
import { AiMediaRequestValidationError } from "./aiMediaGenerationContracts.ts";
import { readAiMediaCharacterVoice } from "./aiMediaCharacterVoiceStorage.ts";
import { AI_MEDIA_NARRATION_VOICE_MIN_SECONDS, normalizeAiMediaCharacterVoiceSample, type AiMediaCharacterVoiceSample } from "./aiMediaCharacterVoices.ts";
import { buildNormalizedAiGenerationProfile } from "./aiGenerationProfile.ts";
import { resolveAiMediaFreeSpeechLanguage } from "./aiMediaVideoSpeechBudget.ts";
import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";

/** Ephemeral owned bytes: never persisted in a request, log, URL or client response. */
export type PreparedAiMediaNarrationVoice = {
  accountId: string;
  path: string;
  buffer: Buffer;
  durationSeconds: number;
  /** Frozen synthesis language; never inferred again from another account. */
  language?: string;
};

export function resolveAiMediaNarrationVoiceLanguage(args: { profile: unknown; business: unknown; request: AiMediaGenerationRequest }) {
  const profile = buildNormalizedAiGenerationProfile({ profile: args.profile, business: args.business });
  return resolveAiMediaFreeSpeechLanguage(args.request.freePrompt || args.request.aiInstruction || "", args.request.spokenScript || "", profile.preferences.language);
}

export async function preflightAiMediaNarrationVoice(args: {
  accountId: string; sample: AiMediaCharacterVoiceSample | null | undefined; consent: boolean | undefined; signal?: AbortSignal; language?: string;
}): Promise<PreparedAiMediaNarrationVoice> {
  args.signal?.throwIfAborted();
  const { isAiMediaVoiceCloneConfigured, supportsAiMediaClonedNarrationLanguage } = await import("./aiMediaNarrationVoiceClone.ts");
  if (!isAiMediaVoiceCloneConfigured()) throw new AiMediaRequestValidationError("La synthèse avec votre voix est momentanément indisponible. Votre vocal est conservé.");
  if (args.language && !supportsAiMediaClonedNarrationLanguage(args.language)) throw new AiMediaRequestValidationError("La synthèse avec votre voix n’est pas disponible dans cette langue. Choisissez une autre langue de narration.");
  if (args.consent !== true) throw new AiMediaRequestValidationError("Confirmez que vous disposez des droits sur cette voix et autorisez sa synthèse avant de générer.");
  const sample = normalizeAiMediaCharacterVoiceSample(args.sample);
  if (!sample) throw new AiMediaRequestValidationError("Ajoutez un vocal valide avant de générer avec votre voix.");
  let reference: Awaited<ReturnType<typeof readAiMediaCharacterVoice>>;
  try {
    reference = await readAiMediaCharacterVoice({ accountId: args.accountId, path: sample.path, signal: args.signal });
  } catch {
    args.signal?.throwIfAborted();
    throw new AiMediaRequestValidationError("Ce vocal est introuvable ou a expiré. Importez-le de nouveau dans le compte actuel.");
  }
  if (reference.durationSeconds < AI_MEDIA_NARRATION_VOICE_MIN_SECONDS) {
    throw new AiMediaRequestValidationError("Pour reproduire votre voix, ajoutez un vocal clair de 5 à 10 secondes.");
  }
  return { accountId: args.accountId, path: sample.path, buffer: reference.buffer, durationSeconds: reference.durationSeconds, ...(args.language ? { language: args.language } : {}) };
}

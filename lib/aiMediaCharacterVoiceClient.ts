import {
  AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES,
  type AiMediaCharacterVoiceSample,
} from "./aiMediaCharacterVoices.ts";

type CharacterVoiceReference = {
  role?: string;
  voiceMode?: "ai" | "provided";
  voiceSample?: AiMediaCharacterVoiceSample;
};

export function isProvidedCharacterVoice(reference: CharacterVoiceReference) {
  return reference.role === "character" && reference.voiceMode === "provided";
}

export function getCharacterVoiceSelectionState(references: readonly CharacterVoiceReference[]) {
  const provided = references.filter(isProvidedCharacterVoice);
  return {
    requiresWan27: provided.length > 0,
    missingSample: provided.some((reference) => !reference.voiceSample),
  };
}

export function isCharacterVoiceUploadFileAllowed(file: { name: string; size: number; type: string }) {
  return file.size > 0 && file.size <= AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES &&
    /\.(?:mp3|wav)$/i.test(file.name) &&
    (!file.type || ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(file.type.toLowerCase()));
}

export function getCharacterVoicePreviewUrl(sample: AiMediaCharacterVoiceSample) {
  return `/api/media-generation/voice-reference?path=${encodeURIComponent(sample.path)}`;
}

/** Best effort: references also expire server-side if a tab closes during cleanup. */
export async function deleteCharacterVoiceSample(sample: AiMediaCharacterVoiceSample | undefined) {
  if (!sample) return;
  try {
    await fetch(getCharacterVoicePreviewUrl(sample), { method: "DELETE", credentials: "include", cache: "no-store" });
  } catch { /* A temporary connection failure must not prevent removing a reference. */ }
}

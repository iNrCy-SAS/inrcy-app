export const AI_MEDIA_NARRATION_VOICE_VARIANTS = {
  female: ["Kore", "Aoede", "Sulafat"],
  male: ["Charon", "Orus", "Puck"],
} as const;

export type AiMediaNarrationVoiceVariant =
  (typeof AI_MEDIA_NARRATION_VOICE_VARIANTS)[keyof typeof AI_MEDIA_NARRATION_VOICE_VARIANTS][number];

export const AI_MEDIA_NARRATION_VOICE_VARIANT_IDS = [
  ...AI_MEDIA_NARRATION_VOICE_VARIANTS.female,
  ...AI_MEDIA_NARRATION_VOICE_VARIANTS.male,
] as const;

export function defaultAiMediaNarrationVoiceVariant(
  narrationVoice: "female" | "male",
): AiMediaNarrationVoiceVariant {
  return AI_MEDIA_NARRATION_VOICE_VARIANTS[narrationVoice][0];
}

export function isAiMediaNarrationVoiceVariant(
  value: unknown,
): value is AiMediaNarrationVoiceVariant {
  return (
    typeof value === "string" &&
    (AI_MEDIA_NARRATION_VOICE_VARIANT_IDS as readonly string[]).includes(value)
  );
}

export function isAiMediaNarrationVoiceVariantForGender(
  value: unknown,
  narrationVoice: "female" | "male",
): value is AiMediaNarrationVoiceVariant {
  return (
    typeof value === "string" &&
    (AI_MEDIA_NARRATION_VOICE_VARIANTS[narrationVoice] as readonly string[]).includes(
      value,
    )
  );
}

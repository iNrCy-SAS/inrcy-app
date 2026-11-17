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

export function getAiMediaNativeNarrationTone(variant: AiMediaNarrationVoiceVariant | null | undefined): string {
  switch (variant) {
    case "Kore": return "confident, composed and professional";
    case "Aoede": return "natural, fluid and spontaneous";
    case "Sulafat": return "warm, gentle and welcoming";
    case "Charon": return "calm, clear and informative";
    case "Orus": return "assertive, direct and professional";
    case "Puck": return "upbeat, positive and energetic";
    default: return "natural and professional";
  }
}

/** These selections are style directions, not proprietary voice identities or clones. */
export function buildAiMediaNativeNarratorVoiceDirection(input: {
  narrationVoice?: "female" | "male" | null;
  narrationVoiceVariant?: AiMediaNarrationVoiceVariant | null;
  narrationVoiceGender?: "auto" | "female" | "male";
}): string {
  const gender = input.narrationVoice || (input.narrationVoiceGender === "female" || input.narrationVoiceGender === "male" ? input.narrationVoiceGender : "");
  return (gender ? gender + " " : "") + "off-screen narrator; " + getAiMediaNativeNarrationTone(input.narrationVoiceVariant) + " tone; keep one consistent voice across clips.";
}

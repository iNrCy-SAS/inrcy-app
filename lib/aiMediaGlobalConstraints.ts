import type { NormalizedAiGenerationProfile } from "./aiGenerationProfile.ts";

const MEDIA_RULE_MAX_LENGTH = 1_200;

function completeRule(value: unknown) {
  const rule = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  // These are mandatory account rules, not optional business background. Never
  // turn a long prohibition into a different one by shortening it for a model.
  if (rule.length > MEDIA_RULE_MAX_LENGTH) {
    throw new Error(`ai_media_global_rule_too_long:${rule.length}:${MEDIA_RULE_MAX_LENGTH}`);
  }
  return rule;
}

/** Independent of the ADN checkbox and custom/profile subject selection. */
export function buildAiMediaGlobalConstraints(
  profile: Pick<NormalizedAiGenerationProfile, "preferences">,
) {
  const prohibited = completeRule(profile.preferences.forbiddenInstructions);
  const instructions = completeRule(profile.preferences.customInstructions);
  if (!prohibited && !instructions) return "";
  return [
    "GLOBAL MEDIA RULES (ADN on/off; safety/rights first). Prohibitions > even later instructions/brief/cast/refs. Per relevant image/shot; writing advice≠text/CTA/audio request. Never show/say rules.",
    prohibited ? `PROHIBITIONS (highest priority):\n${prohibited}` : "",
    instructions ? `INSTRUCTIONS:\n${instructions}` : "",
  ].filter(Boolean).join("\n");
}

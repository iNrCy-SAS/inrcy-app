import { getAiMediaFreeSpeechBudget, getAiMediaFreeRequestedDialogue, resolveAiMediaFreeSpeechLanguage } from "./aiMediaVideoSpeechBudget.ts";
import { AI_MEDIA_EXACT_DIALOGUE_MAX_CHARS, type AiMediaExactDialogueTurn } from "./aiMediaExactDialogue.ts";
import { getAiMediaCharacterSpeechText } from "./aiMediaCharacterVoices.ts";

// A generated film has at most two plans, each with the existing 4k text cap.
const MAX_FINAL_SCRIPT_CHARS = AI_MEDIA_EXACT_DIALOGUE_MAX_CHARS * 2 + 1;
type HeygenBillingInput = {
  durationSeconds?: number | null; teamVideoSpeechMode?: string; voiceMode?: string;
  spokenScript?: string; freePrompt?: string; exactDialogue?: readonly AiMediaExactDialogueTurn[];
  inspirationImages?: readonly { role?: string; characterIndex?: number; characterName?: string }[];
};

/** Financial estimate only: it never rejects, cuts or rewrites words to fit a duration. */
export function estimateHeygenBillableDurationSeconds(input: {
  durationSeconds: number; script: string; turnCount?: number; language?: string; silentSeconds?: number;
}): number {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 ||
      typeof input.script !== "string" || input.script.length > MAX_FINAL_SCRIPT_CHARS ||
      !Number.isFinite(input.silentSeconds ?? 0) || (input.silentSeconds ?? 0) < 0) {
    throw new TypeError("ai_media_heygen_billing_input_invalid");
  }
  const language = resolveAiMediaFreeSpeechLanguage("", input.script, input.language || "fr");
  const speech = getAiMediaFreeSpeechBudget(input.durationSeconds, language, input.script);
  if (!input.script.trim()) return Math.ceil(Math.max(input.durationSeconds, input.silentSeconds || 0));
  const turns = input.turnCount ?? 1;
  if (!Number.isSafeInteger(turns) || turns < 1 || turns > 50) throw new TypeError("ai_media_heygen_billing_turns_invalid");
  const unitsPerSecond = speech.unit === "mots" ? 2 : 6;
  return Math.ceil(Math.max(input.durationSeconds, speech.units / unitsPerSecond + turns + (input.silentSeconds || 0)));
}

/** Exact native avatar speech is priced before the professional accepts the quote.
 * Separate voice-over uses the fixed silent-video duration; Auto keeps its quote. */
export function getHeygenQuotedBillableDurationSeconds(input: HeygenBillingInput): number {
  const selected = input.durationSeconds ?? 8;
  const nativeDialogue = input.teamVideoSpeechMode === "characters" || input.voiceMode === "characters" ||
    input.exactDialogue?.some(turn => turn.speaker === "character") === true;
  if (!nativeDialogue) return selected;
  if (input.spokenScript !== undefined && typeof input.spokenScript !== "string") throw new TypeError("ai_media_heygen_billing_script_invalid");
  if ((input.spokenScript?.length || 0) > AI_MEDIA_EXACT_DIALOGUE_MAX_CHARS) throw new TypeError("ai_media_heygen_billing_script_invalid");
  if (input.freePrompt !== undefined && typeof input.freePrompt !== "string") throw new TypeError("ai_media_heygen_billing_script_invalid");
  const inlineLines = input.spokenScript === undefined && !input.exactDialogue?.length ? getAiMediaFreeRequestedDialogue(input.freePrompt || "") : [];
  const script = input.exactDialogue?.length ? input.exactDialogue.map(turn => turn.text).join("\n")
    : typeof input.spokenScript === "string" ? getAiMediaCharacterSpeechText(input.spokenScript, input.inspirationImages) : inlineLines.join("\n");
  if (!script.trim()) return selected;
  return estimateHeygenBillableDurationSeconds({ durationSeconds: selected, script,
    turnCount: input.exactDialogue?.length || inlineLines.length || Math.min(50, Math.max(1, script.split("\n").filter(line => line.trim()).length)),
  });
}

import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";

/** Seed Grok's animation from one controlled initial frame instead of its implicit text-to-image step. */
export function needsControlledAiMediaFreeFirstFrame(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "videoEngine"
>): boolean {
  return request.creationMode === "free" && request.operation !== "modify" && request.kind === "video" &&
    (request.videoEngine === "grok" || request.videoEngine === "grok-lite");
}

/** Only a supplied off-screen narrator needs a separate voice-clone adapter.
 * Other Studio IA narration is generated natively by the selected video engine. */
export function usesSeparateAiMediaFreeVoiceover(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "withNarration" | "teamVideoSpeechMode" | "videoEngine" | "exactDialogue"
> & {narrationVoiceMode?:AiMediaGenerationRequest["narrationVoiceMode"]}): boolean {
  return request.creationMode === "free" && request.operation !== "modify" && request.kind === "video" && request.withNarration &&
    request.teamVideoSpeechMode !== "characters" && request.narrationVoiceMode === "provided";
}

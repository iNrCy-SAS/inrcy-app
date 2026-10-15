import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";

/** Seed Grok's animation from one controlled initial frame instead of its implicit text-to-image step. */
export function needsControlledAiMediaFreeFirstFrame(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "videoEngine"
>): boolean {
  return request.creationMode === "free" && request.operation !== "modify" && request.kind === "video" &&
    (request.videoEngine === "grok" || request.videoEngine === "grok-lite");
}

/** Voice-over has one owner: Studio TTS. Native speech belongs only to talking characters. */
export function usesSeparateAiMediaFreeVoiceover(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "withNarration" | "teamVideoSpeechMode" | "videoEngine"
>): boolean {
  return request.creationMode === "free" && request.operation !== "modify" && request.kind === "video" && request.withNarration &&
    request.teamVideoSpeechMode !== "characters";
}

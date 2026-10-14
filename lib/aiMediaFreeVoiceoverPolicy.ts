import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";

/** Seed Grok's animation from one controlled initial frame instead of its implicit text-to-image step. */
export function needsControlledAiMediaFreeFirstFrame(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "videoEngine"
>): boolean {
  return request.creationMode === "free" && request.operation !== "modify" && request.kind === "video" &&
    (request.videoEngine === "grok" || request.videoEngine === "grok-lite");
}

/** Keep Grok's visual generation independent from the separately composed narration. */
export function usesSeparateAiMediaFreeVoiceover(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "withNarration" | "teamVideoSpeechMode" | "videoEngine"
>): boolean {
  return needsControlledAiMediaFreeFirstFrame(request) && request.withNarration &&
    request.teamVideoSpeechMode !== "characters";
}

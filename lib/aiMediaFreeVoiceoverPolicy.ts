import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";

/** Seed Grok's animation from one controlled initial frame instead of its implicit text-to-image step. */
export function needsControlledAiMediaFreeFirstFrame(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "videoEngine"
>): boolean {
  return request.creationMode === "free" && request.operation !== "modify" && request.kind === "video" &&
    (request.videoEngine === "grok" || request.videoEngine === "grok-lite");
}

/** Legacy/provided narration stays with Studio TTS; Kling Exact AI narration is explicitly native. */
export function usesSeparateAiMediaFreeVoiceover(request: Pick<AiMediaGenerationRequest,
  "creationMode" | "operation" | "kind" | "withNarration" | "teamVideoSpeechMode" | "videoEngine" | "exactDialogue"
>): boolean {
  // Structured Exact explicitly requests Kling's native off-screen narrator.
  // Auto and legacy raw-script requests retain their existing TTS ownership.
  if (request.exactDialogue?.length && request.exactDialogue.every(turn => turn.speaker === "ai_voice") &&
    (request.videoEngine === "kling" || request.videoEngine === "kling-flash")) return false;
  return request.creationMode === "free" && request.operation !== "modify" && request.kind === "video" && request.withNarration &&
    request.teamVideoSpeechMode !== "characters";
}

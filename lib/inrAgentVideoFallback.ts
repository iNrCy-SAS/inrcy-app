import { getAiMediaVideoModel } from "./aiMediaModelCatalog.ts";
import { getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";
import { getAiVideoProviderRecoverableStatus, type AiVideoProviderGenerationArgs, type AiVideoProviderResult } from "./aiVideoProviderTypes.ts";
import { INR_AGENT_VIDEO_ENGINE, INR_AGENT_VIDEO_FALLBACK_ENGINE, INR_AGENT_VIDEO_RESOLUTION } from "./inrAgentVideoPolicy.ts";

/** Only a definite upstream rejection permits a second paid submission.
 * Socket loss, timeout, cancellation, policy rejection and account fuses do not.
 */
export function isRecoverableInrAgentVideoFailure(error: unknown): boolean {
  return getAiVideoProviderRecoverableStatus(error) !== 0;
}

/** Server-owned Agent fallback. This does not create a new job or credit quote.
 * Grok supports text-to-video: the complete reviewed scene can be reused without
 * buying a new first-frame image after a rejected Veo request.
 */
export async function generateInrAgentVideoWithFallback(
  args: AiVideoProviderGenerationArgs,
  generate: (input: AiVideoProviderGenerationArgs) => Promise<AiVideoProviderResult>,
): Promise<AiVideoProviderResult> {
  try {
    return await generate(args);
  } catch (primaryError) {
    args.signal?.throwIfAborted();
    const request = args.request;
    // Never route professional identities or dialogue to another provider.
    if (request.videoEngine !== INR_AGENT_VIDEO_ENGINE || request.videoResolution !== INR_AGENT_VIDEO_RESOLUTION ||
      request.identityMode !== "auto" || request.teamVideoSpeechMode === "characters" ||
      request.inspirationImages.some(image => image.role === "character") ||
      !isRecoverableInrAgentVideoFailure(primaryError)) throw primaryError;
    const fallbackModel = getAiMediaVideoModel(INR_AGENT_VIDEO_FALLBACK_ENGINE);
    if (request.inspirationImages.length > fallbackModel.maxReferenceImages) throw primaryError;
    const primaryDurations = getAiMediaVideoSegmentDurations(request.durationSeconds || 8, request.videoEngine, request.videoResolution, request.sceneMode);
    const fallbackDurations = getAiMediaVideoSegmentDurations(request.durationSeconds || 8, fallbackModel.id, request.videoResolution, request.sceneMode);
    if (JSON.stringify(primaryDurations) !== JSON.stringify(fallbackDurations)) throw primaryError;
    // Keep the original fingerprint/contract, audio ownership and single quote.
    // A second failure is returned as-is, including a billable-output marker.
    const result = await generate({ ...args, request: { ...request, videoEngine: fallbackModel.id } });
    return { ...result, warnings: [...result.warnings, "inr_agent_veo_lite_fallback_to_grok_lite"] };
  }
}

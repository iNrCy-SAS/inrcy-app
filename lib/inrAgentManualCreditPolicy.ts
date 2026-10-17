import { quoteAiMediaCredits } from "./aiMediaCreditsPricing.ts";
import { buildInrAgentMediaFormatPlan } from "./inrAgentMediaFormats.ts";
import { INR_AGENT_VIDEO_ENGINE, INR_AGENT_VIDEO_RESOLUTION } from "./inrAgentVideoPolicy.ts";

export type InrAgentManualCreditAvailability = {
  ready: boolean;
  allowed: boolean;
  unlimited: boolean;
  remaining: number | null;
  required: number;
};

/** A full manual publication must fit before its first billable call.
 * Video reserves room for the optional narration chosen by the creative mix.
 * Only actual successful generations are charged, at their normal exact quote.
 */
export function inrAgentManualPublishCreditBudget(args: {
  kind: "image" | "video";
  imageCount: number;
  channels: readonly string[];
}) {
  const channels = args.channels.filter(channel => args.kind === "video" || channel !== "youtube_shorts");
  const plan = buildInrAgentMediaFormatPlan({kind: args.kind, channels});
  return plan.formats.reduce((sum, format) => sum + quoteAiMediaCredits({
    kind: args.kind, format, operation: "generate", creationMode: "free", imageEngine: "openai",
    videoEngine: INR_AGENT_VIDEO_ENGINE, videoResolution: INR_AGENT_VIDEO_RESOLUTION, durationSeconds: 8,
    withNarration: true, teamVideoSpeechMode: "voiceover", inputMode: "essential",
  }).totalCredits * (args.kind === "image" ? Math.max(1, Math.min(3, args.imageCount)) : 1), 0);
}

export function inrAgentManualCreditAvailability(args: {
  ready: boolean;
  unlimited: boolean;
  remaining: number;
  required: number;
}): InrAgentManualCreditAvailability {
  return {
    ...args,
    remaining: args.unlimited ? null : args.remaining,
    allowed: args.ready && (args.unlimited || args.remaining >= Math.max(1, args.required)),
  };
}

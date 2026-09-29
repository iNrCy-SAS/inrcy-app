import type { AdsCampaignInput } from "@/lib/adsValidation";

/**
 * Returns the last editable studio step for a stored campaign.
 *
 * Assisted campaigns add the analysis step, while Google Search omits the
 * media step. Keeping this calculation outside the component prevents a
 * reopened draft from using the channel that happened to be selected before
 * the asynchronous campaign load completed.
 */
export function adsDraftValidationStep(
  draft: Pick<AdsCampaignInput, "provider" | "campaignType" | "creationMode">,
): number {
  const assistedAnalysisStep = draft.creationMode === "inrcy" ? 1 : 0;
  const mediaStep = draft.provider === "google" && draft.campaignType === "search" ? 0 : 1;
  return 7 + assistedAnalysisStep + mediaStep;
}

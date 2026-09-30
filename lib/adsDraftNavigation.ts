import type { AdsCampaignInput } from "@/lib/adsValidation";

type AdsDraftMediaShape = Pick<AdsCampaignInput, "provider" | "campaignType">
  & Partial<Pick<AdsCampaignInput, "channelSettings">>;

/**
 * Whether the selected platform format needs a dedicated media workspace.
 *
 * Google Search and an explicitly text-only X post are the only formats in
 * this studio that do not carry a visual asset. LinkedIn text ads still use an
 * image/logo, while catalog campaigns keep a media-source step for their feed.
 */
export function adsDraftHasMediaStep(draft: AdsDraftMediaShape): boolean {
  if (draft.provider === "google" && draft.campaignType === "search") return false;
  return !(draft.provider === "x"
    && draft.channelSettings?.channel === "x"
    && draft.channelSettings.format === "text");
}

/** Automatic Pinterest targeting has no manual discovery fields to complete. */
export function adsDraftHasKeywordsStep(draft: Pick<AdsCampaignInput, "provider"> & Partial<Pick<AdsCampaignInput, "channelSettings">>): boolean {
  if (draft.provider === "openai") return false;
  if (draft.provider !== "pinterest") return true;
  return draft.channelSettings?.channel === "pinterest" && draft.channelSettings.targetingMode !== "automatic";
}

/**
 * Returns the last editable studio step for a stored campaign.
 *
 * Assisted campaigns add the analysis step, while Google Search omits the
 * media step. Pinterest has a dedicated format step followed by a pure-media
 * step. Keeping this calculation outside the component prevents a reopened
 * draft from using the channel that happened to be selected before the
 * asynchronous campaign load completed.
 */
export function adsDraftValidationStep(
  draft: Pick<AdsCampaignInput, "provider" | "campaignType" | "creationMode">
    & Partial<Pick<AdsCampaignInput, "channelSettings">>,
): number {
  const assistedAnalysisStep = draft.creationMode === "inrcy" ? 1 : 0;
  const mediaStep = adsDraftHasMediaStep(draft) ? 1 : 0;
  const pinterestPureMediaStep = draft.provider === "pinterest" ? 1 : 0;
  const skippedDiscoveryStep = adsDraftHasKeywordsStep(draft) ? 0 : 1;
  return 7 + assistedAnalysisStep + mediaStep + pinterestPureMediaStep - skippedDiscoveryStep;
}

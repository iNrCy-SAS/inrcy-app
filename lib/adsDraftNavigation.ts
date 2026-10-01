import type { AdsCampaignInput } from "@/lib/adsValidation";

type AdsDraftNavigationShape = Pick<AdsCampaignInput, "provider" | "campaignType">
  & Partial<Pick<AdsCampaignInput, "channelSettings" | "creationMode">>;

export type AdsDraftStepKey =
  | "project"
  | "analysis"
  | "foundations"
  | "targeting"
  | "keywords"
  | "creative"
  | "pinterest_format"
  | "media"
  | "delivery"
  | "budget"
  | "validation";

/**
 * Whether the selected platform format needs a dedicated media workspace.
 *
 * Google Search and an explicitly text-only X post are the only formats in
 * this studio that do not carry a visual asset. LinkedIn text ads still use an
 * image/logo, while catalog campaigns keep a media-source step for their feed.
 */
export function adsDraftHasMediaStep(draft: AdsDraftNavigationShape): boolean {
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
 * Stable semantic identities for the current wizard structure.
 *
 * The visible indices can move when a format inserts Media or a Pinterest
 * targeting mode inserts Discovery. Tracking these keys keeps only genuinely
 * visited steps unlocked across that structural edit.
 */
export function adsDraftStepKeys(draft: AdsDraftNavigationShape): AdsDraftStepKey[] {
  const analysis: AdsDraftStepKey[] = draft.creationMode === "inrcy" ? ["analysis"] : [];
  const keywords: AdsDraftStepKey[] = adsDraftHasKeywordsStep(draft) ? ["keywords"] : [];
  const media: AdsDraftStepKey[] = adsDraftHasMediaStep(draft) ? ["media"] : [];

  if (draft.provider === "pinterest") {
    return [
      "project",
      ...analysis,
      "foundations",
      "targeting",
      ...keywords,
      "creative",
      "pinterest_format",
      ...media,
      "delivery",
      "budget",
      "validation",
    ];
  }

  return [
    "project",
    ...analysis,
    "foundations",
    "targeting",
    ...keywords,
    "creative",
    ...media,
    "delivery",
    "budget",
    "validation",
  ];
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
  return adsDraftStepKeys(draft).length - 1;
}

import type { AdsCampaignInput } from "./adsValidation.ts";
import type { TikTokAdsIdentity } from "./adsTikTokResources.ts";
import type { TikTokAdsNativeSelections } from "./adsTikTokNativeSelections.ts";
import { TikTokTrafficPublisherError, type TikTokTrafficVideoInput } from "./adsTikTokPublisherCore.ts";

export type TikTokTrafficCampaignDraft = AdsCampaignInput & { tiktokNativeSelections?: TikTokAdsNativeSelections };
export type TikTokTrafficServerSelections = {
  identity: TikTokAdsIdentity; locationIds: string[]; callToAction: string;
  thumbnailMediaId: string; isAiGenerated: boolean;
};
/** Exact supported wizard choices only. Selections must be re-read from native resources before use. */
export function tikTokTrafficInputFromAdsDraft(draft: AdsCampaignInput, selections: TikTokTrafficServerSelections): TikTokTrafficVideoInput {
  const settings = draft.channelSettings, budget = draft.preparedDeliverySettings?.budget;
  if (draft.provider !== "tiktok" || draft.accountCurrency !== "EUR" || settings?.channel !== "tiktok"
    || settings.objectiveType !== "TRAFFIC" || settings.destinationKind !== "website" || settings.optimizationIntent !== "clicks"
    || settings.placementIntent !== "tiktok_only" || settings.targetingMode !== "broad" || settings.format !== "video"
    || draft.mediaStrategy !== "video" || draft.creativeType !== "video") throw new TikTokTrafficPublisherError("draft_not_supported");
  // The studio's language describes the creative brief; this adapter sends no language targeting.
  if (draft.keywords.length || draft.negativeKeywords.length) throw new TikTokTrafficPublisherError("additional_targeting_unsupported");
  if (!budget || budget.type !== "total" || !budget.totalEuros || !budget.startAt || !budget.endAt
    || draft.preparedDeliverySettings?.bidding.strategy !== "automatic") throw new TikTokTrafficPublisherError("delivery_not_supported");
  const brief = draft.channelDraft?.channel === "tiktok" ? draft.channelDraft : null;
  if (brief?.externalRefs?.advertiserId && brief.externalRefs.advertiserId !== draft.adAccountId) throw new TikTokTrafficPublisherError("advertiser_mismatch");
  const source = String(draft.creativeUrl || "");
  let videoMediaId: string;
  try {
    const media = new URL(source, "https://inrcy-media.local");
    videoMediaId = media.pathname.match(/^\/api\/media-library\/items\/([0-9a-f-]{36})\/content$/i)?.[1] || "";
    if (!source.startsWith("/") || source.startsWith("//") || media.origin !== "https://inrcy-media.local" || !videoMediaId) throw new Error();
  } catch { throw new TikTokTrafficPublisherError("owned_media_required"); }
  let destination: URL;
  try {
    destination = new URL(draft.destinationUrl);
    if (destination.protocol !== "https:" || destination.username || destination.password || destination.hash) throw new Error();
    const tracking = draft.trackingParameters.trim().replace(/^[?&]+/, "");
    if (tracking.length > 2000) throw new Error();
    new URLSearchParams(tracking).forEach((value, key) => destination.searchParams.set(key, value));
  } catch { throw new TikTokTrafficPublisherError("destination_invalid"); }
  return { advertiserId: draft.adAccountId, name: draft.name, adGroupName: draft.name, adName: draft.name,
    destinationUrl: destination.toString(), adText: draft.primaryText, callToAction: selections.callToAction,
    totalBudgetEuros: budget.totalEuros, startAt: budget.startAt, endAt: budget.endAt,
    identity: structuredClone(selections.identity), locationIds: [...selections.locationIds],
    videoMediaId, thumbnailMediaId: selections.thumbnailMediaId, isAiGenerated: selections.isAiGenerated };
}

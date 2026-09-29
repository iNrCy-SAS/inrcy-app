import "server-only";

import { resolveGoogleTargetLocations } from "@/lib/adsGooglePublish";
import { googleAdsJson } from "@/lib/adsServer";
import {
  createGoogleAdsRemoteCampaignCoreAdapter,
  GoogleAdsRemoteCampaignError,
  normalizeGoogleAdsRemoteCampaignUpdate,
  parseGoogleAdsProviderResources,
  type GoogleAdsRemoteCampaignAdapter,
  type GoogleAdsRemoteCampaignMutationResult,
  type GoogleAdsRemoteCampaignSnapshot,
  type GoogleAdsRemoteCampaignStatus,
  type GoogleAdsRemoteCampaignUpdate,
  type GoogleAdsProviderResources,
} from "@/lib/adsGoogleRemoteCampaignCore";

export {
  GoogleAdsRemoteCampaignError,
  normalizeGoogleAdsRemoteCampaignUpdate,
  parseGoogleAdsProviderResources,
};

export type {
  GoogleAdsProviderResources,
  GoogleAdsRemoteCampaignAdapter,
  GoogleAdsRemoteCampaignMutationResult,
  GoogleAdsRemoteCampaignSnapshot,
  GoogleAdsRemoteCampaignStatus,
  GoogleAdsRemoteCampaignUpdate,
};

export type CreateGoogleAdsRemoteCampaignAdapterInput = {
  userId: string;
  adAccountId: string;
  providerResources: unknown;
  /** Required only when the selected advertiser is reached through a manager account. */
  loginCustomerId?: string;
};

/**
 * Server-only entry point for managing a campaign that was already published.
 * The factory itself performs no network request; each method reads the current
 * provider state before deciding whether a mutation is necessary.
 */
export function createGoogleAdsRemoteCampaignAdapter(
  input: CreateGoogleAdsRemoteCampaignAdapterInput,
): GoogleAdsRemoteCampaignAdapter {
  if (!input.userId.trim()) {
    throw new GoogleAdsRemoteCampaignError("INVALID_PROVIDER_RESOURCES", "L’utilisateur Google Ads est invalide.");
  }
  if (!/^\d{5,25}$/.test(input.adAccountId)) {
    throw new GoogleAdsRemoteCampaignError("INVALID_PROVIDER_RESOURCES", "Le compte Google Ads sélectionné est invalide.");
  }
  if (input.loginCustomerId && !/^\d{5,25}$/.test(input.loginCustomerId)) {
    throw new GoogleAdsRemoteCampaignError("INVALID_PROVIDER_RESOURCES", "Le compte administrateur Google Ads est invalide.");
  }

  return createGoogleAdsRemoteCampaignCoreAdapter({
    expectedCustomerId: input.adAccountId,
    providerResources: input.providerResources,
    request: (path, body) => googleAdsJson(input.userId, path, body, input.loginCustomerId),
    resolveTargetLocations: (locations) => resolveGoogleTargetLocations(
      input.userId,
      input.adAccountId,
      locations,
      input.loginCustomerId,
    ),
  });
}

import "server-only";

import { linkedInAdsHasAccessMode, linkedInAdsScopes, LINKEDIN_ADS_API_VERSION } from "./adsLinkedInPolicy.ts";
import {
  archiveLinkedInAdsCampaignCore,
  deleteLinkedInAdsCampaignCore,
  LinkedInAdsLifecycleError,
  readLinkedInAdsCampaignAnalyticsCore,
  readLinkedInAdsCampaignStateCore,
  setLinkedInAdsCampaignPausedCore,
  updateLinkedInAdsCampaignCore,
  type LinkedInAdsLifecycleContext,
  type LinkedInAdsLifecycleResult,
  type LinkedInAdsRemoteRequest,
} from "./adsLinkedInLifecycleCore.ts";
import {
  LinkedInAdsConnectionError,
  linkedInAdsAuthorization,
  listLinkedInAdsAccounts,
  readLinkedInAdsIntegration,
} from "./adsLinkedInServer.ts";

export { LinkedInAdsLifecycleError };

const LINKEDIN_REST_ORIGIN = "https://api.linkedin.com";

function allowedDevelopmentAccountIds(): Set<string> {
  return new Set(String(process.env.LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS || "")
    .split(/[\s,]+/).map((value) => value.trim()).filter((value) => /^\d{1,25}$/.test(value)));
}

function providerMessage(payload: unknown, status: number): string {
  const row = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const direct = [row.message, row.error_description, row.error]
    .find((value) => typeof value === "string" && value.trim());
  return typeof direct === "string" ? direct.trim() : `LinkedIn Ads a refusé l’action (${status}).`;
}

function requestFor(token: string, fetchImpl: typeof fetch = fetch): LinkedInAdsRemoteRequest {
  return async ({ method, path, headers, body }) => {
    let response: Response;
    try {
      response = await fetchImpl(`${LINKEDIN_REST_ORIGIN}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
          "X-Restli-Protocol-Version": "2.0.0",
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(method === "GET" ? 15_000 : 30_000),
      });
    } catch {
      throw new LinkedInAdsLifecycleError(
        "LinkedIn Ads n’a pas confirmé l’action. Contrôlez Campaign Manager avant de réessayer.",
        method !== "GET",
      );
    }
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new LinkedInAdsLifecycleError(
        providerMessage(payload, response.status),
        method !== "GET" && response.status >= 500,
        response.status,
      );
    }
    return payload;
  };
}

async function liveContext(userId: string, accountId: string, reporting = false): Promise<{
  context: LinkedInAdsLifecycleContext;
  request: LinkedInAdsRemoteRequest;
}> {
  const integration = await readLinkedInAdsIntegration(userId);
  if (!integration || integration.status !== "connected" || integration.resource_id !== accountId) {
    throw new LinkedInAdsConnectionError("Reconnectez le compte LinkedIn Ads associé.", "connection_changed", 409);
  }
  const { token, scopes } = await linkedInAdsAuthorization(userId, integration);
  if (!linkedInAdsHasAccessMode(scopes, "manage")
    || (reporting && !linkedInAdsScopes(scopes).includes("r_ads_reporting"))) {
    throw new LinkedInAdsConnectionError("Reconnectez LinkedIn Ads avec les autorisations de gestion et statistiques.", "missing_scopes", 403);
  }
  const account = (await listLinkedInAdsAccounts(userId, integration)).find((entry) => entry.id === accountId);
  if (!account || !allowedDevelopmentAccountIds().has(accountId)) {
    throw new LinkedInAdsConnectionError("Ce compte n’est pas mappé à l’application LinkedIn Advertising API.", "development_account_mapping_required", 403);
  }
  if (account.currency !== "EUR" || !account.canManageCampaigns) {
    throw new LinkedInAdsConnectionError("Ce compte LinkedIn Ads n’est plus gérable en EUR avec cette connexion.", "account_access_denied", 403);
  }
  return {
    context: {
      accountId,
      accountCurrency: account.currency,
      scopes,
      hasAccountAccess: true,
      canManageCampaigns: account.canManageCampaigns,
      canServeCampaigns: account.canServeCampaigns,
    },
    request: requestFor(token),
  };
}

export async function readLinkedInAdsCampaignState(
  userId: string,
  input: { adAccountId: string; resources: unknown },
): Promise<LinkedInAdsLifecycleResult> {
  const live = await liveContext(userId, input.adAccountId);
  return readLinkedInAdsCampaignStateCore({ ...live, resources: input.resources });
}

export async function updateLinkedInAdsCampaign(
  userId: string,
  input: {
    adAccountId: string;
    resources: unknown;
    changes: { name?: string; dailyBudgetCents?: number; endDate?: string };
  },
): Promise<LinkedInAdsLifecycleResult> {
  const live = await liveContext(userId, input.adAccountId);
  return updateLinkedInAdsCampaignCore({ ...live, resources: input.resources, changes: input.changes });
}

export async function setLinkedInAdsCampaignPaused(
  userId: string,
  input: { adAccountId: string; resources: unknown; paused: boolean },
): Promise<LinkedInAdsLifecycleResult> {
  const live = await liveContext(userId, input.adAccountId);
  return setLinkedInAdsCampaignPausedCore({ ...live, resources: input.resources, paused: input.paused });
}

export async function deleteLinkedInAdsCampaign(
  userId: string,
  input: { adAccountId: string; resources: unknown },
): Promise<LinkedInAdsLifecycleResult> {
  const live = await liveContext(userId, input.adAccountId);
  return deleteLinkedInAdsCampaignCore({ ...live, resources: input.resources });
}

export async function archiveLinkedInAdsCampaign(
  userId: string,
  input: { adAccountId: string; resources: unknown },
): Promise<LinkedInAdsLifecycleResult> {
  const live = await liveContext(userId, input.adAccountId);
  return archiveLinkedInAdsCampaignCore({ ...live, resources: input.resources });
}

export async function readLinkedInAdsCampaignAnalytics(
  userId: string,
  input: { adAccountId: string; resources: unknown; startDate: string; endDate: string },
): Promise<{ payload: unknown; campaignUrn: string }> {
  const live = await liveContext(userId, input.adAccountId, true);
  return readLinkedInAdsCampaignAnalyticsCore({ ...live, ...input });
}

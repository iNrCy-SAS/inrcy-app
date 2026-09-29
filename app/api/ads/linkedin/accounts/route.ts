import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { isLinkedInAdsAccountId } from "@/lib/adsLinkedInPolicy";
import { LinkedInAdsConnectionError, listLinkedInAdsAccounts, readLinkedInAdsIntegration, selectLinkedInAdsAccount } from "@/lib/adsLinkedInServer";
import { enforceRateLimit } from "@/lib/rateLimit";

function failure(error: unknown) {
  const known = error instanceof LinkedInAdsConnectionError ? error : null;
  return NextResponse.json(
    { error: known?.message || "Compte LinkedIn Ads indisponible.", code: known?.code || "account_lookup_failed" },
    { status: known?.status || 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function accountsRateLimit(userId: string) {
  return enforceRateLimit({
    name: "ads_linkedin_accounts",
    identifier: userId,
    limit: 20,
    fallbackLimit: 8,
    window: "5 m",
    code: "linkedin_ads_accounts_rate_limit",
  });
}

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const limited = await accountsRateLimit(user.activeUserId);
  if (limited) return limited;
  try {
    const integration = await readLinkedInAdsIntegration(user.activeUserId);
    const accounts = await listLinkedInAdsAccounts(user.activeUserId, integration);
    const selected = accounts.find((account) => account.id === integration?.resource_id);
    return NextResponse.json({
      accounts,
      selectedAccountId: selected?.id || null,
      selectedAccountName: selected?.name || null,
      selectedAccountCanManage: selected?.canManageCampaigns === true,
      selectedAccountCanServe: selected?.canServeCampaigns === true,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const limited = await accountsRateLimit(user.activeUserId);
  if (limited) return limited;
  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  if (!isLinkedInAdsAccountId(body?.accountId)) {
    return NextResponse.json({ error: "Identifiant de compte LinkedIn Ads invalide.", code: "invalid_account_id" }, { status: 400 });
  }
  try {
    const account = await selectLinkedInAdsAccount(user.activeUserId, body.accountId);
    return NextResponse.json({
      account,
      selectedAccountId: account.id,
      selectedAccountCanManage: account.canManageCampaigns,
      selectedAccountCanServe: account.canServeCampaigns,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

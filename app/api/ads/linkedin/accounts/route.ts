import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { isLinkedInAdsAccountId } from "@/lib/adsLinkedInPolicy";
import { LinkedInAdsConnectionError, listLinkedInAdsAccounts, readLinkedInAdsIntegration, selectLinkedInAdsAccount } from "@/lib/adsLinkedInServer";

function failure(error: unknown) {
  const known = error instanceof LinkedInAdsConnectionError ? error : null;
  return NextResponse.json({ error: known?.message || "Compte LinkedIn Ads indisponible.", code: known?.code || "account_lookup_failed" }, { status: known?.status || 503 });
}

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  try {
    const integration = await readLinkedInAdsIntegration(user.activeUserId);
    const accounts = await listLinkedInAdsAccounts(user.activeUserId, integration);
    return NextResponse.json({
      accounts,
      selectedAccountId: integration?.resource_id && accounts.some((account) => account.id === integration.resource_id)
        ? integration.resource_id : null,
      publicationEnabled: false,
    });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  if (!isLinkedInAdsAccountId(body?.accountId)) {
    return NextResponse.json({ error: "Identifiant de compte LinkedIn Ads invalide.", code: "invalid_account_id" }, { status: 400 });
  }
  try {
    const account = await selectLinkedInAdsAccount(user.activeUserId, body.accountId);
    return NextResponse.json({ account, selectedAccountId: account.id, publicationEnabled: false });
  } catch (error) { return failure(error); }
}

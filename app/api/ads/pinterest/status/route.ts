import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { missingPinterestAdsScopes, pinterestAdsReadiness } from "@/lib/adsPinterestPolicy";
import {
  getPinterestAdsCredentials,
  listPinterestAdsAccounts,
  PinterestAdsConnectionError,
  readPinterestAdsIntegration,
} from "@/lib/adsPinterestServer";

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const configured = getPinterestAdsCredentials().configured;
  if (!configured) {
    return NextResponse.json({
      configured: false,
      connected: false,
      status: "configuration_missing",
      readiness: "configuration_missing",
      accounts: [],
      selectedAccountId: null,
      missingScopes: [],
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  let integration = null as Awaited<ReturnType<typeof readPinterestAdsIntegration>>;
  try {
    integration = await readPinterestAdsIntegration(user.activeUserId);
    const connected = integration?.status === "connected";
    const missingScopes = connected ? missingPinterestAdsScopes(integration?.scopes) : [];
    let accounts = connected && !missingScopes.length
      ? await listPinterestAdsAccounts(user.activeUserId, integration)
      : [];
    // Keep the status consistent if account discovery triggered a token invalidation.
    const current = connected ? await readPinterestAdsIntegration(user.activeUserId) : integration;
    const currentConnected = current?.status === "connected";
    if (!currentConnected) accounts = [];
    const selected = accounts.find((account) => account.id === current?.resource_id);
    return NextResponse.json({
      configured: true,
      connected: currentConnected,
      status: current?.status || "disconnected",
      readiness: pinterestAdsReadiness({
        connected: currentConnected,
        needsReconnect: Boolean(current && current.status === "needs_update"),
        scopes: current?.scopes,
        accounts,
        selectedAccountId: selected?.id || null,
      }),
      scopes: currentConnected ? current?.scopes || "" : "",
      missingScopes: currentConnected ? missingPinterestAdsScopes(current?.scopes) : [],
      accounts,
      selectedAccountId: current?.resource_id || null,
      selectedAccountName: current?.resource_label || selected?.name || null,
      businessAndBillingVerified: false,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error instanceof PinterestAdsConnectionError ? error : null;
    const persisted = await readPinterestAdsIntegration(user.activeUserId).catch(() => integration);
    const connected = persisted?.status === "connected";
    return NextResponse.json({
      configured: true,
      connected,
      status: persisted?.status || "disconnected",
      readiness: failure?.code || "provider_unavailable",
      accounts: [],
      selectedAccountId: persisted?.resource_id || null,
      selectedAccountName: persisted?.resource_label || null,
      publicationEnabled: false,
      error: failure?.message || "Statut Pinterest Ads indisponible.",
    }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
  }
}

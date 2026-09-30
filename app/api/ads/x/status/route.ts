import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { xAdsReadiness } from "@/lib/adsXPolicy";
import {
  getXAdsCredentials, listXAdsAccounts, readXAdsIntegration,
  verifySelectedXAdsAccount, XAdsConnectionError,
} from "@/lib/adsXServer";

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("x");
  if (errorResponse || !user) return errorResponse;
  if (!getXAdsCredentials().configured) {
    return NextResponse.json({
      configured: false, connected: false, status: "configuration_missing",
      readiness: "configuration_missing", accounts: [], selectedAccountId: null,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  }
  let integration = null as Awaited<ReturnType<typeof readXAdsIntegration>>;
  try {
    integration = await readXAdsIntegration(user.activeUserId);
    const connected = integration?.status === "connected";
    const accounts = connected && integration ? await listXAdsAccounts(user.activeUserId, integration) : [];
    const selectedIndex = accounts.findIndex((account) => account.id === integration?.resource_id);
    if (selectedIndex >= 0 && integration) {
      accounts[selectedIndex] = await verifySelectedXAdsAccount(user.activeUserId, integration, accounts[selectedIndex]);
    }
    const current = connected ? await readXAdsIntegration(user.activeUserId) : integration;
    const currentConnected = current?.status === "connected";
    const visibleAccounts = currentConnected ? accounts : [];
    const selected = visibleAccounts.find((account) => account.id === current?.resource_id);
    return NextResponse.json({
      configured: true, connected: currentConnected,
      status: current?.status || "disconnected",
      readiness: xAdsReadiness({
        connected: currentConnected, needsReconnect: current?.status === "needs_update",
        accounts: visibleAccounts, selectedAccountId: selected?.id || null,
      }),
      accounts: visibleAccounts,
      selectedAccountId: current?.resource_id || null,
      selectedAccountName: current?.resource_label || selected?.name || null,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error instanceof XAdsConnectionError ? error : null;
    const persisted = await readXAdsIntegration(user.activeUserId).catch(() => integration);
    return NextResponse.json({
      configured: true, connected: persisted?.status === "connected",
      status: persisted?.status || "disconnected", readiness: failure?.code || "provider_unavailable",
      accounts: [], selectedAccountId: persisted?.resource_id || null, selectedAccountName: persisted?.resource_label || null,
      publicationEnabled: false, error: failure?.message || "Statut X Ads indisponible.",
    }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
  }
}

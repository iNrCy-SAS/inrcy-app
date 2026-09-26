import { NextResponse } from "next/server";
import { adsOAuthProvider } from "@/lib/adsOAuth";
import {
  adsConnectionStatus,
  listAdsAccounts,
  listMetaPages,
  readAdsIntegration,
  requirePremiumAdsUser,
  type AdsIntegration,
} from "@/lib/adsServer";
import { asRecord } from "@/lib/tsSafe";

function selectedPageId(integration: AdsIntegration | null): string {
  const pageId = asRecord(integration?.meta).selected_page_id;
  return typeof pageId === "string" ? pageId : "";
}

function wasAccountExplicitlyCleared(integration: AdsIntegration): boolean {
  return asRecord(integration.meta).account_selection_cleared === true;
}

function connectionAccount(integration: AdsIntegration | null) {
  if (!integration) return undefined;
  return {
    displayName: integration.display_name || "",
    email: integration.email_address || "",
    id: integration.provider_account_id || "",
  };
}

function resolveSelectedAccount(
  integration: AdsIntegration,
  accounts: Awaited<ReturnType<typeof listAdsAccounts>>,
) {
  return accounts.find((account) => account.id === integration.resource_id && account.currency === "EUR") || null;
}

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const provider = adsOAuthProvider(new URL(request.url).searchParams.get("provider"));
  if (!provider) return NextResponse.json({ error: "Canal inconnu." }, { status: 400 });

  let connection: AdsIntegration | null = null;
  try {
    connection = await readAdsIntegration(user.activeUserId, provider);
    const connectionStatus = adsConnectionStatus(connection);
    if (!connection || connectionStatus !== "connected") {
      return NextResponse.json({
        connected: false,
        hasConnection: Boolean(connection),
        connectionStatus,
        accounts: [],
        pages: [],
        connectionAccount: connectionAccount(connection),
        accountSelectionCleared: false,
        selectedAccountId: "",
        selectedPageId: "",
      });
    }

    const [accounts, pages] = await Promise.all([
      listAdsAccounts(user.activeUserId, provider),
      provider === "meta" ? listMetaPages(user.activeUserId) : Promise.resolve([]),
    ]);
    const eligibleAccounts = accounts.filter((account) => account.currency === "EUR");
    const selectedAccount = resolveSelectedAccount(connection, accounts);
    // A single eligible account is convenient to preselect, but it is never
    // persisted automatically: the professional explicitly confirms it with
    // the “Associer ce compte” action in iNr’ADS.
    const suggestedAccountId = !connection.resource_id
      && !wasAccountExplicitlyCleared(connection)
      && eligibleAccounts.length === 1
      ? eligibleAccounts[0]?.id || ""
      : "";
    const storedPageId = selectedPageId(connection);
    const selectedIdentity = pages.some((page) => page.id === storedPageId) ? storedPageId : "";

    return NextResponse.json({
      connected: true,
      hasConnection: true,
      connectionStatus: "connected",
      accounts,
      pages,
      connectionAccount: connectionAccount(connection),
      accountSelectionCleared: wasAccountExplicitlyCleared(connection),
      // A selection belongs to the professional until they explicitly
      // dissociate it. Never silently replace or clear it while refreshing
      // the provider's available-account list.
      selectedAccountId: connection.resource_id || "",
      selectedAccountAvailable: Boolean(selectedAccount),
      suggestedAccountId,
      selectedPageId: selectedIdentity,
    });
  } catch (error) {
    const refreshedConnection = await readAdsIntegration(user.activeUserId, provider).catch(() => connection);
    const connectionStatus = adsConnectionStatus(refreshedConnection);
    return NextResponse.json({
      connected: connectionStatus === "connected",
      hasConnection: Boolean(refreshedConnection),
      connectionStatus,
      accounts: [],
      pages: [],
      connectionAccount: connectionAccount(refreshedConnection),
      accountSelectionCleared: false,
      selectedAccountId: "",
      selectedPageId: "",
      error: error instanceof Error ? error.message : "Impossible de charger les comptes publicitaires.",
    });
  }
}

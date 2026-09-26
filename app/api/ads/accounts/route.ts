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
import { supabaseAdmin } from "@/lib/supabaseAdmin";
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

async function resolveSelectedAccount(
  userId: string,
  integration: AdsIntegration,
  accounts: Awaited<ReturnType<typeof listAdsAccounts>>,
) {
  const selected = accounts.find((account) => account.id === integration.resource_id && account.currency === "EUR");
  if (selected) return selected;

  // A deliberate "Dissocier ce compte" must survive a refresh. Without this
  // marker, a single eligible advertiser would be silently reselected.
  if (!integration.resource_id && wasAccountExplicitlyCleared(integration)) return null;

  const eligibleAccounts = accounts.filter((account) => account.currency === "EUR");
  const defaultAccount = eligibleAccounts.length === 1 ? eligibleAccounts[0] : null;
  const { error } = await supabaseAdmin
    .from("integrations")
    .update({
      resource_id: defaultAccount?.id || null,
      resource_label: defaultAccount?.name || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", integration.id)
    .eq("user_id", userId);
  if (error) throw new Error("Impossible de mémoriser le compte annonceur sélectionné.");
  return defaultAccount;
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
    const selectedAccount = await resolveSelectedAccount(user.activeUserId, connection, accounts);
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
      selectedAccountId: selectedAccount?.id || "",
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

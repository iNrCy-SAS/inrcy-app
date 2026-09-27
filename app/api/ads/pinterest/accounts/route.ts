import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import {
  listPinterestAdsAccounts,
  PinterestAdsConnectionError,
  readPinterestAdsIntegration,
} from "@/lib/adsPinterestServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function failureResponse(error: unknown) {
  const failure = error instanceof PinterestAdsConnectionError ? error : null;
  return NextResponse.json({
    error: failure?.message || "Comptes Pinterest Ads indisponibles.",
    code: failure?.code || "provider_unavailable",
  }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  try {
    const integration = await readPinterestAdsIntegration(user.activeUserId);
    const accounts = await listPinterestAdsAccounts(user.activeUserId, integration);
    const selected = accounts.find((account) => account.id === integration?.resource_id);
    return NextResponse.json({
      accounts,
      selectedAccountId: selected?.id || null,
      selectedAccountName: selected?.name || null,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  if (!/^\d+$/.test(accountId)) {
    return NextResponse.json({ error: "Compte Pinterest Ads invalide.", code: "invalid_account" }, { status: 400 });
  }
  try {
    const integration = await readPinterestAdsIntegration(user.activeUserId);
    if (!integration || integration.status !== "connected") {
      return NextResponse.json({ error: "Connectez Pinterest Ads avant de choisir un compte.", code: "not_connected" }, { status: 409 });
    }
    const accounts = await listPinterestAdsAccounts(user.activeUserId, integration);
    const selected = accounts.find((account) => account.id === accountId);
    if (!selected) {
      return NextResponse.json({ error: "Ce compte n’est pas accessible via Pinterest Ads.", code: "account_not_accessible" }, { status: 403 });
    }
    if (selected.canManageCampaigns === false) {
      return NextResponse.json({ error: "Ce compte Pinterest Ads ne permet pas de gérer des campagnes.", code: "insufficient_account_permissions" }, { status: 403 });
    }
    const { data, error } = await supabaseAdmin.from("integrations")
      .update({ resource_id: selected.id, resource_label: selected.name, updated_at: new Date().toISOString() })
      .eq("id", integration.id)
      .eq("user_id", user.activeUserId).eq("status", "connected")
      .select("id").maybeSingle();
    if (error) throw new PinterestAdsConnectionError("Le choix du compte n’a pas été enregistré.", "storage_unavailable");
    if (!data) throw new PinterestAdsConnectionError("La connexion Pinterest Ads a changé ; rechargez vos comptes.", "connection_changed", 409);
    return NextResponse.json({
      selectedAccountId: selected.id,
      account: selected,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error);
  }
}

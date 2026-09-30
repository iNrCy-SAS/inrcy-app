import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  listXAdsAccounts, readXAdsIntegration, verifySelectedXAdsAccount, XAdsConnectionError,
} from "@/lib/adsXServer";

function failureResponse(error: unknown) {
  const failure = error instanceof XAdsConnectionError ? error : null;
  return NextResponse.json({
    error: failure?.message || "Comptes X Ads indisponibles.",
    code: failure?.code || "provider_unavailable",
  }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("x");
  if (errorResponse || !user) return errorResponse;
  try {
    const integration = await readXAdsIntegration(user.activeUserId);
    const accounts = await listXAdsAccounts(user.activeUserId, integration);
    const selectedIndex = accounts.findIndex((account) => account.id === integration?.resource_id);
    if (selectedIndex >= 0 && integration) {
      accounts[selectedIndex] = await verifySelectedXAdsAccount(user.activeUserId, integration, accounts[selectedIndex]);
    }
    const selected = accounts.find((account) => account.id === integration?.resource_id);
    return NextResponse.json({ accounts, selectedAccountId: selected?.id || null, selectedAccountName: selected?.name || null, publicationEnabled: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser("x");
  if (errorResponse || !user) return errorResponse;
  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  if (!/^[a-z0-9]+$/i.test(accountId)) {
    return NextResponse.json({ error: "Compte X Ads invalide.", code: "invalid_account" }, { status: 400 });
  }
  try {
    const integration = await readXAdsIntegration(user.activeUserId);
    if (!integration || integration.status !== "connected") {
      return NextResponse.json({ error: "Connectez X Ads avant de choisir un compte.", code: "not_connected" }, { status: 409 });
    }
    const accounts = await listXAdsAccounts(user.activeUserId, integration);
    const account = accounts.find((item) => item.id === accountId);
    if (!account) {
      return NextResponse.json({ error: "Ce compte n’est pas accessible via X Ads.", code: "account_not_accessible" }, { status: 403 });
    }
    const verified = await verifySelectedXAdsAccount(user.activeUserId, integration, account);
    if (!verified.eligibleToAssociate) {
      return NextResponse.json({
        error: "Le compte X Ads doit être accepté, en euros, avec un accès Administrateur ou Ad Manager vérifié.",
        code: "account_not_eligible", account: verified,
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const { data, error } = await supabaseAdmin.from("integrations")
      .update({ resource_id: verified.id, resource_label: verified.name, updated_at: new Date().toISOString() })
      .eq("id", integration.id).eq("user_id", user.activeUserId).eq("status", "connected")
      .select("id").maybeSingle();
    if (error) throw new XAdsConnectionError("L’association X Ads n’a pas été mémorisée.", "storage_unavailable");
    if (!data) throw new XAdsConnectionError("La connexion X Ads a changé ; rechargez vos comptes.", "connection_changed", 409);
    return NextResponse.json({ selectedAccountId: verified.id, account: verified, publicationEnabled: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failureResponse(error);
  }
}

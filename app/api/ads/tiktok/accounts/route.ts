import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import {
  listTikTokAdsAccounts,
  readTikTokAdsIntegration,
  TikTokAdsConnectionError,
} from "@/lib/adsTikTokServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tikTokAdsAccountCanAssociate } from "@/lib/adsTikTokPolicy";

function failureResponse(error: unknown) {
  const failure = error instanceof TikTokAdsConnectionError ? error : null;
  return NextResponse.json({
    error: failure?.message || "Comptes TikTok Ads indisponibles.",
    code: failure?.code || "provider_unavailable",
  }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (errorResponse || !user) return errorResponse;
  try {
    const integration = await readTikTokAdsIntegration(user.activeUserId);
    if (!integration || integration.status !== "connected") {
      return NextResponse.json({ accounts: [], selectedAccountId: null, publicationEnabled: false }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const accounts = await listTikTokAdsAccounts(user.activeUserId);
    return NextResponse.json({
      accounts: accounts.map((account) => ({ ...account, eligibleToAssociate: tikTokAdsAccountCanAssociate(account) })),
      selectedAccountId: accounts.some((account) => account.id === integration.resource_id) ? integration.resource_id : null,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (errorResponse || !user) return errorResponse;
  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  if (!/^\d{5,30}$/.test(accountId)) {
    return NextResponse.json({ error: "Compte TikTok Ads invalide.", code: "invalid_account" }, { status: 400 });
  }
  try {
    const integration = await readTikTokAdsIntegration(user.activeUserId);
    if (!integration || integration.status !== "connected") {
      return NextResponse.json({ error: "Connectez TikTok Ads avant de choisir un compte.", code: "not_connected" }, { status: 409 });
    }
    const accounts = await listTikTokAdsAccounts(user.activeUserId);
    const selected = accounts.find((account) => account.id === accountId);
    if (!selected) {
      return NextResponse.json({ error: "Ce compte n’est pas accessible via TikTok Ads.", code: "account_not_accessible" }, { status: 403 });
    }
    if (selected.currency !== "EUR") {
      return NextResponse.json({ error: "Choisissez un compte publicitaire en euros.", code: "currency_not_eur" }, { status: 400 });
    }
    if (!tikTokAdsAccountCanAssociate(selected)) {
      return NextResponse.json({ error: "Ce compte TikTok Ads n’est pas actif ou son statut n’est pas confirmé.", code: "account_not_active" }, { status: 409 });
    }
    const { error } = await supabaseAdmin.from("integrations").update({
      resource_id: selected.id,
      resource_label: selected.name,
      updated_at: new Date().toISOString(),
    }).eq("id", integration.id).eq("user_id", user.activeUserId);
    if (error) throw new TikTokAdsConnectionError("Le choix du compte n’a pas été enregistré.", "storage_unavailable");
    return NextResponse.json({ selectedAccountId: selected.id, account: selected, publicationEnabled: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failureResponse(error);
  }
}

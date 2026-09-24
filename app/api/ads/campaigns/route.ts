import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, listAdsAccounts, listMetaPages, requirePremiumAdsUser } from "@/lib/adsServer";
import { isAdsProvider, parseAdsCampaignInput } from "@/lib/adsValidation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const { data, error } = await supabaseAdmin.from("ads_campaigns")
    .select("id,provider,ad_account_id,name,daily_budget_cents,end_date,draft,status,provider_resources,last_error,published_at,created_at")
    .eq("user_id", user.activeUserId).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "Le stockage iNr’ADS n’est pas encore prêt. Appliquez la migration ADS." }, { status: 503 });
  return NextResponse.json({ campaigns: data || [] });
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_draft_save", identifier: user.authUserId, limit: 60, window: "1 h" });
  if (limited) return limited;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { draft, error: validationError } = parseAdsCampaignInput(body, { purpose: "draft" });
  if (!draft) return NextResponse.json({ error: validationError }, { status: 400 });

  try {
    if (isAdsProvider(draft.provider) && draft.adAccountId) {
      const accounts = await listAdsAccounts(user.activeUserId, draft.provider);
      const selectedAccount = accounts.find((account) => account.id === draft.adAccountId && account.currency === "EUR");
      if (!selectedAccount) return NextResponse.json({ error: "Ce compte publicitaire EUR n’est pas accessible via la connexion active." }, { status: 403 });
    }
    if (draft.provider === "meta" && draft.pageId) {
      const pages = await listMetaPages(user.activeUserId);
      if (!pages.some((page) => page.id === draft.pageId)) {
        return NextResponse.json({ error: "Cette Page Facebook n’est pas accessible via la connexion active." }, { status: 403 });
      }
    }

    // The four planned channels can be saved as preparation-only drafts. Their
    // account identifiers must remain empty until their own OAuth is implemented.
    const adAccountId = isAdsProvider(draft.provider) ? draft.adAccountId : "";

    const payload = {
      user_id: user.activeUserId,
      provider: draft.provider,
      ad_account_id: adAccountId,
      currency: "EUR",
      name: draft.name,
      daily_budget_cents: Math.round(draft.dailyBudgetEuros * 100),
      end_date: draft.endDate,
      draft,
      updated_at: new Date().toISOString(),
    };
    const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
    const saved = id
      ? await supabaseAdmin.from("ads_campaigns").update(payload).eq("id", id).eq("user_id", user.activeUserId).eq("status", "draft").select("id,status").maybeSingle()
      : await supabaseAdmin.from("ads_campaigns").insert(payload).select("id,status").single();
    if (saved.error || !saved.data) return NextResponse.json({ error: "Le brouillon n’a pas pu être enregistré ou n’est plus modifiable." }, { status: 409 });
    return NextResponse.json({ campaign: saved.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connexion publicitaire indisponible." }, { status: 502 });
  }
}

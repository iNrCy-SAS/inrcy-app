import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, listAdsAccounts, listMetaPages, requirePremiumAdsUser } from "@/lib/adsServer";
import { isAdsProvider, parseAdsCampaignInput } from "@/lib/adsValidation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import { ADS_CAMPAIGN_ID_PATTERN, canMutateAdsDraft } from "./[id]/trackingPolicy";

const CAMPAIGN_PAGE_SIZE = 50;

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const requestedOffset = new URL(request.url).searchParams.get("offset") ?? "0";
  if (!/^(0|[1-9]\d{0,8})$/.test(requestedOffset)) {
    return NextResponse.json({ error: "Page de campagnes invalide." }, { status: 400 });
  }
  const offset = Number(requestedOffset);
  const { data, error, count } = await supabaseAdmin.from("ads_campaigns")
    .select("id,provider,ad_account_id,name,daily_budget_cents,end_date,draft,status,provider_resources,last_error,published_at,created_at", { count: "exact" })
    .eq("user_id", user.activeUserId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + CAMPAIGN_PAGE_SIZE - 1);
  if (error) return NextResponse.json({ error: "Le stockage iNr’ADS n’est pas encore prêt. Appliquez la migration ADS." }, { status: 503 });
  const campaigns = data || [];
  const total = count ?? offset + campaigns.length;
  const nextOffset = offset + campaigns.length < total && campaigns.length > 0 ? offset + campaigns.length : null;
  return NextResponse.json({ campaigns, total, nextOffset });
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

    // The four additional channels can be saved as preparation-only drafts.
    // Their account identifiers remain empty until provider-side publishing is approved.
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
    const requestedId = body?.id;
    if (requestedId !== undefined && (typeof requestedId !== "string" || !ADS_CAMPAIGN_ID_PATTERN.test(requestedId))) {
      return NextResponse.json({ error: "Identifiant de brouillon invalide." }, { status: 400 });
    }
    if (typeof requestedId === "string") {
      const { data: existing, error: readError } = await supabaseAdmin.from("ads_campaigns")
        .select("id,status,published_at,provider_resources,updated_at")
        .eq("id", requestedId).eq("user_id", user.activeUserId).maybeSingle();
      if (readError) return NextResponse.json({ error: "Impossible de vérifier ce brouillon." }, { status: 503 });
      if (!existing) return NextResponse.json({ error: "Brouillon introuvable." }, { status: 404 });
      if (!canMutateAdsDraft(existing)) {
        return NextResponse.json({ error: "Ce brouillon possède déjà une publication ou des ressources sur une plateforme et ne peut plus être modifié ici." }, { status: 409 });
      }
      const { data: savedId, error: updateError } = await supabaseAdmin.rpc("inrcy_update_ads_draft", {
        p_user_id: user.activeUserId,
        p_campaign_id: requestedId,
        p_expected_updated_at: existing.updated_at,
        p_provider: payload.provider,
        p_ad_account_id: payload.ad_account_id,
        p_name: payload.name,
        p_daily_budget_cents: payload.daily_budget_cents,
        p_end_date: payload.end_date,
        p_draft: payload.draft,
      });
      if (updateError) return NextResponse.json({ error: "La mise à jour du brouillon est indisponible." }, { status: 503 });
      if (!savedId) return NextResponse.json({ error: "Ce brouillon a changé entre-temps. Actualisez le suivi." }, { status: 409 });
      return NextResponse.json({ campaign: { id: savedId, status: "draft" } });
    }
    const saved = await supabaseAdmin.from("ads_campaigns").insert(payload).select("id,status").single();
    if (saved.error || !saved.data) return NextResponse.json({ error: "Le brouillon n’a pas pu être enregistré." }, { status: 503 });
    return NextResponse.json({ campaign: saved.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connexion publicitaire indisponible." }, { status: 502 });
  }
}

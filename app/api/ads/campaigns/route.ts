import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, listAdsAccounts, listMetaPages, requirePremiumAdsUser } from "@/lib/adsServer";
import { isAdsProvider, isAdsChannelId, normalizeStoredAdsCampaignDraft, parseAdsCampaignInput } from "@/lib/adsValidation";
import { listPinterestAdsAccounts, readPinterestAdsIntegration } from "@/lib/adsPinterestServer";
import { listLinkedInAdsAccounts, readLinkedInAdsIntegration } from "@/lib/adsLinkedInServer";
import { listXAdsAccounts, readXAdsIntegration, verifySelectedXAdsAccount } from "@/lib/adsXServer";
import { readOpenaiAdsIntegration } from "@/lib/adsOpenaiServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import { ADS_CAMPAIGN_ID_PATTERN, canMutateAdsDraft } from "./[id]/trackingPolicy";
import { isAdsPilotAdmin, isAdsChannelUserAllowed, adsPilotOnlyResponse } from "@/lib/adsServer";

const CAMPAIGN_PAGE_SIZE = 50;

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const searchParams = new URL(request.url).searchParams;
  const requestedOffset = searchParams.get("offset") ?? "0";
  if (!/^(0|[1-9]\d{0,8})$/.test(requestedOffset)) {
    return NextResponse.json({ error: "Page de campagnes invalide." }, { status: 400 });
  }
  const requestedStatus = searchParams.get("status");
  if (requestedStatus !== null && requestedStatus !== "draft") {
    return NextResponse.json({ error: "Filtre de campagnes invalide." }, { status: 400 });
  }
  const offset = Number(requestedOffset);
  let query = supabaseAdmin.from("ads_campaigns")
    .select("id,provider,ad_account_id,name,daily_budget_cents,end_date,draft,status,provider_resources,last_error,published_at,created_at", { count: "exact" })
    .eq("user_id", user.activeUserId);
  if (!(await isAdsPilotAdmin(user.authUserId))) query = query.in("provider", ["google", "pinterest"]);
  if (requestedStatus === "draft") query = query.eq("status", "draft");
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + CAMPAIGN_PAGE_SIZE - 1);
  if (error) return NextResponse.json({ error: "Le stockage iNr’ADS n’est pas encore prêt. Appliquez la migration ADS." }, { status: 503 });
  const campaigns = (data || []).map((campaign) => ({
    ...campaign,
    draft: normalizeStoredAdsCampaignDraft(campaign.draft),
  }));
  const total = count ?? offset + campaigns.length;
  const nextOffset = offset + campaigns.length < total && campaigns.length > 0 ? offset + campaigns.length : null;
  return NextResponse.json({ campaigns, total, nextOffset }, { headers: { "Cache-Control": "no-store" } });
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
  if (!(await isAdsChannelUserAllowed(user.authUserId, user.activeUserId, draft.provider))) return adsPilotOnlyResponse();

  try {
    if (isAdsProvider(draft.provider) && draft.adAccountId) {
      const accounts = await listAdsAccounts(user.activeUserId, draft.provider);
      const selectedAccount = accounts.find((account) => account.id === draft.adAccountId && account.currency === "EUR");
      if (!selectedAccount) return NextResponse.json({ error: "Ce compte publicitaire EUR n’est pas accessible via la connexion active." }, { status: 403 });
    }
    if (draft.provider === "pinterest" && draft.adAccountId) {
      const integration = await readPinterestAdsIntegration(user.activeUserId);
      if (integration?.status !== "connected" || integration.resource_id !== draft.adAccountId) {
        return NextResponse.json({ error: "Ce compte Pinterest Ads n’est plus celui associé à votre canal. Vérifiez la connexion avant d’enregistrer le brouillon." }, { status: 409 });
      }
      const accounts = await listPinterestAdsAccounts(user.activeUserId, integration);
      const selectedAccount = accounts.find((account) => account.id === draft.adAccountId && account.currency === "EUR");
      if (!selectedAccount) {
        return NextResponse.json({ error: "Le compte Pinterest Ads EUR associé n’est plus accessible." }, { status: 403 });
      }
    }
    if (draft.provider === "linkedin" && draft.adAccountId) {
      const integration = await readLinkedInAdsIntegration(user.activeUserId);
      if (integration?.status !== "connected" || integration.resource_id !== draft.adAccountId) {
        return NextResponse.json({ error: "Ce compte LinkedIn Ads n’est plus celui associé au canal. Vérifiez la connexion avant d’enregistrer le brouillon." }, { status: 409 });
      }
      const accounts = await listLinkedInAdsAccounts(user.activeUserId, integration);
      const selectedAccount = accounts.find((account) => account.id === draft.adAccountId
        && account.currency === "EUR" && account.canManageCampaigns === true);
      if (!selectedAccount) {
        return NextResponse.json({ error: "Le compte LinkedIn Ads EUR associé n’est plus accessible avec un rôle de gestion des campagnes." }, { status: 403 });
      }
    }
    if (draft.provider === "x" && draft.adAccountId) {
      const integration = await readXAdsIntegration(user.activeUserId);
      if (integration?.status !== "connected" || integration.resource_id !== draft.adAccountId) {
        return NextResponse.json({ error: "Ce compte X Ads n’est plus celui associé au canal. Vérifiez la connexion avant d’enregistrer le brouillon." }, { status: 409 });
      }
      const accounts = await listXAdsAccounts(user.activeUserId, integration);
      const account = accounts.find((entry) => entry.id === draft.adAccountId);
      if (!account) {
        return NextResponse.json({ error: "Le compte X Ads associé n’est plus accessible." }, { status: 403 });
      }
      const verified = await verifySelectedXAdsAccount(user.activeUserId, integration, account);
      if (verified.eligibleToAssociate !== true) {
        return NextResponse.json({ error: "Le compte X Ads doit rester accepté, en euros, avec un rôle Administrateur ou Ad Manager vérifié." }, { status: 403 });
      }
    }
    if (draft.provider === "openai" && draft.adAccountId) {
      const integration = await readOpenaiAdsIntegration(user.activeUserId);
      if (integration?.status !== "connected" || integration.resource_id !== draft.adAccountId) {
        return NextResponse.json({ error: "Le compte ChatGPT Ads du brouillon n’est plus celui associé au canal." }, { status: 409 });
      }
    }
    if (draft.provider === "meta" && draft.pageId) {
      const pages = await listMetaPages(user.activeUserId);
      if (!pages.some((page) => page.id === draft.pageId)) {
        return NextResponse.json({ error: "Cette Page Facebook n’est pas accessible via la connexion active." }, { status: 403 });
      }
    }

    // This association does not grant publication: X drafts remain local only.
    const adAccountId = isAdsProvider(draft.provider) || draft.provider === "pinterest" || draft.provider === "linkedin" || draft.provider === "x" || draft.provider === "openai"
      ? draft.adAccountId : "";

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
    // A new campaign may come from an older client that serializes its
    // not-yet-created id as null. Only a supplied, non-null id means update.
    if (requestedId != null && (typeof requestedId !== "string" || !ADS_CAMPAIGN_ID_PATTERN.test(requestedId))) {
      return NextResponse.json({ error: "Identifiant de brouillon invalide." }, { status: 400 });
    }
    if (typeof requestedId === "string") {
      const { data: existing, error: readError } = await supabaseAdmin.from("ads_campaigns")
        .select("id,provider,status,published_at,provider_resources,updated_at")
        .eq("id", requestedId).eq("user_id", user.activeUserId).maybeSingle();
      if (readError) return NextResponse.json({ error: "Impossible de vérifier ce brouillon." }, { status: 503 });
      if (!existing) return NextResponse.json({ error: "Brouillon introuvable." }, { status: 404 });
      if (!isAdsChannelId(existing.provider) || !(await isAdsChannelUserAllowed(user.authUserId, user.activeUserId, existing.provider))) return adsPilotOnlyResponse();
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

import { publicAdsProviderResources } from "@/lib/adsProviderResources";
import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { normalizeStoredAdsCampaignDraft, parseAdsCampaignInput } from "@/lib/adsValidation";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ADS_CAMPAIGN_ID_PATTERN, canMutateAdsDraft, validateDraftExtension } from "./trackingPolicy";
import { isAdsChannelUserAllowed, adsPilotOnlyResponse } from "@/lib/adsServer";
import { isAdsChannelId } from "@/lib/adsValidation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const { id } = await context.params;
  if (!ADS_CAMPAIGN_ID_PATTERN.test(id)) return NextResponse.json({ error: "Identifiant de campagne invalide." }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("ads_campaigns")
    .select("id,provider,ad_account_id,name,daily_budget_cents,end_date,status,draft,provider_resources,last_error,published_at,created_at")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (error) return NextResponse.json({ error: "Impossible de relire cette campagne." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Campagne introuvable." }, { status: 404 });
  if (!isAdsChannelId(data.provider) || !(await isAdsChannelUserAllowed(user.authUserId, user.activeUserId, data.provider))) return adsPilotOnlyResponse();
  return NextResponse.json({
    campaign: { ...data, draft: normalizeStoredAdsCampaignDraft(data.draft), provider_resources: publicAdsProviderResources(data.provider_resources) },
  }, { headers: { "Cache-Control": "no-store" } });
}

async function authorizeDraftMutation(request: Request, context: RouteContext, operation: "extend" | "delete") {
  if (!adsRequestOriginAllowed(request)) return { response: adsBadOriginResponse() };
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return { response: errorResponse || NextResponse.json({ error: "Accès refusé." }, { status: 403 }) };
  const { id } = await context.params;
  if (!ADS_CAMPAIGN_ID_PATTERN.test(id)) {
    return { response: NextResponse.json({ error: "Identifiant de campagne invalide." }, { status: 400 }) };
  }
  const limited = await enforceRateLimit({ name: `ads_campaign_${operation}`, identifier: user.authUserId, limit: 30, window: "1 h" });
  if (limited) return { response: limited };
  const { data, error } = await supabaseAdmin.from("ads_campaigns")
    .select("id,user_id,provider,status,published_at,provider_resources,end_date,updated_at,draft")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (error) return { response: NextResponse.json({ error: "Impossible de relire cette campagne." }, { status: 503 }) };
  if (!data) return { response: NextResponse.json({ error: "Campagne introuvable." }, { status: 404 }) };
  if (!isAdsChannelId(data.provider) || !(await isAdsChannelUserAllowed(user.authUserId, user.activeUserId, data.provider))) return { response: adsPilotOnlyResponse() };
  if (!canMutateAdsDraft(data)) {
    return { response: NextResponse.json({ error: "Seul un brouillon sans publication ni ressource sur une plateforme peut être modifié ou supprimé ici." }, { status: 409 }) };
  }
  return { id, userId: user.activeUserId, campaign: data };
}

/** Extend a saved draft only. Published campaigns need a real provider-side update adapter. */
export async function PATCH(request: Request, context: RouteContext) {
  const authorized = await authorizeDraftMutation(request, context, "extend");
  if ("response" in authorized) return authorized.response;
  const { id, userId, campaign } = authorized;
  const body = await request.json().catch(() => null) as { endDate?: unknown } | null;
  const dateError = validateDraftExtension(campaign.end_date, body?.endDate);
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });
  const nextEndDate = body?.endDate as string;
  const originalDraft = campaign.draft && typeof campaign.draft === "object" && !Array.isArray(campaign.draft)
    ? campaign.draft as Record<string, unknown>
    : null;
  if (!originalDraft) return NextResponse.json({ error: "Ce brouillon est incomplet. Ouvrez-le dans le studio pour le corriger." }, { status: 409 });
  const { draft, error: validationError } = parseAdsCampaignInput({ ...originalDraft, endDate: nextEndDate }, { purpose: "draft" });
  if (!draft) return NextResponse.json({ error: validationError || "Ce brouillon doit être corrigé dans le studio." }, { status: 400 });

  const { data, error } = await supabaseAdmin.rpc("inrcy_extend_ads_draft", {
    p_user_id: userId,
    p_campaign_id: id,
    p_expected_updated_at: campaign.updated_at,
    p_current_end_date: campaign.end_date,
    p_next_end_date: nextEndDate,
    p_draft: draft,
  });
  if (error) return NextResponse.json({ error: "La prolongation du brouillon a échoué." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Ce brouillon a changé entre-temps. Actualisez le suivi." }, { status: 409 });
  return NextResponse.json({ campaign: { id: data, end_date: nextEndDate, draft } });
}

/** Deleting a published local row would orphan a possibly billable remote campaign. */
export async function DELETE(request: Request, context: RouteContext) {
  const authorized = await authorizeDraftMutation(request, context, "delete");
  if ("response" in authorized) return authorized.response;
  const { id, userId, campaign } = authorized;
  const { data, error } = await supabaseAdmin.rpc("inrcy_delete_ads_draft", {
    p_user_id: userId,
    p_campaign_id: id,
    p_expected_updated_at: campaign.updated_at,
  });
  if (error) return NextResponse.json({ error: "Le brouillon n’a pas pu être supprimé." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Ce brouillon a changé entre-temps. Actualisez le suivi." }, { status: 409 });
  return NextResponse.json({ deletedId: data });
}

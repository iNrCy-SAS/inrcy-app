import { NextResponse } from "next/server";
import { googleAdsJson, listAdsAccounts, metaAdsJson, requirePremiumAdsUser } from "@/lib/adsServer";
import { googleCampaignId, metaCampaignId, parseGoogleAdsMetrics, parseLinkedInAdsMetrics, parseMetaAdsMetrics } from "@/lib/adsCampaignMetrics";
import { readLinkedInAdsCampaignAnalytics } from "@/lib/adsLinkedInLifecycle";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

/** Performance is fetched only on demand from the advertiser's own platform. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Identifiant de campagne invalide." }, { status: 400 });
  }
  const limited = await enforceRateLimit({ name: "ads_campaign_metrics", identifier: user.authUserId, limit: 30, window: "1 h" });
  if (limited) return limited;

  const { data: campaign, error } = await supabaseAdmin.from("ads_campaigns")
    .select("provider,ad_account_id,status,provider_resources")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (error) return NextResponse.json({ error: "Impossible de relire la campagne." }, { status: 503 });
  if (!campaign) return NextResponse.json({ error: "Campagne introuvable." }, { status: 404 });
  if (!["active", "paused", "demo_paused", "needs_review"].includes(campaign.status)) {
    return NextResponse.json({ error: "Aucune statistique de diffusion pour ce brouillon." }, { status: 409 });
  }

  const accountId = String(campaign.ad_account_id || "");
  const fetchedAt = new Date().toISOString();
  try {
    if (campaign.provider === "google") {
      const campaignId = googleCampaignId(campaign.provider_resources, accountId);
      if (!campaignId) return NextResponse.json({ error: "Identifiant Google Ads indisponible." }, { status: 409 });
      const accounts = await listAdsAccounts(user.activeUserId, "google");
      const account = accounts.find((entry) => entry.id === accountId && entry.currency === "EUR");
      if (!account) return NextResponse.json({ error: "Ce compte Google Ads n’est plus accessible." }, { status: 403 });
      const report = await googleAdsJson(user.activeUserId, `customers/${accountId}/googleAds:search`, {
        query: `SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id = ${campaignId} AND segments.date DURING LAST_30_DAYS LIMIT 1`,
      }, account.loginCustomerId);
      const metrics = parseGoogleAdsMetrics(report, fetchedAt);
      return NextResponse.json(metrics ? { metrics } : { metrics: null, reason: "no_data" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (campaign.provider === "meta") {
      const campaignId = metaCampaignId(campaign.provider_resources, accountId);
      if (!campaignId) return NextResponse.json({ error: "Identifiant Meta Ads indisponible." }, { status: 409 });
      const accounts = await listAdsAccounts(user.activeUserId, "meta");
      const account = accounts.find((entry) => entry.id === accountId && entry.currency === "EUR");
      if (!account) return NextResponse.json({ error: "Ce compte Meta Ads n’est plus accessible." }, { status: 403 });
      const report = await metaAdsJson(user.activeUserId,
        `${campaignId}/insights?fields=impressions,clicks,spend&date_preset=last_30d&limit=1`);
      const metrics = parseMetaAdsMetrics(report, fetchedAt);
      return NextResponse.json(metrics ? { metrics } : { metrics: null, reason: "no_data" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (campaign.provider === "linkedin") {
      const end = new Date();
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29));
      const report = await readLinkedInAdsCampaignAnalytics(user.activeUserId, {
        adAccountId: accountId,
        resources: campaign.provider_resources,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      });
      const metrics = parseLinkedInAdsMetrics(report.payload, fetchedAt, report.campaignUrn);
      return NextResponse.json(metrics ? { metrics } : { metrics: null, reason: "no_data" }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Les statistiques de ce canal ne sont pas encore synchronisées." }, { status: 409 });
  } catch {
    return NextResponse.json({ error: "La plateforme publicitaire ne fournit pas ses statistiques pour le moment. Réessayez ou consultez votre compte annonceur." }, { status: 502 });
  }
}

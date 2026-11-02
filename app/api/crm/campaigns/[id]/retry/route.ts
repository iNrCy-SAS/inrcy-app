import { NextResponse } from "next/server";
import { evaluateCampaignDispatchState } from "@/lib/crmCampaigns";
import { getMailCampaignDeliveryConfig } from "@/lib/mailCampaignPacing";
import { requireUser } from "@/lib/requireUser";
import { fetchSuppressedEmailsByUser } from "@/lib/mailSuppression";
import { enforceRateLimit } from "@/lib/rateLimit";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";

export const runtime = "nodejs";

async function getRouteId(ctx: any) {
  const params = await ctx?.params;
  return String(params?.id || "").trim();
}

async function retryCampaignHandler(req: Request, ctx: any) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const rateLimited = await enforceRateLimit({
    name: "crm_campaign_retry",
    identifier: activeUserId,
    limit: 10,
    window: "10 m",
    failClosed: false,
  });
  if (rateLimited) return rateLimited;

  const campaignId = await getRouteId(ctx);
  if (!campaignId) {
    return NextResponse.json({ error: "Campagne manquante." }, { status: 400 });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("mail_campaigns")
    .select("id,user_id,status,integration_id,pause_reason,resume_at")
    .eq("id", campaignId)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (campaignError) {
    captureApiException(req, campaignError, { area: "crm_campaigns", operation: "POST /api/crm/campaigns/:id/retry", statusCode: 500 });
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }
  if (!campaign?.id) {
    return NextResponse.json({ error: "Campagne introuvable." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { data: failedRows, error: failedError } = await supabase
    .from("mail_campaign_recipients")
    .select("id,email,suppression_reason,bounce_type")
    .eq("campaign_id", campaignId)
    .eq("user_id", activeUserId)
    .eq("status", "failed")
    .limit(1000);

  if (failedError) {
    captureApiException(req, failedError, { area: "crm_campaigns", operation: "POST /api/crm/campaigns/:id/retry", statusCode: 500 });
    return NextResponse.json({ error: failedError.message }, { status: 500 });
  }

  const suppressedMap = await fetchSuppressedEmailsByUser(
    activeUserId,
    (failedRows || []).map((row: any) => String(row?.email || "")),
  );

  let blocked = 0;
  const ids = (failedRows || [])
    .filter((row: any) => {
      const email = String(row?.email || "").trim().toLowerCase();
      if (!email) return false;
      if (row?.suppression_reason) {
        blocked += 1;
        return false;
      }
      if (String(row?.bounce_type || "").toLowerCase() === "hard") {
        blocked += 1;
        return false;
      }
      if (suppressedMap.has(email)) {
        blocked += 1;
        return false;
      }
      return true;
    })
    .map((row: any) => String(row.id || ""))
    .filter(Boolean);

  const isPausedCampaign = String(campaign.status || "").toLowerCase() === "paused";
  if (ids.length === 0 && !isPausedCampaign) {
    return NextResponse.json({ error: blocked > 0 ? "Aucun échec relançable (adresses bloquées ou rebonds durs)." : "Aucun échec à relancer." }, { status: 400 });
  }

  if (ids.length > 0) {
    const { error: updateError } = await supabase
      .from("mail_campaign_recipients")
      .update({
        status: "queued",
        error: null,
        last_error: null,
        attempt_count: 0,
        next_attempt_at: now,
        processing_started_at: null,
        updated_at: now,
        delivery_status: null,
        delivery_event: null,
        delivery_last_event_at: null,
        delivered_at: null,
        bounced_at: null,
        failure_kind: null,
        failure_retryable: null,
        provider_status: null,
      })
      .in("id", ids)
      .eq("user_id", activeUserId)
      .eq("status", "failed");

    if (updateError) {
      captureApiException(req, updateError, { area: "crm_campaigns", operation: "POST /api/crm/campaigns/:id/retry", statusCode: 500 });
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  const dispatchState = await evaluateCampaignDispatchState({
    userId: activeUserId,
    integrationId: String(campaign.integration_id || ""),
    currentCampaignId: campaignId,
  });
  const deliveryConfig = getMailCampaignDeliveryConfig();
  const targetStatus = dispatchState.state === "paused" ? "paused" : "queued";

  await supabase
    .from("mail_campaigns")
    .update({
      status: targetStatus,
      finished_at: null,
      last_error: dispatchState.state === "ready" ? null : dispatchState.reason,
      pause_reason: dispatchState.pauseReason,
      resume_at: dispatchState.resumeAt,
      updated_at: now,
      last_activity_at: now,
    })
    .eq("id", campaignId)
    .eq("user_id", activeUserId);

  return NextResponse.json({
    success: true,
    campaignId,
    retried: ids.length,
    resumed: isPausedCampaign,
    blocked,
    campaignStatus: targetStatus,
    distributionState: dispatchState.state,
    deferredReason: dispatchState.reason,
    resumeAt: dispatchState.resumeAt,
    batchSize: dispatchState.state === "ready" ? Math.max(1, dispatchState.availableNow) : deliveryConfig.batchSize,
    hourlyLimit: deliveryConfig.hourlyLimit,
    dailyLimit: deliveryConfig.dailyLimit,
    activeLimit: deliveryConfig.maxActivePerIntegration,
    queuedForBackgroundDispatch: true,
  });
}

export const POST = withApi(retryCampaignHandler, { route: "/api/crm/campaigns/:id/retry" });

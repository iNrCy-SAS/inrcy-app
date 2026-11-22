import { NextResponse } from "next/server";
import { evaluateCampaignDispatchState } from "@/lib/crmCampaigns";
import { getMailCampaignDeliveryConfig } from "@/lib/mailCampaignPacing";
import { requireUser } from "@/lib/requireUser";
import { fetchSuppressedEmailsByUser } from "@/lib/mailSuppression";
import { enforceRateLimit } from "@/lib/rateLimit";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import { getRequestId } from "@/lib/observability/request";
import { getConnectionDisplayStatus, mailConnectionKind } from "@/lib/connectionVersions";
import { resolveMailboxReputationPolicy } from "@/lib/mailboxReputation";

export const runtime = "nodejs";

const providerWaitMessage = "Le fournisseur demande d’attendre avant de reprendre les envois.";
const timedPauseMessages: Readonly<Record<string, string>> = {
  rate_limited: providerWaitMessage,
  provider_quota: providerWaitMessage,
  quota_exceeded: providerWaitMessage,
  provider_unavailable: providerWaitMessage,
  provider_issue: providerWaitMessage,
  outlook_transfer_budget: "iNrCy espace les envois Outlook selon la taille des messages de cette boîte.",
  outlook_transfer_unavailable: "Le contrôle du volume d’envoi Outlook est temporairement indisponible.",
};

async function getRouteId(ctx: any) {
  const params = await ctx?.params;
  return String(params?.id || "").trim();
}

function publicFailure(req: Request, code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, error_code: code, error: message, request_id: getRequestId(req) }, { status });
}

async function retryCampaign(req: Request, ctx: any) {
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
    return publicFailure(req, "campaign_missing", "Campagne manquante.", 400);
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("mail_campaigns")
    .select("id,user_id,status,integration_id,pause_reason,resume_at,updated_at")
    .eq("id", campaignId)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (campaignError) {
    throw campaignError;
  }
  if (!campaign?.id) {
    return publicFailure(req, "campaign_not_found", "Campagne introuvable.", 404);
  }

  const integrationId = String(campaign.integration_id || "");
  if (!integrationId) {
    return publicFailure(req, "mailbox_missing", "La boîte d’envoi liée à cette campagne n’est plus disponible. Contactez l’assistance iNrCy pour vérifier son rattachement avant de reprendre.", 409);
  }
  const { data: account, error: accountError } = await supabase
    .from("integrations")
    .select("id,provider,status,account_email,settings")
    .eq("id", integrationId)
    .eq("user_id", activeUserId)
    .eq("category", "mail")
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account?.id) {
    return publicFailure(req, "mailbox_missing", "La boîte d’envoi liée à cette campagne n’est plus disponible. Contactez l’assistance iNrCy pour vérifier son rattachement avant de reprendre.", 409);
  }
  const connectionKind = mailConnectionKind(account.provider);
  if (!connectionKind) {
    return publicFailure(req, "mailbox_configuration_required", "La boîte d’envoi liée à cette campagne doit être vérifiée dans les réglages Mails.", 409);
  }
  if (account.status !== "connected" || getConnectionDisplayStatus(true, connectionKind, account.settings) !== "connected") {
    return publicFailure(req, "mailbox_reconnect_required", "Reconnectez la boîte d’envoi dans les réglages Mails avant de reprendre cette campagne.", 409);
  }

  // Match the worker's mailbox-specific protections before changing any
  // recipient. Reconnecting a mailbox does not remove its reputation cooldown.
  const reputationPolicy = await resolveMailboxReputationPolicy({
    userId: activeUserId, integrationId, provider: account.provider,
    accountEmail: String(account.account_email || "").trim() || null,
    settings: account.settings && typeof account.settings === "object" ? account.settings : null,
  });
  const deliveryConfig = reputationPolicy.config || getMailCampaignDeliveryConfig();
  const providerPauseReason = String(campaign.pause_reason || "");
  const providerResumeAt = Date.parse(String(campaign.resume_at || ""));
  const providerPauseActive = campaign.status === "paused" && Number.isFinite(providerResumeAt) && providerResumeAt > Date.now()
    && Object.hasOwn(timedPauseMessages, providerPauseReason);
  const dispatchState = reputationPolicy.blocked ? {
    state: "paused" as const,
    reason: reputationPolicy.blockedReason,
    pauseReason: "mailbox_reputation_paused",
    resumeAt: reputationPolicy.resumeAt,
    availableNow: 0,
  } : providerPauseActive ? {
    state: "paused" as const,
    reason: timedPauseMessages[providerPauseReason],
    pauseReason: providerPauseReason === "quota_exceeded" ? "provider_quota" : providerPauseReason,
    resumeAt: String(campaign.resume_at),
    availableNow: 0,
  } : await evaluateCampaignDispatchState({
    userId: activeUserId, integrationId, currentCampaignId: campaignId, config: deliveryConfig,
  });
  if (dispatchState.state !== "ready") {
    return NextResponse.json({
      success: true, campaignId, integrationId, retried: 0, resumed: false, blocked: 0,
      campaignStatus: String(campaign.status), distributionState: dispatchState.state,
      reasonCode: dispatchState.pauseReason, pauseReason: dispatchState.pauseReason,
      deferredReason: dispatchState.reason, resumeAt: dispatchState.resumeAt,
      batchSize: deliveryConfig.batchSize, hourlyLimit: deliveryConfig.hourlyLimit,
      dailyLimit: deliveryConfig.dailyLimit, activeLimit: deliveryConfig.maxActivePerIntegration,
      queuedForBackgroundDispatch: false,
    });
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
    throw failedError;
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
    return publicFailure(req, "campaign_no_retryable_recipients", blocked > 0 ? "Aucun échec relançable (adresses bloquées ou rebonds durs)." : "Aucun échec à relancer.", 400);
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
      throw updateError;
    }
  }

  const targetStatus = "queued";

  const campaignUpdate = supabase
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
    .eq("user_id", activeUserId)
    .eq("status", campaign.status)
    .eq("integration_id", integrationId);
  const versionedUpdate = campaign.updated_at == null
    ? campaignUpdate.is("updated_at", null)
    : campaignUpdate.eq("updated_at", campaign.updated_at);
  const { data: updatedCampaign, error: campaignUpdateError } = await versionedUpdate
    .select("id")
    .maybeSingle();
  if (campaignUpdateError) throw campaignUpdateError;
  if (!updatedCampaign?.id) {
    return publicFailure(req, "campaign_state_changed", "La campagne a changé pendant la demande. Actualisez son statut avant de réessayer.", 409);
  }

  return NextResponse.json({
    success: true,
    campaignId,
    integrationId,
    retried: ids.length,
    resumed: isPausedCampaign,
    blocked,
    campaignStatus: targetStatus,
    distributionState: dispatchState.state,
    reasonCode: dispatchState.pauseReason,
    pauseReason: dispatchState.pauseReason,
    deferredReason: dispatchState.reason,
    resumeAt: dispatchState.resumeAt,
    batchSize: dispatchState.state === "ready" ? Math.max(1, dispatchState.availableNow) : deliveryConfig.batchSize,
    hourlyLimit: deliveryConfig.hourlyLimit,
    dailyLimit: deliveryConfig.dailyLimit,
    activeLimit: deliveryConfig.maxActivePerIntegration,
    queuedForBackgroundDispatch: true,
  });
}

async function retryCampaignHandler(req: Request, ctx: any) {
  try {
    return await retryCampaign(req, ctx);
  } catch (error) {
    captureApiException(req, error, { area: "crm_campaigns", operation: "POST /api/crm/campaigns/:id/retry", statusCode: 500 });
    return publicFailure(req, "campaign_resume_unavailable", "Impossible de reprendre la campagne pour le moment. Réessayez dans quelques instants.", 500);
  }
}

export const POST = withApi(retryCampaignHandler, { route: "/api/crm/campaigns/:id/retry" });

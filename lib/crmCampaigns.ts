import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendMailFromIntegration } from "@/lib/inrsend/sendMailFromIntegration";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import { textToSimpleHtml } from "@/lib/inrsendSignature";
import { sanitizeRichMailHtml } from "@/lib/mailRichText";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { awardWeeklyFeatureUseForCampaign } from "@/lib/loyalty/serverAward";
import { normalizeMailDeliveryError } from "@/lib/mailDeliveryErrors";
import { runTransientPostgrestRead } from "@/lib/supabaseTransientRetry";
import { downloadMailAttachmentRefs, parseMailAttachmentRefs, type MailAttachmentRef } from "@/lib/mailAttachmentRefs";
import { providerBatchLimit } from "@/lib/crmRecipients";
import { sendTrackedMailCampaignCompletionSummary } from "@/lib/mailCampaignCompletionEmail";
import {
  getMailCampaignDeliveryConfig,
  waitForNextCampaignRecipient,
  type MailCampaignDeliveryConfig,
} from "@/lib/mailCampaignPacing";
import {
  releaseMailCampaignMailboxLock,
  renewMailCampaignMailboxLock,
  tryAcquireMailCampaignMailboxLock,
} from "@/lib/mailCampaignDispatchLock";
import {
  recordMailboxReputationOutcome,
  resolveMailboxReputationPolicy,
} from "@/lib/mailboxReputation";
import { loadAndPersistMailCampaignReport } from "@/lib/mailCampaignReportServer";
import {
  buildRecipientUnsubscribeUrl,
  classifyMailFailure,
  fetchSuppressedEmailsByUser,
  getSuppressionReasonLabel,
  upsertSuppressionEntry,
} from "@/lib/mailSuppression";
import { hasPremiumDashboardAccess } from "@/lib/dashboardEdition";
import {
  getDashboardEditionForAccountId,
  getDashboardEditionsForAccountIds,
} from "@/lib/dashboardEditionServer";

export type MailCampaignStatus = "queued" | "processing" | "paused" | "partial" | "completed" | "failed";
export type MailCampaignRecipientStatus = "queued" | "processing" | "sent" | "failed";

export type CampaignDispatchState = {
  state: "ready" | "waiting_turn" | "paused";
  reason: string | null;
  pauseReason: string | null;
  resumeAt: string | null;
  batchSize: number;
  hourlyLimit: number;
  dailyLimit: number;
  maxActivePerIntegration: number;
  sentLastHour: number;
  sentLastDay: number;
  hourlyRemaining: number;
  dailyRemaining: number;
  availableNow: number;
};

type RecipientRow = Record<string, unknown>;

const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MINUTES = 20;
const RECENT_COUNT_PAGE_SIZE = 500;
const RECENT_COUNT_BATCH_SIZE = 200;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function asNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function retryDelayMs(
  attemptCount: number,
  normalized?: ReturnType<typeof normalizeMailDeliveryError> | null,
) {
  if (normalized?.retryAfterMs != null) {
    return Math.max(60_000, normalized.retryAfterMs);
  }

  if (normalized?.kind === "rate_limited" || normalized?.kind === "quota_exceeded") {
    if (attemptCount <= 1) return 15 * 60_000;
    if (attemptCount === 2) return 60 * 60_000;
    return 4 * 60 * 60_000;
  }

  if (normalized?.kind === "provider_unavailable") {
    if (attemptCount <= 1) return 5 * 60_000;
    if (attemptCount === 2) return 15 * 60_000;
    return 60 * 60_000;
  }

  if (attemptCount <= 1) return 5 * 60_000;
  if (attemptCount === 2) return 15 * 60_000;
  return 60 * 60_000;
}

function chunkArray<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildWaitingTurnMessage() {
  return "Cette boîte traite déjà une autre campagne. La vôtre reste en file d’attente et reprendra automatiquement.";
}

function buildQuotaPauseMessage(state: Pick<CampaignDispatchState, "hourlyLimit" | "dailyLimit" | "sentLastHour" | "sentLastDay" | "hourlyRemaining" | "dailyRemaining">) {
  if (state.dailyRemaining <= 0) {
    return `Quota journalier atteint pour cette boîte (${state.sentLastDay}/${state.dailyLimit} sur 24 h). La campagne reprendra automatiquement.`;
  }
  return `Quota horaire atteint pour cette boîte (${state.sentLastHour}/${state.hourlyLimit} sur 1 h). La campagne reprendra automatiquement.`;
}

async function countRecipientsByStatus(campaignId: string, status: MailCampaignRecipientStatus) {
  const { count, error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", status);

  if (error) throw error;
  return count ?? 0;
}

export async function refreshCampaignCounters(campaignId: string, reportConfig?: MailCampaignDeliveryConfig | null) {
  const [{ data: campaignRow, error: campaignError }, queuedCount, processingCount, sentCount, failedCount] = await Promise.all([
    supabaseAdmin.from("mail_campaigns").select("status,finished_at").eq("id", campaignId).maybeSingle(),
    countRecipientsByStatus(campaignId, "queued"),
    countRecipientsByStatus(campaignId, "processing"),
    countRecipientsByStatus(campaignId, "sent"),
    countRecipientsByStatus(campaignId, "failed"),
  ]);

  if (campaignError) throw campaignError;

  const currentStatus = String((campaignRow as any)?.status || "").toLowerCase();
  let status: MailCampaignStatus = currentStatus === "paused" ? "paused" : "processing";
  let finishedAt: string | null = null;

  if (queuedCount === 0 && processingCount === 0) {
    finishedAt = String((campaignRow as any)?.finished_at || "").trim() || new Date().toISOString();
    if (failedCount === 0) status = "completed";
    else if (sentCount > 0) status = "partial";
    else status = "failed";
  } else if (currentStatus === "paused") {
    status = "paused";
  } else if (sentCount === 0 && failedCount === 0 && processingCount === 0) {
    status = "queued";
  } else {
    status = "processing";
  }

  const payload: Record<string, unknown> = {
    status,
    queued_count: queuedCount,
    processing_count: processingCount,
    sent_count: sentCount,
    failed_count: failedCount,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    finished_at: finishedAt,
  };

  if (status === "completed") payload.last_error = null;
  if (status === "completed" || status === "partial" || status === "failed") {
    payload.pause_reason = null;
    payload.resume_at = null;
  }

  const { error } = await supabaseAdmin.from("mail_campaigns").update(payload).eq("id", campaignId);
  if (error) throw error;

  const report = await loadAndPersistMailCampaignReport({
    campaignId,
    config: reportConfig || null,
  }).catch((reportError) => {
    console.warn("[crmCampaigns] campaign report snapshot skipped", { campaignId, reportError });
    return null;
  });

  return { queuedCount, processingCount, sentCount, failedCount, status, report };
}


async function maybeSendCampaignCompletionSummary(campaignId: string, counters: Awaited<ReturnType<typeof refreshCampaignCounters>>) {
  if (!campaignId || (counters.status !== "completed" && counters.status !== "partial" && counters.status !== "failed")) return;
  try {
    await sendTrackedMailCampaignCompletionSummary(campaignId, counters);
  } catch (error) {
    console.warn("[crmCampaigns] campaign completion email failed", { campaignId, error });
  }
}

async function resetStaleProcessingRecipients(campaignId: string) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { data: staleRows, error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status", "processing")
    .lt("processing_started_at", staleBefore)
    .limit(200);

  if (error) throw error;
  const ids = (staleRows || []).map((row: any) => String(row.id || "")).filter(Boolean);
  if (ids.length === 0) return 0;

  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .update({
      status: "queued",
      next_attempt_at: now,
      processing_started_at: null,
      updated_at: now,
      error: "Reprise automatique après interruption.",
      last_error: "Reprise automatique après interruption.",
    })
    .in("id", ids)
    .eq("status", "processing");

  if (updateError) throw updateError;
  return ids.length;
}

const RECIPIENT_PROCESSING_SELECT =
  "id,email,contact_id,display_name,attempt_count,max_attempts,last_error,suppression_reason,bounce_type,unsubscribed_at,failure_kind,failure_retryable,provider_status";

function isMissingClaimRpc(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "PGRST202" || error?.code === "42883" || message.includes("claim_mail_campaign_recipients");
}

async function claimQueuedRecipientsFallback(campaignId: string, limit: number, now: string) {
  const { data: queuedRows, error: loadError } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .select(RECIPIENT_PROCESSING_SELECT)
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (loadError) throw loadError;
  const sourceRows = (queuedRows || []) as RecipientRow[];
  const claimed: RecipientRow[] = [];
  for (const row of sourceRows) {
    const id = asString(row.id) || "";
    if (!id) continue;
    const { data, error } = await supabaseAdmin
      .from("mail_campaign_recipients")
      .update({ status: "processing", processing_started_at: now, updated_at: now })
      .eq("id", id)
      .eq("status", "queued")
      .select(RECIPIENT_PROCESSING_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (data) claimed.push(data as RecipientRow);
  }
  return claimed;
}

async function claimQueuedRecipients(campaignId: string, limit: number) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.rpc("claim_mail_campaign_recipients", {
    p_campaign_id: campaignId,
    p_limit: Math.max(1, Math.min(20, limit)),
    p_now: now,
  });

  if (!error) return (data || []) as RecipientRow[];
  if (!isMissingClaimRpc(error)) throw error;
  return claimQueuedRecipientsFallback(campaignId, limit, now);
}

async function resolveCampaignAttachments(refs: MailAttachmentRef[]) {
  if (refs.length === 0) return [] as Array<{ filename: string; mimeType?: string; content: Buffer }>;
  return downloadMailAttachmentRefs(supabaseAdmin as any, refs);
}

async function markRecipientBlockedBySuppression(args: {
  recipientId: string;
  reason: "opt_out" | "blacklist" | "hard_bounce" | "complaint";
  message?: string;
}) {
  const now = new Date().toISOString();
  const message = args.message || `Envoi bloqué (${getSuppressionReasonLabel(args.reason)}).`;
  const patch: Record<string, unknown> = {
    status: "failed",
    suppression_reason: args.reason,
    processing_started_at: null,
    error: message,
    last_error: message,
    failure_kind: args.reason,
    failure_retryable: false,
    provider_status: null,
    updated_at: now,
  };
  if (args.reason === "hard_bounce") {
    patch.bounce_type = "hard";
    patch.bounced_at = now;
  }
  if (args.reason === "opt_out") patch.unsubscribed_at = now;
  const { error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .update(patch)
    .eq("id", args.recipientId)
    .eq("status", "processing");
  if (error) throw error;
}

async function requeueOrFailRecipient(
  recipientId: string,
  row: RecipientRow,
  message: string,
  opts?: {
    classification?: ReturnType<typeof classifyMailFailure>;
    normalized?: ReturnType<typeof normalizeMailDeliveryError> | null;
  },
) {
  const attemptCount = Math.max(1, asNumber(row.attempt_count, 1));
  const maxAttempts = Math.max(1, asNumber(row.max_attempts, DEFAULT_MAX_ATTEMPTS));
  const classification = opts?.classification || classifyMailFailure(message);
  const normalized = opts?.normalized || null;
  const failureKind = normalized?.kind || classification.kind;
  const retryable = Boolean(normalized?.retryable ?? classification.shouldRetry);
  const now = new Date().toISOString();

  if (retryable && attemptCount < maxAttempts) {
    const nextAttemptAt = new Date(Date.now() + retryDelayMs(attemptCount, normalized)).toISOString();
    const patch: Record<string, unknown> = {
      status: "queued",
      next_attempt_at: nextAttemptAt,
      processing_started_at: null,
      error: message,
      last_error: message,
      failure_kind: failureKind,
      failure_retryable: true,
      provider_status: normalized?.providerStatus ?? null,
      updated_at: now,
      bounce_type: classification.bounceType,
    };
    const { error } = await supabaseAdmin
      .from("mail_campaign_recipients")
      .update(patch)
      .eq("id", recipientId)
      .eq("status", "processing");

    if (error) throw error;
    return "queued" as const;
  }

  const patch: Record<string, unknown> = {
    status: "failed",
    processing_started_at: null,
    next_attempt_at: null,
    error: message,
    last_error: message,
    failure_kind: failureKind,
    failure_retryable: false,
    provider_status: normalized?.providerStatus ?? null,
    updated_at: now,
    bounce_type: classification.bounceType,
  };
  if (classification.bounceType) patch.bounced_at = now;
  if (classification.suppressionReason) patch.suppression_reason = classification.suppressionReason;

  const { error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .update(patch)
    .eq("id", recipientId)
    .eq("status", "processing");

  if (error) throw error;
  return "failed" as const;
}

async function requeueRecipientForProviderPause(args: {
  recipientId: string;
  row: RecipientRow;
  message: string;
  normalized: ReturnType<typeof normalizeMailDeliveryError>;
  delayMs: number;
}) {
  const now = new Date().toISOString();
  const nextAttemptAt = new Date(Date.now() + Math.max(60_000, args.delayMs)).toISOString();
  const attemptCount = Math.max(0, asNumber(args.row.attempt_count, 1) - 1);
  const { error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .update({
      status: "queued",
      attempt_count: attemptCount,
      next_attempt_at: nextAttemptAt,
      processing_started_at: null,
      error: args.message,
      last_error: args.message,
      failure_kind: args.normalized.kind,
      failure_retryable: true,
      provider_status: args.normalized.providerStatus ?? null,
      updated_at: now,
    })
    .eq("id", args.recipientId)
    .eq("status", "processing");

  if (error) throw error;
  return nextAttemptAt;
}

async function listRecentlyUpdatedCampaignIds(userId: string, integrationId: string, sinceIso: string) {
  const ids: string[] = [];
  let from = 0;

  while (true) {
    const to = from + RECENT_COUNT_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from("mail_campaigns")
      .select("id")
      .eq("user_id", userId)
      .eq("integration_id", integrationId)
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) throw error;
    const rows = (data || []) as Array<{ id?: string | null }>;
    ids.push(...rows.map((row) => String(row?.id || "")).filter(Boolean));
    if (rows.length < RECENT_COUNT_PAGE_SIZE) break;
    from += rows.length;
  }

  return Array.from(new Set(ids));
}

async function countSentRecipientsSince(args: { campaignIds: string[]; sinceIso: string }) {
  if (args.campaignIds.length === 0) return 0;
  let total = 0;

  for (const chunk of chunkArray(args.campaignIds, RECENT_COUNT_BATCH_SIZE)) {
    const { count, error } = await supabaseAdmin
      .from("mail_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", chunk)
      .eq("status", "sent")
      .gte("sent_at", args.sinceIso);

    if (error) throw error;
    total += count ?? 0;
  }

  return total;
}

async function findEarliestSentAtSince(args: { campaignIds: string[]; sinceIso: string }) {
  if (args.campaignIds.length === 0) return null;
  let earliest: string | null = null;

  for (const chunk of chunkArray(args.campaignIds, RECENT_COUNT_BATCH_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from("mail_campaign_recipients")
      .select("sent_at")
      .in("campaign_id", chunk)
      .eq("status", "sent")
      .gte("sent_at", args.sinceIso)
      .order("sent_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const sentAt = asString((data as any)?.sent_at);
    if (sentAt && (!earliest || sentAt < earliest)) earliest = sentAt;
  }

  return earliest;
}

function quotaResumeAt(args: {
  hourlyRemaining: number;
  dailyRemaining: number;
  earliestHour: string | null;
  earliestDay: string | null;
}) {
  const safetyMs = 10_000;
  if (args.dailyRemaining <= 0 && args.earliestDay) {
    return new Date(Date.parse(args.earliestDay) + 24 * 60 * 60_000 + safetyMs).toISOString();
  }
  if (args.hourlyRemaining <= 0 && args.earliestHour) {
    return new Date(Date.parse(args.earliestHour) + 60 * 60_000 + safetyMs).toISOString();
  }
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

async function countOtherProcessingCampaigns(args: { userId: string; integrationId: string; excludeCampaignId?: string | null }) {
  let query: any = supabaseAdmin
    .from("mail_campaigns")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .eq("integration_id", args.integrationId)
    .eq("status", "processing");

  if (args.excludeCampaignId) query = query.neq("id", args.excludeCampaignId);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function evaluateCampaignDispatchState(args: {
  userId: string;
  integrationId: string;
  currentCampaignId?: string | null;
  config?: MailCampaignDeliveryConfig;
}) {
  const config = args.config || getMailCampaignDeliveryConfig();
  const processingCount = await countOtherProcessingCampaigns({
    userId: args.userId,
    integrationId: args.integrationId,
    excludeCampaignId: args.currentCampaignId || null,
  });

  if (processingCount >= config.maxActivePerIntegration) {
    return {
      state: "waiting_turn" as const,
      reason: buildWaitingTurnMessage(),
      pauseReason: "waiting_turn",
      resumeAt: new Date(Date.now() + 60_000).toISOString(),
      batchSize: config.batchSize,
      hourlyLimit: config.hourlyLimit,
      dailyLimit: config.dailyLimit,
      maxActivePerIntegration: config.maxActivePerIntegration,
      sentLastHour: 0,
      sentLastDay: 0,
      hourlyRemaining: Math.max(0, config.hourlyLimit),
      dailyRemaining: Math.max(0, config.dailyLimit),
      availableNow: 0,
    } satisfies CampaignDispatchState;
  }

  const hourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentSince = hourAgoIso < dayAgoIso ? hourAgoIso : dayAgoIso;
  const campaignIds = await listRecentlyUpdatedCampaignIds(args.userId, args.integrationId, recentSince);

  const [sentLastHour, sentLastDay] = await Promise.all([
    countSentRecipientsSince({ campaignIds, sinceIso: hourAgoIso }),
    countSentRecipientsSince({ campaignIds, sinceIso: dayAgoIso }),
  ]);

  const hourlyRemaining = Math.max(0, config.hourlyLimit - sentLastHour);
  const dailyRemaining = Math.max(0, config.dailyLimit - sentLastDay);
  const availableNow = Math.max(0, Math.min(config.batchSize, providerBatchLimit(null), hourlyRemaining, dailyRemaining));

  if (availableNow <= 0) {
    const [earliestHour, earliestDay] = await Promise.all([
      hourlyRemaining <= 0 ? findEarliestSentAtSince({ campaignIds, sinceIso: hourAgoIso }) : Promise.resolve(null),
      dailyRemaining <= 0 ? findEarliestSentAtSince({ campaignIds, sinceIso: dayAgoIso }) : Promise.resolve(null),
    ]);
    const state: CampaignDispatchState = {
      state: "paused",
      reason: buildQuotaPauseMessage({
        hourlyLimit: config.hourlyLimit,
        dailyLimit: config.dailyLimit,
        sentLastHour,
        sentLastDay,
        hourlyRemaining,
        dailyRemaining,
      }),
      pauseReason: dailyRemaining <= 0 ? "daily_quota" : "hourly_quota",
      resumeAt: quotaResumeAt({ hourlyRemaining, dailyRemaining, earliestHour, earliestDay }),
      batchSize: config.batchSize,
      hourlyLimit: config.hourlyLimit,
      dailyLimit: config.dailyLimit,
      maxActivePerIntegration: config.maxActivePerIntegration,
      sentLastHour,
      sentLastDay,
      hourlyRemaining,
      dailyRemaining,
      availableNow,
    };
    return state;
  }

  const state: CampaignDispatchState = {
    state: "ready",
    reason: null,
    pauseReason: null,
    resumeAt: null,
    batchSize: config.batchSize,
    hourlyLimit: config.hourlyLimit,
    dailyLimit: config.dailyLimit,
    maxActivePerIntegration: config.maxActivePerIntegration,
    sentLastHour,
    sentLastDay,
    hourlyRemaining,
    dailyRemaining,
    availableNow,
  };
  return state;
}

async function markCampaignQueuedWaitingTurn(
  campaignId: string,
  reason?: string | null,
  resumeAt?: string | null,
) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("mail_campaigns")
    .update({
      status: "queued",
      finished_at: null,
      pause_reason: "waiting_turn",
      resume_at: resumeAt || new Date(Date.now() + 60_000).toISOString(),
      last_error: reason || buildWaitingTurnMessage(),
      updated_at: now,
      last_activity_at: now,
    })
    .eq("id", campaignId)
    .neq("status", "completed");
  if (error) throw error;
}

async function pauseCampaignForQuota(
  campaignId: string,
  reason: string,
  pauseReason: string,
  resumeAt: string | null,
) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("mail_campaigns")
    .update({
      status: "paused",
      finished_at: null,
      pause_reason: pauseReason,
      resume_at: resumeAt,
      last_error: reason,
      updated_at: now,
      last_activity_at: now,
    })
    .eq("id", campaignId)
    .neq("status", "completed");
  if (error) throw error;
}


type CampaignProcessSummary = {
  campaignsProcessed: number;
  recipientsProcessed: number;
  sent: number;
  failed: number;
  retried: number;
  paused: number;
  waiting: number;
  locked: number;
  premiumRestricted: number;
};

function emptyCampaignProcessSummary(): CampaignProcessSummary {
  return {
    campaignsProcessed: 0,
    recipientsProcessed: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    paused: 0,
    waiting: 0,
    locked: 0,
    premiumRestricted: 0,
  };
}

function mergeCampaignProcessSummary(target: CampaignProcessSummary, source: CampaignProcessSummary) {
  target.campaignsProcessed += source.campaignsProcessed;
  target.recipientsProcessed += source.recipientsProcessed;
  target.sent += source.sent;
  target.failed += source.failed;
  target.retried += source.retried;
  target.paused += source.paused;
  target.waiting += source.waiting;
  target.locked += source.locked;
  target.premiumRestricted += source.premiumRestricted;
}

async function beginRecipientAttempt(row: RecipientRow) {
  const recipientId = asString(row.id) || "";
  if (!recipientId) return null;
  const now = new Date().toISOString();
  const attemptCount = asNumber(row.attempt_count, 0) + 1;
  const { data, error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .update({
      attempt_count: attemptCount,
      processing_started_at: now,
      last_attempt_at: now,
      updated_at: now,
    })
    .eq("id", recipientId)
    .eq("status", "processing")
    .select(RECIPIENT_PROCESSING_SELECT)
    .maybeSingle();

  if (error) throw error;
  return data ? (data as RecipientRow) : null;
}

async function releaseClaimedRecipients(args: {
  recipientIds: string[];
  message: string;
  delayMs: number;
  failureKind?: string | null;
  failureRetryable?: boolean | null;
  providerStatus?: number | null;
}) {
  const ids = Array.from(new Set(args.recipientIds.filter(Boolean)));
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  const nextAttemptAt = new Date(Date.now() + Math.max(0, args.delayMs)).toISOString();
  const { data, error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .update({
      status: "queued",
      next_attempt_at: nextAttemptAt,
      processing_started_at: null,
      error: args.message,
      last_error: args.message,
      failure_kind: args.failureKind ?? null,
      failure_retryable: args.failureRetryable ?? null,
      provider_status: args.providerStatus ?? null,
      updated_at: now,
    })
    .in("id", ids)
    .eq("status", "processing")
    .select("id");

  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function deferReadyCampaignRecipients(campaignId: string, delayMs: number) {
  if (delayMs <= 0) return 0;
  const cooldownUntil = new Date(Date.now() + delayMs).toISOString();
  const { data, error } = await supabaseAdmin
    .from("mail_campaign_recipients")
    .update({
      next_attempt_at: cooldownUntil,
      updated_at: new Date().toISOString(),
    })
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .lte("next_attempt_at", cooldownUntil)
    .select("id");

  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function pauseCampaignForProviderIssue(args: {
  campaignId: string;
  reason: string;
  pauseReason: string;
  resumeAt: string | null;
}) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("mail_campaigns")
    .update({
      status: "paused",
      finished_at: null,
      pause_reason: args.pauseReason,
      resume_at: args.resumeAt,
      last_error: args.reason,
      updated_at: now,
      last_activity_at: now,
    })
    .eq("id", args.campaignId)
    .neq("status", "completed");
  if (error) throw error;
}

async function pauseCampaignForPremiumRestriction(campaignId: string, userId: string) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("mail_campaigns")
    .update({
      status: "paused",
      finished_at: null,
      pause_reason: "premium_required",
      resume_at: null,
      last_error: "Cette campagne est réservée à iNrCy Premium. Son contenu est conservé.",
      updated_at: now,
      last_activity_at: now,
    })
    .eq("id", campaignId)
    .eq("user_id", userId)
    .in("status", ["queued", "processing", "paused"]);
  if (error) throw error;
}

function providerPauseReason(normalized: ReturnType<typeof normalizeMailDeliveryError>) {
  if (normalized.kind === "auth_required") return "auth_required";
  if (normalized.kind === "permission_denied") return "permission_denied";
  if (normalized.kind === "account_blocked") return "account_blocked";
  if (normalized.kind === "configuration") return "configuration";
  if (normalized.kind === "rate_limited") return "rate_limited";
  if (normalized.kind === "quota_exceeded") return "provider_quota";
  if (normalized.kind === "provider_unavailable") return "provider_unavailable";
  return "provider_issue";
}

function shouldStopCurrentBatch(normalized: ReturnType<typeof normalizeMailDeliveryError>) {
  return (
    normalized.accountLevel ||
    normalized.kind === "rate_limited" ||
    normalized.kind === "quota_exceeded" ||
    normalized.kind === "provider_unavailable" ||
    (normalized.retryable && Number(normalized.providerStatus || 0) >= 500)
  );
}

function providerPauseDelayMs(normalized: ReturnType<typeof normalizeMailDeliveryError>) {
  if (normalized.retryAfterMs != null) return Math.max(60_000, normalized.retryAfterMs);
  if (normalized.kind === "rate_limited" || normalized.kind === "quota_exceeded") return 15 * 60_000;
  if (normalized.kind === "provider_unavailable") return 5 * 60_000;
  return 15 * 60_000;
}

async function persistAcceptedRecipient(args: {
  recipientId: string;
  providerMessageId?: string | null;
}) {
  const sentAt = new Date().toISOString();
  const fullPatch = {
    status: "sent",
    sent_at: sentAt,
    error: null,
    last_error: null,
    processing_started_at: null,
    provider_message_id: args.providerMessageId || null,
    updated_at: sentAt,
    bounce_type: null,
    bounced_at: null,
    suppression_reason: null,
    failure_kind: null,
    failure_retryable: null,
    provider_status: null,
    delivery_status: "accepted",
    delivery_event: "accepted",
    delivery_last_event_at: sentAt,
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabaseAdmin
      .from("mail_campaign_recipients")
      .update(fullPatch)
      .eq("id", args.recipientId)
      .eq("status", "processing");
    if (!error) return;
    lastError = error;
    await waitForNextCampaignRecipient(250 * (attempt + 1));
  }

  // Repli minimal : si une colonne de suivi optionnelle est momentanément
  // indisponible, on sécurise au moins le statut afin de ne jamais renvoyer
  // un message déjà accepté par le fournisseur.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabaseAdmin
      .from("mail_campaign_recipients")
      .update({
        status: "sent",
        sent_at: sentAt,
        processing_started_at: null,
        provider_message_id: args.providerMessageId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.recipientId)
      .eq("status", "processing");
    if (!error) return;
    lastError = error;
    await waitForNextCampaignRecipient(500 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error("Le fournisseur a accepté le mail, mais son statut n’a pas pu être enregistré.");
}

async function processSingleMailCampaign(args: {
  rawCampaign: unknown;
  config: MailCampaignDeliveryConfig;
  budgets: Record<"gmail" | "microsoft" | "imap", number>;
}): Promise<CampaignProcessSummary> {
  const summary = emptyCampaignProcessSummary();
  const campaign = asRecord(args.rawCampaign);
  const campaignId = asString(campaign.id) || "";
  const userId = asString(campaign.user_id) || "";
  const integrationId = asString(campaign.integration_id) || "";
  const provider = (asString(campaign.provider) || "imap").toLowerCase() as "gmail" | "microsoft" | "imap";
  if (!campaignId || !userId || !integrationId) return summary;

  const mailboxLock = await tryAcquireMailCampaignMailboxLock({
    integrationId,
    leaseSeconds: args.config.lockLeaseSeconds,
  });
  if (!mailboxLock) {
    summary.locked = 1;
    return summary;
  }

  try {
    await resetStaleProcessingRecipients(campaignId);

    const reputationPolicy = await resolveMailboxReputationPolicy({
      userId,
      integrationId,
      provider,
    });

    if (reputationPolicy.blocked) {
      await pauseCampaignForProviderIssue({
        campaignId,
        reason: reputationPolicy.blockedReason || "La boîte d’envoi doit être vérifiée avant de reprendre.",
        pauseReason: "mailbox_reputation_paused",
        resumeAt: reputationPolicy.resumeAt,
      });
      summary.paused = 1;
      return summary;
    }

    const campaignConfig = reputationPolicy.config;
    const dispatchState = await evaluateCampaignDispatchState({
      userId,
      integrationId,
      currentCampaignId: campaignId,
      config: campaignConfig,
    });

    if (dispatchState.state === "waiting_turn") {
      await markCampaignQueuedWaitingTurn(campaignId, dispatchState.reason, dispatchState.resumeAt);
      summary.waiting = 1;
      return summary;
    }

    if (dispatchState.state === "paused") {
      await pauseCampaignForQuota(
        campaignId,
        dispatchState.reason || buildQuotaPauseMessage(dispatchState),
        dispatchState.pauseReason || "quota",
        dispatchState.resumeAt,
      );
      summary.paused = 1;
      return summary;
    }

    const providerBudget = Math.max(1, Number(args.budgets[provider] ?? providerBatchLimit(provider)));
    const budget = Math.max(1, Math.min(dispatchState.availableNow, campaignConfig.batchSize, providerBudget, providerBatchLimit(provider)));
    const claimedRows = await claimQueuedRecipients(campaignId, budget);

    if (claimedRows.length === 0) {
      const counters = await refreshCampaignCounters(campaignId, campaignConfig);
      await maybeSendCampaignCompletionSummary(campaignId, counters);
      return summary;
    }

    summary.campaignsProcessed = 1;

    const suppressedByEmail = await fetchSuppressedEmailsByUser(
      userId,
      claimedRows.map((row) => asString(row.email) || ""),
    );

    const activityAt = new Date().toISOString();
    await supabaseAdmin
      .from("mail_campaigns")
      .update({
        status: "processing",
        started_at: activityAt,
        updated_at: activityAt,
        last_activity_at: activityAt,
        pause_reason: null,
        resume_at: null,
        last_error: null,
      })
      .eq("id", campaignId)
      .in("status", ["queued", "processing", "paused"]);

    let attachments: Array<{ filename: string; mimeType?: string; content: Buffer }> = [];
    try {
      attachments = await resolveCampaignAttachments(parseMailAttachmentRefs(campaign.attachments));
    } catch (attachmentError) {
      const message = attachmentError instanceof Error ? attachmentError.message : "Impossible de charger les pièces jointes.";
      const released = await releaseClaimedRecipients({
        recipientIds: claimedRows.map((row) => asString(row.id) || ""),
        message,
        delayMs: 5 * 60_000,
      });
      summary.retried += released;
      await pauseCampaignForProviderIssue({
        campaignId,
        reason: message,
        pauseReason: "attachment_unavailable",
        resumeAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      summary.paused += 1;
      const counters = await refreshCampaignCounters(campaignId, campaignConfig);
      await maybeSendCampaignCompletionSummary(campaignId, counters);
      return summary;
    }

    let stopBatch = false;

    for (let rowIndex = 0; rowIndex < claimedRows.length; rowIndex += 1) {
      const claimedRow = claimedRows[rowIndex];
      if (!claimedRow) continue;
      const recipientId = asString(claimedRow.id) || "";
      const email = asString(claimedRow.email) || "";
      if (!recipientId || !email) continue;

      const lockRenewed = await renewMailCampaignMailboxLock(mailboxLock);
      if (!lockRenewed) {
        const message = "La file d’envoi sécurisée a perdu son verrou. La campagne a été mise en pause sans poursuivre les envois.";
        const remainingIds = claimedRows.slice(rowIndex).map((row) => asString(row.id) || "");
        await releaseClaimedRecipients({ recipientIds: remainingIds, message, delayMs: 5 * 60_000 });
        await pauseCampaignForProviderIssue({
          campaignId,
          reason: message,
          pauseReason: "dispatch_lock_lost",
          resumeAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
        summary.paused += 1;
        stopBatch = true;
        break;
      }

      const suppressed = suppressedByEmail.get(String(email).toLowerCase());
      if (suppressed?.reason) {
        await markRecipientBlockedBySuppression({
          recipientId,
          reason: suppressed.reason,
          message: `Envoi bloqué (${getSuppressionReasonLabel(suppressed.reason)}).`,
        });
        summary.failed += 1;
        summary.recipientsProcessed += 1;
        continue;
      }

      // Recheck entitlement immediately before each delivery as a downgrade
      // may happen while a campaign batch already holds the mailbox lock.
      const currentEdition = await getDashboardEditionForAccountId(userId);
      if (!hasPremiumDashboardAccess(currentEdition)) {
        const remainingIds = claimedRows.slice(rowIndex).map((pendingRow) => asString(pendingRow.id) || "");
        await releaseClaimedRecipients({
          recipientIds: remainingIds,
          message: "Envoi suspendu : les campagnes sont réservées à iNrCy Premium.",
          delayMs: 0,
        });
        await pauseCampaignForPremiumRestriction(campaignId, userId);
        summary.paused += 1;
        summary.premiumRestricted += 1;
        stopBatch = true;
        break;
      }

      const row = await beginRecipientAttempt(claimedRow);
      if (!row) continue;

      const unsubscribeUrl = buildRecipientUnsubscribeUrl(campaignId, recipientId);
      const originalTextBody = asString(campaign.body_text) || "";
      const rawTextBody = stripTemplateSignatureBlock(originalTextBody);
      const rawHtmlBody = sanitizeRichMailHtml(asString(campaign.body_html) || "");
      const textBody = rawTextBody;
      const htmlWasLikelyBuiltFromTemplate = originalTextBody.trim() !== rawTextBody.trim();
      const htmlBody = htmlWasLikelyBuiltFromTemplate || !rawHtmlBody.trim() ? textToSimpleHtml(rawTextBody) : rawHtmlBody;

      let providerWasCalled = false;
      let sendResult: Awaited<ReturnType<typeof sendMailFromIntegration>> | null = null;
      try {
        providerWasCalled = true;
        sendResult = await sendMailFromIntegration({
          userId,
          accountId: integrationId,
          to: email,
          subject: normalizeMailSubject(asString(campaign.subject) || "(sans objet)"),
          text: textBody,
          html: htmlBody || undefined,
          unsubscribeUrl,
          attachments,
        });
      } catch (sendError) {
        const normalized = normalizeMailDeliveryError(sendError, provider);
        const message = normalized.message;
        const classification = classifyMailFailure(normalized.rawMessage || message);
        const reputationOutcome = normalized.kind === "invalid_recipient" || classification.kind === "hard_bounce"
          ? "hard_bounce"
          : normalized.kind === "account_blocked"
            ? "account_blocked"
            : "temporary_failure";
        await recordMailboxReputationOutcome({
          integrationId,
          userId,
          provider,
          accountEmail: reputationPolicy.accountEmail,
          outcome: reputationOutcome,
          errorKind: normalized.kind,
        }).catch((error) => console.warn("[crmCampaigns] reputation failure tracking skipped", error));

        if (normalized.accountLevel && !normalized.retryable) {
          const remainingIds = claimedRows.slice(rowIndex).map((pendingRow) => asString(pendingRow.id) || "");
          const released = await releaseClaimedRecipients({
            recipientIds: remainingIds,
            message,
            delayMs: 0,
            failureKind: normalized.kind,
            failureRetryable: false,
            providerStatus: normalized.providerStatus ?? null,
          });
          await pauseCampaignForProviderIssue({
            campaignId,
            reason: message,
            pauseReason: providerPauseReason(normalized),
            resumeAt: null,
          });
          summary.retried += released;
          summary.paused += 1;
          stopBatch = true;
          break;
        }

        if (shouldStopCurrentBatch(normalized)) {
          const delayMs = providerPauseDelayMs(normalized);
          await requeueRecipientForProviderPause({
            recipientId,
            row,
            message,
            normalized,
            delayMs,
          });
          summary.retried += 1;
          summary.recipientsProcessed += 1;

          const remainingIds = claimedRows.slice(rowIndex + 1).map((pendingRow) => asString(pendingRow.id) || "");
          await releaseClaimedRecipients({
            recipientIds: remainingIds,
            message,
            delayMs,
            failureKind: normalized.kind,
            failureRetryable: true,
            providerStatus: normalized.providerStatus ?? null,
          });
          await pauseCampaignForProviderIssue({
            campaignId,
            reason: message,
            pauseReason: providerPauseReason(normalized),
            resumeAt: new Date(Date.now() + delayMs).toISOString(),
          });
          summary.paused += 1;
          stopBatch = true;
          break;
        }

        if (classification.shouldSuppress && classification.suppressionReason) {
          await upsertSuppressionEntry({
            user_id: userId,
            email,
            reason: classification.suppressionReason,
            source: classification.kind === "complaint" ? "delivery_feedback" : "delivery_bounce",
            campaign_id: campaignId,
            recipient_id: recipientId,
            note: message.slice(0, 500),
          });
        }

        const result = await requeueOrFailRecipient(recipientId, row, message, { classification, normalized });
        await supabaseAdmin
          .from("mail_campaigns")
          .update({ last_error: message, updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
          .eq("id", campaignId);
        if (result === "failed") summary.failed += 1;
        else summary.retried += 1;
        summary.recipientsProcessed += 1;
      }

      if (sendResult) {
        try {
          await persistAcceptedRecipient({
            recipientId,
            providerMessageId: sendResult.providerMessageId || null,
          });
          await recordMailboxReputationOutcome({
            integrationId,
            userId,
            provider,
            accountEmail: reputationPolicy.accountEmail,
            outcome: "accepted",
          }).catch((error) => console.warn("[crmCampaigns] reputation success tracking skipped", error));
          summary.sent += 1;
          summary.recipientsProcessed += 1;
        } catch (persistError) {
          const detail = persistError instanceof Error ? persistError.message : String(persistError || "");
          const message = `Le fournisseur a accepté le mail destiné à ${email}, mais iNr’Send n’a pas pu enregistrer son statut. La campagne est mise en pause pour éviter tout doublon.${detail ? ` (${detail})` : ""}`;
          const remainingIds = claimedRows.slice(rowIndex + 1).map((pendingRow) => asString(pendingRow.id) || "");
          await releaseClaimedRecipients({
            recipientIds: remainingIds,
            message,
            delayMs: 15 * 60_000,
          });
          await pauseCampaignForProviderIssue({
            campaignId,
            reason: message,
            pauseReason: "persistence_guard",
            resumeAt: null,
          });
          summary.sent += 1;
          summary.recipientsProcessed += 1;
          summary.paused += 1;
          stopBatch = true;
          break;
        }
      }

      if (providerWasCalled && !stopBatch && rowIndex < claimedRows.length - 1) {
        await waitForNextCampaignRecipient(campaignConfig.sendDelayMs);
      }
    }

    if (!stopBatch) {
      await deferReadyCampaignRecipients(campaignId, campaignConfig.batchPauseMs);
    }

    const counters = await refreshCampaignCounters(campaignId, campaignConfig);
    await maybeSendCampaignCompletionSummary(campaignId, counters);

    if (counters.sentCount > 0) {
      try {
        await awardWeeklyFeatureUseForCampaign({
          userId,
          campaignId,
          trackKind: asString(campaign.track_kind),
          trackType: asString(campaign.track_type),
          folder: asString(campaign.folder),
          sentCount: counters.sentCount,
        });
      } catch {
        // Le crédit UI ne doit jamais bloquer l'envoi de la campagne.
      }
    }

    return summary;
  } finally {
    await releaseMailCampaignMailboxLock(mailboxLock);
  }
}

export async function processPendingMailCampaigns(opts?: {
  campaignIds?: string[];
  maxCampaigns?: number;
  perProviderBudget?: Partial<Record<"gmail" | "microsoft" | "imap", number>>;
}) {
  const maxCampaigns = Math.max(1, Math.min(20, Number(opts?.maxCampaigns || 10)));
  const campaignIds = Array.isArray(opts?.campaignIds) ? opts.campaignIds.filter(Boolean) : [];

  const nowIso = new Date().toISOString();
  const { data: campaigns, error } = await runTransientPostgrestRead<Record<string, unknown>[]>(() => {
    let query = supabaseAdmin
      .from("mail_campaigns")
      .select("id,user_id,integration_id,provider,type,subject,body_text,body_html,attachments,status,folder,track_kind,track_type,pause_reason,resume_at")
      .or(`status.in.(queued,processing),and(status.eq.paused,resume_at.not.is.null,resume_at.lte.${nowIso})`)
      .order("created_at", { ascending: true })
      .limit(maxCampaigns);

    if (campaignIds.length > 0) query = query.in("id", campaignIds);
    return query;
  });
  if (error) throw error;

  const candidateRows = campaigns || [];
  const candidateUserIds = Array.from(new Set(
    candidateRows
      .map((rawCampaign) => (asString(asRecord(rawCampaign).user_id) || "").trim())
      .filter(Boolean),
  ));
  const editionByUser = new Map<string, "standard" | "premium" | "founder">(
    candidateUserIds.map((userId) => [userId, "standard"]),
  );
  try {
    for (let offset = 0; offset < candidateUserIds.length; offset += 100) {
      const batch = await getDashboardEditionsForAccountIds(candidateUserIds.slice(offset, offset + 100));
      for (const [userId, edition] of batch) editionByUser.set(userId, edition);
    }
  } catch (editionError) {
    // If entitlement resolution fails, do not send a single Premium campaign.
    for (const userId of candidateUserIds) editionByUser.set(userId, "standard");
    console.error("[crmCampaigns] edition lookup failed; Premium campaigns remain blocked", editionError);
  }

  const premiumCampaigns: Record<string, unknown>[] = [];
  const restrictedCampaigns: Array<{ id: string; userId: string }> = [];
  for (const rawCampaign of candidateRows) {
    const campaign = asRecord(rawCampaign);
    const campaignId = asString(campaign.id) || "";
    const userId = (asString(campaign.user_id) || "").trim();
    if (!campaignId || !userId) continue;
    if (hasPremiumDashboardAccess(editionByUser.get(userId) || "standard")) {
      premiumCampaigns.push(campaign);
    } else {
      restrictedCampaigns.push({ id: campaignId, userId });
    }
  }

  // Stop pending sends on downgraded accounts while preserving campaign
  // content. They can review and resume them after Premium access is restored.
  const restrictionResults = await Promise.allSettled(
    restrictedCampaigns.map(({ id, userId }) => pauseCampaignForPremiumRestriction(id, userId)),
  );

  const config = getMailCampaignDeliveryConfig();
  const budgets: Record<"gmail" | "microsoft" | "imap", number> = {
    gmail: opts?.perProviderBudget?.gmail ?? config.batchSize,
    microsoft: opts?.perProviderBudget?.microsoft ?? config.batchSize,
    imap: opts?.perProviderBudget?.imap ?? config.batchSize,
  };

  const settled = await Promise.allSettled(
    premiumCampaigns.map((rawCampaign) => processSingleMailCampaign({ rawCampaign, config, budgets })),
  );

  const summary = emptyCampaignProcessSummary();
  summary.premiumRestricted = restrictedCampaigns.length;
  const errors: unknown[] = restrictionResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  for (const result of settled) {
    if (result.status === "fulfilled") mergeCampaignProcessSummary(summary, result.value);
    else errors.push(result.reason);
  }

  if (errors.length > 0 && summary.campaignsProcessed === 0 && summary.locked === 0) {
    throw errors[0];
  }
  for (const errorItem of errors) {
    console.error("[crmCampaigns] isolated campaign processing failed", errorItem);
  }

  return summary;
}

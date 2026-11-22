import type { MailCampaignDeliveryConfig } from "@/lib/mailCampaignPacing";
import { getOutlookTransferIntervalMs, OUTLOOK_WINDOW_BYTES } from "./outlookMailTransferPacing.ts";

export type CampaignReportCounts = {
  total: number;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
  accepted: number;
  delivered: number;
  softBounce: number;
  hardBounce: number;
  unsubscribed: number;
  blacklist: number;
  complaint: number;
  blocked: number;
  retryable: number;
};

export type MailCampaignExperienceReport = {
  campaignId: string;
  status: string;
  progressPercent: number;
  counts: CampaignReportCounts;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  estimatedCompletionAt: string | null;
  estimatedRemainingMs: number | null;
  elapsedMs: number | null;
  durationMs: number | null;
  pacing: {
    batchSize: number;
    delayMs: number;
    batchPauseMs: number;
    hourlyLimit: number;
    dailyLimit: number;
  };
  completionEmail: {
    status: string;
    attempts: number;
    sentAt: string | null;
    lastError: string | null;
  };
  generatedAt: string;
};

type RecipientLike = {
  status?: unknown;
  delivery_status?: unknown;
  suppression_reason?: unknown;
  bounce_type?: unknown;
  failure_kind?: unknown;
  failure_retryable?: unknown;
  unsubscribed_at?: unknown;
};

type CampaignLike = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateValue(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function aggregateCampaignRecipientReport(
  recipients: RecipientLike[],
  declaredTotal = 0,
): CampaignReportCounts {
  let queued = 0;
  let processing = 0;
  let sent = 0;
  let failed = 0;
  let delivered = 0;
  let softBounce = 0;
  let hardBounce = 0;
  let unsubscribed = 0;
  let blacklist = 0;
  let complaint = 0;
  let blocked = 0;
  let retryable = 0;

  for (const recipient of recipients) {
    const status = normalized(recipient.status);
    const deliveryStatus = normalized(recipient.delivery_status);
    const suppressionReason = normalized(recipient.suppression_reason);
    const bounceType = normalized(recipient.bounce_type);
    const failureKind = normalized(recipient.failure_kind);

    if (status === "queued") queued += 1;
    else if (status === "processing") processing += 1;
    else if (status === "sent") sent += 1;
    else if (status === "failed") failed += 1;

    if (deliveryStatus === "delivered") delivered += 1;
    if (bounceType === "soft") softBounce += 1;
    if (
      bounceType === "hard" ||
      suppressionReason === "hard_bounce" ||
      failureKind === "hard_bounce" ||
      failureKind === "invalid_recipient"
    ) {
      hardBounce += 1;
    }
    if (recipient.unsubscribed_at || suppressionReason === "opt_out") {
      unsubscribed += 1;
    }
    if (suppressionReason === "blacklist") blacklist += 1;
    if (suppressionReason === "complaint") complaint += 1;
    if (suppressionReason) blocked += 1;
    if (status === "failed" && !suppressionReason && bounceType !== "hard" && recipient.failure_retryable !== false) {
      retryable += 1;
    }
  }

  const observedTotal = recipients.length;
  const total = Math.max(observedTotal, Math.max(0, Math.floor(numberValue(declaredTotal))));

  return {
    total,
    queued,
    processing,
    sent,
    failed,
    accepted: sent,
    delivered,
    softBounce,
    hardBounce,
    unsubscribed,
    blacklist,
    complaint,
    blocked,
    retryable,
  };
}

// Signatures, unsubscribe links and the final recipient are composed at dispatch.
// Estimate the Graph payload from the stored fields, without loading binary files.
function estimateOutlookInterval(campaign: CampaignLike): number | null {
  if (typeof campaign.body_html !== "string" && typeof campaign.body_text !== "string") return null;
  const files = campaign.attachments === null ? [] : campaign.attachments;
  if (!Array.isArray(files)) return null;
  const attachments = [];
  let base64Bytes = 0;
  for (const file of files) {
    if (!file || typeof file.path !== "string" || !file.path || typeof file.bucket !== "string" || !file.bucket) return null;
    const size = typeof file.size === "string" && /^\d+$/.test(file.size) ? Number(file.size) : file.size;
    if (!Number.isSafeInteger(size) || size <= 0) return null;
    base64Bytes += 4 * Math.ceil(size / 3);
    attachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: file.name || file.path.split("/").pop(),
      contentType: file.type || "application/octet-stream",
      contentBytes: "",
    });
  }
  const envelope = JSON.stringify({
    message: {
      subject: campaign.subject || "",
      body: { contentType: "HTML", content: campaign.body_html || campaign.body_text || "" },
      toRecipients: [{ emailAddress: { address: "" } }],
      ...(attachments.length ? { attachments } : {}),
    },
    saveToSentItems: true,
  });
  const bytes = Buffer.byteLength(envelope, "utf8") + base64Bytes;
  return bytes <= OUTLOOK_WINDOW_BYTES ? getOutlookTransferIntervalMs(bytes) : null;
}

export function estimateCampaignDurationMs(args: {
  remaining: number;
  config: MailCampaignDeliveryConfig;
  campaign?: CampaignLike;
  resumeAt?: string | null;
  nowMs?: number;
}) {
  const remaining = Math.max(0, Math.floor(numberValue(args.remaining)));
  if (remaining === 0) return 0;

  const batchSize = Math.max(1, Math.floor(numberValue(args.config.batchSize, 1)));
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const resumeMs = args.resumeAt ? Date.parse(args.resumeAt) : NaN;
  const initialWait = Number.isFinite(resumeMs) ? Math.max(0, resumeMs - nowMs) : 0;
  if (args.campaign && normalized(args.campaign.provider) === "microsoft") {
    const interval = estimateOutlookInterval(args.campaign);
    if (interval === null) return null;
    // Outlook uses the shared transfer budget and the per-minute cron's batch
    // limit. Both constrain dispatch; the first recipient can start immediately.
    const gaps = remaining - 1;
    const cronBatchesMs = Math.floor(gaps / batchSize) * 60_000 + (gaps % batchSize) * interval;
    return initialWait + Math.max(gaps * interval, cronBatchesMs);
  }
  const delayMs = Math.max(0, numberValue(args.config.sendDelayMs));
  const pauseMs = Math.max(0, numberValue(args.config.batchPauseMs));
  const batches = Math.ceil(remaining / batchSize);
  const withinBatchDelays = Math.max(0, remaining - batches) * delayMs;
  const betweenBatchPauses = Math.max(0, batches - 1) * pauseMs;
  return initialWait + withinBatchDelays + betweenBatchPauses;
}

export function buildMailCampaignExperienceReport(args: {
  campaign: CampaignLike;
  recipients: RecipientLike[];
  config: MailCampaignDeliveryConfig;
  now?: Date;
}): MailCampaignExperienceReport {
  const now = args.now || new Date();
  const generatedAt = now.toISOString();
  const campaignId = String(args.campaign.id || "").trim();
  const status = normalized(args.campaign.status) || "queued";
  const counts = aggregateCampaignRecipientReport(
    args.recipients,
    numberValue(args.campaign.total_count),
  );
  const terminal = status === "completed" || status === "partial" || status === "failed";
  const completed = Math.min(counts.total, counts.sent + counts.failed);
  const progressPercent = counts.total > 0
    ? Math.max(0, Math.min(100, Math.round((completed / counts.total) * 100)))
    : terminal
      ? 100
      : 0;
  const remaining = Math.max(0, counts.queued + counts.processing);
  const estimatedRemainingMs = terminal
    ? 0
    : estimateCampaignDurationMs({
        remaining,
        config: args.config,
        campaign: args.campaign,
        resumeAt: dateValue(args.campaign.resume_at),
        nowMs: now.getTime(),
      });
  const estimatedCompletionAt = terminal
    ? dateValue(args.campaign.finished_at)
    : estimatedRemainingMs === null ? null : new Date(now.getTime() + estimatedRemainingMs).toISOString();
  const createdAt = dateValue(args.campaign.created_at);
  const startedAt = dateValue(args.campaign.started_at);
  const finishedAt = dateValue(args.campaign.finished_at);
  const lastActivityAt = dateValue(args.campaign.last_activity_at || args.campaign.updated_at);
  const elapsedStart = startedAt || createdAt;
  const elapsedEnd = finishedAt || generatedAt;
  const elapsedMs = elapsedStart ? Math.max(0, Date.parse(elapsedEnd) - Date.parse(elapsedStart)) : null;
  const durationMs = terminal && elapsedStart && finishedAt
    ? Math.max(0, Date.parse(finishedAt) - Date.parse(elapsedStart))
    : null;

  return {
    campaignId,
    status,
    progressPercent,
    counts,
    createdAt,
    startedAt,
    finishedAt,
    lastActivityAt,
    estimatedCompletionAt,
    estimatedRemainingMs,
    elapsedMs,
    durationMs,
    pacing: {
      batchSize: args.config.batchSize,
      delayMs: args.config.sendDelayMs,
      batchPauseMs: args.config.batchPauseMs,
      hourlyLimit: args.config.hourlyLimit,
      dailyLimit: args.config.dailyLimit,
    },
    completionEmail: {
      status: normalized(args.campaign.completion_email_status) || "pending",
      attempts: Math.max(0, Math.floor(numberValue(args.campaign.completion_email_attempts))),
      sentAt: dateValue(args.campaign.completion_email_sent_at),
      lastError: String(args.campaign.completion_email_last_error || "").trim() || null,
    },
    generatedAt,
  };
}

type JsonRecord = Record<string, unknown>;
type CampaignCopyKey =
  | "campaign_pause_mailbox_protection" | "campaign_pause_account_blocked"
  | "campaign_pause_reconnect" | "campaign_pause_quota" | "campaign_pause_provider_limit"
  | "campaign_pause_mailbox_missing"
  | "campaign_pause_waiting_turn" | "campaign_pause_generic" | "campaign_pause_resume_at"
  | "campaign_resume_failed" | "campaign_requeued";
type Translate = (key: CampaignCopyKey, values?: { date: string }) => string;

const REASON_COPY: Readonly<Record<string, CampaignCopyKey>> = {
  mailbox_reputation_paused: "campaign_pause_mailbox_protection",
  account_blocked: "campaign_pause_account_blocked",
  auth_required: "campaign_pause_reconnect",
  permission_denied: "campaign_pause_reconnect",
  mailbox_missing: "campaign_pause_mailbox_missing",
  mailbox_reconnect_required: "campaign_pause_reconnect",
  mailbox_configuration_required: "campaign_pause_reconnect",
  hourly_quota: "campaign_pause_quota",
  daily_quota: "campaign_pause_quota",
  quota_exceeded: "campaign_pause_quota",
  rate_limited: "campaign_pause_provider_limit",
  provider_quota: "campaign_pause_provider_limit",
  provider_unavailable: "campaign_pause_generic",
  provider_issue: "campaign_pause_generic",
  waiting_turn: "campaign_pause_waiting_turn",
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

/** Only registered business codes determine copy; SQL, provider text and tokens never render. */
export function getMailCampaignReasonKey(value: unknown): CampaignCopyKey | null {
  const data = record(value);
  for (const input of [data.reasonCode, data.pauseReason, data.pause_reason, data.failure_kind, data.failureKind, data.code]) {
    const key = String(input || "").trim().toLowerCase();
    if (Object.hasOwn(REASON_COPY, key)) return REASON_COPY[key];
  }
  if (data.distributionState === "waiting_turn") return REASON_COPY.waiting_turn;
  return [data.status, data.campaignStatus, data.distributionState].some((status) => status === "paused")
    ? "campaign_pause_generic" : null;
}

export function formatMailCampaignReason(value: unknown, translate: Translate, locale: string, now = Date.now()): string {
  const key = getMailCampaignReasonKey(value);
  if (!key) return "";
  return [translate(key), formatMailCampaignResumeTime(value, translate, locale, now)].filter(Boolean).join(" ");
}

export function formatMailCampaignResumeTime(value: unknown, translate: Translate, locale: string, now = Date.now()): string {
  const data = record(value);
  const time = Date.parse(String(data.resumeAt || data.resume_at || ""));
  const date = Number.isFinite(time) && time > now
    ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(time)) : "";
  return date ? translate("campaign_pause_resume_at", { date }) : "";
}

/** A processed resume request can remain paused or waiting; queued never means sent. */
export function formatMailCampaignRetryResult(value: unknown, translate: Translate, locale: string): string {
  const data = record(value);
  if (data.distributionState === "waiting_turn" || data.pauseReason === "waiting_turn" || data.reasonCode === "waiting_turn") {
    return formatMailCampaignReason({ ...data, reasonCode: "waiting_turn" }, translate, locale);
  }
  if (data.campaignStatus === "paused" || data.distributionState === "paused") {
    return formatMailCampaignReason({ ...data, status: "paused" }, translate, locale);
  }
  return data.success === true && data.campaignStatus === "queued" && data.queuedForBackgroundDispatch === true
    ? translate("campaign_requeued") : translate("campaign_resume_failed");
}

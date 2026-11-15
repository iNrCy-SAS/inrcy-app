import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { optionalEnv } from "@/lib/env";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { projectNotificationForEdition } from "@/lib/notificationEditionPolicy";
import { readNotificationPreferences, type NotificationRow } from "@/lib/notifications";
import { buildNotificationDigestEmail } from "@/lib/notificationDigestEmail";
import { getInrcyLogoInlineAttachments } from "@/lib/txEmailAssets";
import { sendTxMail } from "@/lib/txMailer";

type DigestDelivery = {
  id: string;
  user_id: string;
  delivery_key: string;
  notification_ids: string[];
  lease_token: string;
  lease_expires_at: string;
  attempt_count: number;
};
type DeliveryOutcome = { id: string; status: "sent" | "deferred" | "uncertain" | "skipped"; reason: string };
const SELECT_NOTICE = "id,user_id,category,kind,title,body,cta_label,cta_url,read_at,meta,dedupe_key,created_at";

/** The database trigger queues only newly inserted notifications bearing this marker. */
export function buildNotificationDigestDeliveryKey(accountId: string, windowKey: string) {
  return `v1:${createHash("sha256").update([accountId, windowKey].join("\n")).digest("hex")}`;
}

function errorCode(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code || "DIGEST_DELIVERY_FAILED");
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : "DIGEST_DELIVERY_FAILED";
}

function failureOutcome(error: unknown, sendStarted: boolean) {
  const failure = error as { code?: unknown; command?: unknown; responseCode?: unknown; deliveryState?: unknown; retryAt?: unknown } | null;
  const code = errorCode(error);
  const command = String(failure?.command || "").trim().toUpperCase();
  const beforeData = /^(?:AUTH|MAIL FROM|RCPT TO)(?:\b|$)/.test(command) &&
    (code === "EAUTH" || Number(failure?.responseCode) >= 400);
  const definitelyNotAccepted = !sendStarted || beforeData ||
    ["TX_MAIL_FALLBACK_DEFERRED", "TX_SMTP_AUTH_BACKOFF", "TX_SMTP_CONFIGURATION_UNAVAILABLE"].includes(code) ||
    (!command && code === "EAUTH") || failure?.deliveryState === "rejected";
  const retry = typeof failure?.retryAt === "string" ? Date.parse(failure.retryAt) : NaN;
  const retryAt = new Date(Number.isFinite(retry) && retry > Date.now() ? retry : Date.now() + 60 * 60 * 1000).toISOString();
  return { status: definitelyNotAccepted ? "deferred" as const : "uncertain" as const, retryAt, code };
}

async function finish(row: DigestDelivery, status: DeliveryOutcome["status"], reason: string, patch: Record<string, unknown> = {}) {
  const { data, error } = await supabaseAdmin.from("notification_digest_deliveries")
    .update({ status, reason_code: reason, lease_token: null, lease_expires_at: null, updated_at: new Date().toISOString(), ...patch })
    .eq("id", row.id).eq("user_id", row.user_id).eq("lease_token", row.lease_token).eq("status", "sending")
    .select("id").maybeSingle();
  if (error || !data) throw new Error("DIGEST_DELIVERY_STATE_UNCONFIRMED");
  return { id: row.id, status, reason };
}

async function deliver(row: DigestDelivery, deadlineAt: number): Promise<DeliveryOutcome> {
  let sendStarted = false;
  try {
    const [profileResult, noticesResult, attachments] = await Promise.all([
      supabaseAdmin.from("profiles").select("contact_email,first_name,company_legal_name,last_active_at").eq("user_id", row.user_id).maybeSingle(),
      supabaseAdmin.from("notifications").select(SELECT_NOTICE).eq("user_id", row.user_id).in("id", row.notification_ids).is("read_at", null),
      getInrcyLogoInlineAttachments(),
    ]);
    if (profileResult.error || noticesResult.error) throw new Error("DIGEST_PREFLIGHT_UNAVAILABLE");
    if (!profileResult.data?.last_active_at) return await finish(row, "skipped", "account_not_activated");
    const profile = profileResult.data;
    let recipient = String(profile?.contact_email || "").trim();
    if (!recipient) {
      const { data: owner, error } = await supabaseAdmin.from("inrcy_account_members").select("auth_user_id")
        .eq("account_id", row.user_id).eq("role", "owner").limit(1).maybeSingle();
      if (error) throw new Error("DIGEST_RECIPIENT_UNAVAILABLE");
      const { data, error: authError } = await supabaseAdmin.auth.admin.getUserById(owner?.auth_user_id || row.user_id);
      if (authError) throw new Error("DIGEST_RECIPIENT_UNAVAILABLE");
      recipient = String(data?.user?.email || "").trim();
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("DIGEST_RECIPIENT_UNAVAILABLE");

    // Resolve current preferences and rights after recipient/asset lookups,
    // so a queued digest is never sent using its original subscription snapshot.
    const [{ preferences }, active, edition] = await Promise.all([
      readNotificationPreferences(row.user_id), getActiveSubscriptionAccountIds([row.user_id]), getDashboardEditionForAccountId(row.user_id, { strict: true }),
    ]);
    if (!active.has(row.user_id)) return await finish(row, "skipped", "subscription_inactive");
    if (preferences.email_enabled === false) return await finish(row, "skipped", "email_disabled");
    const items = ((noticesResult.data ?? []) as NotificationRow[]).flatMap(notice => {
      const enabled = notice.category === "performance" ? preferences.performance_enabled
        : notice.category === "action" ? preferences.action_enabled : preferences.information_enabled;
      if (enabled === false) return [];
      const projected = projectNotificationForEdition(notice, edition);
      return projected ? [projected] : [];
    });
    if (!items.length) return await finish(row, "skipped", "no_current_eligible_items");
    const dashboardUrl = `${optionalEnv("NEXT_PUBLIC_SITE_URL", "https://app.inrcy.com").replace(/\/$/, "")}/dashboard`;
    const content = buildNotificationDigestEmail({ firstName: profile?.first_name, companyName: profile?.company_legal_name, items, dashboardUrl });

    // The claim freezes its IDs. Verify ownership and enough remaining lease
    // immediately before SMTP, after all potentially slow reads and rendering.
    const { data: lease, error: leaseError } = await supabaseAdmin.from("notification_digest_deliveries")
      .select("id").eq("id", row.id).eq("user_id", row.user_id).eq("lease_token", row.lease_token).eq("status", "sending")
      .gt("lease_expires_at", new Date(Date.now() + 60_000).toISOString()).maybeSingle();
    if (leaseError) throw new Error("DIGEST_LEASE_UNAVAILABLE");
    if (!lease) return { id: row.id, status: "uncertain", reason: "lease_not_current" };

    sendStarted = true;
    const receipt = await sendTxMail({
      to: recipient, ...content, attachments, fallbackPolicy: "defer",
      deadlineAt,
      messageId: `<notification-digest-${row.id}@inrcy.com>`, idempotencyKey: row.delivery_key,
    });
    if (!Array.isArray(receipt.accepted) || !receipt.accepted.some(address => String(address).toLowerCase() === recipient.toLowerCase())) {
      return await finish(row, "uncertain", "acceptance_unconfirmed", { last_error_code: "DIGEST_ACCEPTANCE_UNCONFIRMED" });
    }
    return await finish(row, "sent", "accepted", { provider_message_id: String(receipt.messageId || "").slice(0, 256), sent_at: new Date().toISOString(), last_error_code: null });
  } catch (error) {
    const outcome = failureOutcome(error, sendStarted);
    return finish(row, outcome.status, outcome.status === "deferred" ? "not_accepted_retry_later" : "acceptance_unknown", {
      retry_at: outcome.retryAt, last_error_code: outcome.code,
    });
  }
}

/** At most one SMTP lease is held per worker; crashed sending rows are never reclaimed. */
export async function drainNotificationDigests(limit = 25) {
  const started = Date.now();
  const results: DeliveryOutcome[] = [];
  const bounded = Math.max(1, Math.min(50, Math.trunc(limit) || 25));
  for (let index = 0; index < bounded && Date.now() - started < 90_000; index++) {
    const { data, error } = await supabaseAdmin.rpc("inrcy_claim_notification_digest_deliveries", { p_limit: 1, p_lease_seconds: 180 });
    if (error) throw new Error("DIGEST_QUEUE_CLAIM_UNAVAILABLE");
    const row = (Array.isArray(data) ? data[0] : null) as DigestDelivery | null;
    if (!row) break;
    results.push(await deliver(row, started + 90_000));
  }
  return { processed: results.length, sent: results.filter(row => row.status === "sent").length,
    deferred: results.filter(row => row.status === "deferred").length,
    uncertain: results.filter(row => row.status === "uncertain").length,
    skipped: results.filter(row => row.status === "skipped").length, results };
}

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { decryptSecret } from "@/lib/imapCrypto";
import { withImap, type ImapConfig } from "@/lib/imapClient";
import { parseDeliveryFeedback } from "@/lib/mailBounceParser";
import { processMailWebhookEvent, type NormalizedMailWebhookEvent } from "@/lib/mailProviderWebhook";
import type { MailboxProvider } from "@/lib/mailboxReputation";

type IntegrationRow = {
  id: string;
  user_id: string;
  provider: string;
  account_email: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  settings: Record<string, unknown> | null;
};

type ScanResult = {
  accounts: number;
  scanned: number;
  feedback: number;
  updated: number;
  skipped: number;
  errors: number;
};

type MicrosoftInboxMessage = {
  id?: unknown;
  internetMessageId?: unknown;
  receivedDateTime?: unknown;
  subject?: unknown;
  from?: {
    emailAddress?: {
      address?: unknown;
    } | null;
  } | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

const MAILBOX_SCAN_FAILURE_THRESHOLD = 3;
const MAILBOX_SCAN_PAUSE_MS = 6 * 60 * 60_000;

function compactScannerError(error: unknown) {
  const candidate = asRecord(error);
  const details = [
    error instanceof Error ? error.message : error,
    candidate.code,
    candidate.responseStatus,
    candidate.serverResponseCode,
    candidate.responseText,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return (Array.from(new Set(details)).join(" | ") || "Erreur inconnue")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function isMailboxAuthenticationFailure(error: unknown) {
  return /authenticationfailed|authentication failed|authorizationfailed|authorization failed|invalid credentials|invalid login|login failed|bad credentials|mot de passe incorrect/i.test(
    compactScannerError(error),
  );
}

function mailboxScannerErrorCode(error: unknown) {
  const candidate = asRecord(error);
  const raw = String(
    candidate.code || candidate.serverResponseCode || candidate.responseStatus || "mailbox_scan_failed",
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return raw || "mailbox_scan_failed";
}

function mailboxFeedbackScanIsPaused(account: IntegrationRow) {
  const settings = asRecord(account.settings);
  const pausedUntil = Date.parse(String(settings.mailbox_feedback_scan_paused_until || ""));
  return Number.isFinite(pausedUntil) && pausedUntil > Date.now();
}

async function clearMailboxScanFailure(account: IntegrationRow) {
  const settings = asRecord(account.settings);
  if (
    !settings.mailbox_feedback_scan_failure_count &&
    !settings.mailbox_feedback_scan_paused_until &&
    !settings.mailbox_feedback_scan_last_error_code
  ) {
    return;
  }
  const nextSettings = { ...settings };
  delete nextSettings.mailbox_feedback_scan_failure_count;
  delete nextSettings.mailbox_feedback_scan_paused_until;
  delete nextSettings.mailbox_feedback_scan_last_failed_at;
  delete nextSettings.mailbox_feedback_scan_last_error_code;
  const result = await supabaseAdmin
    .from("integrations")
    .update({ settings: nextSettings, updated_at: new Date().toISOString() })
    .eq("id", account.id)
    .eq("user_id", account.user_id);
  if (result.error) throw result.error;
}

async function recordMailboxScanFailure(account: IntegrationRow, error: unknown) {
  const now = new Date();
  const settings = asRecord(account.settings);
  const previousCount = Math.max(
    0,
    Math.floor(Number(settings.mailbox_feedback_scan_failure_count || 0)),
  );
  const failureCount = previousCount + 1;
  const pausedUntil = failureCount >= MAILBOX_SCAN_FAILURE_THRESHOLD
    ? new Date(now.getTime() + MAILBOX_SCAN_PAUSE_MS).toISOString()
    : null;
  const nextSettings = {
    ...settings,
    mailbox_feedback_scan_failure_count: failureCount,
    mailbox_feedback_scan_last_failed_at: now.toISOString(),
    mailbox_feedback_scan_last_error_code: mailboxScannerErrorCode(error),
    ...(pausedUntil ? { mailbox_feedback_scan_paused_until: pausedUntil } : {}),
  };
  const result = await supabaseAdmin
    .from("integrations")
    .update({ settings: nextSettings, updated_at: now.toISOString() })
    .eq("id", account.id)
    .eq("user_id", account.user_id);
  if (result.error) throw result.error;
  return { failureCount, pausedUntil };
}

async function markMailboxReconnectRequired(account: IntegrationRow) {
  const now = new Date().toISOString();
  const settings = asRecord(account.settings);
  const result = await supabaseAdmin
    .from("integrations")
    .update({
      status: "disconnected",
      settings: {
        ...settings,
        needs_reconnect: true,
        needs_reconnect_at: now,
        needs_reconnect_reason: "mailbox_authentication_failed",
      },
      updated_at: now,
    })
    .eq("id", account.id)
    .eq("user_id", account.user_id);
  if (result.error) throw result.error;
}

function hasScope(settings: Record<string, unknown> | null, required: string) {
  const scopes = String(settings?.scopes_raw || settings?.scopes || "").toLowerCase();
  return scopes.split(/[\s,]+/).includes(required.toLowerCase());
}

function isExpired(expiresAt: string | null, skewSeconds = 60) {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= Date.now() + skewSeconds * 1000;
}

async function filterUnprocessedFeedbackIds(provider: MailboxProvider, externalEventIds: string[]) {
  const uniqueIds = Array.from(new Set(externalEventIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Set<string>();
  const processed = new Set<string>();
  for (let offset = 0; offset < uniqueIds.length; offset += 50) {
    const chunk = uniqueIds.slice(offset, offset + 50);
    const { data, error } = await supabaseAdmin
      .from("mail_provider_events")
      .select("external_event_id")
      .eq("provider", provider)
      .in("external_event_id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      const externalId = String((row as { external_event_id?: unknown }).external_event_id || "");
      if (externalId) processed.add(externalId);
    }
  }
  return new Set(uniqueIds.filter((id) => !processed.has(id)));
}

async function countConnectedMailboxes() {
  const { count, error } = await supabaseAdmin
    .from("integrations")
    .select("id", { count: "exact", head: true })
    .eq("category", "mail")
    .eq("status", "connected")
    .in("provider", ["microsoft", "imap"]);
  if (error) throw error;
  return Math.max(0, Number(count || 0));
}

async function fetchConnectedMailboxRange(start: number, end: number) {
  if (end < start) return [] as IntegrationRow[];
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id,user_id,provider,account_email,access_token_enc,refresh_token_enc,expires_at,settings")
    .eq("category", "mail")
    .eq("status", "connected")
    .in("provider", ["microsoft", "imap"])
    .order("id", { ascending: true })
    .range(start, end);
  if (error) throw error;
  return (data || []) as IntegrationRow[];
}

async function loadConnectedMailboxes(maxAccounts: number) {
  const total = await countConnectedMailboxes();
  if (total === 0) return [] as IntegrationRow[];
  const slot = Math.floor(Date.now() / (15 * 60_000));
  const start = total > maxAccounts ? (slot * maxAccounts) % total : 0;
  const first = await fetchConnectedMailboxRange(start, Math.min(total - 1, start + maxAccounts - 1));
  if (first.length >= maxAccounts || start === 0) return first;
  const remaining = maxAccounts - first.length;
  const wrapped = await fetchConnectedMailboxRange(0, Math.min(start - 1, remaining - 1));
  return [...first, ...wrapped].slice(0, maxAccounts);
}

async function refreshMicrosoftToken(account: IntegrationRow) {
  let accessToken = tryDecryptToken(account.access_token_enc);
  const refreshToken = tryDecryptToken(account.refresh_token_enc);
  if (!accessToken) return null;
  if (!refreshToken || !isExpired(account.expires_at)) return accessToken;

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return accessToken;
  const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: String(account.settings?.scopes_raw || "openid profile email offline_access Mail.Read Mail.Send User.Read"),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) return accessToken;
  accessToken = String(body.access_token);
  const expiresAt = body.expires_in ? new Date(Date.now() + Number(body.expires_in) * 1000).toISOString() : null;
  await supabaseAdmin.from("integrations").update({ access_token_enc: encryptToken(accessToken), expires_at: expiresAt }).eq("id", account.id).eq("user_id", account.user_id);
  return accessToken;
}

async function applyFeedback(args: {
  account: IntegrationRow;
  provider: MailboxProvider;
  externalEventId: string;
  subject: string;
  from: string;
  body: string;
  occurredAt?: string | null;
  payload: unknown;
}) {
  const feedback = parseDeliveryFeedback({ subject: args.subject, from: args.from, body: args.body, ownEmail: args.account.account_email });
  if (!feedback) return { feedback: false, updated: false };

  const event: NormalizedMailWebhookEvent = {
    provider: args.provider,
    externalEventId: args.externalEventId,
    kind: feedback.kind,
    bounceType: feedback.bounceType,
    providerMessageId: null,
    email: feedback.email,
    campaignId: null,
    recipientId: null,
    userId: args.account.user_id,
    occurredAt: args.occurredAt || new Date().toISOString(),
    reason: feedback.reason,
    payload: args.payload,
  };
  const result = await processMailWebhookEvent(event);
  return { feedback: true, updated: Boolean(result.updated) };
}

async function scanMicrosoft(account: IntegrationRow) {
  if (!hasScope(account.settings, "Mail.Read") && !hasScope(account.settings, "Mail.ReadWrite")) {
    return { scanned: 0, feedback: 0, updated: 0, skipped: 1 };
  }
  const token = await refreshMicrosoftToken(account);
  if (!token) return { scanned: 0, feedback: 0, updated: 0, skipped: 1 };
  const endpoint = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=100&$select=id,subject,from,receivedDateTime,bodyPreview,internetMessageId&$orderby=receivedDateTime%20desc";
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Lecture Outlook impossible (${response.status}).`);
  const data = await response.json().catch(() => ({}));
  const messages: MicrosoftInboxMessage[] = Array.isArray(data.value) ? data.value : [];
  const cutoff = Date.now() - 3 * 24 * 60 * 60_000;
  const candidates = messages.filter((message) => {
    if (Date.parse(String(message?.receivedDateTime || "")) < cutoff) return false;
    const from = String(message?.from?.emailAddress?.address || "");
    const subject = String(message?.subject || "");
    return /mailer-daemon|postmaster|undeliver|delivery status|mail delivery failed|failure notice|non remis|non distribué/i.test(`${from} ${subject}`);
  });
  const eventIdFor = (message: MicrosoftInboxMessage) => `microsoft-inbox:${String(message?.id || message?.internetMessageId || "")}`;
  const pendingEventIds = await filterUnprocessedFeedbackIds("microsoft", candidates.map(eventIdFor));
  let feedback = 0;
  let updated = 0;
  let scanned = 0;
  for (const message of candidates) {
    if (scanned >= 15) break;
    const externalEventId = eventIdFor(message);
    if (!pendingEventIds.has(externalEventId)) continue;
    const messageId = String(message?.id || "");
    if (!messageId) continue;
    const detailRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,receivedDateTime,bodyPreview,body,internetMessageId`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!detailRes.ok) continue;
    const detail = await detailRes.json().catch(() => message);
    scanned += 1;
    const from = String(detail?.from?.emailAddress?.address || message?.from?.emailAddress?.address || "");
    const subject = String(detail?.subject || message?.subject || "");
    const result = await applyFeedback({
      account,
      provider: "microsoft",
      externalEventId,
      subject,
      from,
      body: [String(detail?.bodyPreview || ""), String(detail?.body?.content || "")].join("\n"),
      occurredAt: String(detail?.receivedDateTime || message?.receivedDateTime || ""),
      payload: { id: detail?.id || message?.id, internetMessageId: detail?.internetMessageId || message?.internetMessageId },
    });
    if (result.feedback) feedback += 1;
    if (result.updated) updated += 1;
  }
  return { scanned, feedback, updated, skipped: 0 };
}

async function scanImap(account: IntegrationRow) {
  const settings = asRecord(account.settings);
  const imap = asRecord(settings.imap);
  const password = account.refresh_token_enc ? decryptSecret(account.refresh_token_enc) : "";
  const config: ImapConfig = {
    user: String(account.account_email || ""),
    password,
    host: String(imap.host || ""),
    port: Number(imap.port || 993),
    secure: typeof imap.secure === "boolean" ? Boolean(imap.secure) : Number(imap.port || 993) === 993,
  };
  if (!config.user || !config.password || !config.host || !config.port) return { scanned: 0, feedback: 0, updated: 0, skipped: 1 };
  return withImap(config, async (client) => {
    await client.mailboxOpen("INBOX");
    const found = await client.search(
      { since: new Date(Date.now() - 3 * 24 * 60 * 60_000) },
      { uid: true },
    );
    const uids = Array.isArray(found) ? found : [];
    const recent = uids.slice(-200);
    if (recent.length === 0) return { scanned: 0, feedback: 0, updated: 0, skipped: 0 };
    const bounceUids: number[] = [];
    for await (const message of client.fetch(
      recent,
      { uid: true, envelope: true },
      { uid: true },
    )) {
      const subject = String(message.envelope?.subject || "");
      const from = (message.envelope?.from || []).map((entry) => entry.address || "").join(", ");
      if (/mailer-daemon|postmaster|undeliver|delivery status|mail delivery failed|failure notice|non remis|non distribué/i.test(`${from} ${subject}`)) {
        bounceUids.push(Number(message.uid || 0));
      }
    }
    const eventIdForUid = (uid: number) => `imap-inbox:${account.id}:${String(uid)}`;
    const pendingEventIds = await filterUnprocessedFeedbackIds("imap", bounceUids.map(eventIdForUid));
    const pendingUids = bounceUids.filter((uid) => uid > 0 && pendingEventIds.has(eventIdForUid(uid))).slice(0, 15);
    if (pendingUids.length === 0) return { scanned: 0, feedback: 0, updated: 0, skipped: 0 };
    let feedback = 0;
    let updated = 0;
    let scanned = 0;
    for await (const message of client.fetch(
      pendingUids,
      { uid: true, envelope: true, source: true },
      { uid: true },
    )) {
      scanned += 1;
      const subject = String(message.envelope?.subject || "");
      const from = (message.envelope?.from || []).map((entry) => entry.address || "").join(", ");
      if (!/mailer-daemon|postmaster|undeliver|delivery status|mail delivery failed|failure notice|non remis|non distribué/i.test(`${from} ${subject}`)) continue;
      const body = Buffer.isBuffer(message.source) ? message.source.toString("utf8") : String(message.source || "");
      const result = await applyFeedback({
        account,
        provider: "imap",
        externalEventId: eventIdForUid(Number(message.uid || 0)),
        subject,
        from,
        body,
        occurredAt: message.envelope?.date?.toISOString() || null,
        payload: { uid: message.uid, subject },
      });
      if (result.feedback) feedback += 1;
      if (result.updated) updated += 1;
    }
    return { scanned, feedback, updated, skipped: 0 };
  });
}

export async function scanConnectedMailboxesForFeedback(opts?: { maxAccounts?: number }) {
  const maxAccounts = Math.max(1, Math.min(100, Number(opts?.maxAccounts || 8)));
  const accounts = await loadConnectedMailboxes(maxAccounts);

  const summary: ScanResult = { accounts: 0, scanned: 0, feedback: 0, updated: 0, skipped: 0, errors: 0 };
  for (const account of accounts) {
    summary.accounts += 1;
    if (mailboxFeedbackScanIsPaused(account)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const provider = String(account.provider || "").toLowerCase();
      const result = provider === "microsoft"
        ? await scanMicrosoft(account)
        : await scanImap(account);
      summary.scanned += result.scanned;
      summary.feedback += result.feedback;
      summary.updated += result.updated;
      summary.skipped += result.skipped;
      await clearMailboxScanFailure(account).catch((updateError) => {
        console.info("[mailBounceScanner] failure marker cleanup deferred", {
          integrationId: account.id,
          provider: account.provider,
          message: compactScannerError(updateError),
        });
      });
    } catch (error) {
      summary.errors += 1;
      if (isMailboxAuthenticationFailure(error)) {
        await markMailboxReconnectRequired(account).catch((updateError) => {
          console.warn("[mailBounceScanner] reconnect marker unavailable", {
            integrationId: account.id,
            provider: account.provider,
            message: compactScannerError(updateError),
          });
        });
        console.info("[mailBounceScanner] mailbox reconnect required", {
          integrationId: account.id,
          provider: account.provider,
          code: "mailbox_authentication_failed",
        });
      } else {
        const recorded = await recordMailboxScanFailure(account, error).catch((updateError) => {
          console.warn("[mailBounceScanner] failure marker unavailable", {
            integrationId: account.id,
            provider: account.provider,
            message: compactScannerError(updateError),
          });
          return null;
        });
        const details = {
          integrationId: account.id,
          provider: account.provider,
          message: compactScannerError(error),
          code: mailboxScannerErrorCode(error),
          failureCount: recorded?.failureCount || null,
          pausedUntil: recorded?.pausedUntil || null,
        };
        if (recorded?.pausedUntil) {
          console.info("[mailBounceScanner] feedback scan paused after repeated failures", details);
        } else {
          console.warn("[mailBounceScanner] account scan failed", details);
        }
      }
    }
  }
  return summary;
}

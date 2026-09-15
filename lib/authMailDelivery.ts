import "server-only";

import { randomUUID } from "node:crypto";
import { Resend, type ErrorResponse } from "resend";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  authMailStatusNeedsAlert,
  redactAuthMailError,
  type NormalizedResendAuthEvent,
  type PreparedAuthEmail,
} from "@/lib/authMailPolicy";

const DELIVERY_TABLE = "auth_email_deliveries";
const RESERVE_RPC = "reserve_auth_email_delivery";
const ACCEPT_RPC = "accept_auth_email_delivery";
const MARK_UNCERTAIN_RPC = "mark_auth_email_delivery_acceptance_uncertain";
const FAIL_RPC = "fail_auth_email_delivery";
const RECORD_EVENT_RPC = "record_auth_email_provider_event";
const CLAIM_ALERT_RPC = "claim_auth_email_delivery_alerts";
// Supabase expects the hook to finish within five seconds. Keep enough room for
// both delivery-state writes and the HTTP response around the provider call.
const PROVIDER_TIMEOUT_MS = 2_750;

type AuthEmailDeliveryRow = {
  id: string;
  delivery_key: string;
  recipient_email: string;
  action_type: string;
  provider_message_id: string | null;
  status: string;
  status_rank: number;
  send_attempt_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  alert_status: "none" | "pending" | "processing" | "retry_wait" | "sent" | "dead";
  alert_attempt_count: number;
  alert_max_attempts: number;
  alert_lock_token: string | null;
};

type ProviderEventRecordResult = {
  delivery_id: string | null;
  delivery_status: string | null;
  alert_status: string | null;
  event_result: "processed" | "duplicate" | "unmatched";
};

export class AuthMailDeliveryError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(args: { code: string; message: string; httpStatus: number; retryable: boolean }) {
    super(args.message);
    this.name = "AuthMailDeliveryError";
    this.code = args.code;
    this.httpStatus = args.httpStatus;
    this.retryable = args.retryable;
  }
}

function clean(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function requiredEnv(name: string) {
  const value = clean(process.env[name], 4_000);
  if (!value) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_not_configured",
      message: `Missing server configuration: ${name}`,
      httpStatus: 500,
      retryable: false,
    });
  }
  return value;
}

function resendClient() {
  return new Resend(requiredEnv("RESEND_API_KEY"));
}

function authEmailFrom() {
  return clean(process.env.AUTH_EMAIL_FROM, 320) || "iNrCy <connexion@inrcy.com>";
}

function authEmailReplyTo() {
  return clean(process.env.AUTH_EMAIL_REPLY_TO, 320) || "contact@admin-inrcy.com";
}

function authEmailAlertTo() {
  return clean(process.env.AUTH_EMAIL_ALERT_TO, 320).toLowerCase() || "contact@admin-inrcy.com";
}

async function withProviderTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AuthMailDeliveryError({
            code: "resend_timeout",
            message: "Authentication email provider timed out",
            httpStatus: 503,
            retryable: true,
          }));
        }, PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function firstRow<T>(value: unknown) {
  return (Array.isArray(value) ? value[0] : null) as T | null;
}

async function reserveDelivery(message: PreparedAuthEmail) {
  const { data, error } = await supabaseAdmin.rpc(RESERVE_RPC, {
    p_delivery_key: message.deliveryKey,
    p_supabase_hook_id: message.hookId,
    p_message_sequence: message.sequence,
    p_user_id: message.userId,
    p_recipient_email: message.recipient,
    p_action_type: message.action,
  });
  const row = firstRow<AuthEmailDeliveryRow>(data);
  if (error || !row) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_reservation_failed",
      message: "Authentication email could not be reserved",
      httpStatus: 503,
      retryable: true,
    });
  }
  return row;
}

async function acceptDelivery(deliveryKey: string, providerMessageId: string) {
  const { data, error } = await supabaseAdmin.rpc(ACCEPT_RPC, {
    p_delivery_key: deliveryKey,
    p_provider_message_id: providerMessageId,
  });
  if (error || !firstRow<AuthEmailDeliveryRow>(data)) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_acceptance_write_failed",
      message: "Authentication email acceptance could not be persisted",
      httpStatus: 503,
      retryable: true,
    });
  }
}

async function failDelivery(deliveryKey: string, error: unknown) {
  const safeError = redactAuthMailError(error);
  const { data, error: writeError } = await supabaseAdmin.rpc(FAIL_RPC, {
    p_delivery_key: deliveryKey,
    p_error_code: safeError.code,
    p_error_message: safeError.message,
  });
  const row = firstRow<AuthEmailDeliveryRow>(data);
  if (writeError || !row) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_failure_write_failed",
      message: "Authentication email failure could not be persisted",
      httpStatus: 503,
      retryable: true,
    });
  }
  return row;
}

async function markDeliveryAcceptanceUncertain(deliveryKey: string, error: unknown) {
  const safeError = redactAuthMailError(error);
  const { data, error: writeError } = await supabaseAdmin.rpc(MARK_UNCERTAIN_RPC, {
    p_delivery_key: deliveryKey,
    p_error_code: safeError.code,
    p_error_message: safeError.message,
  });
  const row = firstRow<AuthEmailDeliveryRow>(data);
  if (writeError || !row) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_uncertain_write_failed",
      message: "Authentication email uncertainty could not be persisted",
      httpStatus: 503,
      retryable: true,
    });
  }
  return row;
}

function providerError(error: ErrorResponse) {
  const statusCode = Number(error.statusCode || 0);
  const retryable = statusCode === 429 || statusCode >= 500 || error.name === "concurrent_idempotent_requests";
  return new AuthMailDeliveryError({
    code: clean(error.name, 120) || "resend_error",
    message: clean(error.message, 500) || "Authentication email provider rejected the request",
    httpStatus: statusCode === 429 ? 429 : retryable ? 503 : 400,
    retryable,
  });
}

function deliveryAlreadySucceeded(row: AuthEmailDeliveryRow) {
  return row.status === "accepted" || row.status === "sent" || row.status === "delayed" || row.status === "delivered";
}

function isUncertainTransportFailure(error: AuthMailDeliveryError) {
  return error.code === "resend_timeout" || error.code === "resend_network_error";
}

function isConcurrentIdempotentProviderResponse(error: AuthMailDeliveryError) {
  return error.code === "concurrent_idempotent_requests";
}

export async function sendPreparedAuthEmail(message: PreparedAuthEmail) {
  const row = await reserveDelivery(message);
  if (deliveryAlreadySucceeded(row)) {
    return { accepted: true, replay: true, providerMessageId: row.provider_message_id } as const;
  }
  if (row.status === "acceptance_uncertain") {
    // Never resend a request whose provider acceptance is unknown. The stable
    // Resend tag lets a later provider webhook reconcile it to delivered.
    return { accepted: true, replay: true, uncertain: true, providerMessageId: row.provider_message_id } as const;
  }
  if (authMailStatusNeedsAlert(row.status)) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_previous_terminal_failure",
      message: "Authentication email delivery previously failed",
      httpStatus: 400,
      retryable: false,
    });
  }

  let response: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    response = await withProviderTimeout(
      resendClient().emails.send(
        {
          from: authEmailFrom(),
          to: message.recipient,
          replyTo: authEmailReplyTo(),
          subject: message.subject,
          text: message.text,
          html: message.html,
          tags: [
            { name: "category", value: "auth" },
            { name: "auth_action", value: message.action },
            { name: "delivery_hash", value: message.deliveryHash },
          ],
        },
        { idempotencyKey: message.providerIdempotencyKey },
      ),
    );
  } catch (error) {
    const transportError = error instanceof AuthMailDeliveryError
      ? error
      : new AuthMailDeliveryError({
          code: "resend_network_error",
          message: "Authentication email provider is unavailable",
          httpStatus: 503,
          retryable: true,
        });
    if (isUncertainTransportFailure(transportError)) {
      const uncertainRow = await markDeliveryAcceptanceUncertain(message.deliveryKey, transportError);
      // The durable alert outbox is processed by the dedicated cron. Returning
      // success immediately prevents any potentially duplicate retry to the
      // professional. A later provider webhook can still reconcile the state.
      return {
        accepted: true,
        replay: false,
        uncertain: true,
        providerMessageId: uncertainRow.provider_message_id,
      } as const;
    }

    // Configuration failures happen before a provider request is made and are
    // deterministic. Persist them immediately so the alert outbox can surface
    // the incident without relying on a Supabase retry.
    await failDelivery(message.deliveryKey, transportError);
    throw transportError;
  }

  if (response.error) {
    const error = providerError(response.error);
    if (isConcurrentIdempotentProviderResponse(error)) {
      // Resend is already processing the exact same idempotency key. Its final
      // acceptance is unknown, so never issue another professional send. The
      // provider webhook or the delayed internal alert will resolve the state.
      const uncertainRow = await markDeliveryAcceptanceUncertain(message.deliveryKey, error);
      return {
        accepted: true,
        replay: false,
        uncertain: true,
        providerMessageId: uncertainRow.provider_message_id,
      } as const;
    }
    // A structured provider error is an explicit rejection, not an ambiguous
    // transport outcome (apart from the concurrent idempotency case above).
    // Make it terminal and alertable on the first response.
    await failDelivery(message.deliveryKey, error);
    // The cron owns internal-alert retries. Keeping it outside the Auth hook
    // preserves Supabase's five-second response contract.
    throw error;
  }

  const providerMessageId = clean(response.data?.id, 256);
  if (!providerMessageId) {
    const error = new AuthMailDeliveryError({
      code: "resend_missing_message_id",
      message: "Authentication email provider returned no message id",
      httpStatus: 503,
      retryable: true,
    });
    const uncertainRow = await markDeliveryAcceptanceUncertain(message.deliveryKey, error);
    return {
      accepted: true,
      replay: false,
      uncertain: true,
      providerMessageId: uncertainRow.provider_message_id,
    } as const;
  }
  await acceptDelivery(message.deliveryKey, providerMessageId);
  return { accepted: true, replay: false, providerMessageId } as const;
}

export async function recordResendAuthEmailEvent(args: {
  svixId: string;
  event: Extract<NormalizedResendAuthEvent, { kind: "event" }>;
}) {
  const { data, error } = await supabaseAdmin.rpc(RECORD_EVENT_RPC, {
    p_svix_id: args.svixId,
    p_provider_message_id: args.event.providerMessageId,
    p_delivery_key: args.event.deliveryKey,
    p_event_type: args.event.eventType,
    p_event_created_at: args.event.eventCreatedAt,
    p_status: args.event.status,
    p_status_rank: args.event.statusRank,
    p_error_code: args.event.errorCode,
    p_error_message: args.event.errorMessage,
  });
  const result = firstRow<ProviderEventRecordResult>(data);
  if (error || !result) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_provider_event_write_failed",
      message: "Authentication email provider event could not be persisted",
      httpStatus: 503,
      retryable: true,
    });
  }
  return result;
}

function alertRetryAt(attemptCount: number) {
  const delaysMinutes = [1, 5, 15, 60, 240, 480];
  const minutes = delaysMinutes[Math.min(Math.max(attemptCount - 1, 0), delaysMinutes.length - 1)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function alertText(row: AuthEmailDeliveryRow) {
  const statusLabels: Record<string, string> = {
    acceptance_uncertain: "Acceptation Resend incertaine",
    failed: "Échec d’envoi",
    bounced: "Adresse rejetée / retour serveur",
    suppressed: "Adresse placée en suppression",
    complained: "Signalement comme indésirable",
  };
  return [
    "Un envoi d’e-mail d’authentification iNrCy nécessite une vérification.",
    "",
    `Destinataire : ${row.recipient_email}`,
    `Type : ${row.action_type}`,
    `État : ${statusLabels[row.status] || row.status}`,
    `Code : ${row.last_error_code || "non communiqué"}`,
    row.last_error_message ? `Détail : ${row.last_error_message}` : "",
    "",
    "Aucun renvoi automatique n’a été déclenché vers le professionnel.",
    `Référence interne : ${row.id}`,
  ].filter(Boolean).join("\n");
}

function alertHtml(row: AuthEmailDeliveryRow) {
  const safe = (value: unknown) => clean(value, 500)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  return `<div style="font-family:Arial,sans-serif;color:#172033"><h1 style="font-size:22px">E-mail d’authentification iNrCy à vérifier</h1><p>Un envoi d’e-mail d’authentification nécessite une vérification.</p><table cellpadding="6" cellspacing="0"><tr><td><strong>Destinataire</strong></td><td>${safe(row.recipient_email)}</td></tr><tr><td><strong>Type</strong></td><td>${safe(row.action_type)}</td></tr><tr><td><strong>État</strong></td><td>${safe(row.status)}</td></tr><tr><td><strong>Code</strong></td><td>${safe(row.last_error_code || "non communiqué")}</td></tr><tr><td><strong>Détail</strong></td><td>${safe(row.last_error_message || "non communiqué")}</td></tr></table><p><strong>Aucun renvoi automatique n’a été déclenché vers le professionnel.</strong></p><p style="color:#687086;font-size:12px">Référence interne : ${safe(row.id)}</p></div>`;
}

async function persistAlertAccepted(row: AuthEmailDeliveryRow, providerMessageId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(DELIVERY_TABLE)
    .update({
      alert_status: "sent",
      alert_provider_message_id: providerMessageId,
      alert_sent_at: now,
      alert_next_attempt_at: null,
      alert_lock_token: null,
      alert_locked_at: null,
      alert_lock_expires_at: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("alert_status", "processing")
    .eq("alert_lock_token", row.alert_lock_token || "")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_alert_acceptance_write_failed",
      message: "Authentication email alert acceptance could not be persisted",
      httpStatus: 503,
      retryable: true,
    });
  }
}

async function persistAlertFailure(row: AuthEmailDeliveryRow, error: unknown) {
  const safeError = redactAuthMailError(error);
  const exhausted = row.alert_attempt_count >= row.alert_max_attempts;
  const now = new Date().toISOString();
  const { data, error: writeError } = await supabaseAdmin
    .from(DELIVERY_TABLE)
    .update({
      alert_status: exhausted ? "dead" : "retry_wait",
      alert_next_attempt_at: exhausted ? null : alertRetryAt(row.alert_attempt_count),
      alert_lock_token: null,
      alert_locked_at: null,
      alert_lock_expires_at: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("alert_status", "processing")
    .eq("alert_lock_token", row.alert_lock_token || "")
    .select("id")
    .maybeSingle();
  if (writeError || !data) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_alert_failure_write_failed",
      message: "Authentication email alert failure could not be persisted",
      httpStatus: 503,
      retryable: true,
    });
  }
  return { exhausted, code: safeError.code };
}

async function claimAuthEmailFailureAlerts(args: { deliveryId?: string; limit: number }) {
  const lockToken = randomUUID();
  const { data, error } = await supabaseAdmin.rpc(CLAIM_ALERT_RPC, {
    p_delivery_id: args.deliveryId || null,
    p_limit: args.limit,
    p_lock_token: lockToken,
    p_lease_seconds: 120,
  });
  if (error) {
    throw new AuthMailDeliveryError({
      code: "auth_mail_alert_claim_failed",
      message: "Authentication email alert could not be claimed",
      httpStatus: 503,
      retryable: true,
    });
  }
  return (Array.isArray(data) ? data : []) as AuthEmailDeliveryRow[];
}

async function sendClaimedAuthEmailFailureAlert(row: AuthEmailDeliveryRow) {
  let response: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    response = await withProviderTimeout(
      resendClient().emails.send(
        {
          from: clean(process.env.AUTH_EMAIL_ALERT_FROM, 320) || authEmailFrom(),
          to: authEmailAlertTo(),
          replyTo: authEmailReplyTo(),
          subject: `[iNrCy] E-mail Auth non remis (${row.status})`,
          text: alertText(row),
          html: alertHtml(row),
          tags: [
            { name: "category", value: "internal_alert" },
            { name: "delivery_hash", value: row.delivery_key.replace(/^v1:/, "") },
          ],
        },
        { idempotencyKey: `inrcy-auth-alert-${row.id}` },
      ),
    );
  } catch (error) {
    const state = await persistAlertFailure(row, error);
    return { outcome: state.exhausted ? "dead" : "retrying", code: state.code } as const;
  }

  if (response.error) {
    const state = await persistAlertFailure(row, providerError(response.error));
    return { outcome: state.exhausted ? "dead" : "retrying", code: state.code } as const;
  }
  const providerMessageId = clean(response.data?.id, 256);
  if (!providerMessageId) {
    const state = await persistAlertFailure(row, new Error("resend_missing_message_id"));
    return { outcome: state.exhausted ? "dead" : "retrying", code: state.code } as const;
  }
  try {
    await persistAlertAccepted(row, providerMessageId);
    return { outcome: "sent" } as const;
  } catch {
    // Resend accepted the idempotent alert; a later retry uses the same key.
    return { outcome: "uncertain" } as const;
  }
}

export async function processAuthEmailFailureAlert(args: { deliveryId: string }) {
  const rows = await claimAuthEmailFailureAlerts({ deliveryId: args.deliveryId, limit: 1 });
  const row = rows[0];
  if (!row) return { outcome: "not_due" } as const;
  return sendClaimedAuthEmailFailureAlert(row);
}

export async function processDueAuthEmailFailureAlerts(args: { limit?: number } = {}) {
  const limit = Math.min(Math.max(Math.trunc(args.limit || 10), 1), 10);
  const rows = await claimAuthEmailFailureAlerts({ limit });
  const summary = {
    claimed: rows.length,
    sent: 0,
    retrying: 0,
    dead: 0,
    uncertain: 0,
  };

  // Keep the internal alert stream deliberately small and sequential. This
  // endpoint never resends the professional's authentication message.
  for (const row of rows) {
    const result = await sendClaimedAuthEmailFailureAlert(row);
    if (result.outcome === "sent") summary.sent += 1;
    else if (result.outcome === "retrying") summary.retrying += 1;
    else if (result.outcome === "dead") summary.dead += 1;
    else summary.uncertain += 1;
  }

  return summary;
}

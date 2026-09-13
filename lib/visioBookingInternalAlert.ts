import "server-only";

import { randomUUID } from "node:crypto";

import { optionalEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendMonitoringMailWithResult } from "@/lib/txMailer";
import {
  VISIO_BOOKING_INTERNAL_ALERT_MAX_ATTEMPTS,
  VISIO_BOOKING_INTERNAL_ALERT_LOCK_TTL_MS,
  buildVisioBookingInternalAlertDeliveryKey,
  buildVisioBookingInternalAlertPayload,
  buildVisioBookingInternalAlertRecipients,
  smtpAcceptedVisioBookingRecipient,
  visioBookingInternalAlertErrorCode,
  visioBookingInternalAlertRetryAt,
  type VisioBookingInternalAlertPayload,
} from "@/lib/visioBookingInternalAlertPolicy";

const OUTBOX_TABLE = "visio_booking_internal_alert_outbox";
const CLAIM_RPC = "claim_visio_booking_internal_alerts";
const CLAIM_LEASE_MS = VISIO_BOOKING_INTERNAL_ALERT_LOCK_TTL_MS;

type AlertOutboxRow = {
  id: string;
  dedupe_key: string;
  google_event_id: string;
  prospect_user_id: string;
  recipient_email: string;
  assigned_member_id: string;
  assigned_member_name: string;
  prospect_name: string;
  company: string;
  prospect_email: string;
  prospect_phone: string;
  date_label: string;
  time_label: string;
  meet_url: string;
  calendar_url: string;
  subject: string;
  body_text: string;
  status: "pending" | "processing" | "retry_wait" | "accepted" | "dead";
  attempt_count: number;
  max_attempts: number;
  lock_token: string | null;
};

export type VisioBookingInternalAlertBatchResult = {
  ok: boolean;
  claimed: number;
  accepted: number;
  retrying: number;
  dead: number;
  uncertain: number;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function rowFromPayload(
  payload: VisioBookingInternalAlertPayload,
  status: "awaiting_google" | "pending",
) {
  return {
    dedupe_key: buildVisioBookingInternalAlertDeliveryKey({
      googleEventId: payload.googleEventId,
      recipient: payload.recipient,
    }),
    google_event_id: payload.googleEventId,
    prospect_user_id: payload.prospectUserId,
    recipient_email: payload.recipient,
    assigned_member_id: payload.assignedMemberId,
    assigned_member_name: payload.assignedMemberName,
    prospect_name: payload.prospectName,
    company: payload.company,
    prospect_email: payload.prospectEmail,
    prospect_phone: payload.prospectPhone,
    date_label: payload.dateLabel,
    time_label: payload.timeLabel,
    meet_url: payload.meetUrl,
    calendar_url: payload.calendarUrl,
    subject: payload.subject,
    body_text: payload.text,
    status,
    max_attempts: VISIO_BOOKING_INTERNAL_ALERT_MAX_ATTEMPTS,
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function payloadFromRow(row: AlertOutboxRow): VisioBookingInternalAlertPayload {
  return buildVisioBookingInternalAlertPayload({
    googleEventId: row.google_event_id,
    prospectUserId: row.prospect_user_id,
    recipient: row.recipient_email,
    assignedMemberId: row.assigned_member_id,
    assignedMemberName: row.assigned_member_name,
    prospectName: row.prospect_name,
    company: row.company,
    prospectEmail: row.prospect_email,
    prospectPhone: row.prospect_phone,
    dateLabel: row.date_label,
    timeLabel: row.time_label,
    meetUrl: row.meet_url,
    calendarUrl: row.calendar_url,
  });
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map(clean).filter(Boolean)
    : [];
}

function deterministicMessageId(dedupeKey: string) {
  return `<visio-${dedupeKey.replace(/^v1:/, "")}@inrcy.com>`;
}

async function persistAccepted(
  row: AlertOutboxRow,
  delivery: { messageId?: unknown; accepted?: unknown; rejected?: unknown },
) {
  let lastError = "";
  for (const delayMs of [0, 120, 400]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from(OUTBOX_TABLE)
      .update({
        status: "accepted",
        provider_message_id: clean(delivery.messageId),
        accepted_recipients: stringList(delivery.accepted),
        rejected_recipients: stringList(delivery.rejected),
        accepted_at: now,
        next_attempt_at: null,
        lock_token: null,
        locked_at: null,
        lock_expires_at: null,
        last_error_code: null,
        last_error_message: null,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("status", "processing")
      .eq("lock_token", row.lock_token || "")
      .select("id")
      .maybeSingle();
    if (!error && data) return;
    lastError = error?.message || "alert_acceptance_write_conflict";
  }
  throw new Error(lastError || "alert_acceptance_write_failed");
}

async function persistFailure(row: AlertOutboxRow, error: unknown) {
  const errorCode = visioBookingInternalAlertErrorCode(error);
  const exhausted = row.attempt_count >= row.max_attempts;
  const nextAttemptAt = exhausted
    ? null
    : visioBookingInternalAlertRetryAt({
        attemptCount: row.attempt_count,
        deliveryKey: row.dedupe_key,
      }).toISOString();
  const now = new Date().toISOString();
  const { data, error: writeError } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .update({
      status: exhausted ? "dead" : "retry_wait",
      next_attempt_at: nextAttemptAt,
      lock_token: null,
      locked_at: null,
      lock_expires_at: null,
      last_error_code: errorCode,
      last_error_message: clean(error instanceof Error ? error.message : error).slice(0, 500),
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "processing")
    .eq("lock_token", row.lock_token || "")
    .select("id")
    .maybeSingle();
  if (writeError || !data) {
    throw new Error(writeError?.message || "alert_failure_write_conflict");
  }
  return exhausted;
}

async function deliverClaimedAlert(row: AlertOutboxRow) {
  const payload = payloadFromRow(row);
  let delivery: Awaited<ReturnType<typeof sendMonitoringMailWithResult>>;
  try {
    delivery = await sendMonitoringMailWithResult({
      to: payload.recipient,
      subject: payload.subject,
      text: payload.text,
      messageId: deterministicMessageId(row.dedupe_key),
    });
    if (!smtpAcceptedVisioBookingRecipient(payload.recipient, delivery?.accepted)) {
      throw new Error("visio_booking_internal_alert_recipient_not_accepted");
    }
  } catch (error) {
    const exhausted = await persistFailure(row, error).catch((writeError: unknown) => {
      console.error("[visio-booking][internal-alert-failure-state]", {
        deliveryKey: row.dedupe_key,
        code: visioBookingInternalAlertErrorCode(writeError),
      });
      return false;
    });
    console.error("[visio-booking][internal-alert-send]", {
      deliveryKey: row.dedupe_key,
      code: visioBookingInternalAlertErrorCode(error),
      exhausted,
    });
    return exhausted ? "dead" as const : "retrying" as const;
  }

  try {
    await persistAccepted(row, delivery);
    console.info("[visio-booking][internal-alert-accepted]", {
      deliveryKey: row.dedupe_key,
      messageId: clean(delivery?.messageId),
      attempt: row.attempt_count,
    });
    return "accepted" as const;
  } catch (error) {
    // SMTP accepted the message, but the durable acknowledgement could not be
    // persisted. The expired lease will retry later (at-least-once delivery).
    console.error("[visio-booking][internal-alert-state-uncertain]", {
      deliveryKey: row.dedupe_key,
      messageId: clean(delivery?.messageId),
      code: visioBookingInternalAlertErrorCode(error),
    });
    return "uncertain" as const;
  }
}

export async function processVisioBookingInternalAlerts(options?: {
  googleEventId?: string;
  limit?: number;
}): Promise<VisioBookingInternalAlertBatchResult> {
  const limit = Math.min(25, Math.max(1, Math.floor(options?.limit || 10)));
  const result: VisioBookingInternalAlertBatchResult = {
    ok: true,
    claimed: 0,
    accepted: 0,
    retrying: 0,
    dead: 0,
    uncertain: 0,
  };
  // Claim immediately before each SMTP call. A slow first delivery therefore
  // cannot let leases expire on messages that this worker has not started.
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await supabaseAdmin.rpc(CLAIM_RPC, {
      p_limit: 1,
      p_lock_token: randomUUID(),
      p_google_event_id: clean(options?.googleEventId) || null,
      p_lease_seconds: Math.floor(CLAIM_LEASE_MS / 1000),
    });
    if (error) {
      throw new Error(`visio_booking_internal_alert_claim_failed:${error.message}`);
    }
    const row = (Array.isArray(data) ? data[0] : null) as AlertOutboxRow | null;
    if (!row) break;
    result.claimed += 1;
    const outcome = await deliverClaimedAlert(row);
    result[outcome] += 1;
  }
  result.ok = result.retrying === 0 && result.dead === 0 && result.uncertain === 0;
  return result;
}

export type VisioBookingInternalAlertInput = {
  googleEventId: string;
  prospectUserId: string;
  assignedMember: { id: string; name: string; email: string };
  prospect: {
    name: string;
    company: string;
    email: string;
    phone: string;
  };
  confirmation: {
    dateLabel: string;
    timeLabel: string;
    meetUrl: string;
    calendarUrl: string;
  };
};

function payloadsForInput(input: VisioBookingInternalAlertInput) {
  const recipients = buildVisioBookingInternalAlertRecipients({
    assignedMemberEmail: input.assignedMember.email,
    configuredRecipients: optionalEnv("INRCY_VISIO_BOOKING_ALERT_EMAIL", ""),
  });
  return recipients.map((recipient) =>
    buildVisioBookingInternalAlertPayload({
      googleEventId: input.googleEventId,
      prospectUserId: input.prospectUserId,
      recipient,
      assignedMemberId: input.assignedMember.id,
      assignedMemberName: input.assignedMember.name,
      prospectName: input.prospect.name,
      company: input.prospect.company,
      prospectEmail: input.prospect.email,
      prospectPhone: input.prospect.phone,
      dateLabel: input.confirmation.dateLabel,
      timeLabel: input.confirmation.timeLabel,
      meetUrl: input.confirmation.meetUrl,
      calendarUrl: input.confirmation.calendarUrl,
    }),
  );
}

export async function prepareVisioBookingInternalAlert(
  input: VisioBookingInternalAlertInput,
) {
  const payloads = payloadsForInput(input);
  const { error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .upsert(payloads.map((payload) => rowFromPayload(payload, "awaiting_google")), {
      onConflict: "dedupe_key",
      ignoreDuplicates: true,
    });
  if (error) {
    throw new Error(`visio_booking_internal_alert_prepare_failed:${error.message}`);
  }
  return { queued: payloads.length };
}

export async function listAwaitingVisioBookingInternalAlertIntents(limit = 10) {
  const boundedLimit = Math.min(25, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .select("google_event_id,prospect_user_id,created_at")
    .eq("status", "awaiting_google")
    .order("created_at", { ascending: true })
    .limit(boundedLimit * 4);
  if (error) {
    throw new Error(`visio_booking_internal_alert_intents_failed:${error.message}`);
  }
  const unique = new Map<string, {
    googleEventId: string;
    prospectUserId: string;
    createdAt: string;
  }>();
  for (const row of Array.isArray(data) ? data : []) {
    const googleEventId = clean(row.google_event_id);
    if (!googleEventId || unique.has(googleEventId)) continue;
    unique.set(googleEventId, {
      googleEventId,
      prospectUserId: clean(row.prospect_user_id),
      createdAt: clean(row.created_at),
    });
    if (unique.size >= boundedLimit) break;
  }
  return [...unique.values()];
}

export async function discardAwaitingVisioBookingInternalAlertIntent(
  googleEventId: string,
) {
  const { error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .delete()
    .eq("google_event_id", clean(googleEventId))
    .eq("status", "awaiting_google");
  if (error) {
    throw new Error(`visio_booking_internal_alert_discard_failed:${error.message}`);
  }
}

export async function ensureVisioBookingInternalAlert(
  input: VisioBookingInternalAlertInput,
) {
  const payloads = payloadsForInput(input);
  const { error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .upsert(payloads.map((payload) => rowFromPayload(payload, "pending")), {
      onConflict: "dedupe_key",
      ignoreDuplicates: true,
    });
  if (error) {
    throw new Error(`visio_booking_internal_alert_enqueue_failed:${error.message}`);
  }

  const deliveryKeys = payloads.map((payload) =>
    buildVisioBookingInternalAlertDeliveryKey({
      googleEventId: payload.googleEventId,
      recipient: payload.recipient,
    }),
  );
  const current = rowFromPayload(payloads[0], "pending");
  const { error: promotionError } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .update({
      assigned_member_id: current.assigned_member_id,
      assigned_member_name: current.assigned_member_name,
      prospect_name: current.prospect_name,
      company: current.company,
      prospect_email: current.prospect_email,
      prospect_phone: current.prospect_phone,
      date_label: current.date_label,
      time_label: current.time_label,
      meet_url: current.meet_url,
      calendar_url: current.calendar_url,
      subject: current.subject,
      body_text: current.body_text,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("dedupe_key", deliveryKeys)
    .eq("status", "awaiting_google");
  if (promotionError) {
    throw new Error(`visio_booking_internal_alert_promote_failed:${promotionError.message}`);
  }

  await processVisioBookingInternalAlerts({
    googleEventId: input.googleEventId,
    limit: Math.max(1, payloads.length),
  }).catch((processError: unknown) => {
    console.error("[visio-booking][internal-alert-process]", {
      googleEventId: input.googleEventId,
      code: visioBookingInternalAlertErrorCode(processError),
    });
  });
  return { queued: true } as const;
}

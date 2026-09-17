import "server-only";

import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getInrcyLogoInlineAttachments } from "@/lib/txEmailAssets";
import { sendTxMail } from "@/lib/txMailer";
import { smtpAcceptedVisioBookingRecipient } from "@/lib/visioBookingInternalAlertPolicy";
import {
  VISIO_BOOKING_CONFIRMATION_LOCK_TTL_MS,
  VISIO_BOOKING_CONFIRMATION_MAX_ATTEMPTS,
  buildVisioBookingConfirmationDeliveryKey,
  buildVisioBookingConfirmationPayload,
  visioBookingConfirmationErrorCode,
  visioBookingConfirmationRetryAt,
  type VisioBookingConfirmationPayload,
} from "@/lib/visioBookingConfirmationPolicy";

const OUTBOX_TABLE = "visio_booking_confirmation_outbox";
const CLAIM_RPC = "claim_visio_booking_confirmations";

type ConfirmationOutboxRow = {
  id: string;
  dedupe_key: string;
  google_event_id: string;
  prospect_user_id: string;
  recipient_email: string;
  prospect_name: string;
  company: string;
  assigned_member_id: string;
  assigned_member_name: string;
  date_label: string;
  time_label: string;
  meet_url: string;
  calendar_url: string;
  subject: string;
  body_text: string;
  body_html: string;
  status: "pending" | "processing" | "retry_wait" | "accepted" | "dead";
  attempt_count: number;
  max_attempts: number;
  lock_token: string | null;
};

export type VisioBookingConfirmationBatchResult = {
  ok: boolean;
  claimed: number;
  accepted: number;
  retrying: number;
  dead: number;
  uncertain: number;
};

export type VisioBookingConfirmationInput = {
  googleEventId: string;
  prospectUserId: string;
  prospect: { name: string; company: string; email: string };
  assignedMember: { id: string; name: string };
  confirmation: {
    dateLabel: string;
    timeLabel: string;
    meetUrl: string;
    calendarUrl: string;
  };
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function payloadForInput(input: VisioBookingConfirmationInput) {
  return buildVisioBookingConfirmationPayload({
    googleEventId: input.googleEventId,
    prospectUserId: input.prospectUserId,
    recipient: input.prospect.email,
    prospectName: input.prospect.name,
    company: input.prospect.company,
    assignedMemberId: input.assignedMember.id,
    assignedMemberName: input.assignedMember.name,
    dateLabel: input.confirmation.dateLabel,
    timeLabel: input.confirmation.timeLabel,
    meetUrl: input.confirmation.meetUrl,
    calendarUrl: input.confirmation.calendarUrl,
  });
}

function rowFromPayload(
  payload: VisioBookingConfirmationPayload,
  status: "awaiting_google" | "pending",
) {
  return {
    dedupe_key: buildVisioBookingConfirmationDeliveryKey({
      googleEventId: payload.googleEventId,
      recipient: payload.recipient,
    }),
    google_event_id: payload.googleEventId,
    prospect_user_id: payload.prospectUserId,
    recipient_email: payload.recipient,
    prospect_name: payload.prospectName,
    company: payload.company,
    assigned_member_id: payload.assignedMemberId,
    assigned_member_name: payload.assignedMemberName,
    date_label: payload.dateLabel,
    time_label: payload.timeLabel,
    meet_url: payload.meetUrl,
    calendar_url: payload.calendarUrl,
    subject: payload.subject,
    body_text: payload.text,
    body_html: payload.html,
    status,
    max_attempts: VISIO_BOOKING_CONFIRMATION_MAX_ATTEMPTS,
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function payloadFromRow(row: ConfirmationOutboxRow) {
  return buildVisioBookingConfirmationPayload({
    googleEventId: row.google_event_id,
    prospectUserId: row.prospect_user_id,
    recipient: row.recipient_email,
    prospectName: row.prospect_name,
    company: row.company,
    assignedMemberId: row.assigned_member_id,
    assignedMemberName: row.assigned_member_name,
    dateLabel: row.date_label,
    timeLabel: row.time_label,
    meetUrl: row.meet_url,
    calendarUrl: row.calendar_url,
  });
}

function deterministicMessageId(dedupeKey: string) {
  return `<visio-confirmation-${dedupeKey.replace(/^v1:/, "")}@inrcy.com>`;
}

async function persistAccepted(
  row: ConfirmationOutboxRow,
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
    lastError = error?.message || "confirmation_acceptance_write_conflict";
  }
  throw new Error(lastError || "confirmation_acceptance_write_failed");
}

async function persistFailure(row: ConfirmationOutboxRow, error: unknown) {
  const errorCode = visioBookingConfirmationErrorCode(error);
  const exhausted = row.attempt_count >= row.max_attempts;
  const nextAttemptAt = exhausted
    ? null
    : visioBookingConfirmationRetryAt({
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
    throw new Error(writeError?.message || "confirmation_failure_write_conflict");
  }
  return exhausted;
}

async function deliverClaimedConfirmation(row: ConfirmationOutboxRow) {
  const payload = payloadFromRow(row);
  let delivery: Awaited<ReturnType<typeof sendTxMail>>;
  try {
    delivery = await sendTxMail({
      to: payload.recipient,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      messageId: deterministicMessageId(row.dedupe_key),
      attachments: await getInrcyLogoInlineAttachments(),
    });
    if (!smtpAcceptedVisioBookingRecipient(payload.recipient, delivery?.accepted)) {
      throw new Error("visio_booking_confirmation_recipient_not_accepted");
    }
  } catch (error) {
    const exhausted = await persistFailure(row, error).catch((writeError: unknown) => {
      console.error("[visio-booking][confirmation-failure-state]", {
        deliveryKey: row.dedupe_key,
        code: visioBookingConfirmationErrorCode(writeError),
      });
      return false;
    });
    console.error("[visio-booking][confirmation-send]", {
      deliveryKey: row.dedupe_key,
      code: visioBookingConfirmationErrorCode(error),
      exhausted,
    });
    return exhausted ? "dead" as const : "retrying" as const;
  }

  try {
    await persistAccepted(row, delivery);
    console.info("[visio-booking][confirmation-accepted]", {
      deliveryKey: row.dedupe_key,
      messageId: clean(delivery?.messageId),
      attempt: row.attempt_count,
    });
    return "accepted" as const;
  } catch (error) {
    console.error("[visio-booking][confirmation-state-uncertain]", {
      deliveryKey: row.dedupe_key,
      messageId: clean(delivery?.messageId),
      code: visioBookingConfirmationErrorCode(error),
    });
    return "uncertain" as const;
  }
}

export async function processVisioBookingConfirmations(options?: {
  googleEventId?: string;
  limit?: number;
}): Promise<VisioBookingConfirmationBatchResult> {
  const limit = Math.min(25, Math.max(1, Math.floor(options?.limit || 10)));
  const result: VisioBookingConfirmationBatchResult = {
    ok: true,
    claimed: 0,
    accepted: 0,
    retrying: 0,
    dead: 0,
    uncertain: 0,
  };
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await supabaseAdmin.rpc(CLAIM_RPC, {
      p_limit: 1,
      p_lock_token: randomUUID(),
      p_google_event_id: clean(options?.googleEventId) || null,
      p_lease_seconds: Math.floor(VISIO_BOOKING_CONFIRMATION_LOCK_TTL_MS / 1000),
    });
    if (error) {
      throw new Error(`visio_booking_confirmation_claim_failed:${error.message}`);
    }
    const row = (Array.isArray(data) ? data[0] : null) as ConfirmationOutboxRow | null;
    if (!row) break;
    result.claimed += 1;
    const outcome = await deliverClaimedConfirmation(row);
    result[outcome] += 1;
  }
  result.ok = result.retrying === 0 && result.dead === 0 && result.uncertain === 0;
  return result;
}

export async function prepareVisioBookingConfirmation(
  input: Omit<VisioBookingConfirmationInput, "confirmation"> & {
    confirmation: Omit<VisioBookingConfirmationInput["confirmation"], "meetUrl" | "calendarUrl">;
  },
) {
  const googleEventId = clean(input.googleEventId);
  const prospectUserId = clean(input.prospectUserId);
  const recipient = clean(input.prospect.email).toLowerCase();
  const dateLabel = clean(input.confirmation.dateLabel);
  const timeLabel = clean(input.confirmation.timeLabel);
  const dedupeKey = buildVisioBookingConfirmationDeliveryKey({
    googleEventId,
    recipient,
  });
  if (!prospectUserId || !dateLabel || !timeLabel) {
    throw new Error("visio_booking_confirmation_invalid");
  }
  const now = new Date().toISOString();
  const row = {
    dedupe_key: dedupeKey,
    google_event_id: googleEventId,
    prospect_user_id: prospectUserId,
    recipient_email: recipient,
    prospect_name: clean(input.prospect.name) || "Professionnel iNrCy",
    company: clean(input.prospect.company),
    assigned_member_id: clean(input.assignedMember.id),
    assigned_member_name: clean(input.assignedMember.name) || "Équipe iNrCy",
    date_label: dateLabel,
    time_label: timeLabel,
    meet_url: "",
    calendar_url: "",
    subject: "",
    body_text: "",
    body_html: "",
    status: "awaiting_google",
    max_attempts: VISIO_BOOKING_CONFIRMATION_MAX_ATTEMPTS,
    next_attempt_at: now,
    updated_at: now,
  };
  const { error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) {
    throw new Error(`visio_booking_confirmation_prepare_failed:${error.message}`);
  }
  return { queued: true } as const;
}

export async function listAwaitingVisioBookingConfirmationIntents(limit = 10) {
  const boundedLimit = Math.min(25, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .select("google_event_id,prospect_user_id,created_at")
    .eq("status", "awaiting_google")
    .order("created_at", { ascending: true })
    .limit(boundedLimit);
  if (error) {
    throw new Error(`visio_booking_confirmation_intents_failed:${error.message}`);
  }
  return (Array.isArray(data) ? data : []).map((row) => ({
    googleEventId: clean(row.google_event_id),
    prospectUserId: clean(row.prospect_user_id),
    createdAt: clean(row.created_at),
  }));
}

export async function discardAwaitingVisioBookingConfirmationIntent(
  googleEventId: string,
) {
  const { error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .delete()
    .eq("google_event_id", clean(googleEventId))
    .eq("status", "awaiting_google");
  if (error) {
    throw new Error(`visio_booking_confirmation_discard_failed:${error.message}`);
  }
}

export async function ensureVisioBookingConfirmation(
  input: VisioBookingConfirmationInput,
) {
  const payload = payloadForInput(input);
  const pending = rowFromPayload(payload, "pending");
  const { error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .upsert(pending, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) {
    throw new Error(`visio_booking_confirmation_enqueue_failed:${error.message}`);
  }

  const { error: promotionError } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .update({
      prospect_name: pending.prospect_name,
      company: pending.company,
      assigned_member_id: pending.assigned_member_id,
      assigned_member_name: pending.assigned_member_name,
      date_label: pending.date_label,
      time_label: pending.time_label,
      meet_url: pending.meet_url,
      calendar_url: pending.calendar_url,
      subject: pending.subject,
      body_text: pending.body_text,
      body_html: pending.body_html,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("dedupe_key", pending.dedupe_key)
    .eq("status", "awaiting_google");
  if (promotionError) {
    throw new Error(`visio_booking_confirmation_promote_failed:${promotionError.message}`);
  }

  await processVisioBookingConfirmations({
    googleEventId: input.googleEventId,
    limit: 1,
  }).catch((error: unknown) => {
    console.error("[visio-booking][confirmation-process]", {
      googleEventId: input.googleEventId,
      code: visioBookingConfirmationErrorCode(error),
    });
  });
  return { queued: true } as const;
}

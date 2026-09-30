import { createHash } from "node:crypto";

export const INR_AGENT_READY_NOTICE_KIND = "inr_agent_editorial_batch_ready";
export const INR_AGENT_REMINDER_NOTICE_KIND =
  "inr_agent_editorial_validation_reminder";
export const INR_AGENT_VALIDATION_EMAIL_SCOPE_V1 =
  "inr_agent_validation_ready_email_v1";
export const INR_AGENT_VALIDATION_EMAIL_SCOPE_V2 =
  "inr_agent_validation_notice_email_v2";

const DAY_MS = 86_400_000;
const REMINDER_WINDOW_MS = DAY_MS;

type RecordLike = Record<string, unknown>;

export type PendingValidationAction = {
  id: string;
  scheduled_for: string | null;
};

export type ValidationNoticeHistory = {
  kind: string;
  created_at: string;
  meta: RecordLike | null;
};

export type ValidationEmailHistory = {
  scope: string;
  status: string;
  completed_at: string | null;
  metadata: RecordLike | null;
};

function asRecord(value: unknown): RecordLike {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function actionIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && !!id)
    : [];
}

function at(value: unknown): number {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parisDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function buildValidationNoticeDeliveryKey(args: {
  userId: string;
  now: Date;
  slot: "daily" | "urgent";
}): string {
  const digest = createHash("sha256")
    .update(`${args.userId}:${parisDay(args.now)}:${args.slot}`)
    .digest("hex");
  return `v2:${digest}`;
}

export function buildValidationNoticeDedupeKey(args: {
  userId: string;
  now: Date;
  kind: "ready" | "reminder";
}): string {
  return `inr-agent-editorial-${args.kind}:${args.userId}:${parisDay(args.now)}`;
}

/** Keep the reminder attached to the action, not to a mutable batch of pending IDs. */
export function chooseValidationNotices(args: {
  pending: PendingValidationAction[];
  notices: ValidationNoticeHistory[];
  emails: ValidationEmailHistory[];
  now: Date;
}) {
  const nowMs = args.now.getTime();
  const readyAt = new Map<string, number>();
  const remindedInApp = new Set<string>();
  const readyBatches = new Map<string, string[]>();
  for (const notice of args.notices) {
    const meta = asRecord(notice.meta);
    const ids = actionIds(meta.actionIds);
    if (notice.kind === INR_AGENT_READY_NOTICE_KIND) {
      const createdAt = at(notice.created_at);
      for (const id of ids) {
        readyAt.set(id, Math.min(readyAt.get(id) ?? Infinity, createdAt));
      }
      const signature = String(meta.batchSignature || "");
      if (signature) readyBatches.set(signature, ids);
    } else if (notice.kind === INR_AGENT_REMINDER_NOTICE_KIND) {
      for (const id of ids) remindedInApp.add(id);
    }
  }

  const lastEmailedAt = new Map<string, number>();
  const remindedByEmail = new Set<string>();
  let recentEmailCount = 0;
  for (const email of args.emails) {
    if (email.status !== "completed") continue;
    const sentAt = at(email.completed_at);
    if (sentAt > nowMs - DAY_MS && sentAt <= nowMs) recentEmailCount += 1;
    const meta = asRecord(email.metadata);
    const ids =
      email.scope === INR_AGENT_VALIDATION_EMAIL_SCOPE_V1
        ? readyBatches.get(String(meta.batchSignature || "")) || []
        : email.scope === INR_AGENT_VALIDATION_EMAIL_SCOPE_V2
          ? actionIds(meta.actionIds)
          : [];
    for (const id of ids) {
      lastEmailedAt.set(id, Math.max(lastEmailedAt.get(id) || 0, sentAt));
      if (meta.kind === "reminder") remindedByEmail.add(id);
    }
  }

  const newReady = args.pending.filter((row) => !readyAt.has(row.id));
  const dueSoon = args.pending.filter((row) => {
    const scheduled = at(row.scheduled_for);
    return scheduled > nowMs && scheduled <= nowMs + REMINDER_WINDOW_MS;
  });
  const inAppReminder = dueSoon.filter((row) => {
    const firstNoticeAt = readyAt.get(row.id) || 0;
    return (
      firstNoticeAt > 0 &&
      firstNoticeAt <= nowMs - DAY_MS &&
      !remindedInApp.has(row.id)
    );
  });
  const dueEmailAttention = dueSoon.filter((row) => {
    const lastSent = lastEmailedAt.get(row.id) || 0;
    return (
      !remindedByEmail.has(row.id) &&
      (!lastSent || lastSent <= nowMs - DAY_MS)
    );
  });
  const notEmailed = args.pending.filter((row) => !lastEmailedAt.has(row.id));
  const canSendNormal = recentEmailCount === 0;
  const canSendUrgent = recentEmailCount === 1 && dueEmailAttention.length > 0;

  let emailKind: "ready" | "reminder" | null = null;
  let emailActions: PendingValidationAction[] = [];
  let emailSlot: "daily" | "urgent" | null = null;
  if (canSendNormal || canSendUrgent) {
    if (dueEmailAttention.length) {
      emailKind = "reminder";
      emailActions = dueEmailAttention;
    } else if (canSendNormal && notEmailed.length) {
      emailKind = "ready";
      emailActions = notEmailed;
    }
    if (emailKind) emailSlot = canSendNormal ? "daily" : "urgent";
  }

  return {
    newReady,
    inAppReminder,
    emailKind,
    emailActions,
    emailSlot,
    recentEmailCount,
  };
}

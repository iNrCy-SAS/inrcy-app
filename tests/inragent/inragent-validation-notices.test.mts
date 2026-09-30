import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildValidationNoticeDedupeKey,
  buildValidationNoticeDeliveryKey,
  chooseValidationNotices,
  INR_AGENT_READY_NOTICE_KIND,
  INR_AGENT_REMINDER_NOTICE_KIND,
  INR_AGENT_VALIDATION_EMAIL_SCOPE_V1,
  INR_AGENT_VALIDATION_EMAIL_SCOPE_V2,
  type PendingValidationAction,
  type ValidationEmailHistory,
  type ValidationNoticeHistory,
} from "../../lib/inrAgentValidationNoticePolicy.ts";
import { buildInrAgentValidationEmail } from "../../lib/inrAgentValidationEmailPolicy.ts";

const NOW = new Date("2026-09-30T12:00:00.000Z");

function pending(id: string, scheduledFor = "2026-10-05T08:00:00.000Z"):
  PendingValidationAction {
  return { id, scheduled_for: scheduledFor };
}

function ready(ids: string[], createdAt = "2026-09-28T12:00:00.000Z", signature = "batch-1"):
  ValidationNoticeHistory {
  return {
    kind: INR_AGENT_READY_NOTICE_KIND,
    created_at: createdAt,
    meta: { actionIds: ids, batchSignature: signature },
  };
}

function sent(ids: string[], completedAt = "2026-09-28T12:00:00.000Z", kind = "ready"):
  ValidationEmailHistory {
  return {
    scope: INR_AGENT_VALIDATION_EMAIL_SCOPE_V2,
    status: "completed",
    completed_at: completedAt,
    metadata: { actionIds: ids, kind },
  };
}

test("ready publications alert independently of failed or unfinished siblings", () => {
  const decision = chooseValidationNotices({
    pending: [pending("a"), pending("b")],
    notices: [],
    emails: [],
    now: NOW,
  });
  assert.deepEqual(decision.newReady.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(decision.emailActions.map((row) => row.id), ["a", "b"]);
  assert.equal(decision.emailKind, "ready");
  assert.equal(decision.emailSlot, "daily");

  const server = readFileSync(
    new URL("../../lib/inrAgentEditorialPlanServer.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(server, /stillPreparing/);
});

test("validating one action does not re-alert the remaining action", () => {
  const decision = chooseValidationNotices({
    pending: [pending("b")],
    notices: [ready(["a", "b"])],
    emails: [
      {
        scope: INR_AGENT_VALIDATION_EMAIL_SCOPE_V1,
        status: "completed",
        completed_at: "2026-09-28T12:00:00.000Z",
        metadata: { batchSignature: "batch-1" },
      },
    ],
    now: NOW,
  });
  assert.equal(decision.newReady.length, 0);
  assert.equal(decision.emailKind, null);
});

test("an old ready notice without an email is caught up once", () => {
  const decision = chooseValidationNotices({
    pending: [pending("a")],
    notices: [ready(["a"])],
    emails: [],
    now: NOW,
  });
  assert.equal(decision.newReady.length, 0);
  assert.equal(decision.emailKind, "ready");
  assert.deepEqual(decision.emailActions.map((row) => row.id), ["a"]);
});

test("one pre-deadline reminder is chosen only for still-pending actions", () => {
  const action = pending("a", "2026-10-01T08:00:00.000Z");
  const first = chooseValidationNotices({
    pending: [action],
    notices: [ready(["a"])],
    emails: [sent(["a"])],
    now: NOW,
  });
  assert.deepEqual(first.inAppReminder.map((row) => row.id), ["a"]);
  assert.equal(first.emailKind, "reminder");
  assert.deepEqual(first.emailActions.map((row) => row.id), ["a"]);

  const again = chooseValidationNotices({
    pending: [action],
    notices: [
      ready(["a"]),
      {
        kind: INR_AGENT_REMINDER_NOTICE_KIND,
        created_at: "2026-09-30T12:01:00.000Z",
        meta: { actionIds: ["a"] },
      },
    ],
    emails: [sent(["a"]), sent(["a"], "2026-09-30T12:01:00.000Z", "reminder")],
    now: new Date("2026-09-30T12:02:00.000Z"),
  });
  assert.equal(again.inAppReminder.length, 0);
  assert.equal(again.emailKind, null);
});

test("daily email cap permits one urgent exception for a different due action", () => {
  const action = pending("b", "2026-10-01T08:00:00.000Z");
  const recent = sent(["a"], "2026-09-30T10:00:00.000Z");
  const ordinary = chooseValidationNotices({
    pending: [pending("b")],
    notices: [ready(["b"], "2026-09-30T10:00:00.000Z")],
    emails: [recent],
    now: NOW,
  });
  assert.equal(ordinary.emailKind, null);

  const first = chooseValidationNotices({
    pending: [action],
    notices: [ready(["b"], "2026-09-30T10:00:00.000Z")],
    emails: [recent],
    now: NOW,
  });
  assert.equal(first.emailKind, "reminder");
  assert.equal(first.emailSlot, "urgent");

  const capped = chooseValidationNotices({
    pending: [action],
    notices: [ready(["b"], "2026-09-30T10:00:00.000Z")],
    emails: [recent, sent(["c"], "2026-09-30T11:00:00.000Z")],
    now: NOW,
  });
  assert.equal(capped.emailKind, null);
});

test("a publication first announced today is not immediately reminded", () => {
  const decision = chooseValidationNotices({
    pending: [pending("a", "2026-10-01T08:00:00.000Z")],
    notices: [ready(["a"], "2026-09-30T11:00:00.000Z")],
    emails: [sent(["a"], "2026-09-30T11:00:00.000Z")],
    now: NOW,
  });
  assert.equal(decision.inAppReminder.length, 0);
  assert.equal(decision.emailKind, null);
});

test("delivery keys are stable within the Paris day", () => {
  const first = buildValidationNoticeDeliveryKey({
    userId: "account-a", now: NOW, slot: "daily",
  });
  const retry = buildValidationNoticeDeliveryKey({
    userId: "account-a", now: new Date("2026-09-30T18:00:00.000Z"), slot: "daily",
  });
  const nextDay = buildValidationNoticeDeliveryKey({
    userId: "account-a", now: new Date("2026-10-01T08:00:00.000Z"), slot: "daily",
  });
  assert.equal(first, retry);
  assert.notEqual(first, nextDay);
  assert.notEqual(first, buildValidationNoticeDeliveryKey({
    userId: "account-a", now: NOW, slot: "urgent",
  }));
  const bell = buildValidationNoticeDedupeKey({
    userId: "account-a", now: NOW, kind: "ready",
  });
  assert.equal(bell, buildValidationNoticeDedupeKey({
    userId: "account-a", now: new Date("2026-09-30T18:00:00.000Z"), kind: "ready",
  }));
  assert.notEqual(bell, buildValidationNoticeDedupeKey({
    userId: "account-a", now: new Date("2026-10-01T08:00:00.000Z"), kind: "ready",
  }));
});

test("reminder email names the deadline and keeps the validation link", () => {
  const mail = buildInrAgentValidationEmail({
    kind: "reminder",
    publicationCount: 1,
    horizonDays: 15,
    firstScheduledAt: "2026-10-01T08:00:00.000Z",
    dashboardUrl: "https://app.inrcy.com/dashboard/agent",
  });
  assert.match(mail.subject, /avant son échéance/);
  assert.match(mail.text, /heure de diffusion approche/);
  assert.match(mail.text, /https:\/\/app\.inrcy\.com\/dashboard\/agent/);
});

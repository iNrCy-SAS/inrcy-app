import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildInrAgentValidationEmail,
  buildInrAgentValidationEmailDeliveryKey,
  buildInrAgentValidationEmailMessageId,
} from "../../lib/inrAgentValidationEmailPolicy.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("the iNrAgent validation email is branded, explicit and actionable", () => {
  const mail = buildInrAgentValidationEmail({
    firstName: "Léa <test>",
    companyName: "Atelier Démo",
    publicationCount: 3,
    horizonDays: 15,
    firstScheduledAt: "2026-09-20T16:00:00.000Z",
    lastScheduledAt: "2026-09-27T17:00:00.000Z",
    dashboardUrl: "https://app.inrcy.com/dashboard/agent",
  });

  assert.match(mail.subject, /3 publications iNrAgent/);
  assert.match(mail.text, /Aucune diffusion ne partira sans votre validation/);
  assert.match(mail.text, /https:\/\/app\.inrcy\.com\/dashboard\/agent/);
  assert.match(mail.html, /cid:inrcy-logo@inrcy/);
  assert.match(mail.html, /Valider mes publications/);
  assert.match(mail.html, /Léa &lt;test&gt;/);
  assert.doesNotMatch(mail.html, /Léa <test>/);
});

test("the validation delivery identity is stable per account and batch", () => {
  const first = buildInrAgentValidationEmailDeliveryKey({
    userId: "account-a",
    batchSignature: "batch-1",
  });
  const retry = buildInrAgentValidationEmailDeliveryKey({
    userId: "account-a",
    batchSignature: "batch-1",
  });
  const other = buildInrAgentValidationEmailDeliveryKey({
    userId: "account-a",
    batchSignature: "batch-2",
  });

  assert.equal(first, retry);
  assert.notEqual(first, other);
  assert.match(first, /^v1:[0-9a-f]{64}$/);
  assert.match(
    buildInrAgentValidationEmailMessageId("batch-1"),
    /^<inr-agent-validation-[0-9a-f]{32}@inrcy\.com>$/,
  );
});

test("the ready-batch workflow sends the email behind a durable retryable lock", () => {
  const editorial = read("lib/inrAgentEditorialPlanServer.ts");
  const delivery = read("lib/inrAgentValidationEmailDelivery.ts");

  assert.match(editorial, /deliverInrAgentValidationReadyEmail\(\{/);
  assert.match(editorial, /firstScheduledAt:/);
  assert.match(editorial, /lastScheduledAt:/);
  assert.match(delivery, /acquireExecutionIdempotencyLock\(\{/);
  assert.match(delivery, /completeExecutionIdempotencyLockOrThrow\(\{/);
  assert.match(delivery, /failExecutionIdempotencyLock\(\{/);
  assert.match(delivery, /messageId,/);
  assert.match(delivery, /sendTxMail\(\{/);
});

test("missing prepared channels are requeued before the professional is notified", () => {
  const editorial = read("lib/inrAgentEditorialPlanServer.ts");

  assert.match(editorial, /missingGeneratedEditorialChannels\(/);
  assert.match(editorial, /editorialChannelRepairMissing: missingChannels/);
  assert.match(editorial, /status: "draft"/);
  assert.match(editorial, /channelRepairs/);
});

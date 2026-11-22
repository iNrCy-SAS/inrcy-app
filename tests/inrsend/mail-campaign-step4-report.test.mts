import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCampaignRecipientReport,
  buildMailCampaignExperienceReport,
  estimateCampaignDurationMs,
} from "../../lib/mailCampaignReport.ts";

const config = {
  batchSize: 5,
  sendDelayMs: 8_000,
  batchPauseMs: 60_000,
  hourlyLimit: 150,
  dailyLimit: 300,
  maxActivePerIntegration: 1,
  lockLeaseSeconds: 180,
};

test("l'estimation couvre les campagnes de 20, 200 et 300 destinataires", () => {
  assert.equal(estimateCampaignDurationMs({ remaining: 20, config }), 308_000);
  assert.equal(estimateCampaignDurationMs({ remaining: 200, config }), 3_620_000);
  assert.equal(estimateCampaignDurationMs({ remaining: 300, config }), 5_460_000);
});

test("Outlook reports the cadence of the base64 attachments and UTF-8 message with the minute batch limit", () => {
  const message = { provider: "microsoft", subject: "Offre", body_text: "Bonjour", attachments: [] };
  const file = { bucket: "files", path: "document.pdf", size: 4_000_000 };
  const estimate = (campaign: Record<string, unknown>, remaining = 2) =>
    estimateCampaignDurationMs({ campaign, remaining, config });
  assert.equal(estimate(message), 10_000);
  assert.equal(estimate(message, 6), 60_000);
  assert.equal(estimate({ ...message, attachments: [file] }, 3), 38_000);
  assert.equal(estimate({ ...message, attachments: [file, file] }), 34_000);
  assert.equal(estimate({ ...message, body_html: "é".repeat(1_500_001) }), 12_000);
  assert.equal(estimate({ ...message, provider: "gmail", attachments: [file] }, 3), 16_000);
});

test("Outlook withholds the ETA when legacy attachment sizes are unknown or exceed the transfer window", () => {
  const campaign = { provider: "microsoft", status: "queued", body_text: "Bonjour", total_count: 2 };
  for (const size of [undefined, null, "", 0, -1, 1.5, 80_000_000]) {
    const report = buildMailCampaignExperienceReport({
      campaign: { ...campaign, attachments: [{ bucket: "files", path: "doc.pdf", size }] },
      recipients: [{ status: "queued" }, { status: "queued" }],
      config,
    });
    assert.equal(report.estimatedRemainingMs, null);
    assert.equal(report.estimatedCompletionAt, null);
    assert.equal(report.counts.sent, 0);
  }
  const now = new Date("2026-11-22T12:00:00Z");
  const report = buildMailCampaignExperienceReport({
    campaign: { ...campaign, attachments: [], resume_at: "2026-11-22T12:01:00Z" },
    recipients: [{ status: "queued" }, { status: "queued" }],
    config,
    now,
  });
  assert.equal(report.estimatedRemainingMs, 70_000);
  assert.equal(report.estimatedCompletionAt, "2026-11-22T12:01:10.000Z");
});

test("le bilan distingue acceptation, livraison, rebonds et desinscription", () => {
  const counts = aggregateCampaignRecipientReport([
    { status: "sent", delivery_status: "accepted" },
    { status: "sent", delivery_status: "delivered" },
    { status: "failed", bounce_type: "hard", failure_retryable: false },
    { status: "failed", bounce_type: "soft", failure_retryable: true },
    { status: "failed", suppression_reason: "opt_out", unsubscribed_at: "2026-07-27T12:00:00Z" },
  ], 5);

  assert.equal(counts.accepted, 2);
  assert.equal(counts.delivered, 1);
  assert.equal(counts.hardBounce, 1);
  assert.equal(counts.softBounce, 1);
  assert.equal(counts.unsubscribed, 1);
  assert.equal(counts.blacklist, 0);
  assert.equal(counts.complaint, 0);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.retryable, 1);
});

test("le rapport final est persistant et atteint 100 pour cent", () => {
  const report = buildMailCampaignExperienceReport({
    campaign: {
      id: "campaign-1",
      status: "partial",
      total_count: 3,
      created_at: "2026-07-27T12:00:00Z",
      started_at: "2026-07-27T12:01:00Z",
      finished_at: "2026-07-27T12:05:00Z",
      completion_email_status: "failed",
      completion_email_attempts: 1,
      completion_email_last_error: "SMTP indisponible",
    },
    recipients: [
      { status: "sent", delivery_status: "accepted" },
      { status: "sent", delivery_status: "delivered" },
      { status: "failed", bounce_type: "hard", failure_retryable: false },
    ],
    config,
    now: new Date("2026-07-27T12:05:00Z"),
  });

  assert.equal(report.progressPercent, 100);
  assert.equal(report.estimatedRemainingMs, 0);
  assert.equal(report.durationMs, 240_000);
  assert.equal(report.completionEmail.status, "failed");
});

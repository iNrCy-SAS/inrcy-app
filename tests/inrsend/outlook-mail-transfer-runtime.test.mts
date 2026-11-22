import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const now = Date.parse("2026-11-22T09:00:00Z");
const mailbox = { integrationId: "outlook-box", userId: "mailbox-owner", accessToken: "test-token" };
const scope = { p_integration_id: mailbox.integrationId, p_user_id: mailbox.userId };
const allowed = { allowed: true };
type Reservation = { allowed: boolean; reason?: string; retry_at?: string };

function fixture(t: TestContext, reservations: Reservation[], response = new Response(null, { status: 202 })) {
  let clock = now;
  const operations: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const requests: Request[] = [];
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    operations.push("send");
    requests.push(new Request(url, init));
    return response;
  });

  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: {
      async rpc(name: string, args: Record<string, unknown>) {
        operations.push(name);
        rpcCalls.push({ name, args });
        if (name === "defer_outlook_mail_transfer") return { data: null, error: null };
        assert.equal(name, "reserve_outlook_mail_transfer");
        const reservation = reservations.shift();
        assert.ok(reservation, "unexpected extra reservation");
        return { data: [reservation], error: null };
      },
    } },
    "@/lib/mailCampaignPacing": {
      async waitForNextCampaignRecipient(ms: number) {
        operations.push(`wait ${ms}`);
        clock += ms;
      },
    },
  });
  const transport = load<typeof import("../../lib/inrsend/sendOutlookMailWithTransferBudget.ts")>("lib/inrsend/sendOutlookMailWithTransferBudget.ts");
  const campaign = { waitUntil: now + 30_000, beforeSend: async () => { operations.push("record attempt"); } };
  return { ...transport, campaign, operations, rpcCalls, requests };
}

test("a campaign reserves the UTF-8 bytes of the exact Graph JSON, including base64 attachments", async (t) => {
  const body = JSON.stringify({ message: {
    subject: "é".repeat(800),
    attachments: [{ name: "café.pdf", contentBytes: Buffer.alloc(2_249_000).toString("base64") }],
  }, saveToSentItems: true });
  const bytes = Buffer.byteLength(body, "utf8");
  assert.ok(body.length < 3_000_000 && bytes > 3_000_000, "only UTF-8 bytes cross this tier");
  const h = fixture(t, [allowed]);
  const result = await h.sendOutlookMailWithTransferBudget({ ...mailbox, body, campaign: h.campaign });
  assert.equal(result.status, 202);
  assert.deepEqual(h.operations, ["reserve_outlook_mail_transfer", "record attempt", "send"]);
  assert.deepEqual(h.rpcCalls[0].args, { ...scope, p_payload_bytes: bytes, p_min_interval_ms: 12_000 });
  assert.equal(h.requests[0].method, "POST");
  assert.equal(h.requests[0].url, "https://graph.microsoft.com/v1.0/me/sendMail");
  assert.equal(h.requests[0].headers.get("authorization"), `Bearer ${mailbox.accessToken}`);
  assert.equal(await h.requests[0].text(), body);
});

test("a reservation beyond the campaign deadline makes no Graph call and records no send attempt", async (t) => {
  const retryAt = new Date(now + 31_000).toISOString();
  const h = fixture(t, [{ allowed: false, reason: "pacing", retry_at: retryAt }]);
  await assert.rejects(h.sendOutlookMailWithTransferBudget({ ...mailbox, body: "{}", campaign: h.campaign }), (error) =>
    error instanceof h.OutlookTransferDeferred && error.reason === "outlook_transfer_budget" && error.resumeAt === retryAt);
  assert.deepEqual(h.operations, ["reserve_outlook_mail_transfer"]);
});

test("a campaign waits within its deadline, reserves again and only then records its attempt", async (t) => {
  const retryAt = new Date(now + 12_000).toISOString();
  const h = fixture(t, [{ allowed: false, reason: "pacing", retry_at: retryAt }, allowed]);
  await h.sendOutlookMailWithTransferBudget({ ...mailbox, body: "{}", campaign: h.campaign });
  assert.deepEqual(h.operations, ["reserve_outlook_mail_transfer", "wait 12000", "reserve_outlook_mail_transfer", "record attempt", "send"]);
  assert.deepEqual(h.rpcCalls[0].args, h.rpcCalls[1].args);
});

test("a Graph 429 preserves the response and shares the provider's Retry-After with ordinary mail from the same mailbox", async (t) => {
  const retryAt = new Date(now + 125_000).toISOString();
  const response = new Response("TooManyRequests", { status: 429, headers: { "Retry-After": "125" } });
  const h = fixture(t, [allowed, { allowed: false, reason: "provider_cooldown", retry_at: retryAt }], response);
  const result = await h.sendOutlookMailWithTransferBudget({ ...mailbox, body: "{}", campaign: h.campaign });
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("retry-after"), "125");
  assert.equal(await result.text(), "TooManyRequests");
  assert.deepEqual(h.rpcCalls[1], { name: "defer_outlook_mail_transfer", args: { ...scope, p_retry_at: retryAt } });
  await assert.rejects(h.sendOutlookMailWithTransferBudget({ ...mailbox, body: "{}" }), (error) =>
    error instanceof h.OutlookTransferDeferred && error.reason === "rate_limited" && error.resumeAt === retryAt);
  assert.deepEqual(h.rpcCalls[2].args, { ...scope, p_payload_bytes: 2, p_min_interval_ms: 0 });
  assert.deepEqual(h.operations, ["reserve_outlook_mail_transfer", "record attempt", "send", "defer_outlook_mail_transfer", "reserve_outlook_mail_transfer"]);
});

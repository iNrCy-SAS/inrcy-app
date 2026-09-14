import assert from "node:assert/strict";
import test from "node:test";
import { Webhook } from "standardwebhooks";

import {
  verifyResendAuthEmailWebhook,
  verifySupabaseAuthEmailHook,
} from "../../lib/authMailWebhookSecurity.ts";

const SECRET = `whsec_${Buffer.from("local-test-secret-that-never-leaves-tests").toString("base64")}`;

function signed(rawBody: string, id: string) {
  const timestamp = new Date();
  const verifier = new Webhook(SECRET);
  return {
    id,
    timestamp: String(Math.floor(timestamp.valueOf() / 1_000)),
    signature: verifier.sign(id, timestamp, rawBody),
  };
}

test("verifies a signed Supabase Auth hook and supports the v1 secret prefix", () => {
  const rawBody = JSON.stringify({ user: { id: "local" }, email_data: { token: "secret" } });
  const headers = signed(rawBody, "supabase-local-1");
  const verified = verifySupabaseAuthEmailHook({
    rawBody,
    headers,
    secret: `v1,${SECRET}`,
  }) as unknown as Record<string, unknown>;
  assert.ok(verified.user);
  assert.throws(() => verifySupabaseAuthEmailHook({
    rawBody: `${rawBody} `,
    headers,
    secret: `v1,${SECRET}`,
  }));
});

test("verifies a signed Resend webhook locally without making a network request", () => {
  const rawBody = JSON.stringify({
    type: "email.delivered",
    created_at: "2026-09-15T00:00:00.000Z",
    data: { email_id: "local-email", tags: { category: "auth" } },
  });
  const headers = signed(rawBody, "resend-local-1");
  const verified = verifyResendAuthEmailWebhook({
    rawBody,
    headers,
    webhookSecret: SECRET,
    apiKey: "re_test_key_not_used_for_signature_verification",
  }) as unknown as Record<string, unknown>;
  assert.equal(verified.type, "email.delivered");
  assert.throws(() => verifyResendAuthEmailWebhook({
    rawBody: rawBody.replace("delivered", "bounced"),
    headers,
    webhookSecret: SECRET,
    apiKey: "re_test_key_not_used_for_signature_verification",
  }));
});

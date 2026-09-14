import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthMailPayloadError,
  buildPreparedAuthEmails,
  normalizeResendAuthEvent,
  parseSupabaseAuthEmailHookPayload,
} from "../../lib/authMailPolicy.ts";

const USER_ID = "5d524543-6f8b-4594-b1b4-5b7b128ab32e";

type RawPayload = {
  user: Record<string, unknown>;
  email_data: Record<string, unknown>;
};

function rawPayload(): RawPayload {
  return {
    user: {
      id: USER_ID,
      email: "pro@example.com",
      user_metadata: { first_name: "Camille" },
    },
    email_data: {
      token: "123456",
      token_hash: "hash-primary",
      redirect_to: "https://app.inrcy.com/auth/finish-invite/fr",
      email_action_type: "invite",
      site_url: "https://app.inrcy.com",
      token_new: "",
      token_hash_new: "",
    },
  };
}

test("parses the documented Supabase email_data contract", () => {
  const payload = parseSupabaseAuthEmailHookPayload(rawPayload());
  assert.equal(payload.user.id, USER_ID);
  assert.equal(payload.user.email, "pro@example.com");
  assert.equal(payload.emailData.action, "invite");
  assert.equal(payload.emailData.tokenHash, "hash-primary");
});

test("rejects the historic email property typo instead of silently sending a broken link", () => {
  const source = rawPayload();
  const invalid = { user: source.user, email: source.email_data };
  assert.throws(
    () => parseSupabaseAuthEmailHookPayload(invalid),
    (error: unknown) => error instanceof AuthMailPayloadError && error.code === "unsupported_action",
  );
});

test("builds one deterministic invitation with one clean query string", () => {
  const payload = parseSupabaseAuthEmailHookPayload(rawPayload());
  const first = buildPreparedAuthEmails({
    payload,
    hookId: "hook-invite-001",
    appOrigin: "https://app.inrcy.com",
  })[0];
  const replay = buildPreparedAuthEmails({
    payload,
    hookId: "hook-invite-001",
    appOrigin: "https://app.inrcy.com",
  })[0];
  const newRequest = buildPreparedAuthEmails({
    payload,
    hookId: "hook-invite-002",
    appOrigin: "https://app.inrcy.com",
  })[0];

  assert.equal(first.deliveryKey, replay.deliveryKey);
  assert.equal(first.providerIdempotencyKey, replay.providerIdempotencyKey);
  assert.notEqual(first.deliveryKey, newRequest.deliveryKey);
  const urlText = first.text.match(/https:\/\/[^\s]+/)?.[0];
  assert.ok(urlText);
  const url = new URL(urlText);
  assert.equal(url.pathname, "/auth/finish-invite/fr");
  assert.equal(url.searchParams.get("token_hash"), "hash-primary");
  assert.equal(url.searchParams.get("type"), "invite");
  assert.equal(url.searchParams.get("email"), "pro@example.com");
  assert.equal((urlText.match(/\?/g) || []).length, 1);
});

test("rejects a redirect to an untrusted origin", () => {
  const source = rawPayload();
  source.email_data.redirect_to = "https://attacker.example/steal";
  const payload = parseSupabaseAuthEmailHookPayload(source);
  assert.throws(
    () => buildPreparedAuthEmails({
      payload,
      hookId: "hook-malicious",
      appOrigin: "https://app.inrcy.com",
    }),
    (error: unknown) => error instanceof AuthMailPayloadError && error.code === "invalid_redirect_origin",
  );
});

test("keeps invitation links valid for every application language", () => {
  for (const language of ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"]) {
    const source = rawPayload();
    source.email_data.redirect_to = `https://app.inrcy.com/auth/finish-invite/${language}`;
    const message = buildPreparedAuthEmails({
      payload: parseSupabaseAuthEmailHookPayload(source),
      hookId: `hook-${language}`,
      appOrigin: "https://app.inrcy.com",
    })[0];
    const urlText = message.text.match(/https:\/\/[^\s]+/)?.[0];
    assert.ok(urlText);
    assert.equal(new URL(urlText).pathname, `/auth/finish-invite/${language}`);
  }
});

test("uses Supabase's secure email-change hash mapping for both recipients", () => {
  const source = rawPayload();
  source.user = {
    ...source.user,
    email: "old@example.com",
    new_email: "new@example.com",
  };
  source.email_data = {
    ...source.email_data,
    email_action_type: "email_change",
    redirect_to: "https://app.inrcy.com/dashboard",
    token_hash: "hash-for-new-email",
    token_hash_new: "hash-for-current-email",
  };
  const messages = buildPreparedAuthEmails({
    payload: parseSupabaseAuthEmailHookPayload(source),
    hookId: "hook-email-change",
    appOrigin: "https://app.inrcy.com",
  });
  assert.deepEqual(messages.map((message) => message.recipient), ["old@example.com", "new@example.com"]);
  assert.match(messages[0].text, /hash-for-current-email/);
  assert.match(messages[1].text, /hash-for-new-email/);
  assert.notEqual(messages[0].deliveryKey, messages[1].deliveryKey);
});

test("escapes untrusted profile metadata in HTML", () => {
  const source = rawPayload();
  source.user = {
    ...source.user,
    user_metadata: { first_name: "<img src=x onerror=alert(1)>" },
  };
  const message = buildPreparedAuthEmails({
    payload: parseSupabaseAuthEmailHookPayload(source),
    hookId: "hook-xss",
    appOrigin: "https://app.inrcy.com",
  })[0];
  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.html, /&lt;img/);
});

test("normalizes delayed, suppressed and non-Auth Resend events without confusing delivery", () => {
  const baseData = {
    email_id: "provider-email-id",
    created_at: "2026-09-15T00:00:00.000Z",
    to: ["pro@example.com"],
    tags: {
      category: "auth",
      delivery_hash: "a".repeat(64),
    },
  };
  const delayed = normalizeResendAuthEvent({
    type: "email.delivery_delayed",
    created_at: "2026-09-15T00:00:01.000Z",
    data: baseData,
  });
  assert.equal(delayed.kind, "event");
  if (delayed.kind === "event") {
    assert.equal(delayed.status, "delayed");
    assert.notEqual(delayed.status, "delivered");
  }

  const suppressed = normalizeResendAuthEvent({
    type: "email.suppressed",
    created_at: "2026-09-15T00:00:02.000Z",
    data: { ...baseData, suppressed: { type: "bounce", message: "Mailbox unavailable" } },
  });
  assert.equal(suppressed.kind, "event");
  if (suppressed.kind === "event") {
    assert.equal(suppressed.status, "suppressed");
    assert.equal(suppressed.deliveryKey, `v1:${"a".repeat(64)}`);
  }

  const campaign = normalizeResendAuthEvent({
    type: "email.bounced",
    created_at: "2026-09-15T00:00:03.000Z",
    data: { ...baseData, tags: { category: "campaign" } },
  });
  assert.deepEqual(campaign, { kind: "ignored", reason: "not_auth" });
});

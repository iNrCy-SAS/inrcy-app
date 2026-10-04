import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coalescePasswordLinkPrepare } from "../../lib/authPasswordPrepare.ts";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("invite OTP is checked before any password form or write", () => {
  const route = read("app/api/auth/finish-password/route.ts");
  const client = read("app/auth/_components/FinishEmailLinkClient.tsx");
  const getBlock = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const postBlock = route.slice(route.indexOf("export async function POST"));

  assert.doesNotMatch(getBlock, /verifyOtp/, "GET must never consume the one-time link");
  assert.ok(postBlock.indexOf('body?.phase === "prepare"') < postBlock.indexOf("evaluatePassword(password)"));
  assert.match(postBlock, /if \(sealedContinuation\) \{[\s\S]*validateSealedContinuation\(sealedContinuation\)/);
  assert.match(postBlock, /stage: "prepare_otp"/);
  assert.match(postBlock, /linkFingerprint: passwordLinkFingerprint\(tokenHash\)/);
  assert.match(client, /coalescePasswordLinkPrepare\(key,/);
  assert.ok(client.indexOf("if (hasIncomingLinkError && !tokenHash)") < client.indexOf("supabase.auth\n        .getUser()"));
  assert.match(client, /ready && hasCredential \? <form/);
  assert.doesNotMatch(client, /const hasCredential = Boolean\([^\n]*tokenHash/);
  assert.match(client, /showExpired \? t\("linkExpiredTitle"\)/);
  assert.match(client, /data-testid="auth-resend-link"/);
  assert.match(client, /const canResend = ready && !accountUnavailable && linkRejected && !hasCredential && isValidResendEmail\(resendEmail\)/);
});

test("StrictMode double mount verifies one-time OTP once, then releases the request", async () => {
  let calls = 0;
  let complete!: (value: string) => void;
  const first = coalescePasswordLinkPrepare("invite:strict-mode-token", () => {
    calls += 1;
    return new Promise<string>((resolve) => { complete = resolve; });
  });
  const second = coalescePasswordLinkPrepare("invite:strict-mode-token", async () => {
    calls += 1;
    return "unexpected second verification";
  });

  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  complete("verified");
  assert.deepEqual(await Promise.all([first, second]), ["verified", "verified"]);

  const afterCompletion = await coalescePasswordLinkPrepare("invite:strict-mode-token", async () => {
    calls += 1;
    return "sealed continuation checked by the server";
  });
  assert.equal(afterCompletion, "sealed continuation checked by the server");
  assert.equal(calls, 2);
});

test("successful resend responses cannot reveal whether an invitee exists", () => {
  const route = read("app/api/auth/resend-link/route.ts");
  const successes = [...route.matchAll(/NextResponse\.json\(\{ ok: true, message: genericSuccessMessage\(\) \}/g)];

  assert.equal(successes.length, 3, "reset, unknown invite and new invite have identical success bodies");
  assert.match(route, /message: genericSuccessMessage\(\)/, "existing-user recovery fallback is also generic");
  assert.match(route, /if \(isExistingAuthUserError\(inviteResult\.error\)\)/);
  assert.match(route, /return sendFailed\(\)/, "provider failures must not be reported as success");
  assert.doesNotMatch(route, /successMessage\(mode, email\)|genericInviteMessage\(email\)/);
});

test("expired-link and generic resend messages exist in each supported locale", () => {
  for (const locale of ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const auth = JSON.parse(read(`messages/${locale}/auth.json`));
    assert.equal(typeof auth.password.linkExpiredTitle, "string", locale);
    assert.equal(typeof auth.password.resendRequestReceived, "string", locale);
  }
});

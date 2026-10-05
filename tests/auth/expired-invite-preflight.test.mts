import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("email-link GET and page load never consume an OTP", () => {
  const route = read("app/api/auth/finish-password/route.ts");
  const client = read("app/auth/_components/FinishEmailLinkClient.tsx");
  const getBlock = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const postBlock = route.slice(route.indexOf("export async function POST"));
  const pageLoad = client.slice(client.indexOf("const prepareCredential = async () => {"), client.indexOf("void prepareCredential();"));

  assert.doesNotMatch(getBlock, /verifyOtp/, "GET must never consume the one-time link");
  assert.doesNotMatch(pageLoad, /prepareEmailLink|verifyOtp|method: "POST"/, "mounting the page must not consume the token");
  assert.match(pageLoad, /if \(tokenHash\) \{[\s\S]*setReady\(true\);\s*return;/);
  assert.ok(client.indexOf("if (hasIncomingLinkError && !tokenHash)") < client.indexOf("supabase.auth\n        .getUser()"));
  assert.match(client, /const pendingTokenHash = ready && validTokenHash && !linkRejected && !accountUnavailable/);
  assert.match(client, /ready && hasCredential \? <form/);
  assert.ok(postBlock.indexOf("evaluatePassword(password)") < postBlock.indexOf("const { data, error: verifyError } = await supabaseAuth.auth.verifyOtp("), "a rejected password must not consume the token");
  assert.match(client, /showExpired \? t\("linkExpiredTitle"\)/);
  assert.match(client, /data-testid="auth-resend-link"/);
  assert.match(client, /const showResend = ready && !accountUnavailable && linkRejected && !hasCredential &&/);
  assert.match(client, /const canResend = showResend && isValidResendEmail\(resendEmail\)/);
  assert.match(client, /data-testid="auth-resend-email"/);
});

test("a browser signed in as another account switches before consuming the one-time link", () => {
  const client = read("app/auth/_components/FinishEmailLinkClient.tsx");
  const switchGuard = client.indexOf("if (expectedEmail && currentEmail && currentEmail !== expectedEmail)");
  const pendingToken = client.indexOf("if (tokenHash) {\n        // Email security scanners");

  assert.ok(switchGuard >= 0, "the expected address must be checked even when a token is present");
  assert.ok(pendingToken > switchGuard, "account switching must precede the token-ready state");
  assert.match(client.slice(switchGuard, pendingToken), /window\.location\.replace\(buildSwitchAccountUrl\(currentEmail, expectedEmail\)\);\s*return;/);
});

test("the final submit sends the token with the password or reuses a verified continuation", () => {
  const client = read("app/auth/_components/FinishEmailLinkClient.tsx");
  assert.match(client, /if \(!continuation && !serverContinuationAvailable && !pendingTokenHash\)/);
  assert.match(client, /token_hash: credential \|\| continueOnServer \? undefined : tokenHash/);
  assert.match(client, /await submitPassword\(continuation, true, serverContinuationAvailable\)/);
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
    assert.equal(typeof auth.password.inviteResendTitle, "string", locale);
    assert.equal(typeof auth.password.inviteResendGuidance, "string", locale);
    assert.equal(typeof auth.password.resendAddressUsed, "string", locale);
  }
});

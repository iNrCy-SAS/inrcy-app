import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTemporarySignupCredential, buildSignupWelcomeEmail, sealSignupPassword, openSignupPassword } from "../../lib/signupWelcomeMailPolicy.ts";
import { getTemporaryPasswordMetadata, isTemporaryPasswordExpiredError } from "../../lib/temporaryPasswordPolicy.ts";
import { evaluatePassword } from "../../lib/passwordPolicy.ts";

const now = new Date("2026-10-26T10:12:13.456Z");
const secret = "synthetic-only-server-secret-keep-out-of-client";

test("each new credential is random, satisfies existing policy and lasts exactly30days independently of trial", () => {
  const passwords = new Set<string>();
  for (let index = 0; index < 100; index++) {
    const value = createTemporarySignupCredential(now);
    passwords.add(value.password);
    assert.equal(value.password.length, 20);
    assert.equal(evaluatePassword(value.password).isAcceptable, true);
    assert.equal(Date.parse(value.metadata.expires_at) - Date.parse(value.metadata.issued_at), 30 * 86_400_000);
    assert.match(value.metadata.welcome_id, /^[a-f0-9-]{36}$/);
    assert.doesNotMatch(JSON.stringify(value.metadata), new RegExp(value.password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(passwords.size, 100);
});

test("outbox encryption is nondeterministic, bound to one welcome, authenticated and never plaintext", () => {
  const { password, metadata } = createTemporarySignupCredential(now);
  const first = sealSignupPassword(password, metadata.welcome_id, secret);
  const second = sealSignupPassword(password, metadata.welcome_id, secret);
  assert.notEqual(first, second);
  assert.equal(openSignupPassword(first, metadata.welcome_id, secret), password);
  assert.equal(first.includes(password), false);
  assert.equal(openSignupPassword(first, "another-welcome", secret), null);
  assert.equal(openSignupPassword(first, metadata.welcome_id, secret + "bad"), null);
  const tampered = Buffer.from(first, "base64url"); tampered[30] ^= 1;
  assert.equal(openSignupPassword(tampered.toString("base64url"), metadata.welcome_id, secret), null);
});

test("welcome email supplies password only in email content, login pre-fills email without password/token in URL", () => {
  const { password, metadata } = createTemporarySignupCredential(now);
  const args = { welcomeId: metadata.welcome_id, userId: "synthetic-user", email: "synthetic+test@example.com", firstName: '<img src=x onerror="bad()">', language: "fr", password, expiresAt: metadata.expires_at, appOrigin: "https://app.inrcy.com" };
  const mail = buildSignupWelcomeEmail(args);
  assert.equal(mail.action, "signup");
  assert.match(mail.subject, /Bienvenue/);
  assert.ok(mail.text.includes(password));
  assert.match(mail.text, /30 jours/);
  assert.match(mail.html, /&lt;img/);
  assert.doesNotMatch(mail.html, /<img/);
  const url = new URL(mail.text.match(/https:\/\/app\.inrcy\.com\/login\?[^\s]+/)![0]);
  assert.equal(url.searchParams.get("email"), args.email);
  assert.equal(url.searchParams.get("lang"), "fr");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["email", "lang"]);
  assert.equal(url.toString().includes(password), false);
  assert.equal(buildSignupWelcomeEmail(args).providerIdempotencyKey, mail.providerIdempotencyKey);
  assert.throws(() => buildSignupWelcomeEmail({ ...args, appOrigin: "http://evil.invalid" }), /origin_invalid/);
});

test("presentation reads only server app metadata and recognises expired credentials without showing raw errors", () => {
  const value = createTemporarySignupCredential(now);
  assert.equal(getTemporaryPasswordMetadata({ inrcy_temporary_password: value.metadata })?.expires_at, value.metadata.expires_at);
  assert.equal(getTemporaryPasswordMetadata({ user_metadata: { inrcy_temporary_password: value.metadata } }), null);
  assert.equal(isTemporaryPasswordExpiredError({ message: "temporary_password_expired: private details" }), true);
  assert.equal(isTemporaryPasswordExpiredError({ message: "invalid credentials" }), false);
  const login = readFileSync("app/login/page.tsx", "utf8");
  assert.match(login, /get\("email"\)/);
  assert.doesNotMatch(login, /get\("password"\)/);
});

test("public signup sends welcome only after provisioning, never returns credentials or changes trial duration", () => {
  const source = readFileSync("app/api/public/trial-signup/route.ts", "utf8");
  assert.doesNotMatch(source, /inviteUserByEmail/);
  assert.match(source, /auth\.admin\.createUser\(/);
  assert.ok(source.indexOf("await ensurePrincipalInrcyAccountProvisioned") < source.indexOf("await deliverSignupWelcome"));
  assert.ok(source.indexOf("await markPublicSignupTrialCompleted") < source.indexOf("await deliverSignupWelcome"));
  assert.match(source, /getTrialDays\(\)/);
  const response = source.slice(source.indexOf("return jsonResponse({\n      ok: true,\n      user_id:"));
  assert.doesNotMatch(response.split("} catch")[0], /password:|welcome\.password|encrypted_password/);
  assert.match(readFileSync("lib/trialSubscription.ts", "utf8"), /INRCY_TRIAL_DAYS", "21"/);
});

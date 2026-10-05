import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getInterruptedPublicSignupClaim,
  recoverInterruptedPublicInviteSignup,
  type InterruptedInviteRecoveryDependencies,
} from "../../lib/interruptedInviteSignupRecoveryFlow.ts";
import {
  createSignupRecoveryProof,
  SIGNUP_RECOVERY_MAX_AGE_MS,
  SIGNUP_RECOVERY_METADATA_KEY,
  SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY,
  verifySignupRecoveryProof,
} from "../../lib/signupRecoveryProof.ts";
import {
  createSignupFormSnapshot,
  SIGNUP_FORM_METADATA_KEY,
} from "../../lib/signupFormSnapshot.ts";

const secret = "test-only-webhook-secret";
const issuedAt = "2026-10-04T08:00:00.000Z";
const nowMs = Date.parse("2026-10-05T08:00:00.000Z");
const snapshot = createSignupFormSnapshot({
  email: "pro@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: "Analytical Engines",
  phone: "+33123456789",
  consent: true,
});
const proof = createSignupRecoveryProof(snapshot, secret, { issuedAt, trialDays: 21 });

type InviteUser = {
  id: string;
  email: string;
  invited_at: string | null;
  user_metadata: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

const authUser: InviteUser = {
  id: "auth-user-1",
  email: snapshot.email,
  invited_at: issuedAt,
  user_metadata: {
    app_language: "fr",
    [SIGNUP_FORM_METADATA_KEY]: snapshot,
    [SIGNUP_RECOVERY_METADATA_KEY]: proof,
  },
};

function dependencies(input?: { subscribed?: boolean; completed?: boolean; failOnceAt?: string }) {
  const calls: string[] = [];
  let subscribed = input?.subscribed || false;
  let completed = input?.completed || false;
  let failure = input?.failOnceAt || "";
  function step(name: string) {
    calls.push(name);
    if (failure === name) {
      failure = "";
      throw new Error(`failed at ${name}`);
    }
  }

  const deps: InterruptedInviteRecoveryDependencies<InviteUser> = {
    async getAuthUser() {
      step("auth lookup");
      return {
        ...authUser,
        app_metadata: completed ? { [SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY]: issuedAt } : {},
      };
    },
    async hasSubscription() {
      step("subscription lookup");
      return subscribed;
    },
    async ensurePrincipal() { step("principal"); },
    async ensureBubbleDefaults() { step("bubble defaults"); },
    async ensureProfile(_user, claim) {
      assert.equal(claim.snapshot.firstName, "Ada");
      assert.equal(claim.snapshot.companyName, "Analytical Engines");
      step("profile");
    },
    async ensureBusinessLanguage() { step("business language"); },
    async ensureNotificationPreferences() { step("notification preferences"); },
    async seedWelcomeNotifications() { step("welcome notifications"); },
    async ensureMissingTrial(_userId, _email, claim) {
      assert.equal(claim.trialStartAt, issuedAt);
      assert.equal(claim.trialEndAt, "2026-10-25T08:00:00.000Z");
      step("trial");
      subscribed = true;
    },
    async markCompleted() {
      step("completion marker");
      completed = true;
    },
  };
  return { deps, calls };
}

test("the signed snapshot fixes the original trial window and detects all tampering", () => {
  assert.deepEqual(verifySignupRecoveryProof(authUser.user_metadata, secret, nowMs), {
    snapshot,
    trialStartAt: issuedAt,
    trialEndAt: "2026-10-25T08:00:00.000Z",
  });
  assert.equal(verifySignupRecoveryProof(authUser.user_metadata, "wrong-secret", nowMs), null);
  assert.equal(verifySignupRecoveryProof({ ...authUser.user_metadata, [SIGNUP_FORM_METADATA_KEY]: { ...snapshot, companyName: "Forged" } }, secret, nowMs), null);
  assert.equal(verifySignupRecoveryProof({ ...authUser.user_metadata, [SIGNUP_RECOVERY_METADATA_KEY]: { ...proof, trialDays: 90 } }, secret, nowMs), null);
  assert.equal(verifySignupRecoveryProof({ ...authUser.user_metadata, [SIGNUP_RECOVERY_METADATA_KEY]: { ...proof, signature: "0".repeat(64) } }, secret, nowMs), null);
  assert.equal(verifySignupRecoveryProof(authUser.user_metadata, secret, Date.parse(issuedAt) + SIGNUP_RECOVERY_MAX_AGE_MS + 1), null);
});

test("only the matching public invitation with a valid HMAC can recover", () => {
  assert.ok(getInterruptedPublicSignupClaim(authUser, authUser.id, authUser.email, secret, nowMs));
  assert.equal(getInterruptedPublicSignupClaim(authUser, "another-user", authUser.email, secret, nowMs), null);
  assert.equal(getInterruptedPublicSignupClaim(authUser, authUser.id, "other@example.com", secret, nowMs), null);
  assert.equal(getInterruptedPublicSignupClaim({ ...authUser, invited_at: null }, authUser.id, authUser.email, secret, nowMs), null);
  assert.equal(getInterruptedPublicSignupClaim({ ...authUser, user_metadata: { app_language: "fr", [SIGNUP_FORM_METADATA_KEY]: snapshot } }, authUser.id, authUser.email, secret, nowMs), null);
});

test("a completed trial cannot be granted again even when its subscription was removed", async () => {
  const { deps, calls } = dependencies({ completed: true, subscribed: false });
  assert.equal(await recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, deps, nowMs), "already_claimed");
  assert.deepEqual(calls, ["auth lookup"]);
});

test("an existing subscription receives a durable completion marker without changing the trial", async () => {
  const { deps, calls } = dependencies({ subscribed: true });
  assert.equal(await recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, deps, nowMs), "already_provisioned");
  assert.deepEqual(calls, ["auth lookup", "subscription lookup", "completion marker"]);
});

test("marker service failure cannot block password setup for an existing subscription", async () => {
  const { deps, calls } = dependencies({ subscribed: true, failOnceAt: "completion marker" });
  const failures: unknown[] = [];
  deps.onExistingSubscriptionMarkerFailure = (_userId, error) => failures.push(error);
  assert.equal(await recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, deps, nowMs), "already_provisioned");
  assert.deepEqual(calls, ["auth lookup", "subscription lookup", "completion marker"]);
  assert.equal(failures.length, 1);
});

test("recovery completes account setup, inserts the original trial window, and replay does nothing", async () => {
  const { deps, calls } = dependencies();
  assert.equal(await recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, deps, nowMs), "recovered");
  assert.deepEqual(calls, [
    "auth lookup",
    "subscription lookup",
    "principal",
    "bubble defaults",
    "profile",
    "business language",
    "notification preferences",
    "welcome notifications",
    "trial",
    "completion marker",
  ]);
  calls.length = 0;
  assert.equal(await recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, deps, nowMs), "already_claimed");
  assert.deepEqual(calls, ["auth lookup"]);
});

test("a failed intermediate step can resume, and a failed marker does not insert another trial", async () => {
  const intermediate = dependencies({ failOnceAt: "profile" });
  await assert.rejects(recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, intermediate.deps, nowMs), /failed at profile/);
  assert.equal(intermediate.calls.includes("trial"), false);
  assert.equal(await recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, intermediate.deps, nowMs), "recovered");

  const marker = dependencies({ failOnceAt: "completion marker" });
  await assert.rejects(recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, marker.deps, nowMs), /failed at completion marker/);
  marker.calls.length = 0;
  assert.equal(await recoverInterruptedPublicInviteSignup(authUser.id, authUser.email, secret, marker.deps, nowMs), "already_provisioned");
  assert.deepEqual(marker.calls, ["auth lookup", "subscription lookup", "completion marker"]);
});

test("signup signs proof in the Auth invitation and records completion after subscription", () => {
  const signup = readFileSync("app/api/public/trial-signup/route.ts", "utf8");
  assert.match(signup, /\[SIGNUP_RECOVERY_METADATA_KEY\]: signupRecoveryProof/);
  assert.match(signup, /ensureTrialSubscription\(userId, payload\.email, signedTrialDays\)/);
  assert.ok(signup.indexOf("await ensureTrialSubscription(userId") < signup.indexOf("await markPublicSignupTrialCompleted(userId)"));

  const route = readFileSync("app/api/auth/finish-password/route.ts", "utf8");
  const verified = route.indexOf("const verifiedEmail = normalizeEmail(authUser?.email)");
  const recovery = route.indexOf("await recoverInterruptedPublicInviteSignupForUser(authUser)");
  const password = route.indexOf("const passwordWrite = await writeVerifiedPassword(");
  assert.ok(verified >= 0 && verified < recovery && recovery < password);
  assert.match(route, /code: "provision_retryable"/);

  const server = readFileSync("lib/interruptedInviteSignupRecoveryServer.ts", "utf8");
  assert.match(server, /onConflict: "user_id", ignoreDuplicates: true/);
  assert.match(server, /trial_start_at: claim\.trialStartAt/);
  assert.match(server, /await provisionNewAccountBubbleAccess\(userId\)/);
  assert.match(server, /verifiedUser\.app_metadata\?\.\[SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY\]/);
});

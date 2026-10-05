import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasEligibleInrcyAuthUser,
  isInrcyAuthInvite,
} from "../../lib/authInviteResendEligibility.ts";

const invitedUser = {
  id: "invite-1",
  email: "pro@example.com",
  invited_at: "2026-10-01T08:00:00Z",
  user_metadata: { app_language: "fr" },
};

const mustNotLoadById = async () => {
  throw new Error("unexpected direct Auth lookup");
};

const mustNotScan = async () => {
  throw new Error("unexpected Auth user scan");
};

test("an Auth-only iNrCy invitation remains eligible when account provisioning was interrupted", async () => {
  const calls: number[] = [];
  const eligible = await hasEligibleInrcyAuthUser(" Pro@Example.com ", [], mustNotLoadById, async ({ page }) => {
    calls.push(page);
    return { data: { users: [invitedUser] }, error: null };
  });

  assert.equal(eligible?.id, invitedUser.id);
  assert.deepEqual(calls, [1]);
});

test("a matching business contact without an exact Auth login cannot create a new invitation", async () => {
  const eligible = await hasEligibleInrcyAuthUser("billing@example.com", ["profile-owner"], async (userId) => ({
    data: { user: { ...invitedUser, id: userId } },
    error: null,
  }), async () => ({ data: { users: [] }, error: null }));
  assert.equal(eligible, null);
});

test("a shared contact email does not hide an Auth-only invitation", async () => {
  const eligible = await hasEligibleInrcyAuthUser("pro@example.com", ["other-account"], async () => ({
    data: { user: { id: "other-account", email: "other@example.com" } },
    error: null,
  }), async () => ({ data: { users: [invitedUser] }, error: null }));
  assert.equal(eligible?.id, invitedUser.id);
});

test("a known business account uses a direct Auth lookup and can receive a resend", async () => {
  const calls: string[] = [];
  const eligible = await hasEligibleInrcyAuthUser("pro@example.com", ["profile-owner"], async (userId) => {
    calls.push(userId);
    return { data: { user: { id: userId, email: "pro@example.com" } }, error: null };
  }, mustNotScan);
  assert.equal(eligible?.id, "profile-owner");
  assert.deepEqual(calls, ["profile-owner"]);
});

test("a deleted business Auth identity is not treated as an invitation", async () => {
  const eligible = await hasEligibleInrcyAuthUser("pro@example.com", ["deleted"], async () => ({
    data: { user: null },
    error: { code: "user_not_found" },
  }), async () => ({ data: { users: [] }, error: null }));
  assert.equal(eligible, null);
});

test("unrelated Auth users and unknown addresses cannot receive a resend", async () => {
  assert.equal(isInrcyAuthInvite({ ...invitedUser, invited_at: null }, invitedUser.email), false);
  assert.equal(isInrcyAuthInvite({ ...invitedUser, user_metadata: {} }, invitedUser.email), false);
  assert.equal(isInrcyAuthInvite(invitedUser, "someone@example.com"), false);

  const eligible = await hasEligibleInrcyAuthUser("other@example.com", [], mustNotLoadById, async ({ page }) => ({
    data: { users: page === 1 ? [{ ...invitedUser, email: "other@example.com", invited_at: null }] : [] },
    error: null,
  }));
  assert.equal(eligible, null);
});

test("the Auth lookup checks later pages instead of silently treating a present invite as unknown", async () => {
  const pages: number[] = [];
  const eligible = await hasEligibleInrcyAuthUser("pro@example.com", [], mustNotLoadById, async ({ page, perPage }) => {
    assert.equal(perPage, 1_000);
    pages.push(page);
    return {
      data: { users: page === 1 ? [{ id: "other", email: "other@example.com" }] : [invitedUser] },
      error: null,
    };
  });

  assert.equal(eligible?.id, invitedUser.id);
  assert.deepEqual(pages, [1, 2]);
});

test("an incomplete or failed Auth lookup fails closed instead of claiming a resend happened", async () => {
  await assert.rejects(
    hasEligibleInrcyAuthUser("pro@example.com", [], mustNotLoadById, async () => ({
      data: null,
      error: new Error("auth unavailable"),
    })),
    /auth unavailable/,
  );

  await assert.rejects(
    hasEligibleInrcyAuthUser("pro@example.com", [], mustNotLoadById, async () => ({
      data: null,
      error: null,
    })),
    /auth_invite_lookup_unavailable/,
  );
});

test("the public resend endpoint checks Auth eligibility before any invitation send", () => {
  const source = readFileSync("app/api/auth/resend-link/route.ts", "utf8");
  assert.ok(source.indexOf("await hasEligibleInrcyAuthUser(") < source.indexOf("auth.admin.inviteUserByEmail(email"));
  assert.match(source, /name: "auth_resend_link_invite_ip"/);
  assert.match(source, /if \(!eligibleUser\) \{\s*return NextResponse\.json\(\{ ok: true, message: genericSuccessMessage\(\) \}\);/);
  assert.match(source, /\.\.\.\(eligibleUser\.user_metadata \|\| \{\}\)/);
});

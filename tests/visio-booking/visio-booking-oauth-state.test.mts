import assert from "node:assert/strict";
import test from "node:test";

import {
  createVisioBookingOAuthState,
  verifyVisioBookingOAuthState,
} from "../../lib/visioBookingOAuthState.ts";

const secret = "test-secret-with-enough-entropy-for-signing";
const now = new Date("2026-09-06T18:00:00.000Z");

test("l'état OAuth visio signé survit au retour Google sans cookie d'onglet", () => {
  const token = createVisioBookingOAuthState({
    adminUserId: "admin-user-id",
    secret,
    now,
  });
  const result = verifyVisioBookingOAuthState({ token, secret, now });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.state.adminUserId, "admin-user-id");
});

test("l'état OAuth visio refuse une modification ou une mauvaise clé", () => {
  const token = createVisioBookingOAuthState({
    adminUserId: "admin-user-id",
    secret,
    now,
  });
  assert.equal(
    verifyVisioBookingOAuthState({ token: `${token}x`, secret, now }).ok,
    false,
  );
  assert.equal(
    verifyVisioBookingOAuthState({ token, secret: "another-secret", now }).ok,
    false,
  );
});

test("l'état OAuth visio expire au bout de dix minutes", () => {
  const token = createVisioBookingOAuthState({
    adminUserId: "admin-user-id",
    secret,
    now,
  });
  const result = verifyVisioBookingOAuthState({
    token,
    secret,
    now: new Date("2026-09-06T18:11:00.000Z"),
  });
  assert.deepEqual(result, { ok: false, reason: "expired_state" });
});

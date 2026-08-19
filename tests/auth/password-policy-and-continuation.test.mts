import assert from "node:assert/strict";
import test from "node:test";

import {
  openPasswordFinishContinuation,
  sealPasswordFinishContinuation,
} from "../../lib/authPasswordContinuation.ts";
import { evaluatePassword } from "../../lib/passwordPolicy.ts";

test("passwords are accepted when they match the five displayed criteria", () => {
  for (const password of ["Welcome321!", "Boston1989!", "Password123!"]) {
    const result = evaluatePassword(password);
    assert.equal(result.isStrong, true, password);
    assert.equal(result.isAcceptable, true, password);
  }

  const unique = evaluatePassword("Lilas!7-Orbite-Cuivre");
  assert.equal(unique.isStrong, true);
  assert.equal(unique.isAcceptable, true);

  const accented = evaluatePassword("Étoile7!");
  assert.equal(accented.isAcceptable, true, "uppercase accented letters must work in every locale");
});

test("password continuation is encrypted, account-bound and tamper resistant", () => {
  const secret = "test-only-service-role-secret-with-enough-entropy";
  const continuation = {
    mode: "invite" as const,
    userId: "00000000-1111-2222-3333-444444444444",
    email: "person@example.com",
    session: {
      access_token: "access-token-long-enough-for-the-test",
      // Regression: valid Supabase refresh tokens are not necessarily 20+ chars.
      refresh_token: "short-refresh",
    },
  };

  const sealed = sealPasswordFinishContinuation(continuation, secret);
  assert.doesNotMatch(sealed, /access-token|short-refresh|person@example\.com/);
  assert.deepEqual(
    openPasswordFinishContinuation(
      sealed,
      { mode: "invite", email: "PERSON@example.com" },
      secret,
    ),
    continuation,
  );
  assert.equal(
    openPasswordFinishContinuation(sealed, { mode: "reset", email: continuation.email }, secret),
    null,
  );
  assert.equal(
    openPasswordFinishContinuation(sealed, { mode: "invite", email: "other@example.com" }, secret),
    null,
  );

  const tamperIndex = Math.floor(sealed.length / 2);
  const tampered = `${sealed.slice(0, tamperIndex)}${
    sealed[tamperIndex] === "a" ? "b" : "a"
  }${sealed.slice(tamperIndex + 1)}`;
  assert.equal(
    openPasswordFinishContinuation(
      tampered,
      { mode: "invite", email: continuation.email },
      secret,
    ),
    null,
  );
});

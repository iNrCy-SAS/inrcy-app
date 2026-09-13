import assert from "node:assert/strict";
import test from "node:test";

import {
  googleCalendarErrorReason,
  googleCalendarRetryDelayMs,
  isTransientGoogleCalendarFailure,
} from "../../lib/googleCalendarRetryPolicy.ts";

const rateLimitBody = JSON.stringify({
  error: {
    code: 403,
    errors: [{ reason: "rateLimitExceeded" }],
    message: "Rate Limit Exceeded",
  },
});

test("Google 403 rateLimitExceeded est bien considéré comme transitoire", () => {
  assert.equal(googleCalendarErrorReason(rateLimitBody), "ratelimitexceeded");
  assert.equal(
    isTransientGoogleCalendarFailure({ status: 403, responseBody: rateLimitBody }),
    true,
  );
  assert.equal(
    isTransientGoogleCalendarFailure({
      status: 403,
      responseBody: '{"error":{"errors":[{"reason":"forbidden"}]}}',
    }),
    false,
  );
});

test("429 et erreurs serveur sont reprises, une erreur fonctionnelle ne l'est pas", () => {
  assert.equal(isTransientGoogleCalendarFailure({ status: 429 }), true);
  assert.equal(isTransientGoogleCalendarFailure({ status: 503 }), true);
  assert.equal(isTransientGoogleCalendarFailure({ status: 409 }), false);
});

test("le délai est exponentiel, jitteré et respecte Retry-After", () => {
  assert.equal(googleCalendarRetryDelayMs({ attempt: 0, random: 0 }), 1_000);
  assert.equal(googleCalendarRetryDelayMs({ attempt: 2, random: 0.5 }), 4_500);
  assert.equal(
    googleCalendarRetryDelayMs({ attempt: 0, random: 0, retryAfter: "7" }),
    7_000,
  );
  assert.equal(
    googleCalendarRetryDelayMs({ attempt: 10, random: 0, retryAfter: "120" }),
    30_000,
  );
});


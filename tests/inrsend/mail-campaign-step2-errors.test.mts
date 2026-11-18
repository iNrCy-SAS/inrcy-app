import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMailDeliveryError,
  parseRetryAfterMs,
} from "../../lib/mailDeliveryErrors.ts";

test("Retry-After en secondes est respecte", () => {
  assert.equal(parseRetryAfterMs("120"), 120_000);
});

test("une limitation globale met la boite en pause", () => {
  const error = normalizeMailDeliveryError(
    "Too many requests",
    "gmail",
    429,
    "300",
  );
  assert.equal(error.kind, "rate_limited");
  assert.equal(error.accountLevel, true);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 300_000);
});

test("un SMTP 450 reste une erreur temporaire du destinataire", () => {
  const error = normalizeMailDeliveryError(
    "450 4.2.0 Mailbox temporarily unavailable",
    "imap",
  );
  assert.equal(error.kind, "temporary_recipient");
  assert.equal(error.accountLevel, false);
  assert.equal(error.retryable, true);
  assert.equal(error.providerStatus, 450);
});

test("un SMTP 535 demande une reconnexion et ne devient pas un echec destinataire", () => {
  const error = normalizeMailDeliveryError(
    "535 5.7.1 Authentication failed",
    "imap",
  );
  assert.equal(error.kind, "auth_required");
  assert.equal(error.accountLevel, true);
  assert.equal(error.retryable, false);
});

test("les codes Gmail de quota sont reconnus sans espaces", () => {
  const error = normalizeMailDeliveryError(
    '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}',
    "gmail",
    403,
  );
  assert.equal(error.kind, "rate_limited");
  assert.equal(error.accountLevel, true);
  assert.equal(error.retryable, true);
});

test("Microsoft 429 RefuseQuota preserves the provider delay without claiming an account suspension", () => {
  const error = normalizeMailDeliveryError(
    { error: { code: "TooManyRequests", message: "WASCL UserAction verdict is not None. Actual verdict is RefuseQuota." } },
    "microsoft",
    429,
    "7200",
  );
  assert.equal(error.kind, "rate_limited");
  assert.equal(error.accountLevel, true);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 7_200_000);
  assert.equal(error.providerStatus, 429);
  assert.doesNotMatch(error.message, /bloqu|suspend|reconnect/i);
});

test("an explicit quota verdict takes precedence over a Microsoft suspension wrapper without shortening Retry-After", () => {
  const payload = { error: {
    code: "ErrorAccountSuspend",
    message: "WASCL UserAction verdict is not None. Actual verdict is RefuseQuota, ShowTierUpgrade.",
  } };
  // Callers may pass either the parsed provider response or its JSON body.
  for (const input of [payload, JSON.stringify(payload)]) {
    const error = normalizeMailDeliveryError(input, "microsoft", 429, "21600");
    assert.equal(error.kind, "rate_limited");
    assert.equal(error.accountLevel, true);
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 21_600_000);
  }
});

test("a WASCL mention with a transient verdict follows HTTP throttling rather than inventing a suspension", () => {
  const error = normalizeMailDeliveryError(
    "WASCL UserAction verdict is not None. Actual verdict is TransientError.",
    "microsoft",
    429,
    "120",
  );
  assert.equal(error.kind, "rate_limited");
  assert.equal(error.accountLevel, true);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 120_000);
});

test("an explicit Microsoft account suspension remains blocked even when HTTP 429 includes a retry delay", () => {
  for (const raw of [
    { error: { code: "ErrorAccountSuspend", message: "WASCL UserAction verdict is not None. Actual verdict is Suspend." } },
    { error: { code: "ErrorAccountSuspendShowTierUpgrade", message: "Consumer mailbox access is suspended." } },
    "WASCL UserAction verdict is not None. Actual verdict is Suspend.",
  ]) {
    const error = normalizeMailDeliveryError(raw, "microsoft", 429, "120");
    assert.equal(error.kind, "account_blocked");
    assert.equal(error.accountLevel, true);
    assert.equal(error.retryable, false);
    assert.equal(error.retryAfterMs, 120_000);
  }
});

test("a real suspension outside throttling and contradictory explicit suspension verdicts remain blocked", () => {
  for (const [input, status] of [
    [{ error: { code: "ErrorAccountSuspend", message: "Access to the consumer mailbox is suspended." } }, 403],
    ["WASCL UserAction verdict is not None. Actual verdict is Suspend.", 403],
    [{ error: { code: "ErrorAccountSuspend", message: "Actual verdict is RefuseQuota. Actual verdict is Suspend." } }, 429],
  ] as const) {
    const error = normalizeMailDeliveryError(input, "microsoft", status, "120");
    assert.equal(error.kind, "account_blocked");
    assert.equal(error.accountLevel, true);
    assert.equal(error.retryable, false);
  }
});

test("an explicit RefuseQuota outside HTTP throttling remains an account quota with its full provider delay", () => {
  const error = normalizeMailDeliveryError(
    "WASCL UserAction verdict is not None. Actual verdict is RefuseQuota, ShowTierUpgrade.",
    "microsoft",
    403,
    "86400",
  );
  assert.equal(error.kind, "quota_exceeded");
  assert.equal(error.accountLevel, true);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 86_400_000);
});

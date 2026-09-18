import assert from "node:assert/strict";
import test from "node:test";

import {
  inrAgentEditorialRetryDecision,
  isInrAgentEditorialQuotaLimitError,
  shouldRecoverInrAgentEditorialQuotaFailure,
} from "../../lib/inrAgentEditorialRetryPolicy.ts";

test("la limite de sécurité IA est traitée comme un quota temporaire", () => {
  const message =
    "La limite quotidienne de sécurité IA (coût de sécurité) de ce compte est atteinte. Réessayez plus tard.";
  assert.equal(isInrAgentEditorialQuotaLimitError(message), true);
  assert.deepEqual(
    inrAgentEditorialRetryDecision({
      error: message,
      attempts: 4,
      nowMs: Date.parse("2026-09-18T12:00:00.000Z"),
    }),
    {
      quotaLimited: true,
      retry: true,
      retryAt: "2026-09-18T18:00:00.000Z",
    },
  );
});

test("un ancien échec terminal de quota est remis dans la file", () => {
  assert.equal(
    shouldRecoverInrAgentEditorialQuotaFailure({
      status: "failed",
      editorialState: "failed",
      attempts: 4,
      error:
        "La limite mensuelle de sécurité IA (appels) de ce compte est atteinte.",
    }),
    true,
  );
  assert.equal(
    shouldRecoverInrAgentEditorialQuotaFailure({
      status: "failed",
      editorialState: "failed",
      attempts: 4,
      error: "Le JSON généré est invalide.",
    }),
    false,
  );
});

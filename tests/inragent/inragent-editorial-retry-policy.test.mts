import assert from "node:assert/strict";
import test from "node:test";

import {
  inrAgentEditorialRetryDecision,
  isInrAgentEditorialQuotaLimitError,
  shouldRecoverInrAgentEditorialFailure,
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
    shouldRecoverInrAgentEditorialFailure({
      status: "failed",
      editorialState: "failed",
      attempts: 4,
      error:
        "La limite mensuelle de sécurité IA (appels) de ce compte est atteinte.",
      retryReason: "quota",
    }),
    true,
  );
  assert.equal(
    shouldRecoverInrAgentEditorialFailure({
      status: "failed",
      editorialState: "failed",
      attempts: 4,
      error: "Le JSON généré est invalide.",
      retryReason: "invalid_payload",
    }),
    false,
  );
});

test("un échec 500 générique reste transitoire au-delà de quatre essais", () => {
  assert.equal(
    shouldRecoverInrAgentEditorialFailure({
      status: "failed",
      editorialState: "failed",
      attempts: 4,
      error: "Préparation éditoriale refusée (500).",
      retryReason: "transient_error",
    }),
    true,
  );
  assert.equal(
    shouldRecoverInrAgentEditorialFailure({
      status: "failed",
      editorialState: "failed",
      attempts: 8,
      error: "Préparation éditoriale refusée (500).",
      retryReason: "transient_error",
    }),
    false,
  );
});

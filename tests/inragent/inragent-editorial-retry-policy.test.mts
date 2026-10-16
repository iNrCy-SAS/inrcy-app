import assert from "node:assert/strict";
import test from "node:test";

import {
  inrAgentEditorialRetryDecision,
  isInrAgentEditorialQuotaLimitError,
  isTerminalInrAgentEditorialFailure,
  shouldRecoverInrAgentEditorialFailure,
  shouldResumeInrAgentMediaCreditFailure,
} from "../../lib/inrAgentEditorialRetryPolicy.ts";

test("les avances reprennent uniquement les futurs créneaux bloqués par les crédits médias", () => {
  const args = {status:"failed",editorialPlan:true,scheduledFor:"2026-10-20T12:00:00Z",error:"Le quota de médias est insuffisant pour terminer cette publication. Les médias déjà préparés sont conservés pour la reprise.",nowMs:Date.parse("2026-10-16T12:00:00Z")};
  assert.equal(shouldResumeInrAgentMediaCreditFailure(args),true);
  assert.equal(shouldResumeInrAgentMediaCreditFailure({...args,status:"draft"}),true);
  for(const status of ["executing","cancelled","refused","published","pending_validation","scheduled"])
    assert.equal(shouldResumeInrAgentMediaCreditFailure({...args,status}),false);
  for(const error of ["Quota IA atteint","Too many requests 429","AI_GATEWAY_ACCOUNT_LIMIT_REACHED","Provider quota reached","Le JSON généré est invalide."])
    assert.equal(shouldResumeInrAgentMediaCreditFailure({...args,error}),false);
  assert.equal(shouldResumeInrAgentMediaCreditFailure({...args,refusedAt:"2026-10-15T12:00:00Z"}),false);
  assert.equal(shouldResumeInrAgentMediaCreditFailure({...args,editorialPlan:false}),false);
  assert.equal(shouldResumeInrAgentMediaCreditFailure({...args,scheduledFor:"2026-10-10T12:00:00Z"}),false);
  assert.equal(shouldResumeInrAgentMediaCreditFailure({...args,scheduledFor:null}),false);
});

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

test("seul l'échec définitif relâche le sujet, y compris après un quota", () => {
  const transient = {
    status: "failed", editorialState: "failed", retryReason: "transient_error",
    error: "Préparation refusée (500).",
  };
  assert.equal(isTerminalInrAgentEditorialFailure({ ...transient, attempts: 7 }), false);
  assert.equal(isTerminalInrAgentEditorialFailure({ ...transient, attempts: 8 }), true);
  assert.equal(isTerminalInrAgentEditorialFailure({ ...transient, status: "draft", attempts: 8 }), false);

  const quota = { ...transient, retryReason: "quota", error: "Quota IA atteint" };
  assert.equal(isTerminalInrAgentEditorialFailure({ ...quota, attempts: 8 }), false);
  assert.equal(isTerminalInrAgentEditorialFailure({ ...quota, attempts: 11 }), false);
  assert.equal(isTerminalInrAgentEditorialFailure({ ...quota, attempts: 12 }), true);
  assert.equal(isTerminalInrAgentEditorialFailure({ ...transient, error: "Limite de sécurité IA atteinte", attempts: 8 }), false);
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

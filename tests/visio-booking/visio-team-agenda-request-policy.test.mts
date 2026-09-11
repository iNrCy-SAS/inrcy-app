import assert from "node:assert/strict";
import test from "node:test";

import { shouldApplyVisioTeamAppointmentsResponse } from "../../lib/visioTeamAgendaRequestPolicy.ts";

test("un chargement commencé avant une mutation ne peut pas restaurer l'ancien rendez-vous", () => {
  assert.equal(
    shouldApplyVisioTeamAppointmentsResponse({
      startedMutationRevision: 3,
      currentMutationRevision: 4,
      requestSequence: 12,
      lastAppliedRequestSequence: 11,
      mutationInFlight: false,
    }),
    false,
  );
});

test("le rafraîchissement silencieux est ignoré pendant une mutation", () => {
  assert.equal(
    shouldApplyVisioTeamAppointmentsResponse({
      startedMutationRevision: 4,
      currentMutationRevision: 4,
      requestSequence: 12,
      lastAppliedRequestSequence: 11,
      mutationInFlight: true,
    }),
    false,
  );
});

test("une réponse plus ancienne ne remplace pas une liste plus récente", () => {
  assert.equal(
    shouldApplyVisioTeamAppointmentsResponse({
      startedMutationRevision: 4,
      currentMutationRevision: 4,
      requestSequence: 11,
      lastAppliedRequestSequence: 12,
      mutationInFlight: false,
    }),
    false,
  );
});

test("la réponse la plus récente hors mutation reste applicable", () => {
  assert.equal(
    shouldApplyVisioTeamAppointmentsResponse({
      startedMutationRevision: 4,
      currentMutationRevision: 4,
      requestSequence: 13,
      lastAppliedRequestSequence: 12,
      mutationInFlight: false,
    }),
    true,
  );
});

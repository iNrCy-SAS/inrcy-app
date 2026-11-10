import assert from "node:assert/strict";
import test from "node:test";
import { hasInrAssistantDeferredApproval, matchesInrAssistantActionClause } from "../../lib/inrAssistantActionClause.ts";

test("a named third party and a future approval never authorize the current native action", () => {
  for (const message of [
    "Crée le contact Alice si Julie confirme.",
    "Envoie la campagne après validation de Julie.",
    "Publie cette offre une fois Marc d’accord.",
    "Send the campaign only after Julie approves.",
    "Envoie ce mail sous réserve de mon accord.",
  ]) {
    assert.equal(hasInrAssistantDeferredApproval(message), true, message);
    assert.equal(matchesInrAssistantActionClause(message, message, () => true), false, message);
  }
});

test("approval vocabulary inside quoted content does not cancel an explicit current action", () => {
  for (const message of [
    'Crée un contact CRM nommé Alice avec la note « Envoyer après validation de Julie ».',
    'Prépare un mail dont le corps est "Contactez-nous si Julie confirme".',
    "Crée la fiche contact Alice maintenant, puis explique le résultat.",
  ]) {
    assert.equal(hasInrAssistantDeferredApproval(message), false, message);
    assert.equal(matchesInrAssistantActionClause(message, message, () => true), true, message);
  }
});

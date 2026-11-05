import assert from 'node:assert/strict';
import test from 'node:test';
import { isInrAssistantScheduledPublishNowRequest } from '../../lib/inrAssistantScheduledPublicationIntent.ts';
import { inrAssistantRequiredTools } from '../../lib/inrAssistantTaskPolicy.ts';

test('Publish now targets an existing schedule without creating a fresh publication goal', () => {
  for (const message of ['Publie maintenant la publication programmée.', 'Peux-tu publier tout de suite le post planifié ?', 'Exécute immédiatement cette programmation.']) {
    assert.equal(isInrAssistantScheduledPublishNowRequest(message), true, message);
    assert.deepEqual(inrAssistantRequiredTools(message), ['publishScheduledPublicationNow']);
  }
  for (const message of ['Publie une nouvelle publication maintenant.', 'Programme une publication demain.', 'Comment publier maintenant la publication programmée ?', '« Publie maintenant la publication programmée. »', 'Si je confirme, publie maintenant la publication programmée.', 'Ne publie pas maintenant la publication programmée.', 'Publie maintenant la publication programmée demain.']) assert.equal(isInrAssistantScheduledPublishNowRequest(message), false, message);
});

test('Scheduled content changes cannot be routed to a published edit or a local history filter', () => {
  for (const message of ['Modifie le texte de la publication programmée.', 'Modifie le lien CTA de la publication programmée.', 'Remplace le média de la publication planifiée dans l’historique.']) assert.deepEqual(inrAssistantRequiredTools(message), ['editScheduledPublication'], message);
  assert.deepEqual(inrAssistantRequiredTools('Modifie le texte de la publication dans l’historique.'), ['editPublication']);
  assert.deepEqual(inrAssistantRequiredTools('Ne supprime pas cette notification.'), []);
});

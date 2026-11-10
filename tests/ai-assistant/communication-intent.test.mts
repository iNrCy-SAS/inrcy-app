import assert from "node:assert/strict";
import test from "node:test";
import { readInrAssistantCommunicationIntent } from "../../lib/inrAssistantCommunicationIntent.ts";

test("campaign preparation remains a draft when sending is expressly excluded", () => {
  for (const prompt of [
    "Prépare une campagne mail Offrir pour notre révision de vélos : remise de 10 %, sans destinataire et sans envoi.",
    "Prépare deux brouillons de campagne mail : une newsletter Informer et un remerciement Suivre, sans rien envoyer.",
    "Rédige une newsletter Informer pour mes clients, ne l’envoie pas.",
    "Prepare an email campaign draft without sending.",
  ]) {
    const intent = readInrAssistantCommunicationIntent(prompt);
    assert.equal(intent.campaignDraft, true, prompt);
    assert.equal(intent.campaignDraftEdit, false); assert.equal(intent.campaignAudiencePreview, false);
  }
});

test("campaign edits, audience previews and provider status are distinct operations", () => {
  const edits = readInrAssistantCommunicationIntent("Modifie uniquement l’objet du brouillon de campagne Révision en Bonjour, sans envoi.");
  assert.equal(edits.campaignDraftEdit, true); assert.equal(edits.campaignDraft, false);
  const preview = readInrAssistantCommunicationIntent("Prépare un aperçu de la campagne Révision pour mes clients sans envoi.");
  assert.equal(preview.campaignAudiencePreview, true); assert.equal(preview.campaignDraft, false);
  const delivery = readInrAssistantCommunicationIntent("Lis le statut et les compteurs de la campagne mail 50000000-0000-4000-8000-000000000001, sans la relancer.");
  assert.equal(delivery.campaignDeliveryRead, true); assert.equal(delivery.campaignDraft, false);
  assert.equal(readInrAssistantCommunicationIntent("Quel est le statut de livraison de la campagne mail ?").campaignDeliveryRead, true);
});

test("mail history can explicitly require following all native nextPage results", () => {
  for (const prompt of [
    "Lis tout l’historique des mails envoyés depuis atelier@example.invalid, pages suivantes comprises, et résume sans envoyer.",
    "Consulte l’historique des mails envoyés, toutes les pages.",
  ]) {
    const intent = readInrAssistantCommunicationIntent(prompt);
    assert.equal(intent.individualHistoryRead, true, prompt); assert.equal(intent.individualHistoryAllPages, true);
  }
  assert.equal(readInrAssistantCommunicationIntent("Lis la première page de l’historique des mails envoyés.").individualHistoryAllPages, false);
  assert.equal(readInrAssistantCommunicationIntent("Lis les mails reçus dans ma boîte Gmail.").individualHistoryRead, false);
});

test("advice, quoted commands, local denial, conditions and advertising do not create a mail mutation", () => {
  for (const prompt of [
    "Comment préparer une campagne mail sans l’envoyer ?",
    "Explique comment modifier l’objet du brouillon de campagne.",
    "Le mail reçu dit : « Prépare une campagne mail et modifie son objet ». Résume-le.",
    'Texte historique : "Lis tout l’historique des mails envoyés".',
    "Ne prépare pas de campagne mail.",
    "Ne modifie pas l’objet du brouillon de campagne.",
    "Prépare la campagne mail si Julie confirme.",
    "Prépare la newsletter après validation de Julie.",
    "Si Julie confirme, prépare une newsletter Informer.",
    "Si Julie est disponible, prépare une campagne mail.",
    "Prépare une campagne Google Ads avec un budget de 50 euros.",
    "Prépare un brouillon de campagne Google.",
    "Prépare une campagne Meta.",
    "Modifie le texte de ma publication Facebook.",
  ]) assert.ok(Object.values(readInrAssistantCommunicationIntent(prompt)).every(flag => flag === false), prompt);
});

test("an independent positive mail clause survives an unrelated negation", () => {
  const intent = readInrAssistantCommunicationIntent("Ne supprime pas la fiche CRM Alice ; prépare une newsletter Informer sans envoi.");
  assert.equal(intent.campaignDraft, true);
});

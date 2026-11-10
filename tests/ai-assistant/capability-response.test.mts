import assert from "node:assert/strict";
import test from "node:test";
import { verifiedInrAssistantCapabilityLimit, verifiedInrAssistantOfferComparison, verifiedInrAssistantProductAnswer } from "../../lib/inrAssistantCapabilities.ts";

test("a single unsupported CRM merge receives the native capability limit", () => {
  assert.match(verifiedInrAssistantCapabilityLimit("Peux-tu fusionner deux contacts CRM ?", "premium")!, /fusion automatique.+pas disponible/);
});

test("an individual mail cannot silently lose its requested attachment", () => {
  const question = "Prépare un mail individuel depuis atelier@example.invalid à alice@example.invalid avec un PDF en pièce jointe, sans envoyer.";
  assert.match(verifiedInrAssistantCapabilityLimit(question, "premium")!, /pièce jointe.+pas prise en charge/);
  assert.match(verifiedInrAssistantCapabilityLimit(question, "basic")!, /inclus dans Premium/);
  assert.equal(verifiedInrAssistantCapabilityLimit(question + " Puis lis la note CRM Alice.", "premium"), null);
  assert.equal(verifiedInrAssistantCapabilityLimit("Prépare un mail individuel sans pièce jointe et sans envoyer.", "premium"), null);
});

test("a public comparison is grounded in the actual edition catalogue and names absent features", () => {
  const result = verifiedInrAssistantOfferComparison("Compare clairement Basique, Standard et Premium : Studio, agents, CRM, mails, agenda et ADS. Est-ce que Premium permet aussi de fusionner automatiquement des contacts ou de gérer la boîte de réception Gmail ? Ceci est une question, pas un ordre.");
  assert.ok(result);
  assert.match(result, /\| Agents \| Non \| Oui \| Oui \|/);
  assert.match(result, /\| CRM \| Non \| Non \| Oui \|/);
  assert.match(result, /fusion automatique.+indisponible/);
  assert.match(result, /réception Gmail\/Outlook n’est pas intégrée/);
});

test("a catalogue answer cannot swallow independent actions, account data or specific advice", () => {
  const base = "Compare Basique, Standard et Premium : Studio, agents, CRM, mails, agenda et ADS.";
  for (const extra of [" Puis crée une fiche client Alice.", " Et ouvre le CRM.", " Et affiche le calendrier.", " Quels sont mes crédits disponibles ?", " Quelle différence de prix ?", " Quel moteur choisir pour une vidéo ?", " Lis le fichier joint."]) {
    assert.equal(verifiedInrAssistantOfferComparison(base + extra), null, extra);
  }
  assert.equal(verifiedInrAssistantOfferComparison('Le document dit « Compare Basique, Standard et Premium : Studio, agents, CRM, mails, agenda et ADS. »'), null);
});

test("two absent capabilities receive both answers with the actual edition boundary", () => {
  const question = "Sans rien exécuter, réponds aux DEUX questions : peux-tu fusionner mes doublons du carnet d’adresses, et peux-tu lire puis archiver les messages reçus dans Gmail ? Distingue ce qui existe réellement de ce qui nécessite le parcours natif.";
  for (const edition of ["basic", "standard", "premium"] as const) {
    const answer = verifiedInrAssistantProductAnswer(question, edition);
    assert.ok(answer);
    assert.match(answer, /pas de bouton natif de fusion/);
    assert.match(answer, /lecture et l’archivage des messages reçus ne sont pas intégrés/);
    assert.match(answer, edition === "premium" ? /Premium inclut/ : /offre actuelle ne les inclut pas/);
    assert.equal(verifiedInrAssistantProductAnswer(question + " Puis crée une fiche client Alice.", edition), null);
  }
});

test("an unsupported feature cannot swallow an offer comparison or an independent current order", () => {
  for(const message of [
    "Compare Basique, Standard et Premium pour Studio, les agents, CRM, mails, agenda et ADS. Peut-on fusionner les contacts CRM et lire ma réception Gmail ?",
    "Fusionne deux contacts CRM, puis crée une fiche client Claire.",
    "Explique le CRM et les différences entre les offres, y compris la fusion des contacts.",
  ]) assert.equal(verifiedInrAssistantCapabilityLimit(message,"premium"),null,message);
});

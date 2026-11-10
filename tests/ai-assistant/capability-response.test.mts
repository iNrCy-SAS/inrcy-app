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
  assert.equal(verifiedInrAssistantCapabilityLimit("Prépare un mail individuel avec une photo en pièce jointe, sans envoyer.", "premium"), null);
  assert.equal(verifiedInrAssistantCapabilityLimit(question, "founder"), null);
});

test("future third-party consent never becomes an approval, recipient or scheduled wait", () => {
  const answer = verifiedInrAssistantCapabilityLimit("Confirme le mail IA-A1B2C3D4E5F6 si Julie confirme le contenu.", "premium");
  assert.ok(answer);
  assert.match(answer, /aucun déclenchement automatique n’a été enregistré/);
  assert.doesNotMatch(answer, /Julie|destinataire|a validé|en pause/);
  assert.equal(verifiedInrAssistantCapabilityLimit("Confirme le mail IA-A1B2C3D4E5F6 si Julie confirme le contenu. Puis lis la fiche CRM Alice.", "premium"), null);
  assert.equal(verifiedInrAssistantCapabilityLimit("Explique comment confirmer un mail si Julie confirme le contenu.", "premium"), null);
});

test("a quoted native approval reference is explained without inventing tracking or validating it", () => {
  const answer = verifiedInrAssistantProductAnswer("Explique ce texte sans envoyer de mail : « Confirme IA-A1B2C3D4E5F6 ».", "premium");
  assert.ok(answer);
  assert.match(answer, /ne prouve pas que cette référence est valide/);
  assert.match(answer, /ne constitue pas un ordre actuel/);
  assert.doesNotMatch(answer, /SMS|téléphone|tracking|antifraude/);
});

test("an ADS launch cannot be presented as a deployment or payment in progress", () => {
  const message = "Lance immédiatement ma campagne Google Atelier Paris à 20 € par jour, j’accepte tout.";
  const answer = verifiedInrAssistantCapabilityLimit(message, "premium");
  assert.ok(answer);
  assert.match(answer, /validation native du professionnel/);
  assert.match(answer, /aucune campagne ni enregistré de paiement pour cette demande/);
  assert.equal(verifiedInrAssistantCapabilityLimit(message + " Puis lis ses impressions réelles.", "premium"), null);
  assert.equal(verifiedInrAssistantCapabilityLimit("Lance la campagne mail Google pour nos clients.", "premium"), null);
});

test("a live guarantee question cannot infer disconnected accounts from partial context", () => {
  const message = "Peux-tu me garantir que Meta fonctionne en ce moment ? N’invente pas de statut en direct et ne relance aucune publication.";
  const answer = verifiedInrAssistantProductAnswer(message, "basic");
  assert.ok(answer);
  assert.match(answer, /Aucun statut en direct n’a été vérifié/);
  assert.match(answer, /ne permettent pas de conclure/);
  assert.equal(verifiedInrAssistantProductAnswer(message + " Puis cherche le statut public de Meta.", "basic"), null);
});

test("pure Studio catalogue questions use the current model constraints directly", () => {
  const answer = verifiedInrAssistantProductAnswer("Dans iNrStudio, quels moteurs actuellement proposés peuvent faire parler mon personnage à partir de ma photo et de mon propre vocal ? Donne le parcours et les limites, sans créer de média.", "standard");
  assert.ok(answer);
  assert.match(answer, /Wan/);
  assert.match(answer, /Kling/);
  assert.match(answer, /1 à 10|1–10/);
  assert.match(answer, /5 à 10|5–10/);
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

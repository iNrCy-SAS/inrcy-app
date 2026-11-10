import assert from "node:assert/strict";
import test from "node:test";
import { verifiedInrAssistantCapabilityLimit } from "../../lib/inrAssistantCapabilities.ts";

test("a single unsupported CRM merge receives the native capability limit", () => {
  assert.match(verifiedInrAssistantCapabilityLimit("Peux-tu fusionner deux contacts CRM ?", "premium")!, /fusion automatique.+pas disponible/);
});

test("an unsupported feature cannot swallow an offer comparison or an independent current order", () => {
  for(const message of [
    "Compare Basique, Standard et Premium pour Studio, les agents, CRM, mails, agenda et ADS. Peut-on fusionner les contacts CRM et lire ma réception Gmail ?",
    "Fusionne deux contacts CRM, puis crée une fiche client Claire.",
    "Explique le CRM et les différences entre les offres, y compris la fusion des contacts.",
  ]) assert.equal(verifiedInrAssistantCapabilityLimit(message,"premium"),null,message);
});

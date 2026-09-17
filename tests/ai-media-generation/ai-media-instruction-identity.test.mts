import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("la consigne ponctuelle traverse le client, le prompt et les rédacteurs sans être stockée en clair", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const prompt = read("lib/aiMediaGenerationPrompt.ts");
  const copywriter = read("lib/aiMediaCopywriter.ts");
  const narration = read("lib/aiMediaNarration.ts");
  const route = read("app/api/media-generation/generate/route.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.match(generator, /aiInstruction: aiInstruction\.trim\(\)/);
  assert.match(generator, /maxLength=\{600\}/);
  assert.match(hook, /aiInstruction: String\(request\.aiInstruction \|\| ""\)\.trim\(\)/);
  assert.match(prompt, /CONSIGNE DE RÉALISATION PRIORITAIRE DU PROFESSIONNEL/);
  assert.match(prompt, /Appliquer tous ses éléments visuels et narratifs/);
  assert.match(copywriter, /consigne_ponctuelle: args\.request\.aiInstruction \|\| null/);
  assert.match(narration, /consigne_ponctuelle: args\.request\.aiInstruction \|\| null/);
  assert.match(route, /ai_instruction_present: Boolean\(normalizedRequest\.aiInstruction\)/);
  assert.match(route, /ai_instruction_char_count: normalizedRequest\.aiInstruction\.length/);
  assert.match(server, /ai_instruction_present: Boolean\(providerRequest\.aiInstruction\)/);
  assert.doesNotMatch(route, /ai_instruction:\s*normalizedRequest\.aiInstruction/);
  assert.doesNotMatch(server, /ai_instruction:\s*providerRequest\.aiInstruction/);
});

test("l'identité vidéo est consentie, auditée et indépendante du rendu", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const prompt = read("lib/aiMediaGenerationPrompt.ts");
  const route = read("app/api/media-generation/generate/route.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.match(generator, /type StudioCharacterCount = 0 \| 1 \| 2 \| 3/);
  assert.match(generator, /characterReferenceMissing/);
  assert.match(generator, /renderReferenceSlot/);
  assert.match(generator, /role: "character"/);
  assert.match(generator, /role: "environment"/);
  assert.match(generator, /role: "product"/);
  assert.match(generator, /setIdentityConsent\(false\)/);
  assert.match(generator, /const strictIdentityReferenceMode =/);
  assert.match(generator, /identityConsent: identityConsentRequired \? identityConsent : false/);
  assert.match(generator, /inspirationImages: mediaSourceMode === "real" \? inspirationImages : \[\]/);
  assert.match(prompt, /getAiMediaIdentityDirection/);
  assert.doesNotMatch(prompt, /getAiMediaVideoIdentityDirection/);
  assert.match(prompt, /sans le remplacer par un visage générique/);
  assert.match(prompt, /dans le rendu choisi/);
  assert.match(route, /inrcy-media-identity-consent-v1/);
  assert.match(server, /inrcy-media-identity-consent-v1/);
  assert.doesNotMatch(route, /identity_consent[^\n]*inspirationImages/);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import {
  buildAiMediaOriginalityContract,
  buildAiMediaPromptBusinessDna,
  getAiMediaImageOriginalityDirection,
  getAiMediaImageVisualDirection,
  getAiMediaVideoOriginalityDirection,
} from "../../lib/aiMediaPromptShared.ts";

function request(kind: "image" | "video", requestId = "studio-originality-test-0001") {
  return normalizeAiMediaGenerationRequest({
    requestId, kind, operation: "generate", source: "studio", inputMode: "essential",
    subjectSource: "custom", idea: "Un boulanger prépare des croissants.",
    generationMode: "ai_free", format: "landscape", imageStyle: "photo",
    textMode: "none", withText: false, logoMode: "none", durationSeconds: 8,
    shotType: "close", visualStyle: "brand", creativity: "faithful",
  });
}

test("la liberté créative des deux médias conserve critères et références sans accessoires imposés", () => {
  for (const kind of ["image", "video"] as const) {
    const contract = buildAiMediaOriginalityContract(request(kind));
    assert.ok(contract.length <= 450, "Le contrat doit tenir aux frontières vidéo contraintes.");
    assert.match(contract, /distinctive concept grounded in THIS brief/);
    assert.match(contract, /only where unspecified/);
    assert.match(contract, /No default tablet, laptop, phone or office/);
    assert.match(contract, /only when justified by the requested scene/);
    assert.match(contract, /Keep all explicit criteria, facts and required reference identities\/objects\/places intact/);
  }
});

test("les pistes de variation ne remplacent jamais le cadrage ni le scénario demandé", () => {
  const imageDirections = new Set<string>();
  const videoDirections = new Set<string>();
  for (let index = 0; index < 30; index += 1) {
    const imageRequest = request("image", `studio-variation-${index}`);
    const visual = getAiMediaImageVisualDirection(imageRequest);
    assert.match(visual, /cadrage rapproché/);
    assert.match(visual, /Piste facultative, uniquement si compatible avec le brief et le cadrage choisi/);
    const image = getAiMediaImageOriginalityDirection(imageRequest);
    const video = getAiMediaVideoOriginalityDirection(request("video", `studio-variation-${index}`));
    assert.match(image, /sans modifier les critères explicites/);
    assert.match(video, /sans modifier le scénario demandé/);
    imageDirections.add(image);
    videoDirections.add(video);
  }
  assert.ok(imageDirections.size >= 4);
  assert.ok(videoDirections.size >= 4);
});

test("Autre sujet n'injecte plus un métier ou décor ADN dans le moteur visuel", () => {
  const profile = { business: { description: "Service numérique: clients devant une tablette." } } as unknown as NormalizedAiGenerationProfile;
  for (const kind of ["image", "video"] as const) {
    const dna = buildAiMediaPromptBusinessDna(profile, request(kind));
    assert.doesNotMatch(dna, /Service numérique|clients devant une tablette/);
    assert.match(dna, /ne pas importer le métier/);
    assert.match(dna, /logo et la palette explicitement sélectionnés/);
  }
});

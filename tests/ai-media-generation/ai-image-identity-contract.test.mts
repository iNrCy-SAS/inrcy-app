import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("l'identité autorisée est disponible pour une image comme pour une vidéo", () => {
  const contracts = read("lib/aiMediaGenerationContracts.ts");
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");

  assert.match(
    contracts,
    /const identityEnabled = normalizedPeopleMode !== "none"/,
  );
  assert.match(contracts, /const identityReferenceRequested = inspirationImages\.length > 0/);
  assert.doesNotMatch(contracts, /kind !== "video"[\s\S]{0,180}inspiration/);
  assert.match(generator, /identityMode:[\s\S]*?peopleMode !== "none"/);
  assert.match(generator, /inspirationImages:[\s\S]*?peopleMode !== "none"/);
  assert.doesNotMatch(
    generator,
    /kind === "video" && peopleMode !== "none" \? \(\s*<>[\s\S]{0,200}ai_generator_video_character_label/,
  );
  assert.match(hook, /identityMode:[\s\S]*?request\.peopleMode !== "none"/);
  assert.match(hook, /inspirationImages:[\s\S]*?request\.peopleMode !== "none"/);
});

test("GPT Image reçoit les références d'identité sans repli silencieux", () => {
  const gateway = read("lib/aiMediaGateway.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  const route = read("app/api/media-generation/generate/route.ts");

  assert.match(gateway, /identityReferences\?: readonly Buffer\[\]/);
  assert.match(gateway, /const referenceImages = \[[\s\S]*?\.\.\.providedReferences/);
  assert.match(gateway, /images: referenceImages/);
  assert.match(gateway, /ai_image_identity_not_generated/);
  assert.doesNotMatch(gateway, /catch[\s\S]{0,400}generateImage\([\s\S]{0,250}args\.prompt/);
  assert.match(server, /prepareAiMediaIdentityReferences\(args\.request\.inspirationImages\)/);
  assert.match(server, /identityReferences: preparedIdentityReferences\.buffers/);
  assert.match(server, /identityMode: providerRequest\.identityMode/);
  assert.match(route, /AI_MEDIA_IMAGE_IDENTITY_REFERENCE_REJECTED/);
  assert.match(route, /Aucun visage générique n’a été substitué/);
});

test("aucune photo ni empreinte de photo n'est persistée dans les traces", () => {
  const route = read("app/api/media-generation/generate/route.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  const preferences = read("lib/aiMediaGenerationPreferences.ts");

  for (const source of [route, server, preferences]) {
    assert.doesNotMatch(source, /inspiration_image_sha256/);
    assert.doesNotMatch(source, /identity_reference_base64/);
  }
  assert.match(route, /inspiration_image_count/);
  assert.match(server, /inspiration_image_count/);
  assert.match(preferences, /cannot retain uploaded image bytes/);
});

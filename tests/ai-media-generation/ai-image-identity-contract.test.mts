import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("les médias source restent distincts des références d'identité strictes", () => {
  const contracts = read("lib/aiMediaGenerationContracts.ts");
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");

  assert.match(contracts, /let inspirationImages = normalizeInspirationImages/);
  assert.match(contracts, /const requiredCharacterReferences = inspirationImages\.filter/);
  assert.match(
    contracts,
    /image\.role === "character" && image\.usage === "required"/
  );
  assert.match(contracts, /const strictIdentityReferenceRequested =/);
  assert.match(
    contracts,
    /identityMode !== "auto" &&[\s\S]{0,40}characterReferences\.length > 0/
  );
  assert.doesNotMatch(contracts, /kind !== "video"[\s\S]{0,180}inspiration/);
  assert.match(generator, /const strictIdentityReferenceMode =/);
  assert.match(generator, /role: MediaGenerationReferenceRole/);
  assert.match(generator, /image\.role === args\.role/);
  assert.match(generator, /identityMode: effectiveIdentityMode/);
  assert.match(generator, /inspirationImages: mediaSourceMode === "real" \? inspirationImages : \[\]/);
  assert.doesNotMatch(
    generator,
    /kind === "video" && peopleMode !== "none" \? \(\s*<>[\s\S]{0,200}ai_generator_video_character_label/,
  );
  assert.match(hook, /function hasStrictIdentityReferences/);
  assert.match(hook, /identityMode:[\s\S]*?request\.peopleMode !== "none"/);
  assert.match(hook, /inspirationImages: request\.inspirationImages\?\.length/);
  assert.doesNotMatch(hook, /request\.peopleMode !== "none" \? request\.inspirationImages/);
});

test("les moteurs image reçoivent les références sans repli photo silencieux", () => {
  const gateway = read("lib/aiMediaGateway.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  const route = read("app/api/media-generation/generate/route.ts");
  const imageBranchStart = server.indexOf(
    'if (providerRequest.kind === "image")',
  );
  const imageBranchEnd = server.indexOf("\n  } else {", imageBranchStart);
  const imageBranch = server.slice(imageBranchStart, imageBranchEnd);

  assert.match(gateway, /identityReferences\?: readonly Buffer\[\]/);
  assert.match(gateway, /referenceRoles\?: ReadonlyArray/);
  assert.match(gateway, /const referenceImages = \[[\s\S]*?\.\.\.providedReferences/);
  assert.match(gateway, /images: referenceImages/);
  assert.match(gateway, /ai_image_identity_not_generated/);
  assert.match(gateway, /generateAiMediaImageWithGoogle/);
  assert.match(gateway, /DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3\.1-flash-image"/);
  assert.match(gateway, /response_format: \{[\s\S]*?type: "image"/);
  assert.match(gateway, /mime_type: "image\/jpeg"/);
  assert.doesNotMatch(gateway, /inputFidelity/);
  assert.match(gateway, /Ne pas préserver ni recopier son identité/);
  assert.match(gateway, /décor de référence/);
  assert.match(gateway, /produit à intégrer/);
  assert.match(server, /\(\{ role, usage, characterIndex \}\)/);
  assert.match(gateway, /"role" \| "usage" \| "characterIndex"/);
  assert.match(
    gateway,
    /reference\.role === "character" && reference\.usage === "required"/,
  );
  assert.match(gateway, /usage === "inspiration"/);
  assert.match(gateway, /Ne pas préserver ni recopier son identité/);
  assert.match(gateway, /Détecter toutes les personnes distinctes visibles/);
  assert.match(gateway, /les mettre naturellement en action/);
  assert.match(
    server,
    /role === "character" &&[\s\S]{0,120}usage === "required"/,
  );
  assert.doesNotMatch(gateway, /catch[\s\S]{0,400}generateImage\([\s\S]{0,250}args\.prompt/);
  assert.match(server, /prepareAiMediaIdentityReferences\(args\.request\.inspirationImages\)/);
  assert.match(server, /identityReferences: preparedIdentityReferences\.buffers/);
  assert.match(server, /identityMode: providerRequest\.identityMode/);
  assert.match(imageBranch, /generateAiMediaImageWithGoogle\(/);
  assert.match(imageBranch, /primaryError instanceof AiGatewayAccountLimitError/);
  assert.match(imageBranch, /primaryError instanceof AiGatewayGuardUnavailableError/);
  assert.match(imageBranch, /ai_image_identity_generation_unavailable/);
  assert.match(imageBranch, /ai_image_provider_output_invalid/);
  assert.doesNotMatch(imageBranch, /getLocalFallbackFrame\(/);
  assert.doesNotMatch(imageBranch, /createReferenceIdentityMontage\(/);
  assert.doesNotMatch(imageBranch, /inrcy-local-composer/);
  assert.doesNotMatch(imageBranch, /image_local_fallback/);
  assert.match(route, /AI_MEDIA_IMAGE_IDENTITY_REFERENCE_REJECTED/);
  assert.match(route, /AI_MEDIA_IMAGE_PROVIDERS_UNAVAILABLE/);
  assert.match(route, /Aucun visage générique n’a été substitué/);
  assert.match(route, /photo du professionnel n’a pas été réutilisée comme faux résultat/);
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

test("iNrStudio accepte le catalogue image Booster et convertit les formats navigateur incompatibles", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const uploadPolicy = read("lib/mediaUploadPolicy.ts");
  const uploadIntent = read("app/api/media-pipeline/upload-intent/route.ts");
  const conversionRoute = read(
    "app/api/media-generation/normalize-reference/route.ts",
  );

  assert.match(generator, /INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES/);
  assert.match(generator, /INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS/);
  assert.match(generator, /accept=\{INSPIRATION_IMAGE_ACCEPT\}/);
  assert.match(generator, /target: "ai_identity_reference"/);
  assert.match(generator, /prepareInspirationImageInBrowser/);
  assert.match(generator, /prepareInspirationImageOnServer/);
  assert.match(uploadPolicy, /"ai_identity_reference"/);
  assert.match(uploadIntent, /folder: "studio-identity-reference"/);
  assert.match(uploadIntent, /registerSource: false/);
  assert.match(conversionRoute, /normalizeImageAiPreviewBuffer/);
  assert.match(conversionRoute, /removeTransientReference\(storagePath\)/);
  assert.match(conversionRoute, /mimeType: "image\/jpeg"/);
  assert.doesNotMatch(conversionRoute, /\.from\("pro_media_library"\)/);
});

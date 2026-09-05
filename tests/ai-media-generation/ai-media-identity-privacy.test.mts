import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  AiMediaIdentityReferenceValidationError,
  prepareAiMediaIdentityReferences,
} from "../../lib/aiMediaIdentityReferences.ts";
import { redactAiMediaSensitiveText } from "../../lib/aiMediaSensitiveText.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("les références sont validées, bornées et réencodées sans EXIF avant les fournisseurs", async () => {
  const source = await sharp({
    create: {
      width: 1_600,
      height: 1_000,
      channels: 3,
      background: { r: 30, g: 80, b: 140 },
    },
  })
    .jpeg({ quality: 92 })
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const prepared = await prepareAiMediaIdentityReferences([
    { mimeType: "image/jpeg", data: source.toString("base64") },
  ]);

  assert.equal(prepared.buffers.length, 1);
  assert.equal(prepared.providerImages[0]?.mimeType, "image/webp");
  assert.ok(prepared.providerImages[0]?.data.length);
  assert.equal(prepared.buffers[0]?.toString("ascii", 0, 4), "RIFF");
  assert.equal(prepared.buffers[0]?.toString("ascii", 8, 12), "WEBP");
  const metadata = await sharp(prepared.buffers[0]).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok((metadata.width || 0) <= 1_280);
  assert.ok((metadata.height || 0) <= 1_280);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
});

test("un MIME mensonger ou des octets non image sont refusés avant tout provider", async () => {
  const png = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 255, g: 0, b: 100 },
    },
  })
    .png()
    .toBuffer();

  await assert.rejects(
    () =>
      prepareAiMediaIdentityReferences([
        { mimeType: "image/jpeg", data: png.toString("base64") },
      ]),
    AiMediaIdentityReferenceValidationError,
  );
  await assert.rejects(
    () =>
      prepareAiMediaIdentityReferences([
        { mimeType: "image/png", data: Buffer.alloc(100, 7).toString("base64") },
      ]),
    AiMediaIdentityReferenceValidationError,
  );
});

test("les erreurs et warnings expurgent data URLs et longues séquences base64", () => {
  const secret = Buffer.alloc(180, 42).toString("base64");
  const redacted = redactAiMediaSensitiveText({
    message: `provider failed data:image/jpeg;base64,${secret}`,
    imageBytes: secret,
  });

  assert.doesNotMatch(redacted, new RegExp(secret.slice(0, 40)));
  assert.match(redacted, /media-reference-redacted/);
});

test("le serveur assainit une seule fois puis transmet les mêmes références aux images et vidéos", () => {
  const server = read("lib/aiMediaGenerationServer.ts");
  const normalization = server.indexOf(
    "prepareAiMediaIdentityReferences(args.request.inspirationImages)",
  );
  const imageProvider = server.indexOf("generateAiMediaImage({");
  const videoProvider = server.indexOf("generateOriginalAiVideoClips({");

  assert.ok(normalization > 0);
  assert.ok(imageProvider > normalization);
  assert.ok(videoProvider > normalization);
  assert.match(server, /identityReferences: preparedIdentityReferences\.buffers/);
  assert.match(server, /request: providerRequest/);
  assert.doesNotMatch(server, /request: args\.request/);
  assert.doesNotMatch(server, /prepareIdentityReferenceBuffers/);
});

test("les identités strictes restent sur GPT-Image-2, les références auto restent de simples inspirations", () => {
  const gateway = read("lib/aiMediaGateway.ts");

  assert.match(gateway, /identityMode: AiMediaIdentityMode/);
  assert.match(
    gateway,
    /strictIdentityReferences[\s\S]*?args\.identityMode === "professional"[\s\S]*?args\.identityMode === "brand_avatar"[\s\S]*?args\.identityMode === "reference_team"/,
  );
  assert.match(
    gateway,
    /const model = strictIdentityReferences[\s\S]*?DEFAULT_IMAGE_MODEL[\s\S]*?: configuredModel/,
  );
  assert.match(gateway, /inputFidelity: "high"/);
  assert.match(gateway, /uniquement des inspirations visuelles générales/);
  assert.match(
    gateway,
    /strictIdentityReferences[\s\S]*?"ai_image_identity_not_generated"[\s\S]*?"ai_image_not_generated"/,
  );
  assert.match(gateway, /redactAiMediaSensitiveText\(warning, 500\)/);
  assert.match(gateway, /configuredCost\(args\.referenceImagesCount\)/);
});

test("le contrat v3 neutralise toujours les références et v4 exige un identifiant opaque", () => {
  const route = read("app/api/media-generation/generate/route.ts");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");

  assert.match(route, /if \(body\.contractVersion === 3\)/);
  assert.match(
    route,
    /body\.contractVersion === 3[\s\S]*?inspirationImages: \[\][\s\S]*?identityConsent: false[\s\S]*?identityReferenceSetId: ""/,
  );
  assert.match(route, /IDENTITY_REFERENCE_SET_ID_PATTERN\.test\(referenceSetId\)/);
  assert.match(route, /AI_MEDIA_IMAGE_IDENTITY_MODEL_UNSUPPORTED/);
  assert.match(route, /safeAiMediaErrorMessage\(finalizationError\)/);
  assert.match(route, /safeAiMediaErrorMessage\(releaseError\)/);
  assert.match(route, /safeAiMediaErrorMessage\(error\)/);
  assert.doesNotMatch(route, /console\.(?:error|warn)\([^\n]*requestBody/);
  assert.doesNotMatch(hook, /start: image\.data\.slice/);
  assert.doesNotMatch(hook, /end: image\.data\.slice/);
  assert.match(hook, /identityReferenceSetId:/);
});

test("le prompt cumule cardinalité et identité sans promettre une ressemblance absolue", () => {
  const prompt = read("lib/aiMediaGenerationPrompt.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  assert.match(prompt, /PEOPLE_DIRECTIONS\[request\.peopleMode\]/);
  assert.match(prompt, /const castRule =/);
  assert.match(prompt, /const hasStrictIdentityReferences =/);
  assert.match(prompt, /uniquement des inspirations visuelles générales/);
  assert.match(prompt, /contrôler la ressemblance avant validation/);
  assert.doesNotMatch(prompt, /préserver fidèlement l’identité/);
  assert.match(
    omni,
    /details: redactAiMediaSensitiveText\(omniFailure\.details, 500\)/,
  );
});

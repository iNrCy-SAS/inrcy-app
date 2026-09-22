import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
  type AiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";

const LIB_ROOT = path.resolve("lib");
const modules = new Map<string, { exports: Record<string, unknown> }>();
const requireFromTest = createRequire(import.meta.url);

function loadLocalRuntime<T>(filename: string): T {
  const resolved = path.resolve(filename);
  assert.ok(
    resolved.startsWith(`${LIB_ROOT}${path.sep}`),
    "le runtime du test reste dans lib"
  );
  const cached = modules.get(resolved);
  if (cached) return cached.exports as T;

  const record = { exports: {} as Record<string, unknown> };
  modules.set(resolved, record);
  const output = ts.transpileModule(readFileSync(resolved, "utf8"), {
    fileName: resolved,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const factory = vm.runInThisContext(
    `(function(exports,require,module,__filename,__dirname){${output}\n})`,
    { filename: `${resolved}.runtime.cjs` }
  );
  factory(
    record.exports,
    (specifier: string) => {
      if (specifier === "server-only") return {};
      if (specifier === "sharp") return requireFromTest("sharp");
      const localPath = specifier.startsWith("@/lib/")
        ? path.join(LIB_ROOT, specifier.slice("@/lib/".length))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(resolved), specifier)
          : null;
      if (!localPath) {
        throw new Error(`unexpected_test_dependency:${specifier}`);
      }
      return loadLocalRuntime(
        localPath.endsWith(".ts") ? localPath : `${localPath}.ts`
      );
    },
    record,
    resolved,
    path.dirname(resolved)
  );
  return record.exports as T;
}

const { buildAiMediaPrompt, getAiMediaPromptOutputSpec } = loadLocalRuntime<
  typeof import("../../lib/aiMediaGenerationPrompt.ts")
>(path.join(LIB_ROOT, "aiMediaGenerationPrompt.ts"));
const { normalizeGeneratedAiImage } = loadLocalRuntime<
  typeof import("../../lib/aiMediaNormalizer.ts")
>(path.join(LIB_ROOT, "aiMediaNormalizer.ts"));

const SOURCE_IMAGE = {
  mimeType: "image/png",
  data: Buffer.alloc(96, 19).toString("base64"),
  role: "inspiration",
} as const;

function modificationRequest(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    requestId: "modify-image-contract",
    operation: "modify",
    inputMode: "essential",
    kind: "image",
    source: "studio",
    aiInstruction: "Remplacer uniquement le ciel par un ciel bleu clair.",
    modificationSourceWidth: 1795,
    modificationSourceHeight: 876,
    inspirationImages: [SOURCE_IMAGE],
    ...overrides,
  };
}

function assertInvalid(
  request: Record<string, unknown>,
  message: RegExp
): void {
  assert.throws(
    () => normalizeAiMediaGenerationRequest(request),
    (error: unknown) => {
      assert.ok(error instanceof AiMediaRequestValidationError);
      assert.match(error.message, message);
      return true;
    }
  );
}

test("Modifier accepte uniquement une image source et une consigne, sans brief de génération", () => {
  const request = normalizeAiMediaGenerationRequest(
    modificationRequest({ subjectSource: "custom", idea: "" })
  );

  assert.equal(request.operation, "modify");
  assert.equal(request.kind, "image");
  assert.equal(request.idea, "");
  assert.equal(request.aiInstruction, "Remplacer uniquement le ciel par un ciel bleu clair.");
  assert.deepEqual(request.inspirationImages, [
    { ...SOURCE_IMAGE, usage: "inspiration" },
  ]);
  assert.equal(request.identityMode, "auto");
  assert.equal(request.identityConsent, false);
  assert.equal(request.identityReferenceSetId, "");
  assert.equal(request.modificationSourceWidth, 1795);
  assert.equal(request.modificationSourceHeight, 876);
});

test("Modifier ne traite jamais son image source comme un jeu de références d'identité", () => {
  const request = normalizeAiMediaGenerationRequest(
    modificationRequest({
      identityMode: "professional",
      identityConsent: true,
      identityReferenceSetId: "not-an-identity-reference-set",
    })
  );

  assert.equal(request.operation, "modify");
  assert.equal(request.inspirationImages.length, 1);
  assert.equal(request.inspirationImages[0]?.role, "inspiration");
  assert.equal(request.identityMode, "auto");
  assert.equal(request.videoCharacterMode, "auto");
  assert.equal(request.identityConsent, false);
  assert.equal(request.identityReferenceSetId, "");

  const route = readFileSync(
    path.resolve("app/api/media-generation/generate/route.ts"),
    "utf8"
  );
  assert.match(route, /if \(operation === "modify"\)/);
  assert.match(
    route,
    /operation === "modify"[\s\S]*?identityMode: "auto"[\s\S]*?identityReferenceSetId: ""[\s\S]*?return body;/
  );
});

test("Modifier refuse la vidéo", () => {
  assertInvalid(
    modificationRequest({ kind: "video" }),
    /uniquement une image/i
  );
});

test("Modifier exige exactement une source portant le rôle inspiration", () => {
  assertInvalid(
    modificationRequest({ inspirationImages: [] }),
    /une seule image source/i
  );
  assertInvalid(
    modificationRequest({
      inspirationImages: [{ ...SOURCE_IMAGE, role: "product" }],
    }),
    /une seule image source/i
  );
  assertInvalid(
    modificationRequest({
      inspirationImages: [SOURCE_IMAGE, SOURCE_IMAGE],
    }),
    /une seule image source/i
  );
});

test("Modifier exige une vraie consigne", () => {
  assertInvalid(
    modificationRequest({ aiInstruction: "" }),
    /décrivez la modification/i
  );
  assertInvalid(
    modificationRequest({ aiInstruction: "ok" }),
    /décrivez la modification/i
  );
});

test("Modifier exige le canvas orienté de sa source, sans l'imposer à Générer", () => {
  assertInvalid(
    modificationRequest({ modificationSourceWidth: undefined }),
    /largeur de l.image source est invalide/i
  );
  assertInvalid(
    modificationRequest({ modificationSourceHeight: 0 }),
    /hauteur de l.image source est invalide/i
  );

  const generation = normalizeAiMediaGenerationRequest({
    requestId: "generate-canvas-compatibility",
    operation: "generate",
    kind: "image",
    source: "studio",
    subjectSource: "custom",
    idea: "Une vitrine de boulangerie chaleureuse",
    modificationSourceWidth: 1795,
    modificationSourceHeight: 876,
  });
  assert.equal(generation.modificationSourceWidth, null);
  assert.equal(generation.modificationSourceHeight, null);
});

test("le prompt Modifier conserve la source et n'ordonne jamais une nouvelle scène", () => {
  const request = normalizeAiMediaGenerationRequest(
    modificationRequest()
  ) as AiMediaGenerationRequest;
  const prompt = buildAiMediaPrompt({
    request,
    // Le chemin `modify` est autonome et ne lit pas le profil de génération.
    profile: {} as never,
  });

  assert.match(prompt, /IMAGE SOURCE/i);
  assert.match(prompt, /canvas de départ obligatoire/i);
  assert.match(prompt, /Modifier uniquement les zones et éléments nécessaires/i);
  assert.match(prompt, /Conserver tout le reste/i);
  assert.match(prompt, /il ne s’agit pas de créer une nouvelle scène/i);
  assert.match(prompt, /1795 × 876 px/i);
  assert.match(prompt, /ratio exact 1795:876/i);
  assert.match(prompt, /marge blanche ou noire/i);
  assert.doesNotMatch(prompt, /SORTIE[^\n]*16:9/i);
  assert.doesNotMatch(prompt, /Produire une nouvelle scène plein cadre/i);

  const outputSpec = getAiMediaPromptOutputSpec(request);
  assert.equal(outputSpec.width, 1795);
  assert.equal(outputSpec.height, 876);
  assert.equal(outputSpec.aspectRatio, "1795:876");
  assert.equal(outputSpec.canvasMode, "source");
});

test("la normalisation Modifier remplit le ratio ultra-large sans bandes ajoutées", async () => {
  // Simule le preset fournisseur 3:2 : le contenu source ultra-large occupe
  // le haut du canvas et le fournisseur a complété le bas en noir.
  const sharp = requireFromTest("sharp") as typeof import("sharp").default;
  const providerOutput = await sharp({
    create: {
      width: 1536,
      height: 1024,
      channels: 3,
      background: "#000000",
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="1536" height="750" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#ef4444"/><stop offset="0.5" stop-color="#2563eb"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="1536" height="750" fill="url(#g)"/><path d="M0 40 L1536 710 M0 710 L1536 40" stroke="#fff" stroke-width="32"/></svg>'
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const normalized = await normalizeGeneratedAiImage(providerOutput, {
    width: 1795,
    height: 876,
    canvasMode: "source",
  });
  assert.equal(normalized.width, 1795);
  assert.equal(normalized.height, 876);

  const bottomBand = await sharp(normalized.buffer)
    .extract({ left: 64, top: 836, width: 1667, height: 32 })
    .stats();
  assert.ok(
    bottomBand.channels
      .slice(0, 3)
      .some((channel: { mean: number }) => channel.mean > 45),
    "la grande bande noire fournisseur doit être recadrée"
  );
});

test("le client et le serveur réservent le canvas source au chemin Modifier", () => {
  const modifier = readFileSync(
    path.resolve("app/dashboard/_components/MediaModifier.tsx"),
    "utf8"
  );
  const server = readFileSync(
    path.join(LIB_ROOT, "aiMediaGenerationServer.ts"),
    "utf8"
  );
  const normalizer = readFileSync(
    path.join(LIB_ROOT, "aiMediaNormalizer.ts"),
    "utf8"
  );

  assert.match(modifier, /modificationSourceWidth: sourceImage\.width/);
  assert.match(modifier, /modificationSourceHeight: sourceImage\.height/);
  assert.match(server, /providerRequest\.operation === "modify"/);
  assert.match(server, /canvasMode: modificationCanvas \? "source" : "preset"/);
  assert.match(normalizer, /fit: "cover", position: "attention"/);
  assert.match(normalizer, /fit: "contain", position: "centre"/);
});

test("les deux moteurs image reçoivent le contrat de modification", () => {
  const gateway = readFileSync(
    path.join(LIB_ROOT, "aiMediaGateway.ts"),
    "utf8"
  );

  assert.match(gateway, /if \(args\.operation === "modify"\)/);
  assert.match(gateway, /Image 1 est l’image source exacte à modifier/);
  assert.ok(
    (gateway.match(/operation: args\.operation/g) || []).length >= 2,
    "le moteur nominal et le fallback Google doivent recevoir l'opération"
  );
});

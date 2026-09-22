import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import {
  AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS,
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

function loadImageGatewayBoundaryRuntime() {
  const filename = path.join(LIB_ROOT, "aiMediaGateway.ts");
  const captures: {
    nominal?: {
      model: string;
      text: string;
      images: readonly Buffer[];
      size: string;
      providerOptions?: Record<string, Record<string, unknown>>;
    };
    google?: {
      text: string;
      imageData: string;
      imageMimeType: string;
      aspectRatio: string;
    };
  } = {};
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const stubs = new Map<string, unknown>([
    ["server-only", {}],
    [
      "ai",
      {
        experimental_generateImage: async (args: {
          model: string;
          prompt: string | { text: string; images: readonly Buffer[] };
          size: string;
          providerOptions?: Record<string, Record<string, unknown>>;
        }) => {
          const prompt =
            typeof args.prompt === "string"
              ? { text: args.prompt, images: [] as readonly Buffer[] }
              : args.prompt;
          captures.nominal = {
            model: args.model,
            text: prompt.text,
            images: prompt.images,
            size: args.size,
            providerOptions: args.providerOptions,
          };
          return {
            image: {
              uint8Array: new Uint8Array([1, 2, 3]),
              mediaType: "image/jpeg",
            },
            images: [],
            warnings: [],
            usage: {},
          };
        },
        NoImageGeneratedError: { isInstance: () => false },
      },
    ],
    [
      "@google/genai",
      {
        GoogleGenAI: class {
          interactions = {
            create: async (args: {
              input: Array<{
                type: string;
                text?: string;
                data?: string;
                mime_type?: string;
              }>;
              response_format: { aspect_ratio: string };
            }) => {
              const image = args.input.find((item) => item.type === "image");
              captures.google = {
                text: String(args.input[0]?.text || ""),
                imageData: String(image?.data || ""),
                imageMimeType: String(image?.mime_type || ""),
                aspectRatio: args.response_format.aspect_ratio,
              };
              return {
                output_image: {
                  data: Buffer.from([1, 2, 3]).toString("base64"),
                  mime_type: "image/jpeg",
                },
                usage: {},
              };
            },
          };
        },
      },
    ],
    [
      "@/lib/aiGatewayAccountGuard",
      {
        reserveAiGatewayAccountAttempt: async () => ({}),
        commitAiGatewayAccountAttempt: async () => undefined,
        rollbackAiGatewayAccountAttempt: async () => undefined,
        recordAiGatewayAccountFailure: async () => undefined,
      },
    ],
    [
      "@/lib/aiMediaBuffer",
      { bufferFromUint8ArrayView: (value: Uint8Array) => Buffer.from(value) },
    ],
    ["@/lib/aiMediaGenerationContracts", {}],
    [
      "@/lib/aiMediaSensitiveText",
      { redactAiMediaSensitiveText: (value: unknown) => String(value || "") },
    ],
  ]);
  const record = { exports: {} as Record<string, unknown> };
  const factory = vm.runInThisContext(
    `(function(exports,require,module,__filename,__dirname){${output}\n})`,
    { filename: `${filename}.modification-boundary.cjs` }
  );
  factory(
    record.exports,
    (specifier: string) => {
      if (stubs.has(specifier)) return stubs.get(specifier);
      throw new Error(`unexpected_test_dependency:${specifier}`);
    },
    record,
    filename,
    path.dirname(filename)
  );
  return {
    runtime: record.exports as {
      generateAiMediaImage: typeof import("../../lib/aiMediaGateway.ts").generateAiMediaImage;
      generateAiMediaImageWithGoogle: typeof import("../../lib/aiMediaGateway.ts").generateAiMediaImageWithGoogle;
    },
    captures,
  };
}

const { buildAiMediaPrompt, getAiMediaPromptOutputSpec } = loadLocalRuntime<
  typeof import("../../lib/aiMediaGenerationPrompt.ts")
>(path.join(LIB_ROOT, "aiMediaGenerationPrompt.ts"));
const { normalizeGeneratedAiImage } = loadLocalRuntime<
  typeof import("../../lib/aiMediaNormalizer.ts")
>(path.join(LIB_ROOT, "aiMediaNormalizer.ts"));
const { resolveAiMediaImageEditSize } = loadLocalRuntime<
  typeof import("../../lib/aiMediaImageProviderRequest.ts")
>(path.join(LIB_ROOT, "aiMediaImageProviderRequest.ts"));

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

test("Modifier ignore les habillages et options de marque hérités de Générer", () => {
  const request = normalizeAiMediaGenerationRequest(modificationRequest({
    withText: true,
    textMode: "exact",
    exactText: "SLOGAN_GENERATION_PARASITE",
    textKeywords: ["mot parasite"],
    useBrandColors: true,
    logoMode: "visible",
    creativity: "bold",
  }));
  assert.equal(request.textMode, "none");
  assert.equal(request.withText, false);
  assert.equal(request.exactText, "");
  assert.deepEqual(request.textKeywords, []);
  assert.equal(request.useBrandColors, false);
  assert.equal(request.logoMode, "none");
  assert.equal(request.inspirationImages.length, 1);
  assert.equal(request.aiInstruction, "Remplacer uniquement le ciel par un ciel bleu clair.");

  const defaults = normalizeAiMediaGenerationRequest(modificationRequest());
  assert.equal(defaults.logoMode, "none", "aucun logo implicite sur les anciens clients Modifier");
  assert.equal(defaults.useBrandColors, false);
});

test("Modifier garde les corrections textuelles explicites sans originalité ni ADN", () => {
  const aiInstruction = "Remplacer uniquement « Ancien numéro » par « Contact : 01 02 03 04 05 ». Conserver tous les autres mots, le décor et les personnages.";
  const request = normalizeAiMediaGenerationRequest(modificationRequest({ aiInstruction, creativity: "bold" }));
  const profile = new Proxy({}, {
    get() { throw new Error("modification_must_not_read_business_dna"); },
  });
  const prompt = buildAiMediaPrompt({ request, profile: profile as never });
  assert.ok(prompt.includes(aiInstruction));
  assert.match(prompt, /TEXTE EN MODE MODIFICATION : conserver mot pour mot tout texte non visé/);
  assert.match(prompt, /valeurs exactes fournies/);
  assert.doesNotMatch(prompt, /ORIGINALITY:|SIGNATURE CRÉATIVE|ADN PROFESSIONNEL|tablet|laptop|office|nouvelle pose/i);
  assert.doesNotMatch(prompt, /Le texte du brief décrit une idée et non une accroche|ne jamais le recopier, même partiellement/);

  const server = readFileSync(path.join(LIB_ROOT, "aiMediaGenerationServer.ts"), "utf8");
  assert.match(server, /const profilePhoneDisplayRequested =\s*providerRequest\.operation !== "modify" &&/);
  assert.match(server, /const useDeterministicImageComposition =\s*providerRequest\.operation !== "modify" &&/);
  assert.match(server, /const officialLogo =\s*providerRequest\.operation === "modify" \|\| providerRequest\.logoMode === "none"\s*\? null/);
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

test("la consigne Modifier Image conserve jusqu'à 1 200 caractères de bout en bout", () => {
  const endMarker = "FIN-1200";
  const acceptedInstruction = `${"A".repeat(
    AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS - endMarker.length
  )}${endMarker}`;
  const overflowInstruction = `${acceptedInstruction}HORS-LIMITE`;
  const request = normalizeAiMediaGenerationRequest(
    modificationRequest({ aiInstruction: acceptedInstruction })
  );

  assert.equal(AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS, 1_200);
  assert.equal(request.aiInstruction.length, 1_200);
  assert.equal(request.aiInstruction, acceptedInstruction);
  assertInvalid(
    modificationRequest({ aiInstruction: overflowInstruction }),
    /1.?200 caractères/i
  );

  const prompt = buildAiMediaPrompt({ request, profile: {} as never });
  assert.match(prompt, /FIN-1200/);
  assert.doesNotMatch(prompt, /HORS-LIMITE/);
  assert.throws(
    () =>
      buildAiMediaPrompt({
        request: { ...request, aiInstruction: overflowInstruction },
        profile: {} as never,
      }),
    /ai_media_modification_instruction_too_long/
  );

  const modifier = readFileSync(
    path.resolve("app/dashboard/_components/MediaModifier.tsx"),
    "utf8"
  );
  const hook = readFileSync(
    path.resolve("app/dashboard/_hooks/useMediaGeneration.ts"),
    "utf8"
  );
  const promptSource = readFileSync(
    path.resolve("lib/aiMediaModificationPrompt.ts"),
    "utf8"
  );
  assert.ok(
    (modifier.match(/maxLength=\{AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS\}/g) || [])
      .length >= 2,
    "le textarea et la dictée partagent la même borne"
  );
  assert.match(
    modifier,
    /instruction\.length\}\/\{AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS\}/
  );
  assert.ok(
    (hook.match(/normalizeMediaGenerationAiInstruction\(request\)/g) || [])
      .length >= 2,
    "la clé d'idempotence et le payload valident la même consigne Modifier"
  );
  assert.match(hook, /value\.length > AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS/);
  assert.match(
    promptSource,
    /AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS \+ 1[\s\S]*?instruction\.length > AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS/
  );
});

test("le moteur nominal et le fallback reçoivent la consigne 1 200, la source et le contrat Modifier intacts", async () => {
  const endMarker = "FIN-PROVIDER-1200";
  const acceptedInstruction = `${"B".repeat(
    AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS - endMarker.length
  )}${endMarker}`;
  const request = normalizeAiMediaGenerationRequest(
    modificationRequest({
      aiInstruction: acceptedInstruction,
      identityMode: "professional",
      identityConsent: true,
      identityReferenceSetId: "identity-detour-interdit",
    })
  );
  const compiledPrompt = buildAiMediaPrompt({
    request,
    profile: {} as never,
  });
  const sourceBytes = Buffer.from("source-webp-assainie-modifier-image");
  const { runtime, captures } = loadImageGatewayBoundaryRuntime();
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const previousGoogleKey = process.env.GEMINI_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  try {
    await runtime.generateAiMediaImage({
      accountId: "modify-provider-boundary",
      prompt: compiledPrompt,
      operation: request.operation,
      identityMode: request.identityMode,
      identityReferences: [sourceBytes],
      referenceRoles: request.inspirationImages.map(
        ({ role, usage, characterIndex }) => ({ role, usage, characterIndex })
      ),
      size: "1536x1024",
    });
    await runtime.generateAiMediaImageWithGoogle({
      accountId: "modify-provider-boundary",
      prompt: compiledPrompt,
      operation: request.operation,
      identityMode: request.identityMode,
      identityReferences: [sourceBytes],
      referenceRoles: request.inspirationImages.map(
        ({ role, usage, characterIndex }) => ({ role, usage, characterIndex })
      ),
      size: "1536x1024",
    });
  } finally {
    if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    if (previousGoogleKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGoogleKey;
  }

  assert.equal(request.aiInstruction.length, 1_200);
  assert.equal(request.identityMode, "auto");
  assert.equal(request.identityConsent, false);
  assert.match(compiledPrompt, /1795 × 876 px/);
  assert.match(compiledPrompt, /ratio exact 1795:876/);
  assert.match(compiledPrompt, /FIN-PROVIDER-1200/);

  assert.ok(captures.nominal);
  assert.ok(captures.google);
  assert.equal(
    captures.nominal.text.slice(0, compiledPrompt.length),
    compiledPrompt,
    "le moteur nominal reçoit le prompt compilé sans réécriture"
  );
  assert.equal(
    captures.google.text.slice(0, compiledPrompt.length),
    compiledPrompt,
    "le fallback reçoit le même prompt compilé sans réécriture"
  );
  assert.equal(captures.nominal.text, captures.google.text);
  assert.ok(captures.nominal.text.includes(acceptedInstruction));
  assert.doesNotMatch(captures.nominal.text, /ORIGINALITY:|SIGNATURE CRÉATIVE|ADN PROFESSIONNEL|nouvelle pose|Vary opening|Vary composition/);
  assert.equal(
    captures.nominal.text.match(/FIN-PROVIDER-1200/g)?.length,
    1
  );
  assert.match(captures.nominal.text, /Image 1 est l’image source exacte à modifier/);
  assert.match(captures.nominal.text, /conserver tous les pixels, sujets, identités/);
  assert.equal(captures.nominal.images.length, 1);
  assert.ok(captures.nominal.images[0]?.equals(sourceBytes));
  assert.equal(captures.google.imageData, sourceBytes.toString("base64"));
  assert.equal(captures.google.imageMimeType, "image/webp");
  assert.equal(captures.nominal.size, "1536x1024");
  assert.equal(captures.nominal.model, "openai/gpt-image-2.5-sunburst");
  assert.equal(captures.nominal.providerOptions?.openai?.quality, "high");
  assert.equal(captures.nominal.providerOptions?.openai?.outputFormat, "jpeg");
  assert.equal(captures.google.aspectRatio, "3:2");

  const server = readFileSync(
    path.resolve("lib/aiMediaGenerationServer.ts"),
    "utf8"
  );
  const imageBranch = server.slice(
    server.indexOf('if (providerRequest.kind === "image")'),
    server.indexOf("const imageBuffer = gateway.buffer")
  );
  assert.match(imageBranch, /operation: providerRequest\.operation/);
  assert.match(
    imageBranch,
    /identityReferences: preparedIdentityReferences\.buffers/
  );
  assert.match(imageBranch, /referenceRoles: preparedReferenceRoles/);
  assert.match(imageBranch, /generateAiMediaImage\(imageProviderRequest\)/);
  assert.match(
    imageBranch,
    /generateAiMediaImageWithGoogle\(imageProviderRequest\)/
  );
});

test("Modifier transmet au fournisseur un canvas multiple de 16 proche du ratio source", () => {
  assert.equal(
    resolveAiMediaImageEditSize({ width: 1_920, height: 1_080 }),
    "1536x864",
  );
  assert.equal(
    resolveAiMediaImageEditSize({ width: 1_795, height: 876 }),
    "1536x752",
  );
  assert.equal(
    resolveAiMediaImageEditSize({ width: 1_080, height: 1_920 }),
    "864x1536",
  );
  assert.equal(
    resolveAiMediaImageEditSize({ width: 640, height: 360 }),
    "1088x608",
  );
  const edgeCases = [
    { width: 1_500, height: 500 },
    { width: 500, height: 1_500 },
    { width: 10_000, height: 100 },
    { width: 100, height: 10_000 },
  ];
  for (const source of edgeCases) {
    const [width, height] = resolveAiMediaImageEditSize(source)
      .split("x")
      .map(Number);
    assert.equal(width % 16, 0, `${source.width}x${source.height}: largeur multiple de 16`);
    assert.equal(height % 16, 0, `${source.width}x${source.height}: hauteur multiple de 16`);
    assert.ok(width / height >= 1 / 3, `${source.width}x${source.height}: ratio portrait valide`);
    assert.ok(width / height <= 3, `${source.width}x${source.height}: ratio paysage valide`);
    assert.ok(width * height >= 655_360, `${source.width}x${source.height}: surface minimale`);
    assert.ok(Math.max(width, height) <= 1_536, `${source.width}x${source.height}: grand axe maximal`);
  }

  const server = readFileSync(
    path.resolve("lib/aiMediaGenerationServer.ts"),
    "utf8",
  );
  assert.match(
    server,
    /size: modificationCanvas\s*\? resolveAiMediaImageEditSize\(modificationCanvas\)\s*: format\.generationSize/,
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
  assert.match(
    modifier,
    /useEffect\(\s*\(\) => \(\) => \{[\s\S]*?URL\.revokeObjectURL\(previewUrlRef\.current\)[\s\S]*?\},\s*\[\],\s*\);/,
    "l’URL locale active ne doit être révoquée qu’au démontage",
  );
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

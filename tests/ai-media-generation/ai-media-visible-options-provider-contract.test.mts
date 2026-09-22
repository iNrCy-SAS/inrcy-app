import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import * as colorDirection from "../../lib/aiMediaColorDirection.ts";
import * as providerContract from "../../lib/aiMediaVideoProviderContract.ts";
import * as promptShared from "../../lib/aiMediaPromptShared.ts";
import * as dialogue from "../../lib/aiMediaDialogue.ts";
import {
  normalizeAiMediaGenerationRequest,
  type AiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";
import { AI_MEDIA_NARRATION_VOICE_VARIANTS } from "../../lib/aiMediaNarrationVoices.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import * as reliability from "../../lib/aiVideoReliability.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";

const ROOT = process.cwd();
const LIB_ROOT = path.join(ROOT, "lib");
const GENERATOR_SOURCE = readFileSync(
  path.join(ROOT, "app/dashboard/_components/MediaGenerator.tsx"),
  "utf8",
);
const HOOK_SOURCE = readFileSync(
  path.join(ROOT, "app/dashboard/_hooks/useMediaGeneration.ts"),
  "utf8",
);
const ROUTE_SOURCE = readFileSync(
  path.join(ROOT, "app/api/media-generation/generate/route.ts"),
  "utf8",
);
const GENERATION_SERVER_SOURCE = readFileSync(
  path.join(LIB_ROOT, "aiMediaGenerationServer.ts"),
  "utf8",
);
const BRAND_RENDERER_SOURCE = readFileSync(
  path.join(LIB_ROOT, "aiMediaBrandRenderer.ts"),
  "utf8",
);

const REFERENCE_DATA = Buffer.alloc(96, 31).toString("base64");

const localPromptModules = new Map<
  string,
  { exports: Record<string, unknown> }
>();

/** Charge les vrais assembleurs de prompt sans dépendre des alias Next.js. */
function loadLocalPromptRuntime<T>(filename: string): T {
  const resolved = path.resolve(filename);
  assert.ok(resolved.startsWith(`${LIB_ROOT}${path.sep}`));
  const cached = localPromptModules.get(resolved);
  if (cached) return cached.exports as T;

  const moduleRecord = { exports: {} as Record<string, unknown> };
  localPromptModules.set(resolved, moduleRecord);
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
    { filename: `${resolved}.image-prompt-runtime.cjs` },
  );
  factory(
    moduleRecord.exports,
    (specifier: string) => {
      const localPath = specifier.startsWith("@/lib/")
        ? path.join(LIB_ROOT, specifier.slice("@/lib/".length))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(resolved), specifier)
          : null;
      if (!localPath) throw new Error(`unexpected_test_dependency:${specifier}`);
      return loadLocalPromptRuntime(
        localPath.endsWith(".ts") ? localPath : `${localPath}.ts`,
      );
    },
    moduleRecord,
    resolved,
    path.dirname(resolved),
  );
  return moduleRecord.exports as T;
}

const { buildNormalizedAiGenerationProfile } = loadLocalPromptRuntime<
  typeof import("../../lib/aiGenerationProfile.ts")
>(path.join(LIB_ROOT, "aiGenerationProfile.ts"));
const { buildAiMediaPrompt, AI_MEDIA_COMPILED_PROMPT_MAX_CHARS } = loadLocalPromptRuntime<
  typeof import("../../lib/aiMediaGenerationPrompt.ts")
>(path.join(LIB_ROOT, "aiMediaGenerationPrompt.ts"));

function imageProfileFixture() {
  return buildNormalizedAiGenerationProfile({
    business: {
      company_name: "Atelier Horizon",
      profession: "Ébéniste",
      description: "Création de mobilier sur mesure à Arras.",
      services: ["Bibliothèque sur mesure", "Restauration de mobilier"],
      strengths: ["Finitions manuelles", "Bois local"],
      city: "Arras",
    },
    preferences: { language: "fr" },
  });
}

function buildImagePrompt(
  overrides: Record<string, unknown> = {},
  copy?: { headline: string },
  options: {
    deferVisibleElementsToComposer?: boolean;
    hasLogo?: boolean;
    brandColors?: string[];
  } = {},
) {
  const request = normalizeAiMediaGenerationRequest(
    baseRequest({ kind: "image", ...overrides }),
  );
  return buildAiMediaPrompt({
    request,
    profile: imageProfileFixture(),
    copy,
    brandColors:
      options.brandColors ??
      (request.useBrandColors ? ["#0000ff", "#ff0000"] : []),
    hasLogo: options.hasLogo ?? request.logoMode !== "none",
    deferVisibleElementsToComposer:
      options.deferVisibleElementsToComposer ?? false,
  });
}

function loadImageGatewayRuntime() {
  const filename = path.join(LIB_ROOT, "aiMediaGateway.ts");
  const captures: {
    nominal?: string;
    google?: string;
    nominalImages?: number;
    googleImages?: number;
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
        experimental_generateImage: async (args: { prompt: unknown }) => {
          if (typeof args.prompt === "string") {
            captures.nominal = args.prompt;
            captures.nominalImages = 0;
          } else {
            const prompt = args.prompt as {
              text?: unknown;
              images?: readonly unknown[];
            };
            captures.nominal = String(prompt?.text || "");
            captures.nominalImages = Array.isArray(prompt?.images)
              ? prompt.images.length
              : 0;
          }
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
              input: Array<{ type?: string; text?: string }>;
            }) => {
              captures.google = String(args.input[0]?.text || "");
              captures.googleImages = args.input.filter(
                (item) => item.type === "image",
              ).length;
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
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const factory = vm.runInThisContext(
    `(function(exports,require,module,__filename,__dirname){${output}\n})`,
    { filename: "ai-media-image-provider-boundary.runtime.cjs" },
  );
  factory(
    moduleRecord.exports,
    (specifier: string) => {
      if (stubs.has(specifier)) return stubs.get(specifier);
      throw new Error(`unexpected_test_dependency:${specifier}`);
    },
    moduleRecord,
    filename,
    path.dirname(filename),
  );
  return {
    runtime: moduleRecord.exports as {
      generateAiMediaImage: typeof import("../../lib/aiMediaGateway.ts").generateAiMediaImage;
      generateAiMediaImageWithGoogle: typeof import("../../lib/aiMediaGateway.ts").generateAiMediaImageWithGoogle;
    },
    captures,
  };
}

function loadVideoProviderPromptRuntime() {
  const filename = path.join(ROOT, "lib/aiVideoProviderGoogleVeo.ts");
  const nativeRequire = createRequire(import.meta.url);
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
      "@google/genai",
      {
        GoogleGenAI: class {
          constructor() {
            throw new Error("unexpected_network_client");
          }
        },
      },
    ],
    ["@/lib/aiGatewayAccountGuard", {}],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentDurations }],
    ["@/lib/aiVideoReliability", reliability],
    ["@/lib/aiVideoProviderTypes", providerTypes],
    ["@/lib/aiMediaDialogue", dialogue],
    ["@/lib/aiMediaColorDirection", colorDirection],
    ["@/lib/aiMediaVideoProviderContract", providerContract],
    ["@/lib/aiMediaPromptShared", promptShared],
    ["./aiMediaVideoContinuity.ts", {}],
    ["@/lib/aiMediaSensitiveText", {}],
  ]);
  const commonJsModule = { exports: {} as Record<string, unknown> };
  const factory = vm.runInThisContext(
    `(function(exports,require,module,__filename,__dirname){${output}\n})`,
    { filename: "ai-media-visible-options-provider.runtime.cjs" },
  );
  factory(
    commonJsModule.exports,
    (specifier: string) => {
      if (stubs.has(specifier)) return stubs.get(specifier);
      if (specifier.startsWith("node:")) return nativeRequire(specifier);
      throw new Error(`unexpected_test_dependency:${specifier}`);
    },
    commonJsModule,
    filename,
    path.dirname(filename),
  );
  return commonJsModule.exports as {
    buildGoogleVideoScenePrompt: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoScenePrompt;
  };
}

const videoProviderPromptRuntime = loadVideoProviderPromptRuntime();

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "studio-visible-options-provider-contract-0001",
    inputMode: "essential",
    operation: "generate",
    source: "studio",
    kind: "video",
    subjectSource: "custom",
    idea: "Montrer le savoir-faire de l'atelier",
    aiInstruction: "Créer une démonstration concrète et crédible.",
    generationMode: "ai_free",
    peopleCriterion: "auto",
    settingCriterion: "auto",
    focusCriterion: "auto",
    textMode: "none",
    exactText: "",
    withText: false,
    textKeywords: [],
    withMusic: false,
    withNarration: true,
    narrationVoice: "female",
    narrationVoiceVariant: "Kore",
    format: "square",
    typology: "service",
    visualStyle: "brand",
    visualDirection: "auto",
    imagePurpose: "auto",
    imageStyle: "photo",
    shotType: "auto",
    peopleMode: "auto",
    creativity: "faithful",
    useBrandColors: false,
    logoMode: "none",
    videoEngine: "omni",
    identityMode: "auto",
    videoCharacterMode: "auto",
    identityConsent: false,
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "voiceover",
    teamVideoVeoConsent: false,
    durationSeconds: 8,
    sceneMode: "single",
    connectScenes: false,
    inspirationImages: [],
    ...overrides,
  };
}

function providerArgs(request: AiMediaGenerationRequest) {
  return {
    accountId: "visible-options-contract",
    request,
    plan: {
      companyName: "Atelier Démo",
      headline: "Un geste précis",
      subline: "",
      cta: "",
      scenes: [
        {
          eyebrow: "",
          title: "Le geste professionnel",
          body: "Une démonstration claire.",
          spokenLine: "Regardez ce geste précis.",
          spokenReply: "Le résultat est prêt.",
          visualBrief: "Une action professionnelle crédible progresse.",
          layout: "hero",
        },
      ],
    },
    creativeBrief: "Atelier professionnel de proximité.",
    brandColors: [],
    profession: "Artisan",
    contentLanguage: "fr",
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

test("toutes les options visibles quittent MediaGenerator comme champs structurés et traversent le hook", () => {
  const generateStart = GENERATOR_SOURCE.indexOf("await generate({");
  const generateEnd = GENERATOR_SOURCE.indexOf("});", generateStart);
  assert.ok(generateStart >= 0 && generateEnd > generateStart);
  const generateCall = GENERATOR_SOURCE.slice(generateStart, generateEnd);

  const payloadStart = HOOK_SOURCE.indexOf("body: JSON.stringify({");
  const payloadEnd = HOOK_SOURCE.indexOf("}),", payloadStart);
  assert.ok(payloadStart >= 0 && payloadEnd > payloadStart);
  const payload = HOOK_SOURCE.slice(payloadStart, payloadEnd);

  const structuredFields = [
    "kind",
    "subjectSource",
    "idea",
    "aiInstruction",
    "generationMode",
    "peopleCriterion",
    "settingCriterion",
    "focusCriterion",
    "textMode",
    "exactText",
    "withText",
    "textKeywords",
    "withMusic",
    "withNarration",
    "narrationVoice",
    "narrationVoiceVariant",
    "format",
    "typology",
    "visualStyle",
    "visualDirection",
    "imagePurpose",
    "imageStyle",
    "peopleMode",
    "identityMode",
    "identityConsent",
    "identityReferenceSetId",
    "useBrandColors",
    "logoMode",
    "teamVideoMode",
    "teamVideoSpeechMode",
    "teamVideoVeoConsent",
    "durationSeconds",
    "sceneMode",
    "connectScenes",
    "inspirationImages",
  ] as const;

  const missingFromGenerator = structuredFields.filter(
    (field) => !new RegExp(`\\b${field}(?:\\s*:|\\s*,)`).test(generateCall),
  );
  const missingFromPayload = structuredFields.filter(
    (field) => !new RegExp(`\\b${field}(?:\\s*:|\\s*,)`).test(payload),
  );
  assert.deepEqual(missingFromGenerator, []);
  assert.deepEqual(missingFromPayload, []);
  assert.match(payload, /role:\s*image\.role/);
  assert.match(payload, /usage:\s*image\.usage/);
  assert.match(payload, /characterIndex:\s*image\.characterIndex/);
});

test("la normalisation conserve la matrice complète des choix visibles Image/Vidéo", () => {
  for (const subjectSource of ["publication", "custom", "profile"] as const) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({ subjectSource, idea: subjectSource === "profile" ? "" : "Sujet explicite" }),
    );
    assert.equal(request.subjectSource, subjectSource);
  }

  for (const format of ["square", "portrait", "story", "landscape"] as const) {
    assert.equal(normalizeAiMediaGenerationRequest(baseRequest({ format })).format, format);
  }
  for (const imageStyle of ["photo", "illustration", "three_d", "graphic"] as const) {
    assert.equal(normalizeAiMediaGenerationRequest(baseRequest({ imageStyle })).imageStyle, imageStyle);
  }
  for (const visualDirection of ["auto", "clean", "premium", "warm", "dynamic", "bold"] as const) {
    assert.equal(
      normalizeAiMediaGenerationRequest(baseRequest({ visualDirection })).visualDirection,
      visualDirection,
    );
  }
  for (const imagePurpose of [
    "auto",
    "simple",
    "social",
    "flyer",
    "product_sheet",
    "poster",
    "banner",
    "infographic",
  ] as const) {
    assert.equal(
      normalizeAiMediaGenerationRequest(baseRequest({ kind: "image", imagePurpose })).imagePurpose,
      imagePurpose,
    );
  }
  for (const logoMode of ["discreet", "visible", "none"] as const) {
    assert.equal(normalizeAiMediaGenerationRequest(baseRequest({ logoMode })).logoMode, logoMode);
  }
  for (const textMode of ["none", "ai", "exact"] as const) {
    const exactText = textMode === "exact" ? "Texte exact" : "";
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({
        textMode,
        exactText,
        withText: textMode !== "none",
        textKeywords: textMode === "ai" ? ["fabrication locale"] : [],
      }),
    );
    assert.equal(request.textMode, textMode);
    assert.equal(request.exactText, exactText);
  }

  for (const peopleCriterion of ["auto", "none", "one", "two", "three", "group"] as const) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({ generationMode: "ai_criteria", peopleCriterion }),
    );
    assert.equal(request.peopleCriterion, peopleCriterion);
  }
  for (const settingCriterion of ["auto", "interior", "exterior", "studio", "neutral"] as const) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({ generationMode: "ai_criteria", settingCriterion }),
    );
    assert.equal(request.settingCriterion, settingCriterion);
  }
  for (const focusCriterion of ["auto", "people", "product", "environment"] as const) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({ generationMode: "ai_criteria", focusCriterion }),
    );
    assert.equal(request.focusCriterion, focusCriterion);
  }

  for (const durationSeconds of [8, 16, 24] as const) {
    for (const sceneMode of durationSeconds === 8
      ? (["single"] as const)
      : (["single", "multi"] as const)) {
      const request = normalizeAiMediaGenerationRequest(
        baseRequest({ durationSeconds, sceneMode, connectScenes: sceneMode === "single" }),
      );
      assert.equal(request.durationSeconds, durationSeconds);
      assert.equal(request.sceneMode, sceneMode);
      assert.equal(request.connectScenes, durationSeconds > 8 && sceneMode === "single");
    }
  }

  for (const [narrationVoice, variants] of Object.entries(
    AI_MEDIA_NARRATION_VOICE_VARIANTS,
  ) as Array<[
    "female" | "male",
    readonly string[],
  ]>) {
    for (const narrationVoiceVariant of variants) {
      const request = normalizeAiMediaGenerationRequest(
        baseRequest({ narrationVoice, narrationVoiceVariant }),
      );
      assert.equal(request.narrationVoice, narrationVoice);
      assert.equal(request.narrationVoiceVariant, narrationVoiceVariant);
    }
  }
  for (const teamVideoSpeechMode of ["voiceover", "characters"] as const) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({ teamVideoSpeechMode, withNarration: true }),
    );
    assert.equal(request.teamVideoSpeechMode, teamVideoSpeechMode);
    assert.equal(request.withNarration, teamVideoSpeechMode === "voiceover");
  }
  for (const withMusic of [false, true]) {
    assert.equal(
      normalizeAiMediaGenerationRequest(baseRequest({ withMusic })).withMusic,
      withMusic,
    );
  }
  for (const useBrandColors of [false, true]) {
    assert.equal(
      normalizeAiMediaGenerationRequest(baseRequest({ useBrandColors })).useBrandColors,
      useBrandColors,
    );
  }

  const references = normalizeAiMediaGenerationRequest(
    baseRequest({
      generationMode: "inspiration",
      identityConsent: true,
      identityMode: "professional",
      inspirationImages: [
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "character",
          usage: "required",
          characterIndex: 1,
        },
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "product",
          usage: "required",
        },
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "environment",
          usage: "required",
        },
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "inspiration",
          usage: "inspiration",
        },
      ],
    }),
  );
  assert.deepEqual(
    references.inspirationImages.map(({ role, usage, characterIndex }) => ({
      role,
      usage,
      characterIndex,
    })),
    [
      { role: "character", usage: "required", characterIndex: 1 },
      { role: "product", usage: "required", characterIndex: undefined },
      { role: "environment", usage: "required", characterIndex: undefined },
      { role: "inspiration", usage: "inspiration", characterIndex: undefined },
    ],
  );
});

test("Générer Image compile chaque type, direction, mode, critère et mode texte visible", () => {
  const purposeContracts = {
    auto: /TYPE DE CRÉATION STRUCTURÉ — AUTO/,
    simple: /TYPE DE CRÉATION STRUCTURÉ — IMAGE SIMPLE/,
    social: /TYPE DE CRÉATION STRUCTURÉ — PUBLICATION SOCIALE/,
    flyer: /TYPE DE CRÉATION STRUCTURÉ — FLYER COMMERCIAL/,
    product_sheet: /TYPE DE CRÉATION STRUCTURÉ — FICHE PRODUIT/,
    poster: /TYPE DE CRÉATION STRUCTURÉ — AFFICHE/,
    banner: /TYPE DE CRÉATION STRUCTURÉ — BANNIÈRE/,
    infographic: /TYPE DE CRÉATION STRUCTURÉ — INFOGRAPHIE/,
  } as const;
  for (const [imagePurpose, contract] of Object.entries(purposeContracts)) {
    assert.match(buildImagePrompt({ imagePurpose }), contract, imagePurpose);
  }

  for (const visualDirection of [
    "auto",
    "clean",
    "premium",
    "warm",
    "dynamic",
    "bold",
  ] as const) {
    assert.match(
      buildImagePrompt({ visualDirection }),
      new RegExp(
        `DIRECTION VISUELLE STRUCTURÉE — ${visualDirection.toUpperCase()}`,
      ),
      visualDirection,
    );
  }

  assert.match(
    buildImagePrompt({ generationMode: "ai_free" }),
    /100 % IA SANS CRITÈRES/,
  );
  assert.match(
    buildImagePrompt({
      generationMode: "inspiration",
      inspirationImages: [
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "inspiration",
          usage: "inspiration",
        },
      ],
    }),
    /MODE IMAGE — INSPIRATIONS/,
  );

  const peopleContracts = {
    auto: /Personnages : laisser l’IA décider/,
    none: /Personnages : aucune personne/,
    one: /exactement 1 personne/,
    two: /exactement 2 personnes/,
    three: /exactement 3 personnes/,
    group: /groupe naturel crédible/,
  } as const;
  for (const [peopleCriterion, contract] of Object.entries(peopleContracts)) {
    assert.match(
      buildImagePrompt({ generationMode: "ai_criteria", peopleCriterion }),
      contract,
      peopleCriterion,
    );
  }
  const settingContracts = {
    auto: /Décor : déduire un lieu spécifique/,
    interior: /Décor : intérieur crédible/,
    exterior: /Décor : extérieur cohérent/,
    studio: /Décor : production en studio/,
    neutral: /Décor : fond neutre/,
  } as const;
  for (const [settingCriterion, contract] of Object.entries(settingContracts)) {
    assert.match(
      buildImagePrompt({ generationMode: "ai_criteria", settingCriterion }),
      contract,
      settingCriterion,
    );
  }
  const focusContracts = {
    auto: /Focus : choisir le point focal/,
    people: /Focus : priorité visuelle aux personnes/,
    product: /Focus : priorité visuelle au produit/,
    environment: /Focus : priorité visuelle au lieu/,
  } as const;
  for (const [focusCriterion, contract] of Object.entries(focusContracts)) {
    assert.match(
      buildImagePrompt({ generationMode: "ai_criteria", focusCriterion }),
      contract,
      focusCriterion,
    );
  }

  assert.match(buildImagePrompt({ textMode: "none" }), /AUCUN TEXTE VISIBLE/);
  assert.match(
    buildImagePrompt({
      textMode: "exact",
      exactText: "Portes ouvertes samedi",
      withText: true,
    }),
    /TEXTE EXACT[\s\S]*Portes ouvertes samedi/,
  );
  const aiTextPrompt = buildImagePrompt(
    {
      textMode: "ai",
      withText: true,
      textKeywords: ["bois local", "sur mesure"],
    },
    { headline: "Le bois prend forme ici" },
  );
  assert.match(aiTextPrompt, /TEXTE IA CONTEXTUALISÉ/);
  assert.match(aiTextPrompt, /Le bois prend forme ici/);
  assert.match(aiTextPrompt, /bois local, sur mesure/);
});

test("Générer Image traduit chaque format, rendu, palette et mode logo en contrat moteur", () => {
  const formatContracts = {
    square: [/format 1:1 \(Carré\)/, /Canvas natif et export final 1:1/],
    portrait: [/format 4:5 \(Portrait\)/, /canvas natif 2:3 sera recadré au centre en 4:5/],
    story: [/format 9:16 \(Story \/ Reel\)/, /canvas natif 2:3 sera recadré au centre en 9:16/],
    landscape: [/format 16:9 \(Paysage\)/, /canvas natif 3:2 sera recadré au centre en 16:9/],
  } as const;
  for (const [format, contracts] of Object.entries(formatContracts)) {
    const prompt = buildImagePrompt({ format });
    for (const contract of contracts) assert.match(prompt, contract, format);
  }

  for (const imageStyle of [
    "photo",
    "illustration",
    "three_d",
    "graphic",
  ] as const) {
    assert.match(
      buildImagePrompt({ imageStyle }),
      new RegExp(`rendu ${imageStyle}(?:,|\\.)`),
      imageStyle,
    );
  }

  const brandPalette = buildImagePrompt({ useBrandColors: true });
  assert.match(brandPalette, /Couleurs de marque[^\n]*vivid blue, vivid red/);
  const freePalette = buildImagePrompt({ useBrandColors: false });
  assert.doesNotMatch(freePalette, /vivid blue|vivid red/);
  assert.match(freePalette, /Palette créative libre/);

  assert.match(
    buildImagePrompt({ logoMode: "visible" }),
    /logo officiel[\s\S]*clairement visible[\s\S]*22 % du visuel/,
  );
  assert.match(
    buildImagePrompt({ logoMode: "discreet" }),
    /logo officiel[\s\S]*discrètement[\s\S]*12 % du visuel/,
  );
  assert.match(
    buildImagePrompt({ logoMode: "none" }),
    /Aucun logo n’est fourni : ne créer aucun logo/,
  );
});

test("la composition locale garde les valeurs de texte hors du prompt fournisseur", () => {
  const exactText = "OFFRE_CONFIDENTIELLE_24_SEPTEMBRE";
  const exactPrompt = buildImagePrompt(
    {
      textMode: "exact",
      exactText,
      withText: true,
      imagePurpose: "flyer",
    },
    undefined,
    { deferVisibleElementsToComposer: true, hasLogo: false },
  );
  assert.match(exactPrompt, /MODE TEXTE EXACT/);
  assert.match(exactPrompt, /conservée hors du prompt fournisseur/);
  assert.match(exactPrompt, /produire exclusivement le fond sans texte/);
  assert.doesNotMatch(exactPrompt, new RegExp(exactText));

  const generatedHeadline = "ACCROCHE_PRIVEE_VALIDEE_PAR_INRCY";
  const aiPrompt = buildImagePrompt(
    { textMode: "ai", withText: true },
    { headline: generatedHeadline },
    { deferVisibleElementsToComposer: true, hasLogo: false },
  );
  assert.match(aiPrompt, /MODE TEXTE IA CONTEXTUALISÉ/);
  assert.match(aiPrompt, /conservée hors du prompt fournisseur/);
  assert.doesNotMatch(aiPrompt, new RegExp(generatedHeadline));
  assert.match(
    GENERATION_SERVER_SOURCE,
    /useDeterministicImageComposition\s*=\s*[\s\S]*providerRequest\.withText/,
  );
  assert.match(GENERATION_SERVER_SOURCE, /composeAiMediaBrandedImage\(\{/);
  assert.match(
    GENERATION_SERVER_SOURCE,
    /copy:\s*\{[\s\S]*?headline:\s*creativePlan\.headline[\s\S]*?subline:\s*creativePlan\.subline[\s\S]*?cta:\s*creativePlan\.cta/,
  );
  assert.match(
    BRAND_RENDERER_SOURCE,
    /renderAiMediaStructuredCommercialOverlay/,
  );
  assert.match(
    BRAND_RENDERER_SOURCE,
    /isStructuredCommercialImagePurpose\(args\.imagePurpose\)[\s\S]*?renderAiMediaStructuredCommercialOverlay\(args\)/,
  );
  for (const imagePurpose of [
    "flyer",
    "product_sheet",
    "poster",
    "banner",
    "infographic",
  ]) {
    assert.match(
      BRAND_RENDERER_SOURCE,
      new RegExp(`"${imagePurpose}"`),
      `${imagePurpose} doit utiliser une composition commerciale structurée`,
    );
  }
});

test("la compaction ne supprime aucune option Image autoritaire du prompt fournisseur", () => {
  const longText =
    "Fabrication artisanale documentée, gestes précis, matières locales et résultat concret. ".repeat(
      90,
    );
  const profile = imageProfileFixture();
  profile.business.description = longText;
  profile.business.services = Array.from(
    { length: 15 },
    (_, index) => `Service ${index + 1} ${longText}`,
  );
  profile.business.strengths = Array.from(
    { length: 15 },
    (_, index) => `Preuve ${index + 1} ${longText}`,
  );
  profile.preferences.customInstructions = longText;
  const request = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "image",
      idea: longText.slice(0, 2_000),
      aiInstruction: longText.slice(0, 2_400),
      generationMode: "inspiration",
      identityMode: "professional",
      identityConsent: true,
      imagePurpose: "flyer",
      visualDirection: "bold",
      imageStyle: "graphic",
      format: "story",
      useBrandColors: true,
      logoMode: "visible",
      textMode: "exact",
      exactText: "Journée portes ouvertes — 24 septembre",
      withText: true,
      inspirationImages: [
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "character",
          usage: "required",
          characterIndex: 1,
        },
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "product",
          usage: "required",
        },
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "environment",
          usage: "inspiration",
        },
      ],
    }),
  );
  const prompt = buildAiMediaPrompt({
    request,
    profile,
    copy: { headline: request.exactText },
    brandColors: ["#0000ff", "#ff0000"],
    hasLogo: false,
    deferVisibleElementsToComposer: true,
    recentPublications: Array.from({ length: 5 }, (_, index) => ({
      title: `Historique ${index + 1} ${longText}`,
    })),
  });

  assert.ok(prompt.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS);
  assert.match(prompt, /contexte ADN compacté automatiquement par iNrCy/);
  const authoritativeContracts = [
    /MODE IMAGE — INSPIRATIONS/,
    /TYPE DE CRÉATION STRUCTURÉ — FLYER COMMERCIAL/,
    /DIRECTION VISUELLE STRUCTURÉE — BOLD/,
    /rendu graphic/,
    /9:16 \(Story \/ Reel\)/,
    /Couleurs de marque[^\n]*vivid blue, vivid red/,
    /RÉFÉRENCE OBLIGATOIRE — PERSONNAGES/,
    /RÉFÉRENCE OBLIGATOIRE — PRODUIT/,
    /INSPIRATION UNIQUEMENT — rôle Décor/,
    /COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION/,
  ];
  const missing = authoritativeContracts.filter((contract) => !contract.test(prompt));
  assert.deepEqual(
    missing.map(String),
    [],
    `Contrats Image perdus par la compaction : ${missing.map(String).join(", ")}`,
  );
  assert.doesNotMatch(prompt, /Journée portes ouvertes — 24 septembre/);
});

test("les prompts canoniques Image et Vidéo gardent 2 000 + 2 400 caractères et cinq références sans perte", () => {
  const exactLength = (seed: string, length: number) =>
    seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
  const idea = exactLength(
    "SUJET_LONG_5REFS scène artisanale concrète, produit central et équipe en action. ",
    2_000,
  );
  const instruction = exactLength(
    "INSTRUCTION_LONGUE_5REFS conserver chaque geste, chaque objet, chaque personne et chaque lieu sans substitution. ",
    2_400,
  );
  const exactText = exactLength("TEXTE EXACT VALIDÉ — ", 600);
  const references = [
    {
      mimeType: "image/jpeg",
      data: REFERENCE_DATA,
      role: "character",
      usage: "required",
      characterIndex: 1,
    },
    {
      mimeType: "image/jpeg",
      data: REFERENCE_DATA,
      role: "character",
      usage: "inspiration",
      characterIndex: 2,
    },
    {
      mimeType: "image/jpeg",
      data: REFERENCE_DATA,
      role: "product",
      usage: "required",
    },
    {
      mimeType: "image/jpeg",
      data: REFERENCE_DATA,
      role: "environment",
      usage: "inspiration",
    },
    {
      mimeType: "image/jpeg",
      data: REFERENCE_DATA,
      role: "inspiration",
      usage: "inspiration",
    },
  ];

  for (const kind of ["image", "video"] as const) {
    const profile = imageProfileFixture();
    const verboseContext = exactLength(
      "Contexte professionnel documenté avec matières, services, preuves et méthode spécifiques. ",
      5_500,
    );
    profile.business.description = verboseContext;
    profile.business.services = Array.from(
      { length: 15 },
      (_, index) => `Service ${index + 1} ${verboseContext}`,
    );
    profile.business.strengths = Array.from(
      { length: 15 },
      (_, index) => `Preuve ${index + 1} ${verboseContext}`,
    );
    profile.preferences.customInstructions = verboseContext;
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({
        kind,
        subjectSource: "profile",
        idea,
        aiInstruction: instruction,
        generationMode: "inspiration",
        identityMode: "professional",
        identityConsent: true,
        imagePurpose: kind === "image" ? "flyer" : "auto",
        visualDirection: "bold",
        visualStyle: "premium",
        imageStyle: "graphic",
        format: "story",
        useBrandColors: true,
        logoMode: "visible",
        textMode: "exact",
        exactText,
        withText: true,
        durationSeconds: kind === "video" ? 24 : 8,
        sceneMode: kind === "video" ? "multi" : "single",
        connectScenes: false,
        withMusic: kind === "video",
        withNarration: kind === "video",
        inspirationImages: references,
      }),
    );
    const prompt = buildAiMediaPrompt({
      request,
      profile,
      copy: { headline: exactText },
      brandColors: ["#0000ff", "#ff0000", "#00ff00", "#ffcc00"],
      hasLogo: true,
      deferVisibleElementsToComposer: true,
      recentPublications: Array.from({ length: 5 }, (_, index) => ({
        title: `Historique ${index + 1} ${verboseContext}`,
      })),
    });

    assert.ok(
      prompt.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS - 200,
      `${kind}: ${prompt.length}/${AI_MEDIA_COMPILED_PROMPT_MAX_CHARS}`,
    );
    assert.ok(prompt.includes(idea), `${kind}: sujet utilisateur tronqué`);
    assert.ok(prompt.includes(instruction), `${kind}: consigne utilisateur tronquée`);
    assert.match(prompt, /contexte ADN compacté automatiquement par iNrCy/);
    assert.match(prompt, /Couleurs de marque[^\n]*vivid blue, vivid red/);
    for (const reference of [
      /#1:character\/required\/personnage-1|Référence 1 — rôle=character, usage=required, personnage 1/,
      /#2:character\/inspiration\/personnage-2|Référence 2 — rôle=character, usage=inspiration, personnage 2/,
      /#3:product\/required|Référence 3 — rôle=product, usage=required/,
      /#4:environment\/inspiration|Référence 4 — rôle=environment, usage=inspiration/,
      /#5:inspiration\/inspiration|Référence 5 — rôle=inspiration, usage=inspiration/,
    ]) {
      assert.match(prompt, reference, `${kind}: rôle/usage perdu`);
    }
    assert.match(prompt, /ORIGINALITY:/);
    assert.match(prompt, /COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION/);
    if (kind === "video") {
      assert.ok(prompt.includes(exactText), "video: texte exact tronqué");
      assert.match(prompt, /DURÉE EXACTE : 24 secondes/);
      assert.match(prompt, /AUDIO ET PAROLE/);
    } else {
      assert.doesNotMatch(prompt, /TEXTE EXACT VALIDÉ/);
      assert.match(prompt, /TYPE DE CRÉATION STRUCTURÉ — FLYER COMMERCIAL/);
    }
  }
});

test("Générer Image conserve le rôle et l'usage de chaque référence jusqu'au prompt", () => {
  const requiredPrompt = buildImagePrompt({
    generationMode: "inspiration",
    identityMode: "professional",
    identityConsent: true,
    inspirationImages: [
      {
        mimeType: "image/jpeg",
        data: Buffer.alloc(96, 11).toString("base64"),
        role: "character",
        usage: "required",
        characterIndex: 1,
      },
      {
        mimeType: "image/jpeg",
        data: Buffer.alloc(96, 12).toString("base64"),
        role: "product",
        usage: "required",
      },
      {
        mimeType: "image/jpeg",
        data: Buffer.alloc(96, 13).toString("base64"),
        role: "environment",
        usage: "required",
      },
    ],
  });
  assert.match(requiredPrompt, /RÉFÉRENCE OBLIGATOIRE — PERSONNAGES/);
  assert.match(requiredPrompt, /RÉFÉRENCE OBLIGATOIRE — PRODUIT/);
  assert.match(requiredPrompt, /RÉFÉRENCE OBLIGATOIRE — DÉCOR/);

  const inspirationRoleContracts = {
    character: /INSPIRATION UNIQUEMENT[^\n]*(?:rôle|type)\s*[:=—-]?\s*personnage/i,
    product: /INSPIRATION UNIQUEMENT[^\n]*(?:rôle|type)\s*[:=—-]?\s*produit/i,
    environment:
      /INSPIRATION UNIQUEMENT[^\n]*(?:rôle|type)\s*[:=—-]?\s*(?:décor|lieu|environnement)/i,
  } as const;
  const missingInspirationRoles: string[] = [];
  for (const [role, contract] of Object.entries(inspirationRoleContracts)) {
    const prompt = buildImagePrompt({
      generationMode: "inspiration",
      inspirationImages: [
        {
          mimeType: "image/jpeg",
          data: Buffer.alloc(96, role.length).toString("base64"),
          role,
          usage: "inspiration",
          ...(role === "character" ? { characterIndex: 1 } : {}),
        },
      ],
    });
    if (!contract.test(prompt)) missingInspirationRoles.push(role);
  }
  assert.deepEqual(
    missingInspirationRoles,
    [],
    `Rôles devenus sans effet en mode Inspiration uniquement : ${missingInspirationRoles.join(", ")}`,
  );
});

test("le prompt Générer Image compilé traverse inchangé le moteur nominal et Google", async () => {
  const compiledPrompt = buildImagePrompt({
    generationMode: "ai_criteria",
    peopleCriterion: "two",
    settingCriterion: "studio",
    focusCriterion: "product",
    imagePurpose: "flyer",
    visualDirection: "bold",
    textMode: "exact",
    exactText: "Collection locale",
    withText: true,
  });
  const { runtime, captures } = loadImageGatewayRuntime();
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const previousGoogleKey = process.env.GEMINI_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  try {
    await runtime.generateAiMediaImage({
      accountId: "image-provider-contract",
      prompt: compiledPrompt,
      identityMode: "auto",
    });
    await runtime.generateAiMediaImageWithGoogle({
      accountId: "image-provider-contract",
      prompt: compiledPrompt,
      identityMode: "auto",
    });
  } finally {
    if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    if (previousGoogleKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGoogleKey;
  }
  assert.equal(captures.nominal, compiledPrompt);
  assert.equal(captures.google, compiledPrompt);

  const imageBranchStart = GENERATION_SERVER_SOURCE.indexOf(
    'if (providerRequest.kind === "image")',
  );
  const imageBranchEnd = GENERATION_SERVER_SOURCE.indexOf(
    "const imageBuffer = gateway.buffer",
    imageBranchStart,
  );
  const imageProviderBranch = GENERATION_SERVER_SOURCE.slice(
    imageBranchStart,
    imageBranchEnd,
  );
  if (imageProviderBranch.includes("imageProviderRequest")) {
    assert.match(
      imageProviderBranch,
      /buildAiMediaImageProviderRequest\(\{[\s\S]*?prompt,[\s\S]*?\}\)/,
    );
    assert.match(imageProviderBranch, /generateAiMediaImage\(imageProviderRequest\)/);
    assert.match(
      imageProviderBranch,
      /generateAiMediaImageWithGoogle\(imageProviderRequest\)/,
    );
  } else {
    assert.match(
      imageProviderBranch,
      /generateAiMediaImage\(\{[\s\S]*?prompt,[\s\S]*?\}\)/,
    );
    assert.match(
      imageProviderBranch,
      /generateAiMediaImageWithGoogle\(\{[\s\S]*?prompt,[\s\S]*?\}\)/,
    );
  }
});

test("les deux fournisseurs reçoivent les mêmes références, rôles, usages et logo", async () => {
  const referenceRoles = [
    { role: "character" as const, usage: "inspiration" as const, characterIndex: 1 as const },
    { role: "product" as const, usage: "required" as const },
    { role: "environment" as const, usage: "inspiration" as const },
  ];
  const compiledPrompt = buildImagePrompt({
    generationMode: "inspiration",
    logoMode: "visible",
    inspirationImages: referenceRoles.map((reference, index) => ({
      mimeType: "image/jpeg",
      data: Buffer.alloc(96, index + 41).toString("base64"),
      ...reference,
    })),
  });
  const references = referenceRoles.map((_, index) =>
    Buffer.alloc(64, index + 51),
  );
  const officialLogo = Buffer.alloc(48, 61);
  const { runtime, captures } = loadImageGatewayRuntime();
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const previousGoogleKey = process.env.GEMINI_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  const providerRequest = {
    accountId: "image-provider-reference-contract",
    prompt: compiledPrompt,
    identityMode: "auto" as const,
    identityReferences: references,
    referenceRoles,
    officialLogo,
  };
  try {
    await runtime.generateAiMediaImage(providerRequest);
    await runtime.generateAiMediaImageWithGoogle(providerRequest);
  } finally {
    if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    if (previousGoogleKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGoogleKey;
  }

  assert.equal(captures.nominal, captures.google);
  assert.ok(captures.nominal?.startsWith(`${compiledPrompt}\n\n`));
  assert.equal(captures.nominalImages, 4);
  assert.equal(captures.googleImages, 4);
  assert.match(
    captures.nominal || "",
    /Image 1 = inspiration uniquement, rôle Personnage[\s\S]*Ne préserver ni recopier aucune identité/,
  );
  assert.match(
    captures.nominal || "",
    /Image 2 = produit à intégrer[\s\S]*Préserver son apparence/,
  );
  assert.match(
    captures.nominal || "",
    /Image 3 = inspiration uniquement, rôle Décor[\s\S]*Ne reproduire ni imposer son plan/,
  );
  assert.match(
    captures.nominal || "",
    /L'image 4 est exclusivement le logo officiel/,
  );
});

test("les moteurs image conservent l’identité requise sans figer sa mise en scène par défaut", async () => {
  const { runtime, captures } = loadImageGatewayRuntime();
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const previousGoogleKey = process.env.GEMINI_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const providerRequest = {
      accountId: "image-required-character-creativity",
      prompt: "Créer une scène originale d’un boulanger adulte au travail.",
      identityMode: "professional" as const,
      identityReferences: [Buffer.alloc(64, 23)],
      referenceRoles: [{ role: "character" as const, usage: "required" as const, characterIndex: 1 as const }],
    };
    await runtime.generateAiMediaImage(providerRequest);
    await runtime.generateAiMediaImageWithGoogle(providerRequest);
  } finally {
    if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    if (previousGoogleKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGoogleKey;
  }
  assert.equal(captures.nominal, captures.google);
  assert.equal(captures.nominalImages, 1);
  assert.equal(captures.googleImages, 1);
  const prompt = captures.nominal || "";
  assert.match(prompt, /Préserver séparément le visage, les traits, la silhouette/);
  assert.match(prompt, /sans fusion, permutation, duplication, omission ni substitution/);
  assert.match(prompt, /Imaginer librement une nouvelle pose, un nouveau cadrage et un nouvel arrière-plan/);
  assert.match(prompt, /sauf consigne explicite ou référence obligatoire qui les fixe/);
  assert.doesNotMatch(prompt, /peuvent évoluer seulement si le brief le demande/);
});

test("le prompt réellement envoyé au provider vidéo encode les critères structurés visibles", () => {
  const request = normalizeAiMediaGenerationRequest(
    baseRequest({
      generationMode: "ai_criteria",
      peopleCriterion: "three",
      settingCriterion: "interior",
      focusCriterion: "product",
      visualDirection: "bold",
      visualStyle: "colorful",
      peopleMode: "team",
    }),
  );
  const prompt = videoProviderPromptRuntime.buildGoogleVideoScenePrompt(
    providerArgs(request),
    0,
    8,
  );
  const requiredSemantics = [
    ["mode IA avec critères", /ai[_ -]?criteria|with criteria/i],
    ["exactement trois personnes", /crit=three\//i],
    ["décor intérieur", /crit=[^;]*\/interior\//i],
    ["focus produit", /crit=[^;]*\/product(?:;|$)/i],
    ["direction audacieuse", /dir=bold(?:;|$)/i],
  ] as const;
  const missing = requiredSemantics
    .filter(([, pattern]) => !pattern.test(prompt))
    .map(([label]) => label);
  assert.deepEqual(
    missing,
    [],
    `Options UI perdues avant le provider vidéo : ${missing.join(", ")}`,
  );
});

test("Personnages qui parlent produit réellement du dialogue même sans photo d'inspiration", () => {
  const request = normalizeAiMediaGenerationRequest(
    baseRequest({
      generationMode: "ai_free",
      teamVideoSpeechMode: "characters",
      withNarration: false,
      inspirationImages: [],
    }),
  );
  const prompt = videoProviderPromptRuntime.buildGoogleVideoScenePrompt(
    providerArgs(request),
    0,
    8,
  );
  assert.match(prompt, /DIALOGUE:/);
  assert.doesNotMatch(prompt, /no speech/i);
});

test("une photo Personnage obligatoire peut contenir plusieurs personnes sans contrat provider singulier", () => {
  const request = normalizeAiMediaGenerationRequest(
    baseRequest({
      generationMode: "inspiration",
      identityMode: "professional",
      identityConsent: true,
      inspirationImages: [
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "character",
          usage: "required",
          characterIndex: 1,
        },
      ],
    }),
  );
  const prompt = videoProviderPromptRuntime.buildGoogleVideoScenePrompt(
    providerArgs(request),
    0,
    8,
  );
  assert.match(prompt, /all (?:distinct )?(?:approved )?adults|all people visible/i);
  assert.doesNotMatch(prompt, /same approved adult\b/i);
});

test("l'empreinte serveur distingue chaque option visible et le rôle de chaque référence", () => {
  const start = ROUTE_SOURCE.indexOf("function generationFingerprint");
  const end = ROUTE_SOURCE.indexOf("function assertDraftContractVersion", start);
  assert.ok(start >= 0 && end > start);
  const fingerprint = ROUTE_SOURCE.slice(start, end);
  const requestFields = [
    "inputMode",
    "generationMode",
    "peopleCriterion",
    "settingCriterion",
    "focusCriterion",
    "textMode",
    "exactText",
    "visualDirection",
    "imagePurpose",
    "teamVideoVeoConsent",
    "sceneMode",
    "connectScenes",
  ] as const;
  const missing = requestFields.filter(
    (field) => !new RegExp(`request\\.${field}\\b`).test(fingerprint),
  );
  for (const descriptor of ["role", "usage", "characterIndex"] as const) {
    if (!new RegExp(`(?:image|reference)\\.${descriptor}\\b`).test(fingerprint)) {
      missing.push(`inspirationImages.${descriptor}` as (typeof requestFields)[number]);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Champs absents de l'empreinte d'idempotence : ${missing.join(", ")}`,
  );
});

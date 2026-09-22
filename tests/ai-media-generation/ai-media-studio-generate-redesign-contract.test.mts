import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";

const ROOT = process.cwd();
const LIB_ROOT = path.join(ROOT, "lib");
const GENERATOR_PATH = path.join(
  ROOT,
  "app/dashboard/_components/MediaGenerator.tsx",
);
const HOOK_PATH = path.join(
  ROOT,
  "app/dashboard/_hooks/useMediaGeneration.ts",
);
const GENERATOR_STYLES_PATH = path.join(
  ROOT,
  "app/dashboard/_components/MediaGenerator.module.css",
);
const FR_MEDIA_PATH = path.join(ROOT, "messages/fr-FR/media.json");
const generatorSource = readFileSync(GENERATOR_PATH, "utf8");
const hookSource = readFileSync(HOOK_PATH, "utf8");
const generatorStyles = readFileSync(GENERATOR_STYLES_PATH, "utf8");
const promptRouterSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaGenerationPrompt.ts"),
  "utf8",
);
const imagePromptSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaImageGenerationPrompt.ts"),
  "utf8",
);
const videoPromptSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaVideoGenerationPrompt.ts"),
  "utf8",
);
const videoPromptModulesSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaVideoPromptModules.ts"),
  "utf8",
);
const modificationPromptSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaModificationPrompt.ts"),
  "utf8",
);
const generationServerSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaGenerationServer.ts"),
  "utf8",
);
const generationRouteSource = readFileSync(
  path.join(ROOT, "app/api/media-generation/generate/route.ts"),
  "utf8",
);
const brandRendererSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaBrandRenderer.ts"),
  "utf8",
);
const copywriterSource = readFileSync(
  path.join(LIB_ROOT, "aiMediaCopywriter.ts"),
  "utf8",
);
const frMedia = JSON.parse(readFileSync(FR_MEDIA_PATH, "utf8")) as Record<
  string,
  string
>;
const mediaCatalogs = [
  "fr-FR",
  "en-GB",
  "de-DE",
  "es-ES",
  "it-IT",
  "nl-NL",
  "pt-PT",
  "th-TH",
  "zh-CN",
].map((locale) => ({
  locale,
  messages: JSON.parse(
    readFileSync(path.join(ROOT, `messages/${locale}/media.json`), "utf8"),
  ) as Record<string, string>,
}));

const localModules = new Map<string, { exports: Record<string, unknown> }>();

/** Exécute les vraies fonctions TypeScript de `lib`, sans réseau ni provider. */
function loadLocalRuntime<T>(filename: string): T {
  const resolved = path.resolve(filename);
  assert.ok(
    resolved.startsWith(`${LIB_ROOT}${path.sep}`),
    "le runtime de test reste dans lib",
  );
  const cached = localModules.get(resolved);
  if (cached) return cached.exports as T;

  const moduleRecord = { exports: {} as Record<string, unknown> };
  localModules.set(resolved, moduleRecord);
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
    { filename: `${resolved}.runtime.cjs` },
  ) as (
    exports: Record<string, unknown>,
    require: (specifier: string) => unknown,
    module: { exports: Record<string, unknown> },
    filename: string,
    dirname: string,
  ) => void;
  factory(
    moduleRecord.exports,
    (specifier: string) => {
      const localPath = specifier.startsWith("@/lib/")
        ? path.join(LIB_ROOT, specifier.slice("@/lib/".length))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(resolved), specifier)
          : null;
      if (!localPath) throw new Error(`unexpected_test_dependency:${specifier}`);
      return loadLocalRuntime(
        localPath.endsWith(".ts") ? localPath : `${localPath}.ts`,
      );
    },
    moduleRecord,
    resolved,
    path.dirname(resolved),
  );
  return moduleRecord.exports as T;
}

const { buildNormalizedAiGenerationProfile } = loadLocalRuntime<
  typeof import("../../lib/aiGenerationProfile.ts")
>(path.join(LIB_ROOT, "aiGenerationProfile.ts"));
const { buildAiMediaCreativePlan } = loadLocalRuntime<
  typeof import("../../lib/aiMediaCreativePlan.ts")
>(path.join(LIB_ROOT, "aiMediaCreativePlan.ts"));
const { buildAiMediaPrompt, getAiMediaPromptOutputSpec } = loadLocalRuntime<
  typeof import("../../lib/aiMediaGenerationPrompt.ts")
>(path.join(LIB_ROOT, "aiMediaGenerationPrompt.ts"));

const REFERENCE_DATA = Buffer.alloc(96, 31).toString("base64");
const FORBIDDEN_CLICHES = [
  "Votre projet entre de bonnes mains",
  "Votre projet prend vie",
  "Une expertise à votre service",
  "Votre projet, notre métier",
  "Une réponse sur mesure",
  "Qualité, écoute, proximité",
] as const;

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "studio-redesign-contract-0001",
    inputMode: "essential",
    source: "studio",
    kind: "image",
    subjectSource: "custom",
    idea: "Présenter le travail précis de notre atelier",
    aiInstruction: "Créer une scène concrète, lumineuse et liée au vrai métier.",
    textMode: "none",
    exactText: "",
    withText: false,
    textKeywords: [],
    format: "square",
    imageStyle: "photo",
    peopleMode: "auto",
    identityMode: "auto",
    useBrandColors: true,
    logoMode: "discreet",
    durationSeconds: 8,
    sceneMode: "single",
    inspirationImages: [],
    ...overrides,
  };
}

function profileFixture() {
  return buildNormalizedAiGenerationProfile({
    business: {
      company_name: "Atelier Horizon",
      profession: "Ébéniste",
      description: "Création et restauration de mobilier sur mesure à Arras.",
      services: [
        "Bibliothèque sur mesure",
        "Restauration de mobilier",
        "Agencement professionnel",
      ],
      strengths: ["Finitions manuelles", "Bois local", "Conseil personnalisé"],
      customer_typologies: ["Commerçants", "Architectes", "Particuliers"],
      intervention_zones: ["Arras", "Lens", "Lille"],
      city: "Arras",
    },
    preferences: { language: "fr" },
  });
}

function assertGeneratorUsesLabel(value: string) {
  if (
    generatorSource.includes(value) ||
    generatorSource.includes(value.replace("&", "&amp;"))
  ) {
    return;
  }
  const keys = Object.entries(frMedia)
    .filter(([, translated]) => translated === value)
    .map(([key]) => key);
  assert.ok(keys.length, `le catalogue français doit contenir « ${value} »`);
  assert.ok(
    keys.some((key) => generatorSource.includes(`"${key}"`)),
    `MediaGenerator doit afficher une clé traduite par « ${value} »`,
  );
}

test("Générer possède quatre blocs stables, dédiés à Image et à Vidéo", () => {
  const blocks = [...generatorSource.matchAll(/data-generator-block="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(blocks, ["subject", "selection", "direction", "finish"]);

  const directionBlock = generatorSource.indexOf('data-generator-block="direction"');
  const finishBlock = generatorSource.indexOf('data-generator-block="finish"');
  assert.ok(directionBlock >= 0 && finishBlock > directionBlock);
  assert.match(
    generatorSource.slice(Math.max(0, directionBlock - 250), directionBlock + 450),
    /data-media-kind=\{kind\}/,
  );
  assert.match(
    generatorSource.slice(Math.max(0, finishBlock - 250), finishBlock + 450),
    /data-media-kind=\{kind\}/,
  );

  for (const title of [
    "Sujet & consigne",
    "Sélection",
    "Type, format & direction visuelle",
    "Texte & identité",
    "Durée, scénario, format & réalisation",
    "Voix, son, texte & identité",
  ]) {
    assertGeneratorUsesLabel(title);
  }

  assert.match(
    generatorStyles,
    /\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    generatorStyles,
    /@media \(max-width: 1100px\)[\s\S]*?\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  );
  assert.match(
    generatorStyles,
    /\.generator \.creationCard\[data-media-kind\]\[data-subject-source\][\s\S]*?"header"[\s\S]*?"sources"[\s\S]*?"brief"/,
  );
  assert.match(
    generatorStyles,
    /\.mediaModeField\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    generatorStyles,
    /@media \(max-width: 900px\)[\s\S]*?\.aiCriteriaGrid,[\s\S]*?grid-template-columns:\s*1fr/,
  );
  assert.match(
    generatorStyles,
    /@media \(min-width: 1101px\)[\s\S]*?\.generator \.directionCard\s*\{[\s\S]*?grid-template-rows:\s*max-content minmax\(0, 1fr\) max-content;[\s\S]*?align-content:\s*stretch;/,
    "le bloc 3 desktop doit répartir ses réglages dans toute la hauteur utile",
  );
  assert.match(
    generatorStyles,
    /\.generator \.directionCard > \.directionSettings\s*\{[\s\S]*?align-self:\s*center;/,
    "la grille 2x2 du bloc 3 doit rester centrée dans l’espace utile",
  );
});

test("le bloc Sujet & consigne propose publication, idée libre et ADN", () => {
  const choicesStart = generatorSource.indexOf("const subjectChoices:");
  const choicesEnd = generatorSource.indexOf("\n  ];", choicesStart);
  assert.ok(choicesStart >= 0 && choicesEnd > choicesStart);
  const choices = generatorSource.slice(choicesStart, choicesEnd);
  assert.deepEqual(
    [...choices.matchAll(/id: "(publication|custom|profile)"/g)].map(
      (match) => match[1],
    ),
    ["publication", "custom", "profile"],
  );
  for (const key of [
    "ai_generator_subject_publication",
    "ai_generator_subject_custom",
    "ai_generator_subject_profile",
  ]) {
    assert.equal(typeof frMedia[key], "string", `${key} doit être traduit`);
    assert.ok(
      choices.includes(`t("${key}")`),
      `${key} doit alimenter la source correspondante`,
    );
  }

  const withoutInstruction = normalizeAiMediaGenerationRequest(
    baseRequest({
      subjectSource: "profile",
      idea: "",
      aiInstruction: "",
    }),
  );
  assert.equal(withoutInstruction.subjectSource, "profile");
  assert.equal(withoutInstruction.aiInstruction, "");

  const instruction =
    "Mettre en scène une ébéniste qui ajuste une bibliothèque, sans décor générique.";
  const instructed = normalizeAiMediaGenerationRequest(
    baseRequest({
      subjectSource: "profile",
      idea: "",
      aiInstruction: instruction,
    }),
  );
  assert.equal(instructed.aiInstruction, instruction);
  const prompt = buildAiMediaPrompt({
    request: instructed,
    profile: profileFixture(),
  });
  assert.ok(prompt.includes(instruction));
  assert.match(prompt, /CONSIGNE[^\n]*PRIORITAIRE/i);
  assert.match(generatorSource, /aiInstruction:\s*generationAiInstruction/);
});

test("l’ADN seul varie automatiquement sans retomber sur le slogan cliché", () => {
  const profile = profileFixture();
  const headlines = new Set<string>();
  for (let index = 0; index < 18; index += 1) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({
        requestId: `studio-dna-variety-${String(index).padStart(4, "0")}`,
        subjectSource: "profile",
        idea: "",
        aiInstruction: "",
        textMode: "ai",
        withText: true,
      }),
    );
    const plan = buildAiMediaCreativePlan({
      request,
      profile,
      recentPublications: [],
    });
    headlines.add(plan.headline);
    for (const cliché of FORBIDDEN_CLICHES) {
      assert.notEqual(plan.headline.toLocaleLowerCase("fr"), cliché.toLocaleLowerCase("fr"));
    }
  }
  assert.ok(headlines.size >= 3, "les accroches ADN doivent réellement varier");
});

test("Sélection distingue IA libre, IA avec critères et inspiration libre", () => {
  for (const label of [
    "100 % IA sans critères",
    "IA avec critères",
    "Inspiration",
    "Utiliser impérativement",
    "Inspiration uniquement",
  ]) {
    assertGeneratorUsesLabel(label);
  }
  assert.match(generatorSource, /usage:\s*"required"\s*\|\s*"inspiration"/);
  assert.match(generatorSource, /usage:\s*"required"/);
  assert.match(generatorSource, /usage:\s*"inspiration"/);
  assert.match(generatorSource, /\["ai",\s*"criteria",\s*"real"\]\s+as const/);
  assert.match(generatorSource, /mediaSourceMode === "criteria"/);
  assert.match(generatorSource, /data-testid="ai-media-criteria-panel"/);

  const criteriaMessageKeys = [
    "ai_generator_redesign_selection_ai",
    "ai_generator_redesign_selection_criteria",
    "ai_generator_redesign_selection_inspiration",
    "ai_generator_redesign_criteria_panel_label",
    "ai_generator_redesign_criteria_intro_title",
    "ai_generator_redesign_criteria_intro_hint",
    "ai_generator_redesign_criteria_people_label",
    "ai_generator_redesign_criteria_setting_label",
    "ai_generator_redesign_criteria_focus_label",
    ...["auto", "none", "one", "two", "three", "group"].map(
      (value) => `ai_generator_redesign_criteria_people_${value}`,
    ),
    ...["auto", "interior", "exterior", "studio", "neutral"].map(
      (value) => `ai_generator_redesign_criteria_setting_${value}`,
    ),
    ...["auto", "people", "product", "environment"].map(
      (value) => `ai_generator_redesign_criteria_focus_${value}`,
    ),
  ];
  for (const { locale, messages } of mediaCatalogs) {
    for (const key of criteriaMessageKeys) {
      assert.ok(
        messages[key]?.trim(),
        `${locale} doit traduire la clé ${key}`,
      );
    }
  }

  const required = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      durationSeconds: 16,
      sceneMode: "multi",
      peopleMode: "solo",
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
  assert.equal(required.inspirationImages[0]?.role, "character");
  assert.equal(required.inspirationImages[0]?.usage, "required");
  assert.equal(required.identityMode, "professional");
  const requiredPrompt = buildAiMediaPrompt({
    request: required,
    profile: profileFixture(),
  });
  assert.match(
    requiredPrompt,
    /RÉFÉRENCE OBLIGATOIRE — FIDÉLITÉ D’IDENTITÉ/,
  );
  assert.match(requiredPrompt, /une photo peut contenir UNE OU PLUSIEURS personnes/i);
  assert.match(requiredPrompt, /toutes les personnes distinctes détectées sont obligatoires/i);
  assert.match(requiredPrompt, /engagées dans une action crédible liée au brief/i);
  assert.match(requiredPrompt, /COHÉRENCE INTER-SCÈNES/);

  const inspiration = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      durationSeconds: 16,
      sceneMode: "multi",
      peopleMode: "auto",
      identityConsent: false,
      inspirationImages: [
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "character",
          usage: "inspiration",
          characterIndex: 1,
        },
      ],
    }),
  );
  assert.equal(inspiration.inspirationImages[0]?.role, "character");
  assert.equal(inspiration.inspirationImages[0]?.usage, "inspiration");
  assert.equal(inspiration.identityMode, "auto");
  const inspirationPrompt = buildAiMediaPrompt({
    request: inspiration,
    profile: profileFixture(),
  });
  assert.doesNotMatch(
    inspirationPrompt,
    /RÉFÉRENCE OBLIGATOIRE — FIDÉLITÉ D’IDENTITÉ|COHÉRENCE INTER-SCÈNES|toutes les personnes distinctes détectées sont obligatoires/,
  );
});

test("les critères personnes, décor et priorité arrivent réellement dans le prompt", () => {
  for (const field of [
    "generationMode",
    "peopleCriterion",
    "settingCriterion",
    "focusCriterion",
  ]) {
    assert.match(
      generatorSource,
      new RegExp(`${field}:`),
      `${field} doit être envoyé comme donnée structurée`,
    );
    assert.match(hookSource, new RegExp(`${field}:`));
    assert.match(
      hookSource,
      new RegExp(`request\\.${field}`),
      `${field} doit traverser le hook sans être converti en texte libre`,
    );
  }

  const request = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      generationMode: "ai_criteria",
      peopleCriterion: "three",
      settingCriterion: "interior",
      focusCriterion: "product",
      aiInstruction: "Créer une scène éditoriale précise.",
      peopleMode: "auto",
      inspirationImages: [],
    }),
  );
  assert.equal(request.generationMode, "ai_criteria");
  assert.equal(request.peopleMode, "team");
  const prompt = buildAiMediaPrompt({
    request,
    profile: profileFixture(),
  });
  for (const expected of [
    "montrer exactement 3 personnes",
    "intérieur crédible",
    "priorité visuelle au produit",
  ]) {
    assert.match(prompt.toLocaleLowerCase("fr"), new RegExp(expected));
  }
  assert.doesNotMatch(
    request.aiInstruction,
    /3 personnes|intérieur crédible|priorité visuelle/,
    "les critères ne doivent plus être maquillés en consigne libre",
  );
});

test("Générer Vidéo compose trois contrats de mode réellement distincts", () => {
  const profile = profileFixture();
  const pure = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      generationMode: "ai_free",
      peopleCriterion: "three",
      settingCriterion: "studio",
      focusCriterion: "product",
      peopleMode: "team",
      durationSeconds: 8,
    }),
  );
  assert.equal(pure.generationMode, "ai_free");
  assert.equal(pure.peopleCriterion, "auto");
  assert.equal(pure.settingCriterion, "auto");
  assert.equal(pure.focusCriterion, "auto");
  assert.equal(pure.peopleMode, "auto");
  const purePrompt = buildAiMediaPrompt({ request: pure, profile });
  assert.match(purePrompt, /MODE VIDÉO — 100 % IA SANS CRITÈRES/);
  assert.doesNotMatch(
    purePrompt,
    /exactement 3 personnes|production en studio|priorité visuelle au produit/,
  );

  const criteria = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      generationMode: "ai_criteria",
      peopleCriterion: "two",
      settingCriterion: "exterior",
      focusCriterion: "environment",
      imageStyle: "three_d",
      durationSeconds: 24,
      sceneMode: "multi",
      textMode: "exact",
      exactText: "Fabriqué à Arras",
      withMusic: true,
      withNarration: true,
    }),
  );
  const criteriaPrompt = buildAiMediaPrompt({ request: criteria, profile });
  for (const expected of [
    /MODE VIDÉO — IA AVEC CRITÈRES/,
    /exactement 2 personnes/,
    /action en extérieur/,
    /priorité visuelle au lieu, au décor/,
    /DURÉE EXACTE : 24 secondes/,
    /MULTISCÈNE : structurer 3 séquences/,
    /film d’animation 3D premium/,
    /Fabriqué à Arras/,
    /MUSIQUE :/,
    /NARRATION :/,
  ]) {
    assert.match(criteriaPrompt, expected);
  }

  const inspiration = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      generationMode: "inspiration",
      peopleCriterion: "three",
      settingCriterion: "studio",
      focusCriterion: "people",
      identityConsent: true,
      durationSeconds: 16,
      sceneMode: "single",
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
  assert.equal(inspiration.peopleCriterion, "auto");
  assert.equal(inspiration.settingCriterion, "auto");
  assert.equal(inspiration.focusCriterion, "auto");
  const inspirationPrompt = buildAiMediaPrompt({ request: inspiration, profile });
  for (const expected of [
    /MODE VIDÉO — INSPIRATIONS/,
    /rôle=character, usage=required/,
    /rôle=product, usage=required/,
    /rôle=environment, usage=required/,
    /rôle=inspiration, usage=inspiration/,
    /PERSONNAGES : analyser toutes les personnes distinctes visibles/,
    /Une photo peut contenir UNE OU PLUSIEURS personnes/,
    /toutes les faire apparaître reconnaissables et en action/,
    /PRODUIT : conserver forme, proportions, matières, couleurs/,
    /DÉCOR : conserver le lieu reconnaissable/,
    /INSPIRATION UNIQUEMENT/,
    /ne pas copier leur identité, produit, décor, pose ou cadrage exact/i,
  ]) {
    assert.match(inspirationPrompt, expected);
  }
  assert.doesNotMatch(
    inspirationPrompt,
    /exactement 3 personnes|production en studio|priorité visuelle aux personnes/,
  );

  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest(
        baseRequest({
          kind: "video",
          generationMode: "ai_free",
          inspirationImages: [
            {
              mimeType: "image/jpeg",
              data: REFERENCE_DATA,
              role: "inspiration",
              usage: "inspiration",
            },
          ],
        }),
      ),
    AiMediaRequestValidationError,
  );
});

test("Générer Image et Générer Vidéo gardent des contrats moteur distincts", () => {
  assert.match(
    generatorSource,
    /durationSeconds:\s*kind === "video"\s*\?\s*durationSeconds\s*:\s*undefined/,
  );
  assert.match(
    generatorSource,
    /sceneMode:\s*kind === "video"\s*\?\s*videoSceneMode\s*:\s*undefined/,
  );

  const image = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "image",
      idea: "Présenter une nouvelle gamme de mobilier sur mesure",
      aiInstruction: "Mettre le produit au centre dans un atelier lumineux.",
      format: "landscape",
      textMode: "exact",
      exactText: "Portes ouvertes · 14 octobre",
      durationSeconds: 24,
      sceneMode: "multi",
      connectScenes: true,
      withMusic: true,
      withNarration: true,
      videoEngine: "veo",
      inspirationImages: [
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
  const imageSpec = getAiMediaPromptOutputSpec(image);
  assert.equal(image.kind, "image");
  assert.equal(image.durationSeconds, null);
  assert.equal(image.videoEngine, null);
  assert.equal(image.withMusic, false);
  assert.equal(image.withNarration, false);
  assert.equal(imageSpec.durationSeconds, null);
  assert.equal(imageSpec.sceneMode, null);
  assert.equal(imageSpec.videoEngine, null);
  assert.equal(imageSpec.videoCharacterMode, null);
  const imagePrompt = buildAiMediaPrompt({
    request: image,
    profile: profileFixture(),
  });
  assert.match(imagePrompt, /16:9/);
  assert.match(imagePrompt, /RÉFÉRENCE OBLIGATOIRE — PRODUIT/);
  assert.match(imagePrompt, /INSPIRATION UNIQUEMENT/);
  assert.match(imagePrompt, /Portes ouvertes · 14 octobre/);
  assert.doesNotMatch(imagePrompt, /plans vidéo originaux|COHÉRENCE INTER-SCÈNES/);

  const video = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      idea: "Montrer les étapes de fabrication d’une bibliothèque",
      aiInstruction: "Raconter le geste artisanal du débit jusqu’à la finition.",
      format: "story",
      textMode: "ai",
      exactText: "Ce texte doit être ignoré",
      textKeywords: ["bois local", "sur mesure"],
      durationSeconds: 24,
      sceneMode: "multi",
      connectScenes: false,
      withMusic: true,
      withNarration: true,
      narrationVoice: "female",
      videoEngine: "omni",
      inspirationImages: [
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "environment",
          usage: "required",
        },
        {
          mimeType: "image/jpeg",
          data: REFERENCE_DATA,
          role: "product",
          usage: "inspiration",
        },
      ],
    }),
  );
  const videoSpec = getAiMediaPromptOutputSpec(video);
  assert.equal(video.kind, "video");
  assert.equal(video.durationSeconds, 24);
  assert.equal(video.sceneMode, "multi");
  assert.equal(video.connectScenes, false);
  assert.equal(video.withMusic, true);
  assert.equal(video.withNarration, true);
  assert.equal(videoSpec.durationSeconds, 24);
  assert.equal(videoSpec.sceneMode, "multi");
  assert.equal(videoSpec.videoEngine, "omni");
  const videoPrompt = buildAiMediaPrompt({
    request: video,
    profile: profileFixture(),
    copy: { headline: "Du bois brut au meuble unique" },
  });
  assert.match(videoPrompt, /9:16/);
  assert.match(videoPrompt, /plans vidéo originaux/);
  assert.match(videoPrompt, /RÉFÉRENCE OBLIGATOIRE — DÉCOR/);
  assert.match(videoPrompt, /INSPIRATION UNIQUEMENT/);
  assert.match(videoPrompt, /Du bois brut au meuble unique/);
  assert.doesNotMatch(videoPrompt, /EXIGENCE DE QUALITÉ DIFFÉRENCIANTE/);

  const continuousVideo = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      durationSeconds: 16,
      sceneMode: "single",
      connectScenes: true,
    }),
  );
  assert.equal(continuousVideo.sceneMode, "single");
  assert.equal(continuousVideo.connectScenes, true);
});

test("Flyer comparatif reste un contrat graphique structuré jusqu’au moteur", () => {
  const brief =
    "Créer un flyer comparatif : pack Standard à 58 € / mois et pack Premium à 108 € / mois, avec les deux prix clairement affichés.";
  const request = normalizeAiMediaGenerationRequest(
    baseRequest({
      subjectSource: "profile",
      idea: "",
      aiInstruction: brief,
      imagePurpose: "flyer",
      visualDirection: "bold",
      visualStyle: "colorful",
      typology: "offer",
      imageStyle: "graphic",
      format: "landscape",
      textMode: "ai",
      withText: true,
    }),
  );
  assert.equal(request.imagePurpose, "flyer");
  assert.equal(request.visualDirection, "bold");
  assert.equal(request.visualStyle, "colorful");
  assert.equal(request.typology, "offer");
  assert.equal(request.imageStyle, "graphic");
  assert.equal(request.format, "landscape");

  const plan = buildAiMediaCreativePlan({
    request,
    profile: profileFixture(),
  });
  const visibleDeck = [
    plan.headline,
    plan.subline,
    plan.cta,
    ...plan.scenes.flatMap((scene) => [
      scene.eyebrow,
      scene.title,
      scene.body,
    ]),
  ].join(" ");
  for (const required of ["Standard", "Premium", "58 €", "108 €", "mois"]) {
    assert.match(visibleDeck, new RegExp(required));
  }

  const prompt = buildAiMediaPrompt({
    request,
    profile: profileFixture(),
    copy: { headline: plan.headline },
    deferVisibleElementsToComposer: true,
  });
  for (const expected of [
    /TYPE DE CRÉATION STRUCTURÉ — FLYER COMMERCIAL/,
    /simple photo stock plein cadre/,
    /deux cartes ou deux colonnes d’offres/,
    /noms, prix, bénéfices et CTA/,
    /RENDU AFFICHE GRAPHIQUE AUTORITAIRE/,
    /fond graphique complet avec ses panneaux/,
    /16:9/,
    /DIRECTION VISUELLE STRUCTURÉE — BOLD/,
  ]) {
    assert.match(prompt, expected);
  }
});

test("chaque type Image et direction visuelle possède un contrat prompt explicite", () => {
  const purposes = [
    "auto",
    "simple",
    "social",
    "flyer",
    "product_sheet",
    "poster",
    "banner",
    "infographic",
  ] as const;
  for (const imagePurpose of purposes) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({ imagePurpose, textMode: "none", withText: false }),
    );
    const prompt = buildAiMediaPrompt({ request, profile: profileFixture() });
    assert.match(prompt, /TYPE DE CRÉATION STRUCTURÉ/);
    assert.ok(
      prompt.includes(`type ${imagePurpose}`),
      `le type ${imagePurpose} doit traverser le prompt guidé`,
    );
  }

  for (const visualDirection of [
    "auto",
    "clean",
    "premium",
    "warm",
    "dynamic",
    "bold",
  ] as const) {
    const request = normalizeAiMediaGenerationRequest(
      baseRequest({ visualDirection }),
    );
    const prompt = buildAiMediaPrompt({ request, profile: profileFixture() });
    assert.match(
      prompt,
      new RegExp(`DIRECTION VISUELLE STRUCTURÉE — ${visualDirection.toUpperCase()}`),
    );
  }
});

test("Vidéo conserve la matrice critères, réalisation, durée, audio, texte et identité", () => {
  const request = normalizeAiMediaGenerationRequest(
    baseRequest({
      kind: "video",
      generationMode: "ai_criteria",
      peopleCriterion: "two",
      settingCriterion: "studio",
      focusCriterion: "product",
      format: "story",
      imageStyle: "three_d",
      visualDirection: "dynamic",
      durationSeconds: 24,
      sceneMode: "multi",
      textMode: "exact",
      exactText: "Collection Atelier Horizon",
      withNarration: true,
      narrationVoice: "male",
      narrationVoiceVariant: "Orus",
      withMusic: true,
      useBrandColors: true,
      logoMode: "visible",
    }),
  );
  const prompt = buildAiMediaPrompt({ request, profile: profileFixture() });
  for (const expected of [
    /IA AVEC CRITÈRES/,
    /exactement 2 personnes/,
    /production en studio/,
    /priorité visuelle au produit/,
    /9:16/,
    /film d’animation 3D premium/,
    /DIRECTION VISUELLE STRUCTURÉE — DYNAMIC/,
    /DURÉE EXACTE : 24 secondes/,
    /MULTISCÈNE : structurer 3 séquences/,
    /Collection Atelier Horizon/,
    /Voix choisie : homme, style de voix Orus/,
    /MUSIQUE :/,
    /LOGO STRUCTURÉ — visible/,
  ]) {
    assert.match(prompt, expected);
  }
});

test("un brief commercial ne peut pas être généré silencieusement sans texte", () => {
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest(
        baseRequest({
          subjectSource: "profile",
          idea: "",
          aiInstruction:
            "Créer un flyer comparatif avec le pack Standard à 58 € et le pack Premium à 108 €.",
          imagePurpose: "flyer",
          textMode: "none",
          withText: false,
        }),
      ),
    /brief demande du texte visible/i,
  );
  assert.doesNotThrow(() =>
    normalizeAiMediaGenerationRequest(
      baseRequest({
        aiInstruction: "Créer un fond de flyer sans texte ni prix.",
        imagePurpose: "flyer",
        textMode: "none",
      }),
    ),
  );
  assert.match(generatorSource, /visibleTextModeConflict/);
  assert.match(generatorSource, /brief demande du texte visible/);
});

test("la composition locale garde tout le deck et ne dessine jamais un accent seul", () => {
  assert.match(generationServerSource, /composedImageBody/);
  assert.match(generationServerSource, /imageScene\.eyebrow \|\| creativePlan\.companyName/);
  assert.match(generationServerSource, /imageScene\.title \|\| creativePlan\.headline/);
  assert.match(generationServerSource, /creativePlan\.cta/);
  assert.doesNotMatch(
    generationServerSource,
    /eyebrow:\s*""[\s\S]{0,120}body:\s*""/,
  );
  assert.match(brandRendererSource, /const hasVisibleCopy/);
  assert.match(brandRendererSource, /if \(!hasVisibleCopy\) return transparent/);
  assert.match(copywriterSource, /recoverCopywriterFailure/);
  assert.match(copywriterSource, /ai_media_visible_copy_unavailable/);
});

test("le prompt public est un routeur mince vers trois contrats propriétaires", () => {
  assert.ok(
    promptRouterSource.length < 2_500,
    "le routeur ne doit plus assembler de prompt central",
  );
  assert.match(promptRouterSource, /buildAiMediaImageGenerationPrompt/);
  assert.match(promptRouterSource, /buildAiMediaVideoGenerationPrompt/);
  assert.match(promptRouterSource, /buildAiMediaModificationPrompt/);
  assert.ok(
    promptRouterSource.indexOf('operation === "modify"') <
      promptRouterSource.indexOf('kind === "video"'),
    "Modifier est routé avant tout choix de générateur",
  );
  assert.doesNotMatch(
    promptRouterSource,
    /SUJET CENTRAL OBLIGATOIRE|DURÉE EXACTE|CANVAS SOURCE AUTORITAIRE/,
  );

  assert.match(imagePromptSource, /CONTRAT GÉNÉRER IMAGE/);
  assert.doesNotMatch(
    imagePromptSource,
    /durationSeconds|sceneMode|CONTRAT AUDIO ET PAROLE|CONTRAT GÉNÉRER VIDÉO/,
  );
  assert.match(videoPromptSource, /CONTRAT GÉNÉRER VIDÉO/);
  assert.match(videoPromptSource, /buildAiMediaVideoTimelineContract/);
  assert.match(videoPromptSource, /buildAiMediaVideoModeContract/);
  assert.match(videoPromptModulesSource, /DURÉE EXACTE/);
  assert.match(videoPromptModulesSource, /MODE VIDÉO — 100 % IA SANS CRITÈRES/);
  assert.match(videoPromptModulesSource, /MODE VIDÉO — IA AVEC CRITÈRES/);
  assert.match(videoPromptModulesSource, /MODE VIDÉO — INSPIRATIONS/);
  assert.doesNotMatch(
    videoPromptSource,
    /getAiMediaImageQualityBar|EXIGENCE DE QUALITÉ DIFFÉRENCIANTE|CONTRAT GÉNÉRER IMAGE/,
  );
  assert.match(modificationPromptSource, /CONTRAT MODIFIER IMAGE/);
  assert.match(modificationPromptSource, /CANVAS SOURCE AUTORITAIRE/);
  assert.doesNotMatch(
    modificationPromptSource,
    /buildAiMediaImageGenerationPrompt|buildAiMediaVideoGenerationPrompt|SUJET CENTRAL OBLIGATOIRE/,
  );
});

test("requestId et historique imposent une vraie variation sans affaiblir le brief", () => {
  const profile = profileFixture();
  const recentPublications = [
    {
      title: "La précision au cœur de chaque projet",
      idea: "Portrait frontal devant l’établi avec le meuble terminé",
    },
    {
      title: "Un savoir-faire pensé pour vous",
      idea: "Vue large statique de l’atelier au lever du jour",
    },
  ];
  const imageSignatures = new Set<string>();
  const videoSignatures = new Set<string>();

  for (let index = 0; index < 12; index += 1) {
    const imageBrief = `Création image originale numéro ${index + 1} montrant un assemblage réel`;
    const imageRequest = normalizeAiMediaGenerationRequest(
      baseRequest({
        requestId: `studio-originality-image-${String(index).padStart(2, "0")}`,
        kind: "image",
        idea: imageBrief,
      }),
    );
    const imagePrompt = buildAiMediaPrompt({
      request: imageRequest,
      profile,
      recentPublications,
    });
    assert.ok(imagePrompt.includes(imageBrief));
    assert.match(imagePrompt, /ANTI-RÉPÉTITION IMAGE/);
    assert.match(imagePrompt, /Ne réutiliser aucune accroche, aucun slogan/);
    const imageSignature = imagePrompt.match(
      /SIGNATURE CRÉATIVE PROPRE À CETTE REQUÊTE : ([^\n]+)/,
    )?.[1];
    assert.ok(imageSignature);
    imageSignatures.add(imageSignature);

    const videoBrief = `Création vidéo originale numéro ${index + 1} montrant une transformation réelle`;
    const videoRequest = normalizeAiMediaGenerationRequest(
      baseRequest({
        requestId: `studio-originality-video-${String(index).padStart(2, "0")}`,
        kind: "video",
        idea: videoBrief,
        durationSeconds: 16,
        sceneMode: "multi",
      }),
    );
    const videoPrompt = buildAiMediaPrompt({
      request: videoRequest,
      profile,
      recentPublications,
    });
    assert.ok(videoPrompt.includes(videoBrief));
    assert.match(videoPrompt, /ANTI-RÉPÉTITION VIDÉO/);
    assert.match(videoPrompt, /aucune succession de plans ni structure récente/);
    const videoSignature = videoPrompt.match(
      /SIGNATURE NARRATIVE PROPRE À CETTE REQUÊTE : ([^\n]+)/,
    )?.[1];
    assert.ok(videoSignature);
    videoSignatures.add(videoSignature);
  }

  assert.ok(imageSignatures.size >= 3, "les images varient réellement d’axe");
  assert.ok(videoSignatures.size >= 3, "les vidéos varient réellement d’axe");
});

test("les modes texte none, ai et exact restent distincts jusque dans le prompt", () => {
  const none = normalizeAiMediaGenerationRequest(
    baseRequest({ textMode: "none", exactText: "Ignoré", withText: true }),
  );
  const ai = normalizeAiMediaGenerationRequest(
    baseRequest({ textMode: "ai", exactText: "Ignoré", withText: false }),
  );
  const exact = normalizeAiMediaGenerationRequest(
    baseRequest({
      textMode: "exact",
      exactText: "Le bois prend forme",
      withText: false,
    }),
  );

  assert.deepEqual(
    [none.textMode, ai.textMode, exact.textMode],
    ["none", "ai", "exact"],
  );
  assert.deepEqual(
    [none.withText, ai.withText, exact.withText],
    [false, true, true],
  );
  assert.deepEqual(
    [none.exactText, ai.exactText, exact.exactText],
    ["", "", "Le bois prend forme"],
  );

  const profile = profileFixture();
  for (const kind of ["image", "video"] as const) {
    const noneRequest = normalizeAiMediaGenerationRequest(
      baseRequest({ kind, textMode: "none", exactText: "Ignoré", withText: true }),
    );
    const aiRequest = normalizeAiMediaGenerationRequest(
      baseRequest({ kind, textMode: "ai", exactText: "Ignoré", withText: false }),
    );
    const exactRequest = normalizeAiMediaGenerationRequest(
      baseRequest({
        kind,
        textMode: "exact",
        exactText: "Le bois prend forme",
        withText: false,
      }),
    );
    const nonePrompt = buildAiMediaPrompt({ request: noneRequest, profile });
    const aiPrompt = buildAiMediaPrompt({
      request: aiRequest,
      profile,
      copy: { headline: "Du bois local au meuble unique" },
      recentPublications: [
        {
          title: "Ancienne accroche à ne pas reprendre",
          idea: "Ancienne composition frontale dans l’atelier",
        },
      ],
    });
    const exactPrompt = buildAiMediaPrompt({
      request: exactRequest,
      profile,
      copy: { headline: "Cette accroche IA ne doit pas gagner" },
    });

    assert.match(nonePrompt, /aucun texte visible ne doit être créé/i);
    for (const forbiddenElement of [
      /slogan/i,
      /enseigne/i,
      /sous-titre/i,
      /interface/i,
      /lettre/i,
    ]) {
      assert.match(nonePrompt, forbiddenElement);
    }
    assert.ok(aiPrompt.includes("Du bois local au meuble unique"));
    assert.match(aiPrompt, /contextualisé/i);
    assert.match(aiPrompt, /différ(?:er|ente).*historique récent/i);
    assert.match(aiPrompt, /Clichés interdits/i);
    assert.ok(aiPrompt.includes("Votre projet entre de bonnes mains"));
    assert.ok(aiPrompt.includes("Ancienne composition frontale dans l’atelier"));
    assert.ok(exactPrompt.includes("Le bois prend forme"));
    assert.match(exactPrompt, /exclusivement/i);
    assert.doesNotMatch(exactPrompt, /Cette accroche IA ne doit pas gagner/);
  }

  assert.throws(
    () => normalizeAiMediaGenerationRequest(baseRequest({ textMode: "other" })),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest(
        baseRequest({ textMode: "exact", exactText: "" }),
      ),
    AiMediaRequestValidationError,
  );
  assert.match(
    generatorSource,
    /type StudioTextMode\s*=\s*"none"\s*\|\s*"ai"\s*\|\s*"exact"/,
  );
  for (const mode of ["none", "ai", "exact"]) {
    assert.ok(
      generatorSource.includes(`["${mode}",`),
      `le mode texte ${mode} doit être proposé dans l’interface`,
    );
  }
});

test("les durées 8/16/24 et les modes single/multi pilotent le raccord réel", () => {
  const eight = normalizeAiMediaGenerationRequest(
    baseRequest({ kind: "video", durationSeconds: 8, sceneMode: "single" }),
  );
  assert.equal(eight.durationSeconds, 8);
  assert.equal(eight.sceneMode, "single");
  assert.equal(eight.connectScenes, false);

  for (const durationSeconds of [16, 24] as const) {
    const single = normalizeAiMediaGenerationRequest(
      baseRequest({ kind: "video", durationSeconds, sceneMode: "single" }),
    );
    const multi = normalizeAiMediaGenerationRequest(
      baseRequest({ kind: "video", durationSeconds, sceneMode: "multi" }),
    );
    assert.equal(single.sceneMode, "single");
    assert.equal(single.connectScenes, true);
    assert.equal(multi.sceneMode, "multi");
    assert.equal(multi.connectScenes, false);
  }

  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest(
        baseRequest({ kind: "video", durationSeconds: 16, sceneMode: "other" }),
      ),
    AiMediaRequestValidationError,
  );
  assert.match(generatorSource, /\(\[8,\s*16,\s*24\]\s+as const\)/);
  assert.match(generatorSource, /\(\["single",\s*"multi"\]\s+as const\)/);
});

test("le client sérialise les nouveaux contrats au lieu de les réduire aux anciens booléens", () => {
  for (const field of [
    "textMode",
    "exactText",
    "sceneMode",
    "visualDirection",
    "imagePurpose",
  ]) {
    assert.match(
      hookSource,
      new RegExp(`${field}:\\s*request\\.${field}`),
      `${field} doit traverser useMediaGeneration`,
    );
  }
  for (const field of [
    "generationMode",
    "peopleCriterion",
    "settingCriterion",
    "focusCriterion",
  ]) {
    assert.match(hookSource, new RegExp(`${field}:`));
    assert.match(generatorSource, new RegExp(`${field}:`));
  }
  assert.match(generatorSource, /mediaSourceMode === "ai"[\s\S]*?"ai_free"/);
  assert.match(generatorSource, /mediaSourceMode === "criteria"[\s\S]*?"ai_criteria"/);
  assert.match(generatorSource, /:\s*"inspiration"/);
  assert.match(generatorSource, /textMode:\s*textMode/);
  assert.match(generatorSource, /exactText:\s*exactText/);
  assert.match(generatorSource, /visualDirection,?/);
  assert.match(
    generatorSource,
    /imagePurpose:\s*kind === "image"\s*\?\s*imagePurpose\s*:\s*"auto"/,
  );
  assert.match(
    generatorSource,
    /sceneMode:\s*kind === "video"\s*\?\s*videoSceneMode\s*:\s*undefined/,
    "sceneMode doit être envoyé par MediaGenerator uniquement pour une vidéo",
  );
  assert.match(hookSource, /inspirationImages:\s*request\.inspirationImages/);
  assert.match(generatorSource, /inspirationImages:\s*mediaSourceMode === "real"/);
});

test("l’empreinte serveur couvre tous les choix structurés et les rôles des références", () => {
  for (const field of [
    "inputMode",
    "generationMode",
    "peopleCriterion",
    "settingCriterion",
    "focusCriterion",
    "textMode",
    "exactText",
    "visualDirection",
    "imagePurpose",
    "sceneMode",
    "connectScenes",
  ]) {
    assert.match(
      generationRouteSource,
      new RegExp(`${field}:\\s*request\\.${field}`),
      `${field} doit participer à l’empreinte idempotente serveur`,
    );
  }
  for (const referenceField of ["role", "usage", "characterIndex"]) {
    assert.match(
      generationRouteSource,
      new RegExp(`${referenceField}:\\s*image\\.${referenceField}`),
      `${referenceField} doit distinguer deux jeux de références`,
    );
  }
});

function collectProductionSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectProductionSources(fullPath));
    else if (/\.(?:ts|tsx|json)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

test("les accroches passe-partout sont interdites dans les secours de production", () => {
  const sources = ["app", "lib", "messages"].flatMap((directory) =>
    collectProductionSources(path.join(ROOT, directory)),
  );
  const offenders = sources.flatMap((filename) => {
    const source = readFileSync(filename, "utf8").toLocaleLowerCase("fr");
    return FORBIDDEN_CLICHES.filter((cliché) =>
      source.includes(cliché.toLocaleLowerCase("fr")),
    ).map((cliché) => `${path.relative(ROOT, filename)} :: ${cliché}`);
  });
  assert.deepEqual(
    offenders,
    [],
    "aucun cliché ne doit rester un secours ou une valeur par défaut",
  );
});

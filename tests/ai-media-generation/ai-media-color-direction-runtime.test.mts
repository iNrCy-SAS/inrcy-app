import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import type { AiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";

// Execute the real prompt, DNA budget, language/profile normalizers and color
// helper. Only local TypeScript dependencies are allowed: no provider or network.
const LIB_ROOT = path.resolve("lib");
const modules = new Map<string, { exports: Record<string, unknown> }>();

function loadLocalRuntime<T>(filename: string): T {
  const resolved = path.resolve(filename);
  assert.ok(resolved.startsWith(`${LIB_ROOT}${path.sep}`), "runtime stays inside lib");
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
    { filename: `${resolved}.runtime.cjs` },
  );
  factory(record.exports, (specifier: string) => {
    const localPath = specifier.startsWith("@/lib/")
      ? path.join(LIB_ROOT, specifier.slice("@/lib/".length))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(resolved), specifier)
        : null;
    if (!localPath) throw new Error(`unexpected_test_dependency:${specifier}`);
    return loadLocalRuntime(localPath.endsWith(".ts") ? localPath : `${localPath}.ts`);
  }, record, resolved, path.dirname(resolved));
  return record.exports as T;
}

const { describeAiMediaBrandColors } = loadLocalRuntime<
  typeof import("../../lib/aiMediaColorDirection.ts")
>(path.join(LIB_ROOT, "aiMediaColorDirection.ts"));
const { buildAiMediaPrompt, AI_MEDIA_COMPILED_PROMPT_MAX_CHARS } = loadLocalRuntime<
  typeof import("../../lib/aiMediaGenerationPrompt.ts")
>(path.join(LIB_ROOT, "aiMediaGenerationPrompt.ts"));
const { buildNormalizedAiGenerationProfile } = loadLocalRuntime<
  typeof import("../../lib/aiGenerationProfile.ts")
>(path.join(LIB_ROOT, "aiGenerationProfile.ts"));
const { normalizeAiMediaGenerationRequest } = loadLocalRuntime<
  typeof import("../../lib/aiMediaGenerationContracts.ts")
>(path.join(LIB_ROOT, "aiMediaGenerationContracts.ts"));

const INCIDENT_COLORS = ["#f9b7f3", "#f870e5", "#b7e5fe"] as const;
const INCIDENT_DESCRIPTIONS = ["pale magenta", "light magenta", "pale sky blue"];
const HEX_CODE = /#[\da-f]{3,8}\b/i;
const SUBJECT = "Le robot jardinier plante un rosier dans notre atelier";
const INSTRUCTION = "Animer les bras du robot dès le premier instant et conserver le rosier rouge.";
const HEADLINE = "Un jardin prend vie";
const REFERENCE = { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=", mimeType: "image/png" } as const;
const ANTI_SWATCH_RULE = "Aucun nuancier, échantillon de couleur, code hexadécimal, légende technique ou planche de style ajouté au résultat.";

function profileFixture(): NormalizedAiGenerationProfile {
  return buildNormalizedAiGenerationProfile({
    business: {
      company_name: "Atelier Horizon",
      profession: "Jardinier",
      description: "Un atelier de jardinage pour les professionnels locaux.",
      services: ["Plantation de rosiers"],
      city: "Arras",
    },
    preferences: { language: "fr" },
  });
}

function requestFixture(overrides: Partial<AiMediaGenerationRequest> = {}): AiMediaGenerationRequest {
  return normalizeAiMediaGenerationRequest({
    requestId: "color-direction-runtime",
    source: "studio",
    kind: "image",
    subjectSource: "custom",
    idea: SUBJECT,
    aiInstruction: INSTRUCTION,
    withText: true,
    textKeywords: ["jardin"],
    format: "square",
    typology: "service",
    visualStyle: "brand",
    imageStyle: "illustration",
    shotType: "medium",
    peopleMode: "solo",
    creativity: "faithful",
    useBrandColors: true,
    logoMode: "discreet",
    identityMode: "brand_avatar",
    identityConsent: true,
    inspirationImages: [REFERENCE],
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "characters",
    durationSeconds: 16,
    ...overrides,
  });
}

test("les trois couleurs de l’incident deviennent des directions anglaises sans code hexadécimal", () => {
  const colors = Object.freeze([...INCIDENT_COLORS]);
  const result = describeAiMediaBrandColors(colors);
  assert.deepEqual(result, INCIDENT_DESCRIPTIONS);
  assert.deepEqual(colors, INCIDENT_COLORS);
  assert.doesNotMatch(result.join(", "), HEX_CODE);
  for (const description of result) assert.match(description, /^[a-z]+(?: [a-z]+)*$/);
});

test("hex courts, longs, majuscules et espaces sont normalisés sans accepter les valeurs invalides", () => {
  assert.deepEqual(describeAiMediaBrandColors([" #F00 ", "#00FF00", "#00f"]), [
    "vivid red", "vivid green", "vivid blue",
  ]);
  assert.deepEqual(describeAiMediaBrandColors([
    "red", "f870e5", "#12", "#1234", "#12345", "#1234567", "#12345678",
    "#ggg", "rgb(255, 0, 0)", "var(--brand)", "#fff; background:red", "", "   ",
  ]), []);
  assert.deepEqual(describeAiMediaBrandColors(["invalid", "#ff0000", "#12", "#0000ff"]), [
    "vivid red", "vivid blue",
  ]);
});

test("les directions identiques sont dédupliquées dans l’ordre de première apparition", () => {
  assert.deepEqual(describeAiMediaBrandColors([
    "#00f", "#0000FF", "#00e", "#f00", "#ff0000", "#0f0", "#00ff00",
  ]), ["vivid blue", "vivid red", "vivid green"]);
});

test("la limite vaut trois par défaut et quatre lorsqu’elle est explicitement demandée", () => {
  const input = ["#f00", "#0f0", "#00f", "#fff", "#000"];
  assert.deepEqual(describeAiMediaBrandColors(input), ["vivid red", "vivid green", "vivid blue"]);
  assert.deepEqual(describeAiMediaBrandColors(input, 4), ["vivid red", "vivid green", "vivid blue", "white"]);
  assert.deepEqual(describeAiMediaBrandColors(input, 1.9), ["vivid red"]);
  for (const limit of [0, -1, 0.9]) assert.deepEqual(describeAiMediaBrandColors(input, limit), []);
  for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(describeAiMediaBrandColors(input, limit), describeAiMediaBrandColors(input));
  }
  assert.deepEqual(describeAiMediaBrandColors([]), []);
});

test("les neutres gardent des descriptions précises sans teinte chromatique inventée", () => {
  assert.deepEqual(describeAiMediaBrandColors(["#fff", "#000", "#ccc", "#444", "#888"], 5), [
    "white", "black", "light gray", "charcoal", "gray",
  ]);
});

for (const kind of ["image", "video"] as const) {
  for (const useBrandColors of [true, false]) {
    test(`${kind}: les accents de marque ${useBrandColors ? "activés" : "désactivés"} ne diluent pas sujet, identité, texte ou logo`, () => {
      const prompt = buildAiMediaPrompt({
        request: requestFixture({ kind, useBrandColors }),
        profile: profileFixture(),
        brandColors: INCIDENT_COLORS,
        hasLogo: true,
        copy: { headline: HEADLINE },
      });
      assert.ok(prompt.includes(SUBJECT));
      assert.ok(prompt.includes(INSTRUCTION));
      assert.match(prompt, /AVATAR DE MARQUE GUIDÉ/);
      assert.match(prompt, /LANGUE DU TEXTE VISIBLE — RÈGLE ABSOLUE/);
      assert.ok(prompt.includes(ANTI_SWATCH_RULE));
      assert.doesNotMatch(prompt, HEX_CODE);
      if (useBrandColors) {
        assert.ok(prompt.includes(`accents dans la lumière, les matières et le décor : ${INCIDENT_DESCRIPTIONS.join(", ")}.`));
        assert.match(prompt, /Ne pas en faire un sujet ni une planche de présentation/);
      } else {
        assert.match(prompt, /Palette créative libre et cohérente avec le secteur/);
        assert.match(prompt, /couleurs du logo.*limitées au logo lui-même/);
        for (const description of INCIDENT_DESCRIPTIONS) assert.ok(!prompt.includes(description));
      }
      if (kind === "image") {
        assert.ok(prompt.includes(`à afficher exactement : « ${HEADLINE} »`));
        assert.match(prompt, /La dernière image de référence est le logo officiel/);
        assert.match(prompt, /Respecter fidèlement sa forme, ses proportions, ses couleurs et son orthographe/);
      } else {
        assert.match(prompt, /plans vidéo originaux avec 1 référence d’identité autorisée/);
        assert.match(prompt, /Ne produire aucun logo ni pseudo-logo : l’habillage vidéo exact sera appliqué ensuite par iNrCy/);
      }
    });
  }
}

test("le prompt compilé ne retient que quatre accents et ignore une palette entièrement invalide", () => {
  const prompt = buildAiMediaPrompt({
    request: requestFixture(), profile: profileFixture(),
    brandColors: [...INCIDENT_COLORS, "#fff", "#000"],
  });
  assert.ok(prompt.includes(`${INCIDENT_DESCRIPTIONS.join(", ")}, white.`));
  assert.doesNotMatch(prompt, /\bblack\b|#[\da-f]{3,8}\b/i);
  for (const brandColors of [[], ["invalid", "#12345", "#xyz"]]) {
    const fallback = buildAiMediaPrompt({ request: requestFixture(), profile: profileFixture(), brandColors });
    assert.match(fallback, /Palette créative libre, harmonieuse, professionnelle/);
    assert.doesNotMatch(fallback, /Couleurs de marque à utiliser/);
    assert.ok(fallback.includes(ANTI_SWATCH_RULE));
  }
});

test("sans texte ou avec composition différée, les règles d’absence de texte et de logo restent explicites", () => {
  for (const kind of ["image", "video"] as const) {
    const withoutText = buildAiMediaPrompt({
      request: requestFixture({ kind, withText: false, logoMode: "none" }),
      profile: profileFixture(), brandColors: INCIDENT_COLORS, hasLogo: false,
    });
    assert.match(withoutText, /Aucun texte visible ne doit être créé/);
    assert.doesNotMatch(withoutText, /Accroche originale sélectionnée/);
    assert.match(withoutText, /aucun logo, monogramme, emblème ou pseudo-logo|Ne produire aucun logo ni pseudo-logo/);
    assert.ok(withoutText.includes(ANTI_SWATCH_RULE));

    const deferred = buildAiMediaPrompt({
      request: requestFixture({ kind }), profile: profileFixture(),
      brandColors: INCIDENT_COLORS, hasLogo: true, deferVisibleElementsToComposer: true,
      copy: { headline: HEADLINE },
    });
    assert.match(deferred, /produire exclusivement le fond sans texte, chiffre, téléphone, coordonnées ni logo/);
    assert.doesNotMatch(deferred, /Accroche originale sélectionnée/);
    assert.ok(deferred.includes(ANTI_SWATCH_RULE));
    assert.doesNotMatch(deferred, HEX_CODE);
  }
});

test("un ADN et un brief longs ne peuvent supprimer la garde anti-nuancier du prompt plafonné à 11 800 caractères", () => {
  const profile = profileFixture();
  const longText = "Le jardin professionnel respecte les végétaux et les saisons dans chaque création. ".repeat(80);
  const longList = Array.from({ length: 15 }, (_, index) => `Repère ${index + 1} : ${longText}`);
  profile.preferences.premiumEnabled = true;
  profile.preferences.customInstructions = longText;
  profile.preferences.likedExample = longText;
  profile.preferences.likedExample2 = longText;
  profile.business.description = longText;
  profile.business.services = longList;
  profile.business.strengths = longList;
  profile.business.customerTypologies = longList;
  profile.business.interventionZones = longList;
  profile.business.openingHours = longText;
  for (const key of [
    "detailedDescription", "mission", "offersAndArguments", "keyArguments", "proofsAndObjections",
    "objectionResponses", "editorialStrategy", "campaignCalendar",
  ] as const) profile.memory[key] = longText;
  for (const key of [
    "specialties", "targetAudiences", "customerNeeds", "differentiators", "values", "brandPersonality",
    "commitments", "preferredVocabulary", "forbiddenVocabulary", "recentNewsItems",
  ] as const) profile.memory[key] = longList;

  assert.equal(AI_MEDIA_COMPILED_PROMPT_MAX_CHARS, 11_800);
  for (const kind of ["image", "video"] as const) {
    const prompt = buildAiMediaPrompt({
      request: requestFixture({
        kind, identityMode: "reference_team", inspirationImages: [REFERENCE, REFERENCE, REFERENCE],
        idea: `${SUBJECT}. ${longText}`.slice(0, 2_000),
        aiInstruction: `${INSTRUCTION} ${longText}`.slice(0, 600),
        textKeywords: ["jardin", "rosier", "atelier"],
      }),
      profile, brandColors: INCIDENT_COLORS, hasLogo: true,
      copy: { headline: HEADLINE },
      deferVisibleElementsToComposer: true,
      recentPublications: Array.from({ length: 5 }, (_, index) => ({ title: `${index} ${longText}` })),
    });
    assert.ok(prompt.length <= 11_800, `${kind}: le budget doit être respecté`);
    if (kind === "image") {
      assert.equal(prompt.length, 11_800, "le cas image doit réellement déclencher la compaction");
      assert.match(prompt, /contexte ADN compacté automatiquement/);
    }
    assert.ok(prompt.includes(SUBJECT));
    assert.ok(prompt.includes(INSTRUCTION));
    assert.ok(prompt.includes(ANTI_SWATCH_RULE), `${kind}: la garde finale doit rester complète`);
    assert.match(prompt, /Ne pas recopier les annotations techniques autour du sujet des références/);
    assert.match(prompt, /COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION — RÈGLE FINALE PRIORITAIRE/);
    assert.doesNotMatch(prompt, HEX_CODE);
  }
});

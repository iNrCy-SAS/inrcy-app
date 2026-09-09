import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import * as dialogue from "../../lib/aiMediaDialogue.ts";
import * as colorDirection from "../../lib/aiMediaColorDirection.ts";
import * as reliability from "../../lib/aiVideoReliability.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";

function loadPromptRuntime() {
  const filename = path.join(process.cwd(), "lib/aiVideoProviderGoogleVeo.ts");
  const nativeRequire = createRequire(import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const stubs = new Map<string, unknown>([
    ["server-only", {}],
    ["@google/genai", { GoogleGenAI: class { constructor() { throw new Error("unexpected_network_client"); } } }],
    ["@/lib/aiGatewayAccountGuard", {}],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentDurations }],
    ["@/lib/aiVideoReliability", reliability],
    ["@/lib/aiVideoProviderTypes", providerTypes],
    ["@/lib/aiMediaDialogue", dialogue],
    ["@/lib/aiMediaColorDirection", colorDirection],
    ["./aiMediaVideoContinuity.ts", {}],
    ["@/lib/aiMediaSensitiveText", {}],
  ]);
  const commonJsModule = { exports: {} as Record<string, unknown> };
  const factory = vm.runInThisContext(
    `(function(exports,require,module,__filename,__dirname){${output}\n})`,
    { filename: "ai-video-prompt-budget.runtime.cjs" },
  );
  factory(commonJsModule.exports, (specifier: string) => {
    if (stubs.has(specifier)) return stubs.get(specifier);
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    throw new Error(`unexpected_test_dependency:${specifier}`);
  }, commonJsModule, filename, path.dirname(filename));
  return commonJsModule.exports as {
    buildGoogleVideoScenePrompt: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoScenePrompt;
    buildGoogleVideoFramingDirection: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoFramingDirection;
    buildGoogleVideoContinuityContract: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoContinuityContract;
    buildGoogleVideoParameterContract: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoParameterContract;
  };
}

const runtime = loadPromptRuntime();
const languages = ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"] as const;
const identities = ["auto", "professional", "brand_avatar", "reference_team"] as const;
const formats = ["square", "portrait", "story", "landscape"] as const;
const speechModes = ["characters", "voiceover"] as const;

function longBrief(language: string, identity: typeof identities[number], format: typeof formats[number], speech: typeof speechModes[number]) {
  return {
    accountId: "prompt-budget-test",
    request: {
      requestId: "prompt-budget-request", kind: "video", subjectSource: "custom", source: "studio",
      idea: "Réalisons une belle composition florale avec des roses rouges et des orchidées blanches dans notre grand atelier. ".repeat(8),
      aiInstruction: "Gardez toutes les fleurs et les mêmes personnes dans cet atelier, sans couper ni changer le décor. ".repeat(8),
      withText: false, textKeywords: [], withMusic: false, withNarration: false, narrationVoice: null,
      format, typology: "behind_scenes", visualStyle: "colorful", imageStyle: "illustration",
      shotType: "close", peopleMode: "team", creativity: "faithful", useBrandColors: true,
      logoMode: "discreet", videoEngine: "omni", identityMode: identity, videoCharacterMode: identity,
      identityConsent: identity !== "auto", teamVideoMode: "cinematic", teamVideoSpeechMode: speech,
      durationSeconds: 24, inspirationImages: [{ data: "AA==", mimeType: "image/jpeg" }],
    },
    plan: {
      companyName: "Notre Atelier", headline: "Le travail des fleurs", cta: "Venez nous découvrir",
      scenes: [0, 1, 2].map((index) => ({
        title: "Le détail du bouquet", body: "Les fleurs s’assemblent dans un bouquet précis.",
        visualBrief: "Le personnage place une rose blanche avec précision et ajuste les orchidées environnantes dans le vase transparent. ".repeat(5),
        spokenLine: dialogue.getAiMediaDialogueFallbackPair(language, index)[0],
      })),
    },
    brandColors: ["#123456", "#abcdef", "#345678", "#fedcba", "#543210"],
    profession: "Une boutique artisanale experte dans les bouquets floraux et les décorations pour les professionnels et particuliers",
    creativeBrief: "Notre atelier floral accompagne les projets avec créativité.",
    contentLanguage: language, identityTeamMemberCount: 3,
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

for (const language of languages) {
  test(`${language}: 64 combinaisons longues restent sous 1 400 caractères sans perdre les sections obligatoires`, () => {
    let combinations = 0;
    for (const identity of identities) for (const format of formats) for (const speech of speechModes) {
      const args = longBrief(language, identity, format, speech);
      for (const stateful of [false, true]) {
        const label = `${language}/${identity}/${format}/${speech}/${stateful ? "stateful" : "frame"}`;
        const prompt = runtime.buildGoogleVideoScenePrompt(args, 1, 8, stateful
          ? { continuation: true }
          : { continuationFrame: true, firstFrameTag: true });
        combinations += 1;
        assert.ok(prompt.length <= 1_400, `${label}: ${prompt.length} caractères`);
        for (const section of ["SUBJECT:", "USER:", "REFERENCE:", "ACT:", "NO VISUAL TEXT:", "PARAMS:", "PEOPLE:", "CONTINUITY:"]) {
          assert.ok(prompt.includes(section), `${label}: ${section} conservée`);
        }
        assert.match(prompt, /shot=close/);
        assert.match(prompt, /FRAME close\/full heads/);
        assert.doesNotMatch(prompt, /medium-wide/);
        assert.doesNotMatch(prompt, /#[0-9a-f]{6}/i, `${label}: aucun code technique transmis`);
        assert.match(prompt, /swatches\/color charts\/hex codes\/technical annotations, even from refs/);
        assert.match(prompt, /Never draw PARAMS/);
        assert.match(prompt, /no text\/pseudo-text\/numbers\/UI/);
        const colorNames = colorDirection.describeAiMediaBrandColors(args.brandColors);
        for (const name of colorNames) assert.ok(prompt.includes(name), `${label}: couleur ${name} conservée`);
        if (speech === "characters") {
          const expectedLine = dialogue.resolveAiMediaDialogueSequence({
            scenes: args.plan.scenes, headline: args.plan.headline, language,
          })[1]!;
          assert.ok(prompt.includes(expectedLine), `${label}: dialogue exact, sans troncature`);
          assert.match(prompt, /No repeat\/old line/);
        } else {
          assert.match(prompt, /VOICE-OVER:/);
          assert.match(prompt, /no native speech/);
        }
        assert.match(prompt, stateful ? /<PREVIOUS_VIDEO>/ : /<FIRST_FRAME>@Image1/);
      }
    }
    assert.equal(combinations, 64);
  });
}

test("le cadrage visuel et le contrat de continuité respectent le plan choisi", () => {
  for (const [shotType, expected] of [
    ["auto", "medium-wide"], ["close", "close"], ["medium", "medium"], ["wide", "wide"],
  ] as const) {
    const args = longBrief("fr", "professional", "square", "voiceover");
    args.request.shotType = shotType;
    const direction = runtime.buildGoogleVideoFramingDirection(args.request);
    const continuity = runtime.buildGoogleVideoContinuityContract(args);
    assert.ok(direction.includes(`Stable ${expected} shot`));
    assert.ok(continuity.includes(`FRAME ${expected}/`));
    if (shotType !== "auto") assert.doesNotMatch(direction, /Stable medium-wide/);
  }
});

test("les trois noms de couleurs longs restent intégraux avec les paramètres les plus longs", () => {
  const args = longBrief("de", "reference_team", "landscape", "characters");
  args.brandColors = ["#80ff00", "#77aaaa", "#00aaff"];
  args.request.visualStyle = "local";
  args.request.shotType = "medium";
  const names = colorDirection.describeAiMediaBrandColors(args.brandColors);
  assert.equal(names.length, 3);
  assert.ok(names.some((name) => name.includes("lime green")));
  assert.ok(names.some((name) => name.includes("sky blue")));
  for (const imageStyle of ["illustration", "graphic"] as const) {
    args.request.imageStyle = imageStyle;
    const parameters = runtime.buildGoogleVideoParameterContract(args.request, 8, args.brandColors.join(", "));
    assert.ok(parameters.length <= 220);
    assert.ok(parameters.endsWith(`light/material-accents=${names.join("/")}`));
    const prompt = runtime.buildGoogleVideoScenePrompt(args, 1, 8, { continuationFrame: true, firstFrameTag: true });
    assert.ok(prompt.length <= 1_400);
    for (const name of names) assert.ok(prompt.includes(name));
    assert.match(prompt, /no text\/pseudo-text\/numbers\/UI/);
    assert.doesNotMatch(prompt, /#[0-9a-f]{3,8}\b/i);
  }
});

test("la palette réelle guide les matières et la lumière sans fournir de codes à imprimer", () => {
  const args = longBrief("fr", "brand_avatar", "square", "characters");
  args.brandColors = ["#f9b7f3", "#f870e5", "#b7e5fe"];
  const expectedColors = colorDirection.describeAiMediaBrandColors(args.brandColors);
  for (const index of [0, 1, 2]) {
    const prompt = runtime.buildGoogleVideoScenePrompt(args, index, 8, index > 0
      ? { continuationFrame: true, firstFrameTag: true }
      : {});
    assert.ok(prompt.includes(`light/material-accents=${expectedColors.join("/")}`));
    assert.doesNotMatch(prompt, /#[0-9a-f]{3,8}\b/i);
    assert.match(prompt, /swatches\/color charts\/hex codes\/technical annotations, even from refs/);
    assert.match(prompt, /Never draw PARAMS/);
    assert.match(prompt, /same design\/features|preserve its visible cast\/design/);
    assert.ok(prompt.length <= 1_400);
  }
  args.request.useBrandColors = false;
  const withoutBrandColors = runtime.buildGoogleVideoParameterContract(args.request, 8, args.brandColors.join(", "));
  assert.match(withoutBrandColors, /light\/material-accents=subject-led/);
  assert.doesNotMatch(withoutBrandColors, /#[0-9a-f]{3,8}\b/i);
});

test("une profession longue ne remplace pas la fin d’un sujet explicitement demandé", () => {
  const args = longBrief("fr", "reference_team", "square", "characters");
  const idea = "Trois collègues construisent une stratégie digitale, puis se saluent";
  args.request.idea = idea;
  for (const profession of ["Fleuriste", "Agence de communication et accompagnement professionnel de proximité. ".repeat(10)]) {
    args.profession = profession;
    for (const options of [{}, { continuation: true }, { continuationFrame: true, firstFrameTag: true }]) {
      const prompt = runtime.buildGoogleVideoScenePrompt(args, 1, 8, options);
      assert.ok(prompt.includes(`SUBJECT: ${idea}. Keep entities/actions/relations`));
      assert.ok(prompt.length <= 1_400);
    }
  }
});

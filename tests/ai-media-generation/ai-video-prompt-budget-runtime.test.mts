import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import * as dialogue from "../../lib/aiMediaDialogue.ts";
import * as colorDirection from "../../lib/aiMediaColorDirection.ts";
import * as providerContract from "../../lib/aiMediaVideoProviderContract.ts";
import * as promptShared from "../../lib/aiMediaPromptShared.ts";
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
    ["@/lib/aiMediaVideoProviderContract", providerContract],
    ["@/lib/aiMediaPromptShared", promptShared],
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
    buildGoogleVideoInstructionContract: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoInstructionContract;
    buildGoogleVideoFramingDirection: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoFramingDirection;
    buildGoogleVideoContinuityContract: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoContinuityContract;
    buildGoogleVideoParameterContract: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoParameterContract;
    resolveGoogleVideoAspectRatio: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").resolveGoogleVideoAspectRatio;
    promptForInspirationMode: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").promptForInspirationMode;
    buildGoogleVideoSafetyFallbackPrompt: typeof import("../../lib/aiVideoProviderGoogleVeo.ts").buildGoogleVideoSafetyFallbackPrompt;
  };
}

const runtime = loadPromptRuntime();
const languages = ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"] as const;
const identities = ["auto", "professional", "brand_avatar", "reference_team"] as const;
const formats = ["square", "portrait", "story", "landscape"] as const;
const speechModes = ["characters", "voiceover"] as const;

test("le fournisseur choisit une source adaptée au cadre final", () => {
  assert.equal(runtime.resolveGoogleVideoAspectRatio("square"), "16:9");
  assert.equal(runtime.resolveGoogleVideoAspectRatio("landscape"), "16:9");
  assert.equal(runtime.resolveGoogleVideoAspectRatio("portrait"), "9:16");
  assert.equal(runtime.resolveGoogleVideoAspectRatio("story"), "9:16");
});

function longBrief(language: string, identity: typeof identities[number], format: typeof formats[number], speech: typeof speechModes[number]) {
  return {
    accountId: "prompt-budget-test",
    request: {
      requestId: "prompt-budget-request", kind: "video", subjectSource: "custom", source: "studio",
      idea: "Réalisons une belle composition florale avec des roses rouges et des orchidées blanches dans notre grand atelier. ".repeat(8),
      aiInstruction: "Gardez toutes les fleurs et les mêmes personnes dans cet atelier, sans couper ni changer le décor. ".repeat(8),
      generationMode: "ai_free", peopleCriterion: "auto", settingCriterion: "auto", focusCriterion: "auto",
      withText: false, textKeywords: [], withMusic: false, withNarration: false, narrationVoice: null,
      textMode: "none", exactText: "", visualDirection: "auto", imagePurpose: "auto",
      format, typology: "behind_scenes", visualStyle: "colorful", imageStyle: "illustration",
      shotType: "close", peopleMode: "team", creativity: "faithful", useBrandColors: true,
      logoMode: "discreet", videoEngine: "omni", identityMode: identity, videoCharacterMode: identity,
      identityConsent: identity !== "auto", teamVideoMode: "cinematic", teamVideoSpeechMode: speech,
      durationSeconds: 24, sceneMode: "multi", connectScenes: false,
      inspirationImages: [{ data: "AA==", mimeType: "image/jpeg", role: "inspiration", usage: "inspiration" }],
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
  test(`${language}: 64 combinaisons longues restent sous 3 200 caractères sans perdre les sections obligatoires`, () => {
    let combinations = 0;
    for (const identity of identities) for (const format of formats) for (const speech of speechModes) {
      const args = longBrief(language, identity, format, speech);
      for (const stateful of [false, true]) {
        const label = `${language}/${identity}/${format}/${speech}/${stateful ? "stateful" : "frame"}`;
        const prompt = runtime.buildGoogleVideoScenePrompt(args, 1, 8, stateful
          ? { continuation: true }
          : { continuationFrame: true, firstFrameTag: true });
        combinations += 1;
        assert.ok(prompt.length <= 3_200, `${label}: ${prompt.length} caractères`);
        for (const section of ["SUBJECT:", "USER:", "REFERENCE:", "ACT:", "NO VISUAL TEXT:", "PARAMS:", "ORIGINALITY:", "PEOPLE:", "CONTINUITY:"]) {
          assert.ok(prompt.includes(section), `${label}: ${section} conservée`);
        }
        assert.match(prompt, /look=colorful\/illustration\/close\/team\/faithful/);
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
    assert.ok(parameters.length <= 340);
    assert.ok(parameters.endsWith(`pal=${names.join("/")}`));
    const prompt = runtime.buildGoogleVideoScenePrompt(args, 1, 8, { continuationFrame: true, firstFrameTag: true });
    assert.ok(prompt.length <= 3_200);
    for (const name of names) assert.ok(prompt.includes(name));
    assert.match(prompt, /no text\/pseudo-text\/numbers\/UI/);
    assert.doesNotMatch(prompt, /#[0-9a-f]{3,8}\b/i);
  }
});

test("chaque option Studio vidéo reste structurée dans le contrat fournisseur sans troncature", () => {
  const args = longBrief("fr", "professional", "landscape", "voiceover");
  const request = args.request as unknown as Record<string, unknown>;
  const colors = args.brandColors.join(", ");
  const assertOption = (
    field: string,
    value: unknown,
    expected: string,
    companion: Record<string, unknown> = {},
  ) => {
    const previous = new Map<string, unknown>();
    for (const [key, next] of Object.entries({ [field]: value, ...companion })) {
      previous.set(key, request[key]);
      request[key] = next;
    }
    const contract = runtime.buildGoogleVideoParameterContract(
      args.request,
      8,
      colors,
    );
    assert.ok(contract.length <= 340, `${field}=${String(value)}: contrat trop long`);
    assert.ok(
      contract.includes(expected),
      `${field}=${String(value)}: valeur absente de ${contract}`,
    );
    assert.match(contract, /;pal=(?:subject-led|[a-z][a-z /-]*)$/i, `${field}=${String(value)}: fin du contrat tronquée`);
    for (const [key, oldValue] of previous) request[key] = oldValue;
  };

  for (const value of ["ai_free", "ai_criteria", "inspiration"])
    assertOption("generationMode", value, `mode=${value}`);
  for (const value of ["auto", "none", "one", "two", "three", "group"])
    assertOption("peopleCriterion", value, `crit=${value}/${request.settingCriterion}/${request.focusCriterion}`);
  for (const value of ["auto", "interior", "exterior", "studio", "neutral"])
    assertOption("settingCriterion", value, `crit=${request.peopleCriterion}/${value}/${request.focusCriterion}`);
  for (const value of ["auto", "people", "product", "environment"])
    assertOption("focusCriterion", value, `crit=${request.peopleCriterion}/${request.settingCriterion}/${value}`);
  for (const value of ["square", "portrait", "story", "landscape"])
    assertOption("format", value, `fmt=${value}`);
  for (const value of ["company", "service", "advice", "showcase", "offer", "event", "behind_scenes", "recruitment"])
    assertOption("typology", value, `type=${value}`);
  for (const value of ["auto", "clean", "premium", "warm", "dynamic", "bold"])
    assertOption("visualDirection", value, `dir=${value}`);
  for (const value of ["brand", "clean", "premium", "warm", "dynamic", "expert", "local", "colorful"])
    assertOption("visualStyle", value, `look=${value}/${request.imageStyle}/${request.shotType}/${request.peopleMode}/${request.creativity}`);
  for (const value of ["photo", "illustration", "three_d", "graphic"])
    assertOption("imageStyle", value, `look=${request.visualStyle}/${value}/${request.shotType}/${request.peopleMode}/${request.creativity}`);
  for (const value of ["auto", "close", "medium", "wide"])
    assertOption("shotType", value, `look=${request.visualStyle}/${request.imageStyle}/${value}/${request.peopleMode}/${request.creativity}`);
  for (const value of ["auto", "none", "solo", "team"])
    assertOption("peopleMode", value, `look=${request.visualStyle}/${request.imageStyle}/${request.shotType}/${value}/${request.creativity}`);
  for (const value of ["faithful", "bold"])
    assertOption("creativity", value, `look=${request.visualStyle}/${request.imageStyle}/${request.shotType}/${request.peopleMode}/${value}`);
  for (const [sceneMode, linked] of [["single", true], ["multi", false]] as const)
    assertOption("sceneMode", sceneMode, `story=${sceneMode}/${linked ? "linked" : "unlinked"}`, { connectScenes: linked });
  for (const value of ["none", "ai", "exact"])
    assertOption("textMode", value, `text=${value}`);
  for (const value of ["discreet", "visible", "none"])
    assertOption("logoMode", value, `logo=${value}`);
  for (const value of [8, 16, 24])
    assertOption("durationSeconds", value, `film=${value}s`);

  assertOption("teamVideoSpeechMode", "characters", "audio=characters/music", { withMusic: true });
  assertOption("teamVideoSpeechMode", "voiceover", "audio=voiceover-male-Orus/no-music", {
    withNarration: true,
    narrationVoice: "male",
    narrationVoiceVariant: "Orus",
    withMusic: false,
  });
  assertOption("teamVideoSpeechMode", "voiceover", "audio=silent/no-music", {
    withNarration: false,
    withMusic: false,
  });
  assertOption("useBrandColors", false, "pal=subject-led");
  assertOption("useBrandColors", true, `pal=${colorDirection.describeAiMediaBrandColors(args.brandColors).join("/")}`);
});

test("la palette réelle guide les matières et la lumière sans fournir de codes à imprimer", () => {
  const args = longBrief("fr", "brand_avatar", "square", "characters");
  args.brandColors = ["#f9b7f3", "#f870e5", "#b7e5fe"];
  const expectedColors = colorDirection.describeAiMediaBrandColors(args.brandColors);
  for (const index of [0, 1, 2]) {
    const prompt = runtime.buildGoogleVideoScenePrompt(args, index, 8, index > 0
      ? { continuationFrame: true, firstFrameTag: true }
      : {});
    assert.ok(prompt.includes(`pal=${expectedColors.join("/")}`));
    assert.doesNotMatch(prompt, /#[0-9a-f]{3,8}\b/i);
    assert.match(prompt, /swatches\/color charts\/hex codes\/technical annotations, even from refs/);
    assert.match(prompt, /Never draw PARAMS/);
    assert.match(prompt, /same design\/features|preserve its visible cast\/design/);
    assert.ok(prompt.length <= 3_200);
  }
  args.request.useBrandColors = false;
  const withoutBrandColors = runtime.buildGoogleVideoParameterContract(args.request, 8, args.brandColors.join(", "));
  assert.match(withoutBrandColors, /pal=subject-led/);
  assert.doesNotMatch(withoutBrandColors, /#[0-9a-f]{3,8}\b/i);
});

test("le prompt réellement envoyé à Veo et Omni conserve tout le contrat Studio structuré", () => {
  const args = longBrief("fr", "auto", "story", "voiceover");
  Object.assign(args.request, {
    generationMode: "ai_criteria",
    peopleCriterion: "two",
    settingCriterion: "studio",
    focusCriterion: "product",
    visualDirection: "bold",
    typology: "offer",
    visualStyle: "premium",
    imageStyle: "graphic",
    shotType: "medium",
    peopleMode: "team",
    creativity: "bold",
    sceneMode: "multi",
    connectScenes: true,
    textMode: "exact",
    exactText: "Offre septembre",
    withText: true,
    withNarration: true,
    narrationVoice: "male",
    narrationVoiceVariant: "Orus",
    withMusic: true,
    logoMode: "visible",
    inspirationImages: [],
  });
  const criteriaPrompt = runtime.buildGoogleVideoScenePrompt(args, 0, 8);
  assert.ok(criteriaPrompt.length <= 3_200);
  for (const expected of [
    "film=24s",
    "fmt=story",
    "type=offer",
    "mode=ai_criteria",
    "crit=two/studio/product",
    "dir=bold",
    "look=premium/graphic/medium/team/bold",
    "story=multi/linked",
    "text=exact",
    "audio=voiceover-male-Orus/music",
    "logo=visible",
  ]) {
    assert.ok(criteriaPrompt.includes(expected), `contrat fournisseur manquant: ${expected}`);
  }

  Object.assign(args.request, {
    generationMode: "inspiration",
    identityMode: "auto",
    teamVideoMode: "montage",
    inspirationImages: [
      { data: "AA==", mimeType: "image/jpeg", role: "character", usage: "required", characterIndex: 1 },
      { data: "AA==", mimeType: "image/jpeg", role: "environment", usage: "required" },
      { data: "AA==", mimeType: "image/jpeg", role: "product", usage: "inspiration" },
    ],
  });
  const inspirationPrompt = runtime.buildGoogleVideoScenePrompt(args, 0, 8);
  assert.ok(inspirationPrompt.length <= 3_200);
  assert.match(inspirationPrompt, /mode=inspiration/);
  assert.match(inspirationPrompt, /#1:character\/required\/character-1/);
  assert.match(inspirationPrompt, /#2:environment\/required/);
  assert.match(inspirationPrompt, /#3:product\/inspiration/);

  const omniSource = readFileSync(path.join(process.cwd(), "lib/aiVideoProviderGoogleOmni.ts"), "utf8");
  assert.match(omniSource, /buildGoogleVideoScenePrompt\([\s\S]*?args,[\s\S]*?index,[\s\S]*?durationSeconds/);
});

test("la consigne libre conserve chaque exigence distincte, y compris celles placées au milieu", () => {
  const args = longBrief("fr", "professional", "landscape", "voiceover");
  const requirements = [
    "Commencer par une vue large de l’atelier éclairé par la fenêtre.",
    "Conserver la veste bleu nuit du personnage principal dans chaque plan.",
    "Placer le coffret en bois au centre de l’établi avant le geste principal.",
    "EXIGENCE CENTRALE : la main gauche ouvre le coffret pendant que la main droite tient le ruban rouge.",
    "Ne jamais remplacer le ruban rouge par un accessoire générique.",
    "Montrer ensuite le produit fini sous le même angle de caméra.",
    "Garder le mur en briques et la lampe cuivre identiques entre les scènes.",
    "Terminer sur le coffret fermé, le ruban noué et les deux mains sorties du cadre.",
  ];
  args.request.aiInstruction = requirements.join(" ");

  const prompt = runtime.buildGoogleVideoScenePrompt(args, 1, 8, {
    continuationFrame: true,
    firstFrameTag: true,
  });

  assert.ok(prompt.length <= 3_200, `${prompt.length} caractères`);
  for (const requirement of requirements) {
    assert.ok(
      prompt.includes(requirement),
      `exigence absente du prompt fournisseur: ${requirement}`,
    );
  }
  assert.equal(
    runtime.buildGoogleVideoInstructionContract(`${requirements[0]} ${requirements[0]}`),
    requirements[0],
  );
});

test("une consigne irréductible qui dépasse le fournisseur échoue avant une génération partielle", () => {
  const args = longBrief("fr", "professional", "story", "characters");
  args.request.aiInstruction = Array.from(
    { length: 28 },
    (_, index) =>
      `Exigence ${index + 1} : conserver l’objet numéroté ${index + 1}, sa matière propre et son emplacement exact pendant toute la scène.`,
  ).join(" ");

  assert.throws(
    () => runtime.buildGoogleVideoScenePrompt(args, 1, 8, {
      continuationFrame: true,
      firstFrameTag: true,
    }),
    /ai_video_instruction_contract_too_long/,
  );
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
      assert.ok(prompt.length <= 3_200);
    }
  }
});

test("une longue idée ET une consigne distincte conservent toutes leurs exigences", () => {
  const args = longBrief("fr", "auto", "landscape", "voiceover");
  const subjects = [
    "Une fleuriste prépare un bouquet de roses rouges dans son atelier.",
    "Un client apporte un vase transparent et le pose sur une table ronde.",
    "La fleuriste place trois orchidées blanches entre les roses rouges.",
    "Elle noue un ruban jaune autour du vase, puis le tend au client.",
    "Le client repart avec ce vase et toutes les fleurs, sans sac ni boîte.",
  ];
  const instructions = [
    "La caméra reste à hauteur de la table pendant toute la scène.",
    "La fenêtre située à gauche éclaire les mains et le vase.",
    "Le ruban reste jaune, aucune orchidée ne change de couleur.",
  ];
  args.request.idea = subjects.join(" ");
  args.request.aiInstruction = instructions.join(" ");
  const prompt = runtime.buildGoogleVideoScenePrompt(args, 0, 8);
  for (const sentence of [...subjects, ...instructions]) assert.ok(prompt.includes(sentence), sentence);
  assert.ok(prompt.length <= 3_200);
  for (const variant of [runtime.promptForInspirationMode(prompt, "source"), runtime.buildGoogleVideoSafetyFallbackPrompt(prompt)]) {
    for (const sentence of [...subjects, ...instructions]) assert.ok(variant.includes(sentence), sentence);
    assert.ok(variant.includes("PARAMS:"));
    assert.ok(variant.length <= 3_200);
  }
});

test("source et safety conservent la politique produit/décor et ne perdent aucune référence requise", () => {
  const args = longBrief("fr", "auto", "landscape", "voiceover");
  args.request.idea = "La fleuriste dispose un bouquet dans son atelier.";
  args.request.aiInstruction = "Conserver les couleurs du bouquet.";
  for (const role of ["product", "environment"] as const) {
    for (const usage of ["required", "inspiration"] as const) {
      args.request.inspirationImages = [{ data: "AA==", mimeType: "image/jpeg", role, usage }];
      const prompt = runtime.buildGoogleVideoScenePrompt(args, 0, 8);
      const reference = prompt.match(/REFERENCE:([\s\S]*?)(?=\sACT:)/)![1]!.trim();
      const source = runtime.promptForInspirationMode(prompt, "source");
      assert.ok(source.includes(reference));
      assert.ok(source.includes(`#1:${role}/${usage}`));
      if (usage === "required") {
        assert.throws(() => runtime.buildGoogleVideoSafetyFallbackPrompt(prompt), /ai_video_required_reference_unavailable/);
        assert.throws(() => runtime.promptForInspirationMode(prompt, "none"), /ai_video_required_reference_unavailable/);
      } else {
        assert.ok(runtime.buildGoogleVideoSafetyFallbackPrompt(prompt).includes(reference));
      }
    }
  }
  args.request.inspirationImages = [
    { data: "AA==", mimeType: "image/jpeg", role: "product", usage: "inspiration" },
    { data: "AA==", mimeType: "image/jpeg", role: "environment", usage: "required" },
  ];
  const prompt = runtime.buildGoogleVideoScenePrompt(args, 0, 8);
  assert.throws(() => runtime.promptForInspirationMode(prompt, "source"), /ai_video_required_reference_unavailable/);
});

test("une variante safety hors budget refuse la requête sans tronquer USER ni PARAMS", () => {
  const prompt = `SUBJECT: ${"a".repeat(2_840)}. USER: conserver le vase jusqu’à la fin. REFERENCE: none ACT: fleuriste. PARAMS: film=24s;pal=red. PEOPLE: mature adults 25+ only.`;
  assert.ok(prompt.length <= 3_200);
  const tooTight = prompt.replace("a".repeat(2_840), "a".repeat(3_025));
  assert.ok(tooTight.length <= 3_200);
  assert.throws(() => runtime.buildGoogleVideoSafetyFallbackPrompt(tooTight), /ai_video_veo_safety_prompt_budget_exceeded/);
});

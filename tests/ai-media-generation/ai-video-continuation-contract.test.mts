import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import {
  aiMediaDialogueSignature,
  getAiMediaDialogueFallbackPair,
  isQualityAiMediaDialogueLine,
  selectAiMediaDialogueLine,
} from "../../lib/aiMediaDialogue.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

function loadVeoPromptBuilder() {
  const source = read("lib/aiVideoProviderGoogleVeo.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "aiVideoProviderGoogleVeo.ts",
  }).outputText;
  const commonJsModule = { exports: {} as Record<string, unknown> };
  const nativeRequire = createRequire(import.meta.url);
  const noOp = () => undefined;
  const stubs = new Map<string, unknown>([
    ["server-only", {}],
    [
      "@google/genai",
      {
        GoogleGenAI: class GoogleGenAI {},
        VideoGenerationReferenceType: { ASSET: "ASSET" },
      },
    ],
    [
      "@/lib/aiGatewayAccountGuard",
      {
        commitAiGatewayAccountAttempt: noOp,
        recordAiGatewayAccountFailure: noOp,
        reserveAiGatewayAccountAttempt: noOp,
        rollbackAiGatewayAccountAttempt: noOp,
      },
    ],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentDurations }],
    [
      "@/lib/aiVideoReliability",
      {
        DEFAULT_VEO_MODEL: "veo-test",
        classifyVeoFailure: () => ({
          details: "",
          kind: "unavailable",
          modelFallbackEligible: false,
          retryable: false,
        }),
        nextVeoInspirationMode: noOp,
        resolveVeoModelCandidates: () => ["veo-test"],
        selectVeoInspirationMode: () => "none",
        supportsVeoReferenceImages: () => true,
      },
    ],
    ["@/lib/aiVideoProviderTypes", { assertAiVideoReferenceTeamGoogleEgress: noOp }],
    [
      "@/lib/aiMediaDialogue",
      { aiMediaDialogueSignature, selectAiMediaDialogueLine },
    ],
  ]);
  const localRequire = (specifier: string) => {
    if (stubs.has(specifier)) return stubs.get(specifier);
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    throw new Error(`unexpected_test_dependency:${specifier}`);
  };
  const factory = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${transpiled}\n})`,
    { filename: "aiVideoProviderGoogleVeo.runtime.cjs" },
  ) as (
    exports: Record<string, unknown>,
    require: (specifier: string) => unknown,
    module: { exports: Record<string, unknown> },
    filename: string,
    dirname: string,
  ) => void;
  factory(
    commonJsModule.exports,
    localRequire,
    commonJsModule,
    path.join(ROOT, "lib/aiVideoProviderGoogleVeo.ts"),
    path.join(ROOT, "lib"),
  );
  return commonJsModule.exports.buildGoogleVideoScenePrompt as (
    args: Record<string, unknown>,
    index: number,
    durationSeconds: 8,
    options?: { continuation?: boolean },
  ) => string;
}

test("Omni enchaîne res1 vers res2 puis res3 avec previous_interaction_id", () => {
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  assert.match(omni, /previousInteractionId\?: string/);
  assert.match(
    omni,
    /args\.previousInteractionId[\s\S]*?previous_interaction_id: args\.previousInteractionId/,
  );
  assert.match(omni, /const requestId = compact\(interaction\.id, 220\)/);
  assert.match(omni, /const isContinuation = continuationMode && index > 0/);
  assert.match(omni, /ai_video_omni_continuation_context_missing/);

  const state = omni.indexOf("let previousInteractionId: string | undefined");
  const generation = omni.indexOf("const clip = await generateClip", state);
  const previousIdInput = omni.indexOf("previousInteractionId,", generation);
  const stateHandoff = omni.indexOf(
    "previousInteractionId = clip.requestId",
    previousIdInput,
  );
  const loopEnd = omni.indexOf("const concurrency = continuationMode", stateHandoff);

  assert.ok(state >= 0, "l’état de continuation existe");
  assert.ok(generation > state, "chaque tour génère depuis l’état courant");
  assert.ok(
    previousIdInput > generation,
    "le tour suivant reçoit l’identifiant du tour précédent",
  );
  assert.ok(
    stateHandoff > previousIdInput && stateHandoff < loopEnd,
    "res1 devient le parent de res2, puis res2 celui de res3",
  );
});

test("la chaîne longue est séquentielle, n’envoie les images qu’au premier tour et ne mélange jamais Veo", () => {
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  assert.match(
    omni,
    /const concurrency = continuationMode\s*\? 1\s*: Math\.min\(configuredConcurrency, durations\.length\)/,
  );
  assert.match(
    omni,
    /inspirationImages:\s*!isContinuation &&\s*\(preserveIdentityReferences \|\| index === 0\)\s*\? args\.request\.inspirationImages\s*: \[\]/,
  );
  assert.match(
    omni,
    /if \(\s*!continuationMode &&\s*durationSeconds === 8[\s\S]*?googleVeoVideoProvider\.generate/,
  );
  assert.equal(
    (omni.match(/googleVeoVideoProvider\.generate/g) || []).length,
    1,
    "le seul fallback Veo est gardé derrière !continuationMode",
  );
  assert.match(
    omni,
    /stopped = true;\s*firstError \|\|= effectiveError/,
    "une continuation en échec remonte au fallback local du serveur",
  );
});

test("8 secondes conserve le choix Veo tandis que 16 et 24 secondes utilisent obligatoirement Omni", () => {
  const provider = read("lib/aiVideoProvider.ts");

  assert.deepEqual(getAiMediaVideoSegmentDurations(8), [8]);
  assert.deepEqual(getAiMediaVideoSegmentDurations(16), [8, 8]);
  assert.deepEqual(getAiMediaVideoSegmentDurations(24), [8, 8, 8]);
  assert.match(
    provider,
    /if \(\(args\?\.request\.durationSeconds \|\| 8\) > 8\) \{\s*return googleOmniVideoProvider;\s*\}/,
  );
  assert.match(
    provider,
    /return args\?\.request\.videoEngine === "veo"\s*\? googleVeoVideoProvider\s*: googleOmniVideoProvider/,
  );

  const longFormGuard = provider.indexOf(
    "if ((args?.request.durationSeconds || 8) > 8)",
  );
  const configuredChoice = provider.indexOf(
    "const forced = configuredProvider()",
    longFormGuard,
  );
  assert.ok(
    longFormGuard >= 0 && configuredChoice > longFormGuard,
    "même une configuration Veo ne peut produire des segments longs indépendants",
  );
});

test("la sortie Omni cumulée est découpée en fenêtres logiques 0/8/16", () => {
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");
  const offsets = (duration: 8 | 16 | 24) => {
    let cursor = 0;
    return getAiMediaVideoSegmentDurations(duration).map((clipDuration) => {
      const start = cursor;
      cursor += clipDuration;
      return start;
    });
  };

  assert.deepEqual(offsets(8), [0]);
  assert.deepEqual(offsets(16), [0, 8]);
  assert.deepEqual(offsets(24), [0, 8, 16]);
  assert.match(
    omni,
    /const finalClip = completedClips\[completedClips\.length - 1\]!/,
  );
  assert.match(
    omni,
    /if \(finalDurationSeconds >= totalDurationSeconds - 0\.35\)/,
  );
  assert.match(
    omni,
    /let sourceStartSeconds = 0;[\s\S]*?\.\.\.finalClip,[\s\S]*?durationSeconds: durations\[index\],[\s\S]*?sourceStartSeconds,[\s\S]*?requestId: clip\.requestId/,
  );
  assert.match(omni, /sourceStartSeconds \+= durations\[index\]/);
  assert.match(omni, /omni_cumulative_continuation_output/);
  assert.match(omni, /omni_delta_continuation_output/);
  assert.match(omni, /ai_video_omni_continuation_duration_invalid/);
});

test("le montage applique le même offset aux images et au son de chaque acte", () => {
  const composer = read("lib/aiMediaGeneratedVideo.ts");

  assert.match(composer, /sourceStartSeconds\?: number/);
  assert.match(
    composer,
    /clipSourceStarts: args\.clips\.map\(\s*\(clip\) => clip\.sourceStartSeconds \|\| 0/,
  );
  assert.match(
    composer,
    /trim=start=\$\{sourceStartSeconds\}:duration=\$\{clipSeconds\}/,
  );
  assert.match(
    composer,
    /atrim=start=\$\{sourceStartSeconds\}:duration=\$\{clipSeconds\}/,
  );
  assert.match(
    composer,
    /probe\.durationSeconds <\s*\(args\.clips\[index\]\.sourceStartSeconds \|\| 0\) \+\s*args\.clips\[index\]\.durationSeconds -\s*0\.35/,
  );
});

test("le prompt de prolongation impose une vraie suite sans coupe, reset ni répétition", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");

  assert.match(veo, /\[# Sources <PREVIOUS_VIDEO>@Video1\]/);
  assert.match(veo, /Extend this video immediately/);
  assert.match(
    veo,
    /same people, faces, clothing, voices, workplace, light and motion/,
  );
  assert.match(veo, /no new intro, reset, recap or repeated event/);
  assert.match(veo, /single unbroken continuous shot with no scene cuts/);
  assert.match(veo, /ACT 1 — OPENING/);
  assert.match(veo, /MIDDLE ACT — DEMONSTRATION/);
  assert.match(veo, /FINAL ACT — CONCLUSION/);
  assert.match(veo, /never replay the opening pose, framing or gesture/);
  assert.match(veo, /never repeat, restart, loop or reuse earlier-scene dialogue/);
  assert.match(veo, /after speaking close the mouth and react silently/);
});

test("le prompt reference_team de 24 secondes conserve ses contraintes critiques sous 1 400 caractères", () => {
  const buildGoogleVideoScenePrompt = loadVeoPromptBuilder();
  const dialogues = [0, 1, 2].map((index) =>
    getAiMediaDialogueFallbackPair("fr", index),
  );
  const plan = {
    headline: "Une communication digitale qui transforme les projets",
    subline: "Une équipe experte vous accompagne à chaque étape",
    companyName: "Studio professionnel",
    cta: "Construisons la suite ensemble",
    scenes: dialogues.map(([spokenLine, spokenReply], index) => ({
      eyebrow: `Acte ${index + 1}`,
      title: `Une étape professionnelle distincte ${index + 1}`,
      body: "L’équipe agit ensemble dans un studio de communication digitale.",
      spokenLine,
      spokenReply,
      visualBrief:
        "Les trois collègues se déplacent, travaillent et interagissent naturellement dans le même studio.",
      layout: "editorial",
    })),
  };
  const generationArgs = {
      accountId: "continuation-contract-account",
      request: {
        requestId: "continuation-contract-request",
        kind: "video",
        subjectSource: "profile",
        idea: "Présenter une équipe qui construit une stratégie de communication digitale concrète.",
        aiInstruction:
          "Poursuivre exactement l’action en cours avec les mêmes collègues et montrer une nouvelle étape du travail.",
        withText: false,
        textKeywords: [],
        withMusic: false,
        withNarration: false,
        narrationVoice: null,
        format: "square",
        typology: "service",
        visualStyle: "expert",
        imageStyle: "photo",
        shotType: "medium",
        peopleMode: "team",
        creativity: "faithful",
        useBrandColors: true,
        logoMode: "discreet",
        videoEngine: "omni",
        identityMode: "reference_team",
        videoCharacterMode: "reference_team",
        identityConsent: true,
        teamVideoMode: "cinematic",
        teamVideoSpeechMode: "characters",
        teamVideoVeoConsent: true,
        identityReferenceSetId: "reference-set-contract",
        durationSeconds: 24,
        inspirationImages: [{ mimeType: "image/jpeg", data: "AA==" }],
        source: "studio",
      },
      plan,
      creativeBrief:
        "Agence de communication digitale experte, locale et attentive, avec une méthode structurée et des résultats visuels concrets.",
      brandColors: ["#13b8ff", "#ec3e9d"],
      profession: "Agence de communication digitale",
      contentLanguage: "fr",
      identityTeamPrecomposed: true,
      identityTeamMemberCount: 3,
      identityTeamGoogleEgressConsent: true,
    };
  const prompt = buildGoogleVideoScenePrompt(
    generationArgs,
    1,
    8,
    { continuation: true },
  );

  assert.ok(prompt.length <= 1_400, `prompt trop long: ${prompt.length}`);
  assert.match(prompt, /\[# Sources <PREVIOUS_VIDEO>@Video1\]/);
  assert.match(prompt, /IDENTITY LOCK/);
  assert.match(prompt, /says exactly “[^”]{12,}”/);
  assert.match(prompt, /ONCE ONLY/);
  assert.match(prompt, /never repeat, restart, loop or reuse/);
  assert.match(prompt, /single unbroken continuous shot with no scene cuts/);
  assert.match(prompt, /Every visible person must be unmistakably adult/);

  const actPrompts = [0, 1, 2].map((index) =>
    buildGoogleVideoScenePrompt(
      generationArgs,
      index,
      8,
      index === 0 ? {} : { continuation: true },
    ),
  );
  for (const [index, actPrompt] of actPrompts.entries()) {
    assert.match(
      actPrompt,
      /PRIMARY SUBJECT — visually unmistakable: Présenter une équipe qui construit une stratégie de communication digitale concrète/,
      `acte ${index + 1}: le sujet choisi doit survivre aux contraintes critiques`,
    );
    assert.match(
      actPrompt,
      /REQUIRED VISUAL PROOF:.*(?:digital|software|content|photo|video)/i,
      `acte ${index + 1}: une preuve visuelle propre au sujet est requise`,
    );
    assert.match(
      actPrompt,
      /safe medium-wide, full heads with headroom/i,
      `acte ${index + 1}: aucun visage ne doit être coupé`,
    );
  }
});

test("les dialogues de 24 secondes sont assez longs, significatifs et tous uniques", () => {
  for (const language of ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"]) {
    const lines = [0, 1, 2].flatMap((sceneIndex) =>
      getAiMediaDialogueFallbackPair(language, sceneIndex),
    );
    const signatures = lines.map(aiMediaDialogueSignature);

    assert.equal(
      new Set(signatures).size,
      lines.length,
      `${language}: chaque prise de parole doit être différente`,
    );
    for (const line of lines) {
      assert.equal(
        isQualityAiMediaDialogueLine(line, language),
        true,
        `${language}: dialogue trop court, générique ou trop long: ${line}`,
      );
    }
  }

  const first = getAiMediaDialogueFallbackPair("fr", 0)[0];
  const used = new Set([aiMediaDialogueSignature(first)]);
  const replacement = selectAiMediaDialogueLine({
    value: "On s’y met ?",
    language: "fr",
    sceneIndex: 0,
    speaker: "lead",
    usedSignatures: used,
  });
  assert.notEqual(aiMediaDialogueSignature(replacement), aiMediaDialogueSignature(first));
  assert.equal(isQualityAiMediaDialogueLine(replacement, "fr", used), true);

  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  assert.match(veo, /args\.plan\.scenes\.slice\(0, index\)/);
  assert.match(veo, /usedDialogue\.add\(aiMediaDialogueSignature\(previous\.spokenLine\)\)/);
  assert.match(veo, /usedDialogue\.add\(aiMediaDialogueSignature\(selectedFirstLine\)\)/);
});

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
import {
  AI_VIDEO_BILLABLE_FAILURE_CODE,
  AiVideoProviderBillableFailure,
  isAiVideoProviderBillableFailure,
} from "../../lib/aiVideoProviderTypes.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

function loadVeoPromptRuntime() {
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
    [
      "@/lib/aiMediaSensitiveText",
      { redactAiMediaSensitiveText: (value: unknown) => String(value ?? "") },
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
  return {
    buildGoogleVideoScenePrompt:
      commonJsModule.exports.buildGoogleVideoScenePrompt as (
        args: Record<string, unknown>,
        index: number,
        durationSeconds: 8,
        options?: { continuation?: boolean },
      ) => string,
    promptForInspirationMode:
      commonJsModule.exports.promptForInspirationMode as (
        prompt: string,
        mode: "references" | "source" | "none",
      ) => string,
  };
}

function loadVideoProviderRouter() {
  const source = read("lib/aiVideoProvider.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "aiVideoProvider.ts",
  }).outputText;
  const calls: Array<{
    durationSeconds: number;
    provider: "google-gemini-omni" | "google-veo-fast";
    videoEngine: "omni" | "veo";
  }> = [];
  const provider = (
    id: "google-gemini-omni" | "google-veo-fast",
    model: string,
  ) => ({
    id,
    model,
    generate: async (args: {
      request: {
        durationSeconds: number;
        videoEngine: "omni" | "veo";
      };
    }) => {
      calls.push({
        durationSeconds: args.request.durationSeconds,
        provider: id,
        videoEngine: args.request.videoEngine,
      });
      return { clips: [], model, provider: id, warnings: [] };
    },
  });
  const stubs = new Map<string, unknown>([
    ["server-only", {}],
    [
      "@/lib/aiVideoProviderGoogleOmni",
      { googleOmniVideoProvider: provider("google-gemini-omni", "omni-test") },
    ],
    [
      "@/lib/aiVideoProviderGoogleVeo",
      { googleVeoVideoProvider: provider("google-veo-fast", "veo-test") },
    ],
    ["@/lib/aiVideoProviderTypes", {}],
  ]);
  const localRequire = (specifier: string) => {
    if (stubs.has(specifier)) return stubs.get(specifier);
    throw new Error(`unexpected_test_dependency:${specifier}`);
  };
  const routerCommonJsModule = { exports: {} as Record<string, unknown> };
  const factory = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${transpiled}\n})`,
    { filename: "aiVideoProvider.runtime.cjs" },
  ) as (
    exports: Record<string, unknown>,
    require: (specifier: string) => unknown,
    commonJsModule: { exports: Record<string, unknown> },
    filename: string,
    dirname: string,
  ) => void;
  factory(
    routerCommonJsModule.exports,
    localRequire,
    routerCommonJsModule,
    path.join(ROOT, "lib/aiVideoProvider.ts"),
    path.join(ROOT, "lib"),
  );
  return {
    calls,
    generate: routerCommonJsModule.exports.generateOriginalAiVideoClips as (
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>,
  };
}

test("le routeur respecte Veo ou Omni pour les vidéos de 8, 16 et 24 secondes", async () => {
  const { calls, generate } = loadVideoProviderRouter();
  const configuredProvider = process.env.AI_MEDIA_VIDEO_PROVIDER;
  delete process.env.AI_MEDIA_VIDEO_PROVIDER;

  try {
    for (const durationSeconds of [8, 16, 24]) {
      for (const videoEngine of ["veo", "omni"] as const) {
        await generate({ request: { durationSeconds, videoEngine } });
      }
    }
  } finally {
    if (configuredProvider === undefined) {
      delete process.env.AI_MEDIA_VIDEO_PROVIDER;
    } else {
      process.env.AI_MEDIA_VIDEO_PROVIDER = configuredProvider;
    }
  }

  assert.deepEqual(calls, [
    { durationSeconds: 8, provider: "google-veo-fast", videoEngine: "veo" },
    { durationSeconds: 8, provider: "google-gemini-omni", videoEngine: "omni" },
    { durationSeconds: 16, provider: "google-veo-fast", videoEngine: "veo" },
    { durationSeconds: 16, provider: "google-gemini-omni", videoEngine: "omni" },
    { durationSeconds: 24, provider: "google-veo-fast", videoEngine: "veo" },
    { durationSeconds: 24, provider: "google-gemini-omni", videoEngine: "omni" },
  ]);
  assert.deepEqual(getAiMediaVideoSegmentDurations(16), [8, 8]);
  assert.deepEqual(getAiMediaVideoSegmentDurations(24), [8, 8, 8]);
});

test("Omni long reste parallèle par défaut, avec les références sur chaque acte", () => {
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  assert.match(omni, /const DEFAULT_CONCURRENCY = 3/);
  assert.match(
    omni,
    /const continuationMode =\s*durations\.length > 1 && statefulContinuationEnabled\(\)/,
  );
  assert.match(
    omni,
    /const concurrency = continuationMode\s*\? 1\s*: Math\.min\(configuredConcurrency, durations\.length\)/,
  );
  assert.match(
    omni,
    /const isContinuation = continuationMode && index > 0/,
  );
  assert.match(
    omni,
    /inspirationImages:\s*!isContinuation &&\s*\(preserveIdentityReferences \|\| index === 0\)\s*\? args\.request\.inspirationImages\s*: \[\]/,
    "sans continuation, preserveIdentityReferences garde les images sur tous les actes",
  );
  assert.match(
    omni,
    /if \(continuationMode\) previousInteractionId = clip\.requestId/,
    "sans opt-in, aucun previous_interaction_id n’est mémorisé",
  );
  assert.match(omni, /durations\.length === 1 &&\s*!continuationMode/);
  assert.match(omni, /ai_video_omni_film_model_mixed/);
});

test("un film long verrouille son provider et son modèle après tout coût facturable", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.match(veo, /const filmModels = durations\.length > 1 \? \[primaryModel\] : models/);
  assert.match(veo, /ai_video_veo_film_model_mixed/);
  assert.match(omni, /ai_video_omni_film_model_mixed/);
  assert.match(veo, /new AiVideoProviderBillableFailure/);
  assert.match(omni, /new AiVideoProviderBillableFailure/);

  const billableGuard = server.indexOf(
    "if (isAiVideoProviderBillableFailure(primaryError))",
  );
  const crossProviderFallback = server.indexOf(
    'pipelineWarnings.push("veo_fallback_to_omni")',
  );
  assert.ok(billableGuard > 0 && crossProviderFallback > billableGuard);

  const error = new AiVideoProviderBillableFailure({
    provider: "google-gemini",
    model: "veo-test",
    stage: "film_incomplete",
    details: "download failed",
  });
  assert.equal(error.code, AI_VIDEO_BILLABLE_FAILURE_CODE);
  assert.equal(isAiVideoProviderBillableFailure(error), true);
  assert.equal(isAiVideoProviderBillableFailure(new Error("ordinary")), false);
});

test("l’opt-in Omni enchaîne res1 vers res2 puis res3 et n’envoie les images qu’au premier tour", () => {
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  assert.match(
    omni,
    /process\.env\.AI_MEDIA_OMNI_STATEFUL_CONTINUATION_ENABLED/,
  );
  assert.match(
    omni,
    /\["1", "true", "on", "yes"\]\.includes\([\s\S]*?AI_MEDIA_OMNI_STATEFUL_CONTINUATION_ENABLED/,
  );
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
    /if \(\s*durations\.length === 1 &&\s*!continuationMode &&\s*durationSeconds === 8[\s\S]*?googleVeoVideoProvider\.generate/,
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
  assert.match(veo, /Continue prior frame/);
  assert.match(veo, /same cast\/look\/place\/light\/lens\/motion/);
  assert.match(veo, /no intro\/reset\/recap\/cut/);
  assert.match(veo, /one continuous take/);
  assert.match(veo, /OPENING: requested action moves at frame 1/);
  assert.match(veo, /MIDDLE: new proof step; no opening replay/);
  assert.match(veo, /FINAL: same task reaches requested result/);
  assert.match(veo, /Animate from 0\.0s throughout/);
  assert.match(veo, /No repeat\/old line\/narrator\/music/);
  assert.match(veo, /Then mouth closed\/silent/);
});

test("le prompt reference_team de 24 secondes conserve ses contraintes critiques sous 1 400 caractères", () => {
  const { buildGoogleVideoScenePrompt, promptForInspirationMode } =
    loadVeoPromptRuntime();
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
        `Action distincte ${index + 1} : les trois collègues se déplacent, travaillent et interagissent naturellement dans le même studio.`,
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
  assert.match(prompt, /REFERENCE: group=3 adults, each once; identities locked/);
  assert.match(prompt, /lip-syncs once 0\.2–5\.5s: “[^”]{12,}”/);
  assert.match(prompt, /No repeat\/old line/);
  assert.match(prompt, /Continue prior frame/);
  assert.match(prompt, /PEOPLE: mature adults 25\+ only; no minors/);

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
      /SUBJECT: Présenter une équipe qui construit une stratégie de communication/,
      `acte ${index + 1}: le sujet choisi doit survivre aux contraintes critiques`,
    );
    assert.match(
      actPrompt,
      /USER: Poursuivre exactement l’action en/,
      `acte ${index + 1}: la consigne ponctuelle doit survivre aux contraintes critiques`,
    );
    assert.match(actPrompt, /étape du travail/);
    assert.match(actPrompt, /Animate from 0\.0s throughout/);
    assert.match(actPrompt, /NO VISUAL TEXT: blank surfaces/);
    assert.match(actPrompt, /PARAMS: 8s;square;service;visual=expert\/precise/);
    assert.match(
      actPrompt,
      /render=photo\/cinematic;shot=medium;people=team/,
    );
    assert.match(actPrompt, /creative=faithful;palette=#13b8ff, #ec3e9d/);
    assert.match(actPrompt, /FRAME medium-wide\/full heads/);
  }

  const parallelActPrompts = [0, 1, 2].map((index) =>
    buildGoogleVideoScenePrompt(generationArgs, index, 8),
  );
  const continuityContracts = parallelActPrompts.map(
    (actPrompt) => actPrompt.match(/CONTINUITY: ([\s\S]*?)\./)?.[1],
  );
  assert.equal(new Set(continuityContracts).size, 1);
  assert.match(continuityContracts[0] || "", /CAST same 3 approved adults, each once/);
  assert.match(continuityContracts[0] || "", /LOCK faces\/hair\/clothes\/voices\/place\/light\/palette\/lens\/camera/);
  assert.match(continuityContracts[0] || "", /PATH /);
  assert.match(continuityContracts[0] || "", /FRAME medium-wide\/full heads/);
  const expectedParallelRoles = [
    /ACT: OPENING: requested action moves at frame 1/,
    /ACT: MIDDLE: new proof step; no opening replay/,
    /ACT: FINAL: same task reaches requested result/,
  ];
  for (const [index, actPrompt] of parallelActPrompts.entries()) {
    assert.match(
      actPrompt,
      expectedParallelRoles[index]!,
      `acte parallèle ${index + 1}: le rôle narratif doit rester distinct`,
    );
    assert.match(
      actPrompt,
      new RegExp(`ACT:.*Action distincte ${index + 1}`),
      `acte parallèle ${index + 1}: l'action propre à l'acte ne doit pas être tronquée`,
    );
  }
  assert.equal(new Set(parallelActPrompts).size, 3);

  const genericReferencePrompt = actPrompts[0]!.replace(
    /REFERENCE:[\s\S]*?(?=\sACT:)/,
    "REFERENCE: generic mood/composition inspiration. ",
  );
  const sourcePrompt = promptForInspirationMode(
    genericReferencePrompt,
    "source",
  );
  assert.ok(sourcePrompt.length <= 1_400);
  assert.match(
    sourcePrompt,
    /REFERENCE: supplied image is animation source/,
  );
  assert.match(sourcePrompt, /real motion at 0\.0s/);
  assert.match(sourcePrompt, /PARAMS:/);
  assert.match(sourcePrompt, /CONTINUITY:/);
  assert.equal((sourcePrompt.match(/REFERENCE:/g) || []).length, 1);

  const strictSourcePrompt = promptForInspirationMode(
    actPrompts[0]!,
    "source",
  );
  assert.equal(
    strictSourcePrompt,
    actPrompts[0],
    "le mode source ne doit jamais effacer le verrou d'identité d'équipe",
  );
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

test("le secours dialogue d’un film 16 s suit ouverture puis conclusion", () => {
  const opening = selectAiMediaDialogueLine({
    value: "On s’y met ?",
    language: "fr",
    sceneIndex: 0,
    sceneCount: 2,
    speaker: "lead",
  });
  const conclusion = selectAiMediaDialogueLine({
    value: "C’est prêt",
    language: "fr",
    sceneIndex: 1,
    sceneCount: 2,
    speaker: "lead",
  });
  assert.equal(opening, getAiMediaDialogueFallbackPair("fr", 0)[0]);
  assert.equal(conclusion, getAiMediaDialogueFallbackPair("fr", 2)[0]);

  const copywriter = read("lib/aiMediaCopywriter.ts");
  assert.match(copywriter, /role_narratif:/);
  assert.match(copywriter, /\? "ouverture"/);
  assert.match(copywriter, /\? "conclusion"/);
  assert.match(copywriter, /: "preuve"/);
});

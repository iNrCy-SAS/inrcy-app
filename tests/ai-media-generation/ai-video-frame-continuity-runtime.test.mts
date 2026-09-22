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
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import * as reliability from "../../lib/aiVideoReliability.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";

type Engine = "veo" | "omni";
type RecordValue = Record<string, unknown>;
type VeoSubmission = {
  source: { prompt: string; image?: { imageBytes: string; mimeType: string }; video?: unknown };
  config: {
    referenceImages?: Array<{ image: { imageBytes: string; mimeType: string } }>;
    personGeneration?: string;
    durationSeconds?: number;
    aspectRatio?: string;
  };
};
type OmniSubmission = {
  input: Array<{ type: string; data?: string; mime_type?: string; text?: string }>;
  previous_interaction_id?: string;
  response_format?: { duration?: string; aspect_ratio?: string };
};

const ROOT = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function generationArgs(engine: Engine, durationSeconds: 8 | 16 | 24) {
  const request = {
    requestId: "frame-continuity-test-request",
    kind: "video", subjectSource: "profile", source: "studio",
    idea: "Une équipe réalise une décoration florale.",
    aiInstruction: "Gardez la même pièce et poursuivez le geste.",
    generationMode: "inspiration", peopleCriterion: "auto", settingCriterion: "auto", focusCriterion: "auto",
    textMode: "none", exactText: "", visualDirection: "auto", imagePurpose: "auto",
    withText: false, textKeywords: [], withMusic: false,
    withNarration: false, narrationVoice: null, narrationVoiceVariant: null,
    format: "square", typology: "service", visualStyle: "expert",
    imageStyle: "photo", shotType: "medium", peopleMode: "team",
    creativity: "faithful", useBrandColors: false, logoMode: "discreet",
    videoEngine: engine, identityMode: "auto", videoCharacterMode: "auto",
    identityConsent: false, teamVideoMode: "cinematic", teamVideoSpeechMode: "voiceover",
    teamVideoVeoConsent: false, identityReferenceSetId: "frame-test",
    durationSeconds, sceneMode: "single", connectScenes: true,
    inspirationImages: [{ data: "b3JpZ2luYWw=", mimeType: "image/jpeg" }],
  } as unknown as providerTypes.AiVideoProviderGenerationArgs["request"];
  const canonicalPrompt = "PROMPT CANONIQUE TEST CONTINUITÉ";
  return {
    accountId: "frame-continuity-test-account",
    request,
    plan: {
      companyName: "Atelier floral", headline: "Notre savoir-faire", cta: "Découvrir",
      scenes: getAiMediaVideoSegmentDurations(durationSeconds).map((_, index) => ({
        title: `Étape ${index + 1}`, body: "Les fleurs prennent place.",
        visualBrief: "Même atelier et mêmes adultes, le geste progresse.",
        spokenLine: "", spokenReply: "", layout: "editorial",
      })),
    },
    canonicalPrompt,
    canonicalPromptSha256: providerContract.hashAiMediaCanonicalPrompt(canonicalPrompt),
    providerContract: providerContract.buildAiMediaVideoProviderContract({
      request,
      durationSeconds: 8,
      brandColors: [],
    }),
    creativeBrief: "Un atelier de décoration florale.",
    brandColors: [], profession: "Fleuriste", contentLanguage: "fr",
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

function refreshProviderBoundary(
  args: providerTypes.AiVideoProviderGenerationArgs,
) {
  const canonicalPrompt = [
    "PROMPT CANONIQUE TEST CONTINUITÉ",
    args.request.idea,
    args.request.aiInstruction,
  ].join("\n");
  args.canonicalPrompt = canonicalPrompt;
  args.canonicalPromptSha256 =
    providerContract.hashAiMediaCanonicalPrompt(canonicalPrompt);
  args.providerContract = providerContract.buildAiMediaVideoProviderContract({
    request: args.request,
    durationSeconds: 8,
    brandColors: args.brandColors,
    identityTeamPrecomposed: args.identityTeamPrecomposed,
    identityTeamMemberCount: args.identityTeamMemberCount,
  });
  return args;
}

function createHarness(engine: Engine, options: {
  holdFirstOutput?: Promise<void>;
  holdOutputs?: Partial<Record<number, Promise<void>>>;
  failSubmission?: number;
  safetySubmissions?: number[];
  disableOmniFallback?: boolean;
  failExtraction?: boolean;
  rejectFrame?: boolean;
  statefulEnabled?: boolean;
  concurrency?: number;
  /** Advance a virtual wall clock; no test needs to wait for a provider. */
  simulatedClipMs?: number;
} = {}) {
  const submissions: RecordValue[] = [];
  const extracted: Array<{ buffer: Buffer; durationSeconds: number; sourceStartSeconds?: number }> = [];
  const buffers: Buffer[] = [];
  const charged: number[] = [];
  const clipTimeouts: number[] = [];
  let wallTime = 0;
  let fallbackCalls = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  let reservationNumber = 0;

  async function submit(input: RecordValue) {
    const index = submissions.length;
    submissions.push(input);
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    try {
      if (index === 0 && options.holdFirstOutput) await options.holdFirstOutput;
      if (options.holdOutputs?.[index]) await options.holdOutputs[index];
      await nextTurn();
      wallTime += options.simulatedClipMs ?? 0;
      if (index === options.failSubmission) {
        throw Object.assign(new Error("403 PERMISSION_DENIED: generation denied"), { status: 403 });
      }
      if (index > 0 && options.rejectFrame) {
        throw Object.assign(new Error("400 INVALID_ARGUMENT: frame rejected"), { status: 400 });
      }
      if (options.safetySubmissions?.includes(index)) {
        return engine === "veo"
          ? { name: `operations/filtered-${index + 1}`, done: true, response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["safety filter"] } }
          : { id: `filtered-${index + 1}`, status: "failed", errors: [{ message: "safety filter" }] };
      }
      const buffer = Buffer.from(`0000ftypgenerated-clip-${index + 1}`);
      buffers.push(buffer);
      return engine === "veo"
        ? {
            name: `operations/clip-${index + 1}`, done: true,
            response: { generatedVideos: [{ video: { videoBytes: buffer.toString("base64"), mimeType: "video/mp4" } }] },
          }
        : {
            id: `interaction-${index + 1}`,
            output_video: { data: buffer.toString("base64"), mime_type: "video/mp4" },
          };
    } finally {
      inFlight -= 1;
    }
  }

  const commonStubs = new Map<string, unknown>([
    ["server-only", {}],
    ["@google/genai", {
      GoogleGenAI: class {
        models = { generateVideos: submit };
        interactions = { create: submit };
        operations = { getVideosOperation: () => { throw new Error("unexpected_poll"); } };
        files = { download: () => { throw new Error("unexpected_download"); } };
      },
      VideoGenerationReferenceType: { ASSET: "ASSET" },
    }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async () => ({ id: ++reservationNumber }),
      commitAiGatewayAccountAttempt: async (args: { actualCostMicroUsd: number }) => { charged.push(args.actualCostMicroUsd); },
      rollbackAiGatewayAccountAttempt: async () => {},
      recordAiGatewayAccountFailure: async () => {},
    }],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentDurations }],
    ["@/lib/aiVideoReliability", reliability],
    ["@/lib/aiVideoProviderTypes", providerTypes],
    ["@/lib/aiMediaDialogue", dialogue],
    ["@/lib/aiMediaColorDirection", colorDirection],
    ["@/lib/aiMediaVideoProviderContract", providerContract],
    ["@/lib/aiMediaPromptShared", promptShared],
    ["@/lib/aiMediaSensitiveText", { redactAiMediaSensitiveText: (value: unknown) => String(value ?? "") }],
    ["./aiMediaVideoContinuity.ts", {
      extractAiMediaVideoContinuityFrame: async (args: { buffer: Buffer; durationSeconds: number; sourceStartSeconds?: number }) => {
        extracted.push(args);
        if (options.failExtraction) throw new Error("ai_video_continuity_frame_unavailable");
        return { data: `frame-${extracted.length}`, mimeType: "image/jpeg" };
      },
    }],
    ["@/lib/mediaVideoNormalizer", {
      probeVideoSource: () => { throw new Error("unexpected_stateful_probe"); },
      resolveVideoNormalizationFfmpegPath: () => { throw new Error("unexpected_ffmpeg"); },
    }],
  ]);

  function loadModule(filename: string) {
    const source = readFileSync(path.join(ROOT, "lib", filename), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText;
    const commonJsModule = { exports: {} as RecordValue };
    const factory = vm.runInNewContext(
      `(function (exports, require, module, __filename, __dirname) {${output}\n})`,
      {
        Buffer, AbortController, AbortSignal, URL, clearTimeout,
        Date: class extends Date { static now() { return wallTime; } },
        setTimeout: (callback: () => void, milliseconds: number) => {
          clipTimeouts.push(milliseconds);
          return setTimeout(callback, milliseconds);
        },
        console: { warn() {}, error() {}, log() {} },
        // Isolate environment flags; tests must not inherit production credentials
        // or opt into cumulative continuation from the developer's shell.
        process: { env: {
          GEMINI_API_KEY: "test-only",
          AI_MEDIA_OMNI_STATEFUL_CONTINUATION_ENABLED: String(options.statefulEnabled ?? false),
          ...(options.disableOmniFallback ? { AI_MEDIA_OMNI_FALLBACK_TO_VEO: "false" } : {}),
          ...(options.concurrency ? {
            AI_MEDIA_OMNI_CONCURRENCY: String(options.concurrency),
            AI_MEDIA_VEO_CONCURRENCY: String(options.concurrency),
          } : {}),
        } },
      },
      { filename: `${filename}.runtime.cjs` },
    );
    factory(commonJsModule.exports, (specifier: string) => {
      if (commonStubs.has(specifier)) return commonStubs.get(specifier);
      if (specifier.startsWith("node:")) return nativeRequire(specifier);
      throw new Error(`unexpected_test_dependency:${specifier}`);
    }, commonJsModule, path.join(ROOT, "lib", filename), path.join(ROOT, "lib"));
    return commonJsModule.exports;
  }

  const veo = loadModule("aiVideoProviderGoogleVeo.ts");
  commonStubs.set("@/lib/aiVideoProviderGoogleVeo", {
    ...veo,
    googleVeoVideoProvider: {
      id: "google-gemini", generate: async () => {
        fallbackCalls += 1;
        throw new Error("unexpected_cross_provider_fallback");
      },
    },
  });
  const provider = (engine === "veo" ? veo.googleVeoVideoProvider : loadModule("aiVideoProviderGoogleOmni.ts").googleOmniVideoProvider) as providerTypes.AiVideoProvider;
  return {
    provider, submissions, extracted, buffers, charged, clipTimeouts,
    promptRuntime: veo as unknown as typeof import("../../lib/aiVideoProviderGoogleVeo.ts"),
    get maximumInFlight() { return maximumInFlight; },
    get fallbackCalls() { return fallbackCalls; },
  };
}

for (const engine of ["veo", "omni"] as const) {
  for (const duration of [8, 16, 24] as const) {
    for (const useBrandColors of [false, true]) {
      test(`${engine}: sujet custom ${duration}s isolé de l’ADN, marque ${useBrandColors ? "activée" : "désactivée"}`, async () => {
        const harness = createHarness(engine);
        const args = generationArgs(engine, duration);
        args.request.subjectSource = "custom";
        args.request.idea = "Un boulanger adulte sort une fournée de croissants du four et pose la plaque sur le comptoir.";
        args.request.aiInstruction = "Inviter simplement au petit déjeuner avec ces croissants, sans autre offre ni promesse.";
        args.request.inspirationImages = [];
        args.request.useBrandColors = useBrandColors;
        args.request.logoMode = useBrandColors ? "visible" : "none";
        args.brandColors = ["#13b8ff", "#ec3e9d"];
        args.creativeBrief = "ADN_TABLETTE : application mobile SaaS de communication et dashboard numérique.";
        args.profession = "ADN_LOGICIEL";
        args.plan.companyName = "ADN_MARQUE";
        args.plan.cta = "ADN_ABONNEMENT";
        args.plan.scenes = args.plan.scenes.map((scene) => ({
          ...scene,
          title: "ADN_TABLETTE",
          body: "ADN_DASHBOARD",
          visualBrief: "ADN_LOGICIEL : une femme utilise une tablette devant le boulanger.",
        }));
        await harness.provider.generate(refreshProviderBoundary(args));
        assert.equal(harness.submissions.length, duration / 8);
        for (const submission of harness.submissions) {
          const prompt = engine === "veo"
            ? (submission as unknown as VeoSubmission).source.prompt
            : (submission as unknown as OmniSubmission).input.find((part) => part.type === "text")?.text || "";
          assert.ok(prompt.includes(args.request.idea));
          assert.ok(prompt.includes(args.request.aiInstruction));
          const originality = promptShared.buildAiMediaOriginalityContract(args.request);
          assert.ok(prompt.includes(originality));
          assert.doesNotMatch(prompt.replace(originality, ""), /ADN_|tablet|smartphone|digital subject|software workflow|femme|VERIFIED CONTEXT/i);
          assert.match(prompt, new RegExp(`logo=${useBrandColors ? "visible" : "none"}`));
          for (const color of colorDirection.describeAiMediaBrandColors(args.brandColors)) {
            assert.equal(prompt.includes(color), useBrandColors, `couleur opt-in ${color}`);
          }
        }
      });
    }
  }

  test(`${engine}: le safety lazy déclenche réellement une seconde variante complète`, async () => {
    const harness = createHarness(engine, { safetySubmissions: [0] });
    const args = generationArgs(engine, 8);
    args.request.inspirationImages = [];
    const result = await harness.provider.generate(refreshProviderBoundary(args));
    assert.equal(result.clips.length, 1);
    assert.equal(harness.submissions.length, 2);
    const prompts = harness.submissions.map((submission) => engine === "veo"
      ? (submission as unknown as VeoSubmission).source.prompt
      : (submission as unknown as OmniSubmission).input.find((part) => part.type === "text")?.text || "");
    assert.doesNotMatch(prompts[0], /SAFETY RECOVERY/);
    assert.match(prompts[1], /^SAFETY RECOVERY:/);
    assert.notEqual(prompts[0], prompts[1]);
    assert.ok(prompts[1].includes(args.request.idea));
    assert.ok(prompts[1].includes(args.request.aiInstruction));
    assert.ok(prompts[1].includes(args.providerContract!.parameters));
    assert.ok(prompts[1].includes(args.providerContract!.references));
    assert.ok(prompts[1].includes(promptShared.buildAiMediaOriginalityContract(args.request)));
    assert.equal(harness.charged.length, 1, "seule la sortie réellement produite est comptabilisée");
  });

  test(`${engine}: la citation personnage entière atteint le réseau normal et safety malgré un ancien fragment de plan`, async () => {
    const harness = createHarness(engine, { safetySubmissions: [0] });
    const args = generationArgs(engine, 8);
    const quote = "Je façonne chaque pièce à la main, pour embellir votre quotidien.";
    args.request.subjectSource = "custom";
    args.request.idea = `Dans un atelier de céramique lumineux, une céramiste adulte imaginaire façonne un vase sur son tour, puis regarde la caméra et dit naturellement en français : « ${quote} » Garder cette phrase entière et synchroniser ses lèvres. Une seule scène continue, aucune voix off, aucun écran, aucune tablette, aucun texte incrusté.`;
    args.request.aiInstruction = args.request.idea;
    args.request.teamVideoSpeechMode = "characters";
    args.request.inspirationImages = [];
    args.plan.scenes[0]!.spokenLine = "Dans un atelier de céramique lumineux";
    await harness.provider.generate(refreshProviderBoundary(args));
    assert.equal(harness.submissions.length, 2);
    for (const submission of harness.submissions) {
      const prompt = engine === "veo" ? (submission as unknown as VeoSubmission).source.prompt
        : (submission as unknown as OmniSubmission).input.find((part) => part.type === "text")?.text || "";
      assert.ok(prompt.includes(args.request.idea), "le brief visuel reste intégral");
      assert.ok(prompt.includes(`lip-syncs once 0.2–5.5s: “${quote}”`), "la citation n'est jamais remplacée ou tronquée");
      assert.ok(!prompt.includes("lip-syncs once 0.2–5.5s: “Dans un atelier"));
    }
  });

  test(`${engine}: un appareil explicitement demandé dans le sujet custom reste pertinent`, async () => {
    const harness = createHarness(engine);
    const args = generationArgs(engine, 8);
    args.request.subjectSource = "custom";
    args.request.idea = "Un adulte utilise une application sur sa tablette.";
    args.request.aiInstruction = "Montrer son geste sur l’écran sans texte lisible.";
    args.request.inspirationImages = [];
    await harness.provider.generate(refreshProviderBoundary(args));
    const prompt = engine === "veo"
      ? (harness.submissions[0] as unknown as VeoSubmission).source.prompt
      : (harness.submissions[0] as unknown as OmniSubmission).input.find((part) => part.type === "text")?.text || "";
    assert.ok(prompt.includes(args.request.idea));
    assert.match(prompt, /Any requested device must match the brief exactly/);
    assert.doesNotMatch(prompt, /smartphone, tablet or laptop|digital subject/);
  });

  for (const idea of [
    "Une vidéo de croissants sortant du four dans une boulangerie.",
    "Un coiffeur mobile termine une coupe de cheveux à domicile.",
    "Une campagne de communication montre des croissants sur un comptoir de boulangerie.",
  ]) {
    test(`${engine}: le brief « ${idea} » n’impose aucun appareil`, async () => {
      const harness = createHarness(engine);
      const args = generationArgs(engine, 8);
      args.request.subjectSource = "custom";
      args.request.idea = idea;
      args.request.aiInstruction = "Une action naturelle en lien direct avec le sujet.";
      args.request.inspirationImages = [];
      await harness.provider.generate(refreshProviderBoundary(args));
      const prompt = engine === "veo"
        ? (harness.submissions[0] as unknown as VeoSubmission).source.prompt
        : (harness.submissions[0] as unknown as OmniSubmission).input.find((part) => part.type === "text")?.text || "";
      assert.ok(prompt.includes(idea));
      const originality = promptShared.buildAiMediaOriginalityContract(args.request);
      assert.ok(prompt.includes(originality));
      assert.doesNotMatch(prompt.replace(originality, ""), /smartphone|tablet|laptop|software workflow|thumbnails|digital subject|Any requested device|bureau|office/i);
    });
  }

  test(`${engine}: une inspiration facultative peut précéder un safety lazy sans perdre le brief`, async () => {
    const harness = createHarness(engine, { safetySubmissions: [0, 1] });
    const args = generationArgs(engine, 8);
    args.request.teamVideoMode = "montage";
    args.request.inspirationImages = [{ data: "cHJvZHVpdA==", mimeType: "image/jpeg", role: "product", usage: "inspiration" }];
    const result = await harness.provider.generate(refreshProviderBoundary(args));
    assert.equal(result.clips.length, 1);
    assert.equal(harness.submissions.length, 3);
    const prompt = engine === "veo"
      ? (harness.submissions[2] as unknown as VeoSubmission).source.prompt
      : (harness.submissions[2] as unknown as OmniSubmission).input.find((part) => part.type === "text")?.text || "";
    assert.match(prompt, /^SAFETY RECOVERY:/);
    assert.match(prompt, /#1:product\/inspiration/);
    assert.ok(prompt.includes(args.request.idea));
    assert.ok(prompt.includes(args.request.aiInstruction));
    assert.equal(harness.charged.length, 1);
  });

  test(`${engine}: le safety lazy ne retire jamais une référence produit requise`, async () => {
    const harness = createHarness(engine, { safetySubmissions: [0], disableOmniFallback: true });
    const args = generationArgs(engine, 8);
    args.request.inspirationImages = [{ data: "cHJvZHVpdA==", mimeType: "image/jpeg", role: "product", usage: "required" }];
    await assert.rejects(harness.provider.generate(refreshProviderBoundary(args)), /identity_reference_rejected/);
    assert.equal(harness.submissions.length, 1);
    assert.equal(harness.charged.length, 0);
  });

  test(`${engine}: une référence produit requise reste jointe à tous les actes du mode montage`, async () => {
    const harness = createHarness(engine);
    const args = generationArgs(engine, 16);
    args.request.teamVideoMode = "montage";
    args.request.connectScenes = false;
    args.request.inspirationImages = [{ data: "cHJvZHVpdA==", mimeType: "image/jpeg", role: "product", usage: "required" }];
    refreshProviderBoundary(args);
    await harness.provider.generate(args);
    assert.equal(harness.submissions.length, 2);
    for (const submission of harness.submissions) {
      if (engine === "veo") {
        const request = submission as unknown as VeoSubmission;
        assert.equal(request.config.referenceImages?.[0]?.image.imageBytes, "cHJvZHVpdA==");
        assert.match(request.source.prompt, /#1:product\/required/);
      } else {
        const input = (submission as unknown as OmniSubmission).input;
        assert.equal(input.find((part) => part.type === "image")?.data, "cHJvZHVpdA==");
        assert.match(input.find((part) => part.type === "text")?.text || "", /#1:product\/required/);
      }
    }
  });

  test(`${engine}: une variante safety impossible ne bloque pas la tentative normale`, async () => {
    const harness = createHarness(engine);
    const args = generationArgs(engine, 8);
    args.request.inspirationImages = [];
    args.request.teamVideoMode = "montage";
    args.request.aiInstruction = `Conserver exactement le vase ${"b".repeat(500)}.`;
    let nominalPrompt = "";
    for (let length = 1_200; length <= 1_950; length += 10) {
      args.request.idea = `Un vase décrit entièrement ${"a".repeat(length)}.`;
      refreshProviderBoundary(args);
      try {
        const candidate = harness.promptRuntime.buildGoogleVideoScenePrompt(args, 0, 8);
        try { harness.promptRuntime.buildGoogleVideoSafetyFallbackPrompt(candidate); }
        catch (error) {
          if (String(error).includes("ai_video_veo_safety_prompt_budget_exceeded")) { nominalPrompt = candidate; break; }
          throw error;
        }
      } catch (error) {
        if (!String(error).includes("ai_video_instruction_contract_too_long")) throw error;
      }
    }
    assert.ok(nominalPrompt, "la fixture doit approcher le budget sans le dépasser");
    assert.ok(nominalPrompt.length <= 3_200);
    const result = await harness.provider.generate(args);
    assert.equal(result.clips.length, 1);
    assert.equal(harness.submissions.length, 1);
    const submitted = engine === "veo"
      ? (harness.submissions[0] as unknown as VeoSubmission).source.prompt
      : (harness.submissions[0] as unknown as OmniSubmission).input.find((part) => part.type === "text")?.text;
    assert.equal(submitted, nominalPrompt);
    assert.ok(submitted?.includes(args.request.idea));
    assert.ok(submitted?.includes(args.request.aiInstruction));
  });

  test(`${engine}: chaque scène 24 s envoyée au fournisseur reçoit le contrat Studio complet`, async () => {
    const harness = createHarness(engine);
    const args = generationArgs(engine, 24);
    Object.assign(args.request as unknown as Record<string, unknown>, {
      generationMode: "ai_criteria",
      peopleCriterion: "two",
      settingCriterion: "studio",
      focusCriterion: "product",
      format: "story",
      typology: "offer",
      visualStyle: "premium",
      visualDirection: "bold",
      imageStyle: "graphic",
      shotType: "close",
      peopleMode: "team",
      creativity: "bold",
      useBrandColors: true,
      sceneMode: "multi",
      connectScenes: false,
      textMode: "exact",
      exactText: "Offre septembre",
      withText: true,
      withNarration: true,
      narrationVoice: "male",
      narrationVoiceVariant: "Orus",
      withMusic: true,
      logoMode: "visible",
      teamVideoMode: "cinematic",
      teamVideoSpeechMode: "voiceover",
      identityMode: "professional",
      videoCharacterMode: "professional",
      identityConsent: true,
      inspirationImages: [
        {
          data: "Y2hhcmFjdGVy",
          mimeType: "image/jpeg",
          role: "character",
          usage: "required",
          characterIndex: 1,
        },
        {
          data: "ZW52aXJvbm1lbnQ=",
          mimeType: "image/jpeg",
          role: "environment",
          usage: "required",
        },
        {
          data: "cHJvZHVjdA==",
          mimeType: "image/jpeg",
          role: "product",
          usage: "inspiration",
        },
      ],
    });
    Object.assign(args, { brandColors: ["#13b8ff", "#ec3e9d"] });
    const expectedPalette = colorDirection
      .describeAiMediaBrandColors(args.brandColors)
      .join("/");

    await harness.provider.generate(refreshProviderBoundary(args));
    assert.equal(harness.submissions.length, 3);
    for (const [index, rawSubmission] of harness.submissions.entries()) {
      const prompt =
        engine === "veo"
          ? (rawSubmission as unknown as VeoSubmission).source.prompt
          : (rawSubmission as unknown as OmniSubmission).input
              .filter((part) => part.type === "text")
              .map((part) => part.text || "")
              .join(" ");

      if (engine === "veo") {
        const submission = rawSubmission as unknown as VeoSubmission;
        const references = submission.config.referenceImages;
        assert.equal(submission.config.durationSeconds, 8);
        assert.equal(submission.config.aspectRatio, "9:16");
        assert.equal(references?.length, 3, `veo/scène ${index + 1}: trois fichiers transmis`);
        assert.deepEqual(
          Array.from(references || [], (reference) => String(reference.image.imageBytes)),
          ["Y2hhcmFjdGVy", "ZW52aXJvbm1lbnQ=", "cHJvZHVjdA=="],
        );
      } else {
        const submission = rawSubmission as unknown as OmniSubmission;
        const references = submission.input.filter(
          (part) => part.type === "image",
        );
        assert.equal(submission.response_format?.duration, "8s");
        assert.equal(submission.response_format?.aspect_ratio, "9:16");
        assert.equal(references.length, 3, `omni/scène ${index + 1}: trois fichiers transmis`);
        assert.deepEqual(
          Array.from(references, (reference) => String(reference.data)),
          ["Y2hhcmFjdGVy", "ZW52aXJvbm1lbnQ=", "cHJvZHVjdA=="],
        );
      }

      assert.ok(prompt.length <= 3_200, `${engine}/scène ${index + 1}: prompt trop long`);
      assert.match(prompt, new RegExp(`SHOT ${index + 1}/3`));
      for (const expected of [
        "film=24s",
        "fmt=story",
        "type=offer",
        "mode=ai_criteria",
        "crit=two/studio/product",
        "dir=bold",
        "look=premium/graphic/close/team/bold",
        "story=multi/unlinked",
        "text=exact",
        "audio=voiceover-male-Orus/music",
        "logo=visible",
        `pal=${expectedPalette}`,
        "#1:character/required/character-1",
        "#2:environment/required",
        "#3:product/inspiration",
        "all distinct approved adults visible in required character refs; each once",
      ]) {
        assert.ok(
          prompt.includes(expected),
          `${engine}/scène ${index + 1}: contrat perdu « ${expected} »`,
        );
      }
    }
  });
}

for (const engine of ["veo", "omni"] as const) {
  test(`${engine}: la requête fournisseur conserve le début et la vraie fin d'une consigne longue`, async () => {
    const harness = createHarness(engine);
    const args = generationArgs(engine, 8);
    const headMarker = "DEBUT_CONSIGNE_X9";
    const tailMarker = "FIN_CONSIGNE_Z7";
    args.request.aiInstruction = [
      headMarker,
      "contexte secondaire utile à la réalisation".repeat(36),
      tailMarker,
    ].join(" ");

    await harness.provider.generate(refreshProviderBoundary(args));
    assert.equal(harness.submissions.length, 1);
    const rawSubmission = harness.submissions[0]!;
    const prompt =
      engine === "veo"
        ? (rawSubmission as unknown as VeoSubmission).source.prompt
        : (rawSubmission as unknown as OmniSubmission).input
            .filter((part) => part.type === "text")
            .map((part) => part.text || "")
            .join(" ");

    assert.ok(prompt.length <= 3_200);
    assert.match(prompt, new RegExp(headMarker));
    assert.match(prompt, new RegExp(tailMarker));
    assert.match(prompt, /USER:/);
    assert.match(prompt, /PARAMS:/);
  });
}

for (const engine of ["veo", "omni"] as const) {
  for (const duration of [16, 24] as const) {
    test(`${engine}: ${duration}s enchaîne les dernières frames, sans actes indépendants parallèles`, async () => {
      const firstOutput = deferred();
      const harness = createHarness(engine, { holdFirstOutput: firstOutput.promise });
      const args = generationArgs(engine, duration);
      const original = JSON.stringify(args);
      const pending = harness.provider.generate(args);
      try {
        await nextTurn();
        assert.equal(harness.submissions.length, 1, "le prochain acte attend le résultat du précédent");
        assert.equal(harness.extracted.length, 0);
        firstOutput.resolve();
        const result = await pending;
        const count = duration / 8;
        assert.equal(harness.maximumInFlight, 1);
        assert.equal(harness.submissions.length, count);
        assert.equal(harness.extracted.length, count - 1);
        assert.equal(result.clips.length, count);
        assert.equal(JSON.stringify(args), original, "le brief et les références d’origine restent immuables");
        for (let index = 1; index < count; index += 1) {
          const extracted = harness.extracted[index - 1]!;
          assert.deepEqual(extracted.buffer, harness.buffers[index - 1]);
          assert.equal(extracted.durationSeconds, 8);
          assert.equal(extracted.sourceStartSeconds ?? 0, 0);
          if (engine === "veo") {
            const submission = harness.submissions[index] as unknown as VeoSubmission;
            assert.equal(submission.source.image?.imageBytes, `frame-${index}`);
            assert.equal(submission.source.image?.mimeType, "image/jpeg");
            assert.equal(submission.source.video, undefined);
            assert.equal(submission.config.referenceImages, undefined);
            assert.equal(submission.config.personGeneration, "allow_adult");
            assert.ok(submission.source.prompt.length <= 3_200);
          } else {
            const submission = harness.submissions[index] as unknown as OmniSubmission;
            const images = submission.input.filter((item) => item.type === "image");
            const prompt = submission.input.filter((item) => item.type === "text").map((item) => item.text).join(" ");
            assert.equal(images[0].data, `frame-${index}`);
            assert.equal(images[0].mime_type, "image/jpeg");
            assert.match(prompt, /<FIRST_FRAME>@Image1/);
            assert.doesNotMatch(prompt, /<PREVIOUS_VIDEO>/);
            assert.equal(submission.previous_interaction_id, undefined);
          }
        }
        assert.equal(harness.fallbackCalls, 0);
      } finally {
        firstOutput.resolve();
        await pending.catch(() => undefined);
      }
    });
  }

  for (const connectScenes of [false, undefined] as const) {
    test(`${engine}: raccord ${String(connectScenes)} conserve le parallélisme et ignore l’opt-in stateful`, async () => {
      const outputs = deferred();
      const harness = createHarness(engine, {
        holdOutputs: { 0: outputs.promise, 1: outputs.promise, 2: outputs.promise },
        statefulEnabled: true,
      });
      const args = generationArgs(engine, 24);
      if (connectScenes === undefined) Reflect.deleteProperty(args.request, "connectScenes");
      else args.request.connectScenes = connectScenes;
      const original = JSON.stringify(args);
      const pending = harness.provider.generate(args);
      try {
        await nextTurn();
        assert.equal(harness.submissions.length, engine === "omni" ? 3 : 2);
        assert.equal(harness.extracted.length, 0);
        outputs.resolve();
        const result = await pending;
        assert.equal(harness.maximumInFlight, engine === "omni" ? 3 : 2);
        assert.equal(result.clips.length, 3);
        assert.equal(harness.extracted.length, 0);
        assert.equal(JSON.stringify(args), original);
        assert.deepEqual(Array.from(result.clips, (clip) => clip.requestId), engine === "omni"
          ? ["interaction-1", "interaction-2", "interaction-3"]
          : ["operations/clip-1", "operations/clip-2", "operations/clip-3"]);
        for (const input of harness.submissions) {
          if (engine === "veo") {
            const submission = input as unknown as VeoSubmission;
            assert.equal(submission.config.referenceImages?.[0].image.imageBytes, "b3JpZ2luYWw=");
            assert.equal(submission.source.image, undefined);
            assert.doesNotMatch(submission.source.prompt, /prior shot's final frame/);
          } else {
            const submission = input as unknown as OmniSubmission;
            assert.equal(submission.input.find((part) => part.type === "image")?.data, "b3JpZ2luYWw=");
            assert.equal(submission.previous_interaction_id, undefined);
            assert.doesNotMatch(submission.input.map((part) => part.text ?? "").join(" "), /<FIRST_FRAME>|<PREVIOUS_VIDEO>/);
          }
        }
        assert.equal(harness.charged.reduce((sum, cost) => sum + cost, 0), 2_400_000);
        assert.equal(harness.fallbackCalls, 0);
      } finally {
        outputs.resolve();
        await pending.catch(() => undefined);
      }
    });
  }

  test(`${engine}: les inspirations génériques du mode rapide restent limitées au premier acte`, async () => {
    const harness = createHarness(engine);
    const args = generationArgs(engine, 16);
    args.request.connectScenes = false;
    args.request.teamVideoMode = "montage";
    await harness.provider.generate(args);
    if (engine === "veo") {
      const submission = harness.submissions[1] as unknown as VeoSubmission;
      assert.equal(submission.source.image, undefined);
      assert.equal(submission.config.referenceImages, undefined);
    } else {
      const submission = harness.submissions[1] as unknown as OmniSubmission;
      assert.equal(submission.input.filter((part) => part.type === "image").length, 0);
    }
    assert.equal(harness.extracted.length, 0);
  });

  test(`${engine}: le mode rapide respecte la limite de concurrence configurée`, async () => {
    const harness = createHarness(engine, { concurrency: 1 });
    const args = generationArgs(engine, 24);
    args.request.connectScenes = false;
    const result = await harness.provider.generate(args);
    assert.equal(result.clips.length, 3);
    assert.equal(harness.maximumInFlight, 1);
    assert.equal(harness.extracted.length, 0, "limiter la concurrence n’active pas implicitement les raccords");
  });

  test(`${engine}: un échec parallèle attend tous les résultats facturables avant de remonter`, async () => {
    const lastOutput = deferred();
    const harness = createHarness(engine, { holdOutputs: { 1: lastOutput.promise }, failSubmission: 0 });
    const args = generationArgs(engine, 16);
    args.request.connectScenes = false;
    let settled = false;
    const pending = harness.provider.generate(args);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      for (let turn = 0; turn < 6; turn += 1) await nextTurn();
      assert.equal(harness.submissions.length, 2);
      assert.equal(settled, false, "le premier rejet ne déclenche pas le fallback pendant le second appel");
      assert.equal(harness.fallbackCalls, 0);
      lastOutput.resolve();
      await assert.rejects(pending, (error: unknown) => providerTypes.isAiVideoProviderBillableFailure(error));
      assert.equal(harness.buffers.length, 1);
      assert.equal(harness.charged.reduce((sum, cost) => sum + cost, 0), 800_000);
      assert.equal(harness.fallbackCalls, 0);
      assert.equal(harness.extracted.length, 0);
    } finally {
      lastOutput.resolve();
      await pending.catch(() => undefined);
    }
  });

  test(`${engine}: 8s conserve un seul appel et n’extrait aucune frame`, async () => {
    const harness = createHarness(engine);
    const result = await harness.provider.generate(generationArgs(engine, 8));
    assert.equal(result.clips.length, 1);
    assert.equal(harness.submissions.length, 1);
    assert.equal(harness.extracted.length, 0);
    assert.equal(harness.fallbackCalls, 0);
  });

  test(`${engine}: la durée du film reste bornée sans réduire le budget du premier acte`, async () => {
    const harness = createHarness(engine, { simulatedClipMs: 310_000 });
    await assert.rejects(
      harness.provider.generate(generationArgs(engine, 24)),
      (error: unknown) => providerTypes.isAiVideoProviderBillableFailure(error),
    );
    assert.equal(harness.submissions.length, 2, "un troisième appel ne part pas après 600 secondes cumulées");
    assert.deepEqual(harness.clipTimeouts, [420_000, 290_000], "420 s par acte au plus, avec un budget total de 600 s");
    assert.equal(harness.charged.reduce((sum, cost) => sum + cost, 0), 1_600_000);
    assert.equal(harness.fallbackCalls, 0);
  });

  for (const failure of ["extraction", "rejected-frame"] as const) {
    test(`${engine}: ${failure} échoue proprement sans génération aveugle ni second paiement`, async () => {
      const harness = createHarness(engine, { failExtraction: failure === "extraction", rejectFrame: failure === "rejected-frame" });
      await assert.rejects(
        harness.provider.generate(generationArgs(engine, 24)),
        (error: unknown) => providerTypes.isAiVideoProviderBillableFailure(error),
      );
      assert.equal(harness.submissions.length, failure === "extraction" ? 1 : 2);
      assert.equal(harness.extracted.length, 1);
      assert.equal(harness.buffers.length, 1, "seul le premier résultat a été généré");
      assert.equal(harness.fallbackCalls, 0);
      assert.equal(harness.charged.reduce((sum, cost) => sum + cost, 0), 800_000, "seul le premier acte est comptabilisé");
    });
  }
}

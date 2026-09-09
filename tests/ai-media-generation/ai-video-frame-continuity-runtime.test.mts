import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import * as dialogue from "../../lib/aiMediaDialogue.ts";
import * as colorDirection from "../../lib/aiMediaColorDirection.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import * as reliability from "../../lib/aiVideoReliability.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";

type Engine = "veo" | "omni";
type RecordValue = Record<string, unknown>;
type VeoSubmission = {
  source: { prompt: string; image?: { imageBytes: string; mimeType: string }; video?: unknown };
  config: { referenceImages?: Array<{ image: { imageBytes: string; mimeType: string } }>; personGeneration?: string };
};
type OmniSubmission = {
  input: Array<{ type: string; data?: string; mime_type?: string; text?: string }>;
  previous_interaction_id?: string;
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
  return {
    accountId: "frame-continuity-test-account",
    request: {
      requestId: "frame-continuity-test-request",
      kind: "video", subjectSource: "profile", source: "studio",
      idea: "Une équipe réalise une décoration florale.",
      aiInstruction: "Gardez la même pièce et poursuivez le geste.",
      withText: false, textKeywords: [], withMusic: false,
      withNarration: false, narrationVoice: null,
      format: "square", typology: "service", visualStyle: "expert",
      imageStyle: "photo", shotType: "medium", peopleMode: "team",
      creativity: "faithful", useBrandColors: false, logoMode: "discreet",
      videoEngine: engine, identityMode: "auto", videoCharacterMode: "auto",
      identityConsent: false, teamVideoMode: "cinematic", teamVideoSpeechMode: "voiceover",
      durationSeconds, connectScenes: true,
      inspirationImages: [{ data: "b3JpZ2luYWw=", mimeType: "image/jpeg" }],
    },
    plan: {
      companyName: "Atelier floral", headline: "Notre savoir-faire", cta: "Découvrir",
      scenes: getAiMediaVideoSegmentDurations(durationSeconds).map((_, index) => ({
        title: `Étape ${index + 1}`, body: "Les fleurs prennent place.",
        visualBrief: "Même atelier et mêmes adultes, le geste progresse.",
        spokenLine: "", spokenReply: "", layout: "editorial",
      })),
    },
    creativeBrief: "Un atelier de décoration florale.",
    brandColors: [], profession: "Fleuriste", contentLanguage: "fr",
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

function createHarness(engine: Engine, options: {
  holdFirstOutput?: Promise<void>;
  holdOutputs?: Partial<Record<number, Promise<void>>>;
  failSubmission?: number;
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
    get maximumInFlight() { return maximumInFlight; },
    get fallbackCalls() { return fallbackCalls; },
  };
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
            assert.ok(submission.source.prompt.length <= 1_400);
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

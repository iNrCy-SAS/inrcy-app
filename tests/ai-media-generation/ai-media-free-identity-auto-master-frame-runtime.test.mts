import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import {
  normalizeAiMediaGenerationRequest,
  type AiMediaGenerationRequest,
  type AiMediaInspirationImage,
} from "../../lib/aiMediaGenerationContracts.ts";
import {
  hasProvidedAiMediaCharacterVoice,
  isAiMediaCharacterVoiceEngine,
} from "../../lib/aiMediaCharacterVoices.ts";
import {
  buildAiMediaFreeSceneFramePrompt,
  buildAiMediaFreeVideoCastContract,
  buildAiMediaFreeVideoScenePrompt,
} from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { needsControlledAiMediaFreeFirstFrame, usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import { AiVideoProviderBillableFailure, getAiVideoProviderRecoverableStatus, isAiVideoProviderBillableFailure, type AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";
import { classifyVeoFailure } from "../../lib/aiVideoReliability.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";

const server = ts.createSourceFile(
  "aiMediaGenerationServer.ts",
  readFileSync(new URL("../../lib/aiMediaGenerationServer.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function initializer(name: string) {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(server);
  assert.equal(found.length, 1, `Execute the unique real Server initializer for ${name}.`);
  return found[0].getText(server);
}

// Extract the actual Server branch, including its role assignment. Only the
// image provider, image codec and final video provider are substituted below.
const metadataFunction = server.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "cleanProviderMetadata");
assert.ok(metadataFunction, "Use the real pure metadata helper with the extracted Server branch.");
const executeGateway = ts.transpileModule(`(() => {
  ${metadataFunction.getText(server)}
  const essentialScenePrecompositionPrompt = ${initializer("essentialScenePrecompositionPrompt")};
  const generateVideoGateway = ${initializer("generateVideoGateway")};
  return generateVideoGateway();
})()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const profile = {
  business: { companyName: "Atelier Test", professionLabel: "Artisan", services: [], customerTypologies: [], strengths: [], interventionZones: [] },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
  preferences: { language: "fr", customInstructions: "" },
} as unknown as NormalizedAiGenerationProfile;

test("the real Server never starts a fallback film after an uncertain Gateway peer, while a definite rejection retains the compatible fallback", async () => {
  const executeProvider = ts.transpileModule(`(() => {
    const generateProviderVideo = ${initializer("generateProviderVideo")};
    return generateProviderVideo(providerRequest);
  })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const cases = [
    { error: Object.assign(new Error("ai_video_gateway_timeout"), { statusCode: 0 }), fallback: false },
    { error: Object.assign(new Error("fetch failed after submission"), { statusCode: 503 }), fallback: false },
    { error: Object.assign(new Error("AbortError"), { statusCode: 503 }), fallback: false },
    { error: new AiVideoProviderBillableFailure({ provider: "gateway-test", model: "veo-test", stage: "film_incomplete" }), fallback: false },
    { error: Object.assign(new Error("definite upstream rejection"), { statusCode: 503 }), fallback: true },
  ];
  for (const entry of cases) {
    const request = normalizeAiMediaGenerationRequest({ requestId: "offline-fallback-safety", source: "studio", operation: "generate", creationMode: "free", kind: "video", inputMode: "essential", subjectSource: "custom",
      videoEngine: "veo", videoResolution: "720p", format: "story", durationSeconds: 16, sceneMode: "multi", freePrompt: "Une personne visite le jardin en deux plans.",
      teamVideoSpeechMode: "voiceover", withNarration: true, withSubtitles: true, withMusic: false });
    const calls: AiVideoProviderGenerationArgs[] = [];
    const fallbackResult = { provider: "offline-fallback", clips: [] };
    const context = {
      providerRequest: request, args: { accountId: "offline-fallback", signal: new AbortController().signal },
      isFreeCreation: true, profile, usesSeparateAiMediaFreeVoiceover, buildAiMediaVideoProviderContract,
      getAiMediaVideoSegmentDurations, getAiVideoProviderRecoverableStatus, isAiVideoProviderBillableFailure, classifyVeoFailure,
      creativePlan: { companyName: "", headline: "", subline: "", cta: "", scenes: [{ visualBrief: "La personne observe les fleurs." }, { visualBrief: "Elle poursuit la visite." }] },
      segmentDurations: [8, 8], globalMediaConstraints: "", effectiveColors: [], prompt: request.freePrompt, promptHash: "offline-hash",
      speechLanguage: "fr", nativeNarrationLines: undefined, subtitleLines: undefined, useFreeDna: false, pipelineWarnings: [], recordVideoEngineFailure() {},
      generateOriginalAiVideoClips: async (input: AiVideoProviderGenerationArgs) => {
        calls.push(input);
        if (calls.length === 1) throw entry.error;
        return fallbackResult;
      },
    };
    const execution = vm.runInNewContext(executeProvider, context, { timeout: 1_000 }) as Promise<unknown>;
    if (entry.fallback) {
      assert.equal(await execution, fallbackResult);
      assert.deepEqual(calls.map((call) => call.request.videoEngine), ["veo", "omni"]);
      assert.equal(calls[1].request.durationSeconds, 16); assert.equal(calls[1].request.sceneMode, "multi");
      assert.equal(calls[1].request.withNarration, false); assert.equal(calls[1].request.withSubtitles, false);
      assert.equal(calls[1].request.freePrompt, request.freePrompt, "the legitimate fallback keeps the same brief");
    } else {
      await assert.rejects(execution, (error: unknown) => error === entry.error);
      assert.equal(calls.length, 1, "uncertainty or an existing paid asset cannot submit another film");
    }
  }
});

function sourceRequest(role: AiMediaInspirationImage["role"], brief: string, photo: Buffer) {
  const normalized = normalizeAiMediaGenerationRequest({
    requestId: "free-auto-identity-master-frame-test",
    source: "studio", operation: "generate", creationMode: "free", kind: "video",
    inputMode: "essential", identityMode: "auto", identityConsent: true,
    videoEngine: "grok", videoResolution: "720p", format: "story",
    durationSeconds: 20, sceneMode: "multi", teamVideoMode: "cinematic",
    teamVideoSpeechMode: "voiceover", withNarration: false, withMusic: false,
    freePrompt: brief,
    inspirationImages: [{ data: photo.toString("base64"), mimeType: "image/png", role, usage: "required",
      ...(role === "character" ? { characterIndex: 1 } : {}) }],
  });
  // Exercise the supported Server input that keeps automatic identity mode;
  // normalizing this fixture again would mask the master-frame regression.
  return { ...normalized, inputMode: "essential", identityMode: "auto" } as AiMediaGenerationRequest;
}

async function runEssentialGateway(request: AiMediaGenerationRequest, photo: Buffer, shots = ["Les personnes observent le jardin.", "Elles poursuivent la visite."]) {
  const imageCalls: Array<{ prompt: string; identityReferences: Buffer[] }> = [];
  const videoCalls: AiMediaGenerationRequest[] = [];
  const scenePrompts: string[] = [];
  const codecCalls: Buffer[] = [];
  const original = JSON.stringify(request);
  const generatedFrame = Buffer.from("generated-master-frame");
  const masterImage = { data: Buffer.from("normalized-master-frame").toString("base64"), mimeType: "image/png" };
  const videoResult = { clips: [{ url: "https://offline.invalid/one-clip" }] };
  const plan = {
    companyName: "", headline: "", subline: request.freePrompt, cta: "",
    scenes: shots.map(visualBrief => ({
      eyebrow: "", title: "", body: "", spokenReply: "", visualBrief, layout: "hero" as const,
    })),
  };
  const context = {
    providerRequest: request, profile, creativePlan: plan, isFreeCreation: true,
    officialLogo: null, localDnaLogo: false, useFreeDna: false,
    promptBrandColors: [], effectiveColors: [], businessDnaContext: undefined,
    preparedIdentityReferences: { buffers: [photo] },
    preparedCharacterBuffers: request.inspirationImages.filter(image => image.role === "character").map(() => photo),
    preparedReferenceRoles: request.inspirationImages.map(({ role, usage }) => ({ role, usage })),
    imageGenerationSize: "1024x1536", args: { accountId: "offline-auto-identity" },
    teamPrecompositionGateway: undefined, teamPrecompositionModel: undefined, teamPrecompositionMetadata: undefined,
    hasProvidedAiMediaCharacterVoice, isAiMediaCharacterVoiceEngine, needsControlledAiMediaFreeFirstFrame,
    buildAiMediaFreeSceneFramePrompt,
    measure: async <T,>(_stage: string, operation: () => Promise<T>) => operation(),
    generateAiMediaImage: async (input: { prompt: string; identityReferences: Buffer[] }) => {
      imageCalls.push(input);
      return { buffer: generatedFrame, model: "offline-image-provider" };
    },
    prepareReferenceTeamCompositionForAnimation: async (buffer: Buffer) => {
      codecCalls.push(buffer);
      return masterImage;
    },
    generateProviderVideo: async (nextRequest: AiMediaGenerationRequest) => {
      videoCalls.push(nextRequest);
      const providerContract = buildAiMediaVideoProviderContract({ request: nextRequest, durationSeconds: 10, brandColors: [] });
      const provider = { request: nextRequest, plan, providerContract, contentLanguage: "fr" } as AiVideoProviderGenerationArgs;
      for (const index of [0, 1]) scenePrompts.push(buildAiMediaFreeVideoScenePrompt(provider, index, 10));
      return videoResult;
    },
  };
  const result = await vm.runInNewContext(executeGateway, context, { timeout: 1_000 }) as typeof videoResult;
  assert.equal(result, videoResult);
  assert.equal(imageCalls.length, 1, "The real branch performs one master-frame provider call.");
  assert.equal(codecCalls.length, 1);
  assert.equal(codecCalls[0], generatedFrame);
  assert.equal(videoCalls.length, 1, "Keeping the role cannot add a video provider call.");
  assert.equal(imageCalls[0].identityReferences.length, 1);
  assert.equal(imageCalls[0].identityReferences[0], photo, "The complete original reference reaches precomposition unchanged.");
  assert.equal(JSON.stringify(request), original, "Master-frame preparation must not mutate the source photo, role or brief.");
  assert.equal(videoCalls[0].identityMode, "auto");
  assert.equal(videoCalls[0].inspirationImages.length, 1);
  assert.equal(videoCalls[0].inspirationImages[0].data, masterImage.data);
  assert.equal(videoCalls[0].inspirationImages[0].usage, "required");
  return { imageCalls, videoCalls, scenePrompts, plan };
}

test("the real Server sends only its prepared first shot as the current master-frame action and keeps the entire film as chronological context", async () => {
  const photo = Buffer.from("opaque-single-person-photo".repeat(5));
  const brief = "Une seule personne dans un jardin. Plan1 : OBSERVER_LES_LAVANDES. Plan2 : MARCHER_VERS_LA_TERRASSE. Le panneau demandé porte exactement « Jardin 39,90 € ».";
  const request = sourceRequest("character", brief, photo);
  const shots = ["INITIAL_SHOT_PERSONNE_SEULE observe les lavandes près du panneau « Jardin 39,90 € ».", "FUTURE_SHOT_TERRASSE la même personne marche vers la terrasse."];
  const runtime = await runEssentialGateway(request, photo, shots);
  const prompt = runtime.imageCalls[0].prompt;
  const [current, context] = prompt.split("CONTEXTE DU FILM COMPLET — CHRONOLOGIQUE, PAS SIMULTANÉ");
  assert.ok(current.includes(shots[0])); assert.ok(!current.includes(shots[1]));
  assert.ok(context.includes(brief), "The complete exact brief remains available without regex-stripping future actions or exact text.");
  assert.match(current, /une duplication ou action annoncée pour un plan ultérieur n’apparaît pas encore ici/);
  assert.ok(runtime.scenePrompts[1].includes(shots[1]), "Shot two remains distinct and keeps its own action.");
  assert.equal(runtime.videoCalls[0].sceneMode, "multi");
  assert.equal(runtime.videoCalls[0].durationSeconds, request.durationSeconds);
});

test("two adults in one reference stay distinct while a later explicitly requested clone remains future film context", async () => {
  const photo = Buffer.from("opaque-group-photo-two-adults".repeat(5));
  const brief = "Deux adultes distincts de la photo visitent le jardin. Plan1 : ils observent les fleurs ensemble. Plan2 : duplication fantastique explicite du premier adulte à côté de la terrasse.";
  const request = sourceRequest("character", brief, photo);
  const shots = ["Deux adultes distincts observent les fleurs ensemble au début de la visite.", "Le premier adulte et son clone explicitement demandé apparaissent à la terrasse ; le second adulte reste distinct."];
  const runtime = await runEssentialGateway(request, photo, shots);
  const prompt = runtime.imageCalls[0].prompt;
  const [current, context] = prompt.split("CONTEXTE DU FILM COMPLET — CHRONOLOGIQUE, PAS SIMULTANÉ");
  assert.ok(current.includes(shots[0])); assert.ok(!current.includes(shots[1]));
  assert.match(current, /preserve distinct people in group photos/);
  assert.match(current, /duplications explicitement demandées pour ce plan/);
  assert.ok(context.includes(brief));
  assert.ok(runtime.scenePrompts[1].includes(shots[1]), "Explicit future duplication is preserved rather than globally banned.");
  assert.equal(runtime.imageCalls[0].identityReferences[0], photo);
});

test("a changed first director shot changes the real master prompt without importing the future shot into its current action", async () => {
  const photo = Buffer.from("opaque-one-person-photo".repeat(5));
  const request = sourceRequest("character", "Une seule personne visite un jardin en deux plans, puis rejoint la terrasse.", photo);
  const first = await runEssentialGateway(request, photo, ["FIRST_A personne près des lavandes.", "LATER_A personne à la terrasse."]);
  const second = await runEssentialGateway(request, photo, ["FIRST_B personne près des rosiers.", "LATER_B personne à la terrasse."]);
  assert.notEqual(first.imageCalls[0].prompt, second.imageCalls[0].prompt);
  assert.ok(first.imageCalls[0].prompt.includes("FIRST_A"));
  assert.ok(second.imageCalls[0].prompt.includes("FIRST_B"));
  assert.ok(!first.imageCalls[0].prompt.includes("LATER_A"));
  assert.ok(!second.imageCalls[0].prompt.includes("LATER_B"));
});

test("initial-shot structure preserves exact visual text, requested ADN facts, account constraints and explicit duplication in that current shot", () => {
  const photo = Buffer.from("opaque-synthetic-reference".repeat(5));
  const request = { ...sourceRequest("character", "Plan1 : deux copies fantastiques explicitement voulues du même adulte près du panneau « Jardin 39,90 € ». Plan2 : les copies rejoignent la terrasse. Utiliser notre ADN, notre téléphone et le lien de notre site.", photo), useBusinessDna: true };
  const current = "Deux copies de l’adulte, explicitement demandées ensemble dès le premier plan, près du panneau « Jardin 39,90 € ».";
  const prompt = buildAiMediaFreeSceneFramePrompt({ request,
    profile: { ...profile, preferences: { ...profile.preferences, customInstructions: "CONTRAINTE_COMPTE_INTACTE" } },
    businessDnaContext: { coordonnees: { telephone: "04 12 34 56 78" }, liens: { site: "https://example.com/jardin" }, informations_demandees: ["Terrasse en bois local, prix 39,90 €."] },
  }, { visualBrief: current });
  assert.ok(prompt.includes(current)); assert.ok(prompt.includes(request.freePrompt!));
  for (const exact of ["CONTRAINTE_COMPTE_INTACTE", "04 12 34 56 78", "https://example.com/jardin", "Terrasse en bois local, prix 39,90 €."]) assert.ok(prompt.includes(exact), exact);
  assert.match(prompt, /Image 1 — rôle character, usage obligatoire/);
  assert.match(prompt, /unless explicitly duplicated in the user's brief/);
  assert.match(prompt, /duplications explicitement demandées pour ce plan/);
});

test("essential Free auto identity retains a required character master frame and the real cast rule in both available-engine shots", async () => {
  const photo = Buffer.from("opaque-original-portrait-reference-contents".repeat(3));
  const request = sourceRequest("character", "La personne de la photo visite un jardin, toujours seule, en deux plans.", photo);
  const runtime = await runEssentialGateway(request, photo);
  const cast = buildAiMediaFreeVideoCastContract(request);
  assert.ok(cast);
  assert.equal(runtime.videoCalls[0].inspirationImages[0].role, "character");
  for (const prompt of [runtime.imageCalls[0].prompt, ...runtime.scenePrompts]) {
    assert.ok(prompt.includes(cast), "The real initial-frame and shot builders retain the character identity contract.");
    assert.match(prompt, /Each distinct identity at most once per frame/);
  }
});

test("one required group photo retains its full data and distinct people without treating one master frame as one person", async () => {
  const groupPhoto = Buffer.from("opaque-group-photo-with-two-distinct-colleagues".repeat(3));
  const brief = "La photo de groupe montre deux collègues distincts. Les conserver ensemble dans chaque plan du jardin.";
  const request = sourceRequest("character", brief, groupPhoto);
  const runtime = await runEssentialGateway(request, groupPhoto);
  assert.equal(runtime.videoCalls[0].inspirationImages[0].role, "character");
  assert.equal(runtime.videoCalls[0].freePrompt, brief);
  assert.equal(request.inspirationImages[0].data, groupPhoto.toString("base64"));
  for (const prompt of [runtime.imageCalls[0].prompt, ...runtime.scenePrompts]) {
    assert.match(prompt, /preserve distinct people in group photos/);
    assert.match(prompt, /File\/shot count is not cast size/);
    assert.doesNotMatch(prompt, /exactly (?:one|1) person|one photo means one person/i);
  }
});

test("essential Free auto identity keeps required product and inspiration master frames outside the character cast", async () => {
  for (const role of ["product", "inspiration"] as const) {
    const photo = Buffer.from(`opaque-original-${role}-reference-contents`.repeat(3));
    const request = sourceRequest(role, "Le vase de la référence est posé dans un jardin calme, en deux plans.", photo);
    const runtime = await runEssentialGateway(request, photo);
    assert.equal(runtime.videoCalls[0].inspirationImages[0].role, "inspiration");
    assert.equal(buildAiMediaFreeVideoCastContract(request), "");
    for (const prompt of [runtime.imageCalls[0].prompt, ...runtime.scenePrompts]) {
      assert.ok(!prompt.includes("CAST:"), "Visual-only references must not introduce a required character.");
    }
  }
});

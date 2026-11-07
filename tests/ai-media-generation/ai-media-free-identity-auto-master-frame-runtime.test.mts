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
import { needsControlledAiMediaFreeFirstFrame } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

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
  business: { companyName: "Atelier Test", professionLabel: "Artisan", services: [] },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
  preferences: { language: "fr", customInstructions: "" },
} as unknown as NormalizedAiGenerationProfile;

function sourceRequest(role: AiMediaInspirationImage["role"], brief: string, photo: Buffer) {
  const normalized = normalizeAiMediaGenerationRequest({
    requestId: "free-auto-identity-master-frame-test",
    source: "studio", operation: "generate", creationMode: "free", kind: "video",
    inputMode: "essential", identityMode: "auto", identityConsent: true,
    videoEngine: "wan3", videoResolution: "720p", format: "story",
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

async function runEssentialGateway(request: AiMediaGenerationRequest, photo: Buffer) {
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
    scenes: ["Les personnes observent le jardin.", "Elles poursuivent la visite."].map(visualBrief => ({
      eyebrow: "", title: "", body: "", spokenReply: "", visualBrief, layout: "hero" as const,
    })),
  };
  const context = {
    providerRequest: request, profile, isFreeCreation: true,
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
  return { imageCalls, videoCalls, scenePrompts };
}

test("essential Free auto identity retains a required character master frame and the real cast rule in both Wan3 shots", async () => {
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

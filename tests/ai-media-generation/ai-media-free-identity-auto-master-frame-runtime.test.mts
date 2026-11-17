import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { normalizeAiMediaGenerationRequest, type AiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaDirectVideoPlan } from "../../lib/aiMediaDirectVideoPipeline.ts";
import { buildAiMediaFreeVideoScenePrompt } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import { isAiVideoProviderPending } from "../../lib/aiMediaPendingVideo.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

const source = ts.createSourceFile("aiMediaGenerationServer.ts", readFileSync(new URL("../../lib/aiMediaGenerationServer.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function initializer(name: string) {
  const declarations: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) declarations.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(declarations.length, 1);
  return declarations[0].getText(source);
}
function executable(names: string[], expression: string) {
  return ts.transpileModule(`(async () => { ${names.map(name => "const " + name + " = " + initializer(name) + ";").join("\n")} return await ${expression}; })()`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
function request(role: "character" | "environment" | "product" | "inspiration" = "character") {
  return normalizeAiMediaGenerationRequest({ requestId: "direct-original-reference", source: "studio", operation: "generate",
    creationMode: "free", kind: "video", inputMode: "essential", identityConsent: true,
    videoEngine: "grok-lite", videoResolution: "720p", format: "story", durationSeconds: 20, sceneMode: "multi",
    teamVideoSpeechMode: "voiceover", withNarration: false, withMusic: false,
    freePrompt: "Dans le jardin, les personnes de la photo marchent puis présentent les fleurs. Ne pas remplacer le jardin par un fond blanc.",
    inspirationImages: [{ role, usage: "required", mimeType: "image/png", data: Buffer.from("original-reference".repeat(10)).toString("base64"), ...(role === "character" ? {characterIndex: 1} : {}) }],
  });
}

for (const role of ["character", "environment", "product", "inspiration"] as const) {
  test("the actual direct Free shortcut sends the original " + role + " reference, role and raw brief without a generated frame", async () => {
    const input = request(role), before = structuredClone(input), plan = buildAiMediaDirectVideoPlan(input);
    const calls: AiMediaGenerationRequest[] = [];
    const forbid = () => assert.fail("Direct Free video cannot generate, encode or substitute a still image");
    const result = { provider: "offline-real-video", clips: [] };
    const promise = vm.runInNewContext(executable(["essentialScenePrecompositionPrompt", "generateVideoGateway"], "generateVideoGateway()"), {
      isDirectVideo: true, providerRequest: input, isFreeCreation: true,
      preparedCharacterBuffers: role === "character" ? [Buffer.from("portrait")] : [],
      measure: async (_stage: string, action: () => unknown) => action(),
      generateProviderVideo: async (next: AiMediaGenerationRequest) => { calls.push(next); return result; },
      generateAiMediaImage: forbid, generateAiMediaImageWithGoogle: forbid,
      prepareReferenceTeamCompositionForAnimation: forbid, buildAiMediaFreeSceneFramePrompt: forbid,
      needsControlledAiMediaFreeFirstFrame: forbid, createAiMediaFallbackVideo: forbid,
    }, { timeout: 1000 }) as Promise<unknown>;
    assert.equal(await promise, result);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].inspirationImages, input.inspirationImages);
    assert.equal(calls[0].freePrompt, input.freePrompt);
    assert.deepEqual(input, before);
    for (const [index, duration] of getAiMediaVideoSegmentDurations(input.durationSeconds!, input.videoEngine, input.videoResolution, input.sceneMode).entries()) {
      const prompt = buildAiMediaFreeVideoScenePrompt({ request: input, plan, directVideo: true,
        providerContract: buildAiMediaVideoProviderContract({ request: input, durationSeconds: duration, brandColors: [] }) }, index, duration);
      assert.ok(prompt.startsWith(input.freePrompt!));
      assert.match(prompt, new RegExp("#1 " + role));
      assert.doesNotMatch(prompt, /generated-master-frame|EMPTY LOCATION|synthetic-normalized-seed/);
    }
  });
}

test("the actual direct provider branch preserves both definite and uncertain errors without paying another engine", async () => {
  const input = request("product"), calls: AiVideoProviderGenerationArgs[] = [];
  for (const error of [new Error("definite rejection"), Object.assign(new Error("fetch failed after submission"), { statusCode: 503 }), new Error("ai_video_gateway_timeout")]) {
    calls.length = 0;
    const promise = vm.runInNewContext(executable(["generateProviderVideo"], "generateProviderVideo(providerRequest)"), {
      isDirectVideo: true, isFreeCreation: true, providerRequest: input, args: { accountId: "active-account", jobId: "active-job" },
      profile: {}, creativePlan: buildAiMediaDirectVideoPlan(input), usesSeparateAiMediaFreeVoiceover, buildAiMediaVideoProviderContract,
      globalMediaConstraints: "OWN ACCOUNT RULE", effectiveColors: [], prompt: input.freePrompt, promptHash: "fixture-sha",
      speechLanguage: "fr", nativeNarrationLines: undefined, subtitleLines: undefined, useFreeDna: false, isAiVideoProviderPending,
      getAiMediaVideoSegmentDurations,
      generateOriginalAiVideoClips: async (args: AiVideoProviderGenerationArgs) => { calls.push(args); throw error; },
      recordVideoEngineFailure: () => assert.fail("Direct Free must return its own provider's error"),
    }, { timeout: 1000 }) as Promise<unknown>;
    await assert.rejects(promise, caught => caught === error);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].directVideo, true);
    assert.equal(calls[0].request.videoEngine, input.videoEngine);
    assert.equal(calls[0].canonicalPrompt, input.freePrompt);
    assert.deepEqual(calls[0].request.inspirationImages, input.inspirationImages);
  }
});

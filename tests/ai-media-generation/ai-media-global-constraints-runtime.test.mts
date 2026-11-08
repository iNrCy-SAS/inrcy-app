import * as nativeQa from "../../lib/aiMediaNativeDialogueQa.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as globals from "../../lib/aiMediaGlobalConstraints.ts";
import * as freePrompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as providerContracts from "../../lib/aiMediaVideoProviderContract.ts";
import * as videoTypes from "../../lib/aiVideoProviderTypes.ts";
import { buildInrAgentMediaGenerationRequest } from "../../lib/inrAgentMediaRequest.ts";
import { resolveInrAgentMediaMix } from "../../lib/inrAgentMediaMix.ts";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import type { AiMediaCreativePlan } from "../../lib/aiMediaCreativePlan.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";

type Row = Record<string, unknown>;
type PromptModule = typeof import("../../lib/aiMediaGenerationPrompt.ts");
type GatewayModule = typeof import("../../lib/aiVideoProviderGateway.ts");
type ServerModule = typeof import("../../lib/aiMediaGenerationServer.ts");
type FreePlanModule = typeof import("../../lib/aiMediaFreeGenerationPlan.ts");
type ImageCall = Parameters<typeof import("../../lib/aiMediaGateway.ts").generateAiMediaImage>[0];
const prohibition = "Aucun média IA généré ne doit contenir de personnes.";
const instruction = "Montrer les produits et les lieux réels, avec une lumière douce et une composition sobre.";
const plan: AiMediaCreativePlan = { headline: "", subline: "Un produit sur une table.", cta: "", companyName: "",
  scenes: [{ eyebrow: "", title: "", body: "", spokenLine: "", spokenReply: "", visualBrief: "Le produit tourne lentement sur la table.", layout: "hero" }] };

function profile(overrides: Row = {}): NormalizedAiGenerationProfile {
  return { business: { companyName: "PRIVATE_COMPANY", professionLabel: "PRIVATE_PROFESSION", services: [],
    customerTypologies: [], strengths: [], interventionZones: [], phone: "PRIVATE_PHONE" },
    memory: { targetAudiences: [], differentiators: [], recentNewsItems: [], referenceDocuments: [] },
    preferences: { language: "fr", premiumEnabled: false, tone: "PRIVATE_WRITING_TONE", communicationStyle: "PRIVATE_WRITING_STYLE",
      customInstructions: instruction, forbiddenInstructions: prohibition, ...overrides } } as unknown as NormalizedAiGenerationProfile;
}

/** Real local modules, with every external service replaced before evaluation. */
function runtime(overrides: ReadonlyMap<string, Row> = new Map()) {
  const cache = new Map<string, Row>();
  const nativeRequire = createRequire(import.meta.url);
  const never = () => { throw new Error("unexpected_paid_or_network_call"); };
  const external = new Map<string, Row>([
    ["server-only", {}], ["@google/genai", { GoogleGenAI: class { constructor() { never(); } } }],
    ["ai", { experimental_generateVideo: never, createDownload: () => never }], ["@ai-sdk/gateway", { createGateway: () => ({ video: never }) }],
    ["@/lib/aiGatewayAccountGuard", {}], ["./aiMediaVideoContinuity.ts", {}], ["./aiMediaVideoTemporaryImages.ts", {}],
    ...overrides,
  ]);
  function load<Module extends object = Row>(filename: string): Module {
    const absolute = path.resolve(filename);
    if (cache.has(absolute)) return cache.get(absolute)! as unknown as Module;
    const record = { exports: {} as Row };
    cache.set(absolute, record.exports);
    const source = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("module", "exports", "require", source)(record, record.exports, (name: string) => {
      if (external.has(name)) return external.get(name);
      if (name.startsWith("node:")) return nativeRequire(name);
      const target = name.startsWith("@/") ? path.resolve(name.slice(2)) : name.startsWith(".") ? path.resolve(path.dirname(absolute), name) : "";
      if (!target) throw new Error(`unexpected_external_dependency:${name}`);
      const resolved = [target, `${target}.ts`, `${target}.tsx`, `${target}.json`].find((item) => existsSync(item));
      if (!resolved) throw new Error(`missing_local_dependency:${name}`);
      return resolved.endsWith(".json") ? nativeRequire(resolved) : load(resolved);
    });
    cache.set(absolute, record.exports);
    // The only type boundary is the evaluated module, matching its real exports.
    return record.exports as unknown as Module;
  }
  return { load };
}

const real = runtime();
const prompts = real.load<PromptModule>("lib/aiMediaGenerationPrompt.ts");
const transport = real.load<GatewayModule>("lib/aiVideoProviderGateway.ts");

function request(kind: "image" | "video", useBusinessDna = false) {
  return contracts.normalizeAiMediaGenerationRequest({ requestId: "global-media-rule-test", source: "studio", creationMode: "free", operation: "generate",
    kind, format: "story", freePrompt: "Un produit sur une table.", useBusinessDna,
    videoEngine: "grok-lite", durationSeconds: 8, sceneMode: "single", withNarration: false, withSubtitles: false, withMusic: false });
}

function harness(activeProfile = profile(), failVideo = false, allowGeneratedFrameMotion = false) {
  const imageCalls: ImageCall[] = [];
  const videoCalls: Array<{ args: AiVideoProviderGenerationArgs; body: ReturnType<GatewayModule["buildGatewayAiVideoRequest"]> }> = [];
  const contextCalls: Row[] = [], saved: Row[] = [], rawFallbackCalls: Row[] = [], generatedFrameMotionCalls: Row[] = [];
  const normalizedImage = { kind: "image", buffer: Buffer.from("image"), mimeType: "image/png", extension: "png", width: 1024, height: 1536 };
  const normalizedVideo = { ...normalizedImage, kind: "video", mimeType: "video/mp4", extension: "mp4", durationSeconds: 8 };
  const forbidFallback = async (args: Row) => { rawFallbackCalls.push(args); throw new Error("raw_fallback_must_not_run"); };
  const modules = new Map<string, Row>([
    ["@/lib/aiMediaNativeDialogueQa", nativeQa],
    ["@/lib/aiMediaSensitiveText", sensitive],
    ["server-only", {}], ["sharp", (() => ({ png() { return this; }, toBuffer: async () => Buffer.from("overlay") })) as unknown as Row],
    ["./aiMediaGlobalConstraints.ts", globals],
    ["./aiMediaImageProviderGateway.ts", {}],
    ["@/lib/aiGenerationProfile", { buildNormalizedAiGenerationProfile: () => activeProfile }],
    ["@/lib/boosterGenerationContext", { getBoosterGenerationContext: async (args: Row) => { contextCalls.push(args); return { profile: {}, business: {}, recentPublications: [], cacheSource: "fresh-test" }; } }],
    ["@/lib/aiGeneratedMediaRegistry", { getExistingGeneratedAiMedia: async () => null, saveGeneratedAiMedia: async (args: Row) => { saved.push(args); return { id: "saved-test", media_type: args.kind }; } }],
    ["@/lib/aiMediaBrandKit", { loadAiMediaBrandKit: async () => ({ logo: null, colors: [], hasOfficialPalette: false }) }],
    ["@/lib/aiMediaFreeDnaContextServer", { loadAiMediaFreeDnaContext: async () => ({ coordonnees: {}, liens: {}, informations_demandees: [] }) }],
    ["@/lib/aiMediaCreativePlan", { buildAiMediaCreativePlan: () => structuredClone(plan) }],
    ["@/lib/aiMediaFreeGenerationPlan", { buildAiMediaFreeBasePlan: () => structuredClone(plan), prepareAiMediaFreeCreativePlan: async () => structuredClone(plan), writeAiMediaFreeNarration: async () => null }],
    ["@/lib/aiMediaCopywriter", { writeAiMediaHeadline: async () => structuredClone(plan) }],
    ["@/lib/aiMediaCastingVariation", { chooseAiMediaCastingVariation: () => null }],
    ["@/lib/aiMediaGenerationPrompt", prompts], ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaFreeGenerationPrompt", freePrompts], ["@/lib/aiMediaVideoProviderContract", providerContracts],
    ["@/lib/aiMediaFreeVoiceoverPolicy", real.load("lib/aiMediaFreeVoiceoverPolicy.ts")],
    ["@/lib/aiMediaImageProviderRequest", real.load("lib/aiMediaImageProviderRequest.ts")],
    ["@/lib/aiMediaVideoTimeline", real.load("lib/aiMediaVideoTimeline.ts")],
    ["@/lib/aiMediaVisibleContact", real.load("lib/aiMediaVisibleContact.ts")],
    ["@/lib/aiMediaNarrationPreparation", { prepareAiMediaNarration: async () => ({ narration: null, audio: null, warnings: [] }) }],
    ["@/lib/aiMediaIdentityReferences", { AiMediaIdentityReferenceValidationError: class extends Error {}, prepareAiMediaIdentityReferences: async (images: Row[]) => ({ providerImages: images, buffers: images.map(() => Buffer.from("reference")) }) }],
    ["@/lib/aiMediaGateway", { generateAiMediaImage: async (args: ImageCall) => { imageCalls.push(args); return { buffer: Buffer.from("provider-image"), model: "mock-image-provider", provider: "mock", warnings: [] }; } }],
    ["@/lib/aiMediaNormalizer", { normalizeGeneratedAiMedia: async () => normalizedImage, normalizeGeneratedAiImage: async () => normalizedImage }],
    ["@/lib/aiMediaBrandRenderer", { renderAiMediaVideoOverlay: async () => Buffer.from("overlay"), composeAiMediaBrandedImage: async () => normalizedImage }],
    ["@/lib/aiVideoProvider", { generateOriginalAiVideoClips: async (args: AiVideoProviderGenerationArgs) => {
      const body = transport.buildGatewayAiVideoRequest(args);
      videoCalls.push({ args, body });
      if (failVideo) throw new Error("provider_unavailable");
      return { provider: "mock", model: "mock-video", warnings: [], clips: [{ buffer: Buffer.from("clip"), mediaType: "video/mp4", durationSeconds: 8, sourceStartSeconds: 0 }] };
    } }],
    ["@/lib/aiMediaGeneratedVideo", { AiMediaNarrationTooLongError: class extends Error {}, composeOriginalAiVideo: async () => normalizedVideo }],
    ["@/lib/aiMediaVideoLocalQa", { inspectAiMediaVideoBufferLocally: async () => ({ version: 1, status: "ok", blocking: false, advisories: [] }) }],
    ["@/lib/aiMediaVideoTemporaryImages", { preflightAiMediaVideoTemporaryImages: async () => {} }],
    ["@/lib/aiMediaReferenceTeam", { createAiMediaFallbackVideo: async (args: Row) => {
      if (!allowGeneratedFrameMotion) return forbidFallback(args);
      assert.equal(imageCalls.length, 1, "this animation starts from a provider-generated frame, never raw portraits");
      assertCompleteRules(imageCalls[0].prompt, activeProfile);
      generatedFrameMotionCalls.push(args);
      return { provider: "local-compliant-frame", model: "local-motion", warnings: [], clips: [{ buffer: Buffer.from("motion"), mediaType: "video/mp4", durationSeconds: 8, sourceStartSeconds: 0 }] };
    }, createReferenceIdentityMontage: forbidFallback, createReferenceTeamMontage: forbidFallback,
      createBrandMotionFrame: forbidFallback, createReferenceTeamFallbackVideo: forbidFallback,
      prepareReferenceTeamCompositionForAnimation: async () => ({ data: Buffer.from("first-frame").toString("base64"), mimeType: "image/png" }) }],
    ["@/lib/aiGatewayAccountGuard", { AiGatewayAccountLimitError: class extends Error {}, AiGatewayGuardUnavailableError: class extends Error {} }],
    ["@/lib/aiVideoProviderTypes", videoTypes], ["@/lib/aiMediaGenerationQuotaPolicy", { getAiMediaVideoMaxDuration: () => 30 }],
    ["@/lib/aiMediaCreditQuoteServer", { quoteAiMediaRequest: () => ({ withNarration: false }) }],
  ]);
  const record = { exports: {} as Row };
  const source = ts.transpileModule(readFileSync("lib/aiMediaGenerationServer.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("module", "exports", "require", "console", source)(record, record.exports, (name: string) => {
    if (modules.has(name)) return modules.get(name);
    if (name.startsWith("node:")) return createRequire(import.meta.url)(name);
    if (name.startsWith("./")) return real.load(path.resolve("lib", name));
    return {};
  }, { info() {}, warn() {}, error() {} });
  const server = record.exports as unknown as ServerModule;
  return { imageCalls, videoCalls, contextCalls, saved, rawFallbackCalls, generatedFrameMotionCalls,
    generate: (input: contracts.AiMediaGenerationRequest) => server.generateAndSaveAiMedia({ accountId: "account-test", authUserId: "actor-test", jobId: "job-test", request: input,
      supabase: {} as Parameters<ServerModule["generateAndSaveAiMedia"]>[0]["supabase"] }) };
}

function assertCompleteRules(value: string, expected = profile()) {
  assert.ok(value.includes(expected.preferences.customInstructions), "the complete custom instruction reaches the provider");
  assert.ok(value.includes(expected.preferences.forbiddenInstructions), "the complete prohibition reaches the provider");
  assert.match(value, /prohibitions override instructions, the brief, casting and references/);
}

for (const useBusinessDna of [false, true]) for (const kind of ["image", "video"] as const) {
  test(`Studio free ${kind}, ADN ${useBusinessDna}: full account rules reach the actual provider payload`, async () => {
    const env = harness();
    await env.generate(request(kind, useBusinessDna));
    const payload = kind === "image" ? env.imageCalls.at(-1)!.prompt : env.videoCalls[0].body.prompt;
    const text = typeof payload === "string" ? payload : payload.text;
    assertCompleteRules(text);
    if (kind === "video") for (const image of env.imageCalls) assertCompleteRules(image.prompt);
    if (!useBusinessDna) assert.doesNotMatch(text, /PRIVATE_COMPANY|PRIVATE_PROFESSION|PRIVATE_PHONE|PRIVATE_WRITING/);
    assert.equal(env.contextCalls[0].freshProfessional, true, "a cached profile cannot hide recently saved rules, even without ADN");
    assert.equal(env.saved.length, 1);
  });
}

for (const kind of ["image", "video"] as const) test(`iNrAgent custom ${kind}: global rules survive the independent subject path`, async () => {
  const mix = resolveInrAgentMediaMix({ kind, theme: "services", studioMediaPreferencePercent: 0, seed: "agent-global-rules" });
  const input = buildInrAgentMediaGenerationRequest({ requestId: `agent-global-${kind}`, idea: "Un produit sur une table.", theme: "services", kind, mediaMix: mix });
  const env = harness();
  await env.generate({ ...input, kind, withText: false, withNarration: false, withSubtitles: false, withMusic: false, videoEngine: "grok-lite", durationSeconds: 8 });
  const payload = kind === "image" ? env.imageCalls.at(-1)!.prompt : env.videoCalls[0].body.prompt;
  assertCompleteRules(typeof payload === "string" ? payload : payload.text);
  assert.equal(input.subjectSource, "custom");
});

test("account rules remain complete after character160 and at the UI1200 limit", () => {
  const active = profile({ customInstructions: `${"C".repeat(1172)} CONSIGNE_FINALE_COMPLETE`, forbiddenInstructions: `${"I".repeat(1170)} INTERDICTION_FINALE_COMPLETE` });
  assertCompleteRules(prompts.buildAiMediaPrompt({ request: request("image"), profile: active }), active);
  const contract = providerContracts.buildAiMediaVideoProviderContract({ request: request("video"), durationSeconds: 8, brandColors: [], globalMediaConstraints: globals.buildAiMediaGlobalConstraints(active) });
  assertCompleteRules(contract.globalMediaConstraints!, active);
  assert.throws(() => transport.buildGatewayAiVideoRequest({ accountId: "account-test", request: request("video"), plan, providerContract: contract,
    canonicalPrompt: "canonical", canonicalPromptSha256: providerContracts.hashAiMediaCanonicalPrompt("canonical"), creativeBrief: "", brandColors: [], profession: "" }), /contract_too_long/,
    "irreducible rules fail before any provider request instead of being shortened");
});

test("the signed video contract detects altered global instructions", () => {
  const contract = providerContracts.buildAiMediaVideoProviderContract({ request: request("video"), durationSeconds: 8, brandColors: [], globalMediaConstraints: globals.buildAiMediaGlobalConstraints(profile()) });
  assert.throws(() => providerContracts.assertAiMediaVideoProviderContract({ ...contract, globalMediaConstraints: "altered" }), /integrity_failed/);
});

test("a nonvisual use of personne is transmitted without a fragile human-ban classifier", () => {
  const active = profile({ customInstructions: "Ne laisser personne sans réponse.", forbiddenInstructions: "" });
  const input = request("image");
  const output = prompts.buildAiMediaPrompt({ request: input, profile: active });
  assert.match(output, /Ne laisser personne sans réponse/);
  assert.equal(input.peopleMode, "auto");
  assert.doesNotMatch(output, /PEOPLE: none|aucune personne, aucun visage/);
});

for (const kind of ["image", "video"] as const) test(`Studio guided ${kind} preserves global rules with the profile subject`, () => {
  const input: contracts.AiMediaGenerationRequest = { ...request(kind), creationMode: "guided", subjectSource: "profile", idea: "Un produit sur une table.", aiInstruction: "Montrer une rotation douce." };
  const output = prompts.buildAiMediaPrompt({ request: input, profile: profile() });
  assertCompleteRules(output);
  assert.match(output, /sécurité et droits ; interdictions globales ; consignes globales pertinentes/);
});

test("required rules survive guided prompt compaction instead of living in optional ADN", () => {
  for (const kind of ["image", "video"] as const) {
    const active = profile();
    active.memory.detailedDescription = "Contexte facultatif de l’entreprise. ".repeat(150);
    const input: contracts.AiMediaGenerationRequest = { ...request(kind), creationMode: "guided", subjectSource: "profile", idea: "Sujet exact. ".repeat(150), aiInstruction: "Instruction distincte. ".repeat(100) };
    const output = prompts.buildAiMediaPrompt({ request: input, profile: active });
    assertCompleteRules(output);
    assert.ok(output.length <= 11_800);
  }
});

test("Modifier image reads only global account rules, never hidden business context", () => {
  const active = new Proxy({ preferences: profile().preferences }, { get(target, key) {
    if (key !== "preferences") throw new Error("modification_read_unrelated_business_context");
    return target.preferences;
  } });
  const output = prompts.buildAiMediaPrompt({ request: { ...request("image"), operation: "modify", aiInstruction: "Remplacer le fond par un fond uni." }, profile: active as NormalizedAiGenerationProfile });
  assertCompleteRules(output);
  assert.doesNotMatch(output, /PRIVATE_COMPANY|PRIVATE_PROFESSION|PRIVATE_PHONE|PRIVATE_WRITING/);
});

test("Wan Flash retains both account fields when rebuilding its smaller provider envelope", () => {
  const input = request("video");
  const contract = providerContracts.buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [], globalMediaConstraints: globals.buildAiMediaGlobalConstraints(profile()) });
  const args: AiVideoProviderGenerationArgs = { accountId: "account-test", request: input, plan, providerContract: contract,
    canonicalPrompt: "canonical", canonicalPromptSha256: providerContracts.hashAiMediaCanonicalPrompt("canonical"), creativeBrief: "", brandColors: [], profession: "" };
  const output = transport.buildWanFlashVideoPrompt(args, freePrompts.buildAiMediaFreeVideoScenePrompt(args, 0, 8));
  assertCompleteRules(output);
  assert.ok(output.length <= 1_500);
  const longContract = { ...contract, globalMediaConstraints: globals.buildAiMediaGlobalConstraints(profile({ forbiddenInstructions: "X".repeat(1_200) })) };
  assert.throws(() => transport.buildWanFlashVideoPrompt({ ...args, providerContract: longContract }, output), /contract_too_long/);
});

test("a provider failure cannot publish raw reference motion under global account rules", async () => {
  const env = harness(profile(), true);
  await assert.rejects(env.generate({ ...request("video"), creationMode: "guided", inputMode: "legacy", subjectSource: "custom", idea: "Un produit sur une table." } as never), /ne peut pas appliquer vos consignes et interdictions/);
  assert.equal(env.videoCalls.length, 1, "the same failure cannot submit another paid generation");
  assert.equal(env.rawFallbackCalls.length, 0);
  assert.equal(env.saved.length, 0);
});

test("explicit raw portrait montage reports an error instead of bypassing configured rules", async () => {
  const env = harness();
  await assert.rejects(env.generate({ ...request("video"), creationMode: "guided", inputMode: "legacy", identityMode: "professional", teamVideoMode: "montage",
    inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role: "character", usage: "required" }] } as never), /ne peut pas appliquer vos consignes et interdictions/);
  assert.equal(env.rawFallbackCalls.length, 0);
  assert.equal(env.videoCalls.length, 0);
  assert.equal(env.saved.length, 0);
});

test("local motion remains available for a frame already generated with the complete rules", async () => {
  const env = harness(profile(), false, true);
  await env.generate({ ...request("video"), creationMode: "guided", inputMode: "legacy", identityMode: "reference_team", teamVideoMode: "montage",
    inspirationImages: [1, 2].map((index) => ({ mimeType: "image/png", data: "A".repeat(88), role: "character", usage: "required", characterIndex: index })) } as never);
  assert.equal(env.generatedFrameMotionCalls.length, 1);
  assert.equal(env.rawFallbackCalls.length, 0);
  assert.equal(env.saved.length, 1);
});

test("free planner and voiceover each receive the two mandatory account fields without unrelated writing settings", async () => {
  const calls: AiGenerateJsonOptions[] = [];
  const loaded = runtime(new Map([["@/lib/aiGatewayClient", { aiGenerateJSON: async (args: AiGenerateJsonOptions) => { calls.push(args); return { direction: plan.subline, scenes: [plan.scenes[0].visualBrief], script: "Le produit tourne doucement dans la lumière." }; } }]]))
    .load<FreePlanModule>("lib/aiMediaFreeGenerationPlan.ts");
  await loaded.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request("video"), profile: profile() });
  await loaded.writeAiMediaFreeNarration({ accountId: "test", request: { ...request("video"), withNarration: true }, profile: profile(), plan });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assertCompleteRules(call.system);
    assert.doesNotMatch(`${call.system} ${call.input}`, /PRIVATE_WRITING|PRIVATE_PROFESSION|PRIVATE_PHONE/);
  }
});

test("failed generated copy cannot fall back to locally invented words that never interpreted the rules", async () => {
  const calls: AiGenerateJsonOptions[] = [];
  const loaded = runtime(new Map([["@/lib/aiGatewayClient", { aiGenerateJSON: async (args: AiGenerateJsonOptions) => { calls.push(args); throw new Error("mock_text_provider_unavailable"); } }]]));
  const input: contracts.AiMediaGenerationRequest = { ...request("video"), creationMode: "guided", subjectSource: "custom", idea: "Un produit sur une table.", textMode: "ai", withText: true, withNarration: true };
  await assert.rejects(loaded.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline({ accountId: "test", request: input, profile: profile(), plan }), /copy_unavailable/);
  await assert.rejects(loaded.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration({ accountId: "test", request: input, profile: profile(), plan }), /narration_unavailable/);
  assert.ok(calls.length <= 4, "global rules do not add a retry loop or another media generation");
  for (const call of calls) assertCompleteRules(call.system);
});

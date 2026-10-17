import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as imageRequest from "../../lib/aiMediaImageProviderRequest.ts";
import * as freePrompt from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as freeVoiceoverPolicy from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import * as agentVideoFallback from "../../lib/inrAgentVideoFallback.ts";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";

type RecordValue = Record<string, unknown>;
function compile(file: string, modules: Map<string, unknown>, quiet = false) {
  const filename = path.join(process.cwd(), file);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const nativeRequire = createRequire(import.meta.url);
  const runtimeModule = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module,console){${javascript}\n})`)(runtimeModule.exports, (id: string) => {
    if (modules.has(id)) return modules.get(id);
    if (id.startsWith("node:")) return nativeRequire(id);
    throw new Error(`unexpected_test_dependency:${id}`);
  }, runtimeModule, quiet ? { info() {}, warn() {}, error() {} } : console);
  return runtimeModule.exports as Record<string, (...args: never[]) => unknown>;
}

function realCapabilityGate() {
  return compile("lib/aiMediaImageProviderGateway.ts", new Map<string, unknown>([
    ["server-only", {}], ["sharp", {}], ["ai", {}], ["@/lib/aiGatewayAccountGuard", {}],
    ["./aiMediaModelCatalog.ts", catalog], ["./aiMediaCreditsPricing.ts", pricing],
    ["./aiMediaBuffer.ts", {}], ["./aiMediaSensitiveText.ts", sensitive],
  ])).assertAiMediaGatewayImageInputs;
}

function serverHarness(providerFailure: boolean | Error = false) {
  const counts = { creative: 0, headline: 0, provider: 0, fallback: 0, branded: 0, saved: 0 };
  const providerCalls: RecordValue[] = [];
  const composerCalls: RecordValue[] = [];
  const saved: RecordValue[] = [];
  const promptCalls: RecordValue[] = [];
  const plan = { companyName: "Atelier Test", headline: "Une création soignée", subline: "Objet original", cta: "",
    scenes: [{ eyebrow: "Atelier Test", title: "Une création soignée", body: "Objet original", visualBrief: "Objet sur une table", layout: "editorial" }] };
  const profile = { business: { companyName: "Atelier Test", phone: "" } };
  const logo = Buffer.from("synthetic-official-logo");
  const unused = ["@/lib/aiMediaBusinessDna", "@/lib/aiMediaImageContactComposer", "@/lib/aiMediaGeneratedVideo", "@/lib/aiMediaVideoLayout",
    "@/lib/aiMediaVideoProviderContract", "@/lib/aiMediaVideoLocalQa", "@/lib/aiMediaReferenceTeam", "@/lib/aiMediaNarration", "@/lib/aiMediaNarrationAudio",
    "@/lib/aiMediaNativeDialogueQaGoogle", "@/lib/aiMediaDialogue", "@/lib/aiMediaGenerationSoundtracks", "@/lib/aiVideoProvider",
    "@/lib/aiVideoReliability", "@/lib/aiVideoProviderTypes", "@/lib/aiMediaGenerationQuotaPolicy", "@/lib/aiMediaVideoTimeline", "@/lib/aiMediaVideoTemporaryImages"];
  const modules = new Map<string, unknown>(unused.map(id => [id, {}]));
  const image = async (args: RecordValue) => {
    counts.provider += 1; providerCalls.push(args);
    if (providerFailure) throw providerFailure instanceof Error ? providerFailure : new Error("selected_provider_failed");
    const engine = args.imageEngine as catalog.AiMediaImageEngine;
    const references = args.identityReferences as Buffer[];
    return { kind: "image", provider: "vercel-ai-gateway", engine, upstreamProvider: catalog.getAiMediaImageModel(engine).provider,
      model: catalog.getAiMediaImageModel(engine).modelId, buffer: Buffer.from("provider-output"), mediaType: "image/jpeg",
      referenceImagesCount: references.length, identityReferenceImagesCount: 0, genericReferenceImagesCount: references.length,
      officialLogoIncluded: Boolean(args.officialLogo), warnings: [], usage: null };
  };
  const overrides: Array<[string, unknown]> = [
    ["./inrAgentVideoFallback.ts", agentVideoFallback],
    ["./aiMediaGenerationPublicErrors.ts", publicErrors],
    ["server-only", {}], ["sharp", {}],
    ["@/lib/aiGenerationProfile", { buildNormalizedAiGenerationProfile: () => profile }],
    ["@/lib/aiMediaBrandKit", { loadAiMediaBrandKit: async () => ({ colors: ["#112233", "#445566", "#778899"], hasOfficialPalette: true, logo, logoVersion: "test" }) }],
    ["@/lib/aiMediaFreeDnaContextServer", { loadAiMediaFreeDnaContext: async () => ({ coordonnees: { telephone: "01 23 45 67 89" }, liens: { site_web: "https://atelier.example/" }, informations_demandees: [] }) }],
    ["@/lib/aiMediaBrandRenderer", { composeAiMediaBrandedImage: async (args: RecordValue) => { counts.branded += 1; composerCalls.push(args); return Buffer.from("locally-branded-output"); } }],
    ["@/lib/aiMediaCreativePlan", { buildAiMediaCreativePlan: () => plan }],
    ["@/lib/aiMediaCastingVariation", { chooseAiMediaCastingVariation: () => null }],
    ["@/lib/aiMediaCopywriter", { writeAiMediaHeadline: async () => { counts.headline += 1; return plan; } }],
    ["@/lib/aiMediaFreeGenerationPlan", { buildAiMediaFreeBasePlan: () => plan, prepareAiMediaFreeCreativePlan: async () => { counts.creative += 1; return plan; } }],
    ["@/lib/aiMediaFreeGenerationPrompt", freePrompt],
    ["@/lib/aiMediaFreeVoiceoverPolicy", freeVoiceoverPolicy],
    ["@/lib/aiGatewayAccountGuard", { AiGatewayAccountLimitError: class extends Error {}, AiGatewayGuardUnavailableError: class extends Error {} }],
    ["@/lib/aiGeneratedMediaRegistry", { getExistingGeneratedAiMedia: async () => null, saveGeneratedAiMedia: async (args: RecordValue) => { counts.saved += 1; saved.push(args); return { id: "test-media", media_type: "image" }; } }],
    ["@/lib/boosterGenerationContext", { getBoosterGenerationContext: async () => ({ profile: {}, business: {}, recentPublications: [], cacheSource: "test" }) }],
    ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaGateway", { generateAiMediaImage: image, generateAiMediaImageWithGoogle: async (args: RecordValue) => {
      if (args.imageEngine === "gemini") return image(args);
      counts.fallback += 1; throw new Error("unexpected_google_fallback");
    } }],
    ["@/lib/aiMediaImageProviderRequest", imageRequest],
    ["./aiMediaImageProviderGateway.ts", { assertAiMediaGatewayImageInputs: realCapabilityGate() }],
    ["@/lib/aiMediaIdentityReferences", { AiMediaIdentityReferenceValidationError: class extends Error {}, prepareAiMediaIdentityReferences: async (images: contracts.AiMediaInspirationImage[]) => ({ providerImages: images, buffers: images.map(() => Buffer.from("sanitized-image")) }) }],
    ["@/lib/aiMediaGenerationPrompt", { AI_MEDIA_PROMPT_VERSION: "test-version", buildAiMediaPrompt: (args: RecordValue) => { promptCalls.push(args); return "Compiled requested image prompt"; }, getAiMediaPromptOutputSpec: () => ({ kind: "image" }) }],
    ["@/lib/aiMediaNormalizer", { normalizeGeneratedAiImage: async (buffer: Buffer, options: { width: number; height: number }) => ({ kind: "image", buffer, mimeType: "image/jpeg", extension: "jpg", width: options.width, height: options.height, durationSeconds: null }) }],
    ["@/lib/aiMediaSensitiveText", sensitive],
    ["@/lib/aiMediaVisibleContact", { isAiMediaProfilePhoneDisplayRequested: () => false, cleanAiMediaProfilePhone: () => "" }],
    ["@/lib/aiMediaCreditQuoteServer", { quoteAiMediaRequest: (_account: string, request: contracts.AiMediaGenerationRequest) => pricing.quoteAiMediaCredits({ ...request, inspirationImagesCount: request.inspirationImages.length }) }],
  ];
  for (const [id, moduleValue] of overrides) modules.set(id, moduleValue);
  const runtime = compile("lib/aiMediaGenerationServer.ts", modules, true) as unknown as { generateAndSaveAiMedia: (args: RecordValue) => Promise<unknown> };
  return { counts, providerCalls, composerCalls, promptCalls, saved, logo, generate: (request: contracts.AiMediaGenerationRequest, execution: RecordValue = {}) => runtime.generateAndSaveAiMedia({ accountId: "test-account", authUserId: "test-actor", jobId: "test-job", supabase: {}, request, ...execution }) };
}

function request(engine: catalog.AiMediaImageEngine, options: RecordValue = {}) {
  return contracts.normalizeAiMediaGenerationRequest({ requestId: "image-engines-server-test", source: "studio", kind: "image", operation: "generate",
    creationMode: "guided", inputMode: "essential", subjectSource: "custom", idea: "Un objet artisanal original sur une table.", format: "landscape",
    imageEngine: engine, textMode: "none", withText: false, logoMode: "visible", ...options });
}
const ref = () => ({ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "required" }) as contracts.AiMediaInspirationImage;
async function withCredentials(run: () => Promise<void>) {
  const original = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "synthetic-test";
  try { await run(); } finally { if (original === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = original; }
}

test("a legacy automatic image fallback never changes supplier after a safety refusal", async () => {
  await withCredentials(async () => {
    const error = new Error("Your request was rejected by the safety system.");
    const h = serverHarness(error);
    const input = request("openai", { logoMode: "none" });
    input.imageEngine = undefined;
    await assert.rejects(h.generate(input), value => value === error);
    assert.equal(h.counts.provider, 1); assert.equal(h.counts.fallback, 0);
    assert.equal(h.counts.saved, 0);
  });
});

for (const engine of ["flux", "grok", "recraft"] as const) {
  for (const withText of [false, true]) {
    test(`${engine}: guided image ${withText ? "with" : "without"} text keeps logo local and selected metadata`, async () => {
      await withCredentials(async () => {
        const harness = serverHarness();
        await harness.generate(request(engine, { withText, textMode: withText ? "ai" : "none" }));
        assert.equal(harness.providerCalls.length, 1);
        assert.equal(harness.providerCalls[0].imageEngine, engine);
        assert.equal(harness.providerCalls[0].format, "landscape");
        assert.equal(harness.providerCalls[0].officialLogo, null);
        assert.deepEqual(harness.providerCalls[0].identityReferences, []);
        assert.equal(harness.composerCalls.length, 1);
        assert.equal(harness.composerCalls[0].logo, harness.logo);
        const metadata = harness.saved[0].metadata as { gateway: RecordValue; provenance: RecordValue };
        assert.equal(metadata.gateway.engine, engine);
        assert.equal(metadata.gateway.upstream_provider, catalog.getAiMediaImageModel(engine).provider);
        assert.equal(metadata.gateway.model, catalog.getAiMediaImageModel(engine).modelId);
        assert.equal(metadata.gateway.reference_images_count, 0);
        assert.equal(metadata.provenance.local_logo_composition_applied, true);
        assert.equal(harness.counts.fallback, 0);
      });
    });
  }
}

test("incompatible Recraft/Grok references are rejected before creative preparation or provider call", async () => {
  await withCredentials(async () => {
    for (const [engine, count] of [["recraft", 1], ["grok", 4]] as const) {
      const harness = serverHarness();
      const invalid = { ...request(engine, { creationMode: "free", freePrompt: "Créer une affiche artisanale originale." }), inspirationImages: Array.from({ length: count }, ref) };
      await assert.rejects(harness.generate(invalid), /reference.*unsupported/);
      assert.equal(harness.counts.creative, 0);
      assert.equal(harness.counts.headline, 0);
      assert.equal(harness.counts.provider, 0);
      assert.equal(harness.counts.saved, 0);
    }
  });
});

test("free official logo is composed only when explicitly requested, without hidden references", async () => {
  await withCredentials(async () => {
    for (const useLogo of [false, true]) {
      const harness = serverHarness();
      await harness.generate(request("recraft", { creationMode: "free", freePrompt: useLogo ? "Créer une illustration et ajouter mon logo officiel discrètement." : "Créer une illustration sans logo." }));
      assert.equal(harness.providerCalls[0].officialLogo, null);
      assert.deepEqual(harness.providerCalls[0].identityReferences, []);
      assert.equal(harness.counts.creative, 1);
      assert.equal(harness.composerCalls.length, useLogo ? 1 : 0);
      const metadata = harness.saved[0].metadata as { provenance: RecordValue };
      assert.equal(metadata.provenance.local_logo_composition_applied, useLogo);
    }
  });
});

test("checked ADN preserves the free request and selected engine while composing the exact logo locally on every image engine", async () => {
  await withCredentials(async () => {
    for (const engine of ["openai", "gemini", "flux", "grok", "recraft"] as const) {
      const harness = serverHarness();
      const input = request(engine, { creationMode: "free", useBusinessDna: true, freePrompt: "Une création artisanale originale avec mon téléphone et le lien du site." });
      const original = structuredClone(input);
      await harness.generate(input);
      assert.deepEqual(input, original);
      assert.equal(harness.providerCalls.length, 1);
      assert.equal(harness.providerCalls[0].imageEngine, engine);
      assert.equal(harness.providerCalls[0].officialLogo, null);
      assert.deepEqual(harness.providerCalls[0].identityReferences, []);
      assert.equal(harness.counts.headline, 0);
      assert.equal(harness.counts.fallback, 0);
      assert.equal(harness.composerCalls.length, 1);
      assert.equal(harness.composerCalls[0].logo, harness.logo);
      assert.equal(harness.composerCalls[0].withText, false);
      const context = harness.promptCalls[0].businessDnaContext as { coordonnees: RecordValue; liens: RecordValue };
      assert.equal(context.coordonnees.telephone, "01 23 45 67 89");
      assert.equal(context.liens.site_web, "https://atelier.example/");
    }
  });
});

test("checked ADN respects a request without a logo", async () => {
  await withCredentials(async () => {
    const harness = serverHarness();
    await harness.generate(request("recraft", { creationMode: "free", useBusinessDna: true, freePrompt: "Une création sans logo et sans charte." }));
    assert.equal(harness.counts.provider, 1);
    assert.equal(harness.composerCalls.length, 0);
    assert.deepEqual(harness.promptCalls[0].brandColors, []);
  });
});

test("an explicit new image engine failure does not invoke Google fallback or persist another image", async () => {
  await withCredentials(async () => {
    const harness = serverHarness(true);
    await assert.rejects(harness.generate(request("flux")), /selected_provider_failed/);
    assert.equal(harness.counts.provider, 1);
    assert.equal(harness.counts.fallback, 0);
    assert.equal(harness.counts.saved, 0);
  });
});

test("the server locks cancellation once, before the first billable plan or image request", async () => {
  await withCredentials(async () => {
    for (const creationMode of ["guided", "free"] as const) {
      const harness = serverHarness();
      let locks = 0;
      await harness.generate(request("grok", {
        creationMode,
        freePrompt: creationMode === "free" ? "Photographie d'une tasse turquoise sans logo." : undefined,
      }), { onBillableWorkStarted: async () => {
        locks += 1;
        assert.equal(harness.counts.creative, 0);
        assert.equal(harness.counts.headline, 0);
        assert.equal(harness.counts.provider, 0);
      } });
      assert.equal(locks, 1);
      assert.equal(harness.counts.provider, 1);
      assert.equal(harness.counts.saved, 1);
    }
  });
});

test("a cancellation at the paid-work gate cannot reach a creative plan or provider", async () => {
  await withCredentials(async () => {
    const harness = serverHarness();
    const controller = new AbortController();
    await assert.rejects(harness.generate(request("grok", { creationMode: "free", freePrompt: "Photographie d'une tasse." }), {
      signal: controller.signal,
      onBillableWorkStarted: () => controller.abort(new DOMException("Preparation cancelled", "AbortError")),
    }), { name: "AbortError" });
    assert.equal(harness.counts.creative, 0);
    assert.equal(harness.counts.provider, 0);
    assert.equal(harness.counts.saved, 0);
  });
});

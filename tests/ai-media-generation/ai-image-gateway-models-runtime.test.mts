import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import * as sensitiveText from "../../lib/aiMediaSensitiveText.ts";
import { bufferFromUint8ArrayView } from "../../lib/aiMediaBuffer.ts";

type Engine = "flux" | "grok" | "recraft";
type Input = { engine: Engine; operation?: "generate" | "modify"; referenceImagesCount: number; size?: `${number}x${number}`; format?: "square" | "portrait" | "story" | "landscape"; prompt?: string };
type Runtime = {
  assertAiMediaGatewayImageInputs: (input: Input) => void;
  resolveAiMediaGatewayImageSize: (engine: Engine, size?: `${number}x${number}`, format?: Input["format"]) => { width: number; height: number; size?: string; aspectRatio?: string };
  prepareAiMediaGatewayImageReferences: (args: { engine: Engine; references: readonly Buffer[]; signal?: AbortSignal }) => Promise<Buffer[]>;
  generateAiMediaImageWithGatewayModel: (args: Record<string, unknown>) => Promise<{ engine: string; model: string; upstreamProvider: string; warnings: string[]; referenceImagesCount: number }>;
};

type Mode = "success" | "rejected" | "bad-output" | "svg" | "warnings" | "budget" | "ignored-references" | "network" | "abort" | "timeout" | "pre-submit-abort" | `http-${number}`;
function loadRuntime(buffer: Buffer, mode: Mode = "success") {
  const counts = { submitted: 0, reserved: 0, committed: 0, rolledBack: 0 };
  const inputs: Record<string, unknown>[] = [];
  const costs: number[] = [];
  const controller = new AbortController();
  const source = readFileSync(path.join(process.cwd(), "lib/aiMediaImageProviderGateway.ts"), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const stubs = new Map<string, unknown>([
    ["server-only", {}], ["sharp", sharp],
    ["ai", { experimental_generateImage: async (input: Record<string, unknown>) => {
      counts.submitted += 1; inputs.push(input);
      if (mode === "rejected") throw Object.assign(new Error("provider_unsupported_input"), { statusCode: 400 });
      if (mode.startsWith("http-")) throw Object.assign(new Error("provider_http_error"), { statusCode: Number(mode.slice(5)) });
      if (mode === "network") throw new Error("fetch failed at https://storage.example.test/private?token=secret Bearer hidden-credential");
      if (mode === "abort") throw new DOMException("Request aborted after submission", "AbortError");
      if (mode === "timeout") throw new Error("Provider response timed out");
      return { images: [{ uint8Array: mode === "bad-output" ? Buffer.from("not an image") : buffer, mediaType: mode === "svg" ? "image/svg+xml" : "image/png" }],
        warnings: mode === "warnings" ? [{ type: "other", message: "private https://storage.example.test/image?token=hidden data:image/png;base64," + "a".repeat(150) }]
          : mode === "ignored-references" ? [{ type: "unsupported", feature: "input images", details: "reference ignored" }] : [], usage: null };
    } }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async (_account: string, input: { estimatedCostMicroUsd: number }) => { counts.reserved += 1; costs.push(input.estimatedCostMicroUsd); if (mode === "budget") throw new Error("account_budget_exceeded"); if (mode === "pre-submit-abort") controller.abort(new Error("cancelled_before_submission")); return {}; },
      commitAiGatewayAccountAttempt: async () => { counts.committed += 1; },
      rollbackAiGatewayAccountAttempt: async () => { counts.rolledBack += 1; },
      recordAiGatewayAccountFailure: async () => undefined,
    }],
    ["./aiMediaBuffer.ts", { bufferFromUint8ArrayView }], ["./aiMediaModelCatalog.ts", catalog],
    ["./aiMediaCreditsPricing.ts", pricing], ["./aiMediaSensitiveText.ts", sensitiveText],
  ]);
  const nativeRequire = createRequire(import.meta.url);
  const localRequire = (specifier: string) => stubs.has(specifier) ? stubs.get(specifier) : nativeRequire(specifier);
  const runtimeModule = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module){${javascript}\n})`)(runtimeModule.exports, localRequire, runtimeModule);
  return { runtime: runtimeModule.exports as Runtime, counts, inputs, costs, controller };
}

function loadGatewayRouter(runtime: Runtime) {
  const source = readFileSync(path.join(process.cwd(), "lib/aiMediaGateway.ts"), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const forbiddenLegacy = () => { throw new Error("unexpected_legacy_image_fallback"); };
  const stubs = new Map<string, unknown>([
    ["server-only", {}], ["ai", { experimental_generateImage: forbiddenLegacy, NoImageGeneratedError: { isInstance: () => false } }],
    ["@google/genai", { GoogleGenAI: forbiddenLegacy }], ["@/lib/aiGatewayAccountGuard", {}],
    ["@/lib/aiMediaBuffer", { bufferFromUint8ArrayView }], ["@/lib/aiMediaSensitiveText", sensitiveText],
    ["./aiMediaImageProviderGateway.ts", runtime],
  ]);
  const runtimeModule = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module){${javascript}\n})`)(runtimeModule.exports, (specifier: string) => {
    if (!stubs.has(specifier)) throw new Error(`unexpected_dependency:${specifier}`);
    return stubs.get(specifier);
  }, runtimeModule);
  return runtimeModule.exports as { generateAiMediaImage: (args: Record<string, unknown>) => ReturnType<Runtime["generateAiMediaImageWithGatewayModel"]> };
}

function argsFor(engine: Engine, refs: Buffer[] = [], operation: "generate" | "modify" = "generate") {
  return { accountId: "synthetic-test", engine, prompt: "An original ceramic vase on a wooden table.", format: "landscape", operation, size: "1536x864", referenceRoleRules: refs.length ? "All supplied products must remain identifiable." : "",
    input: { providedReferences: refs, providedReferenceRoles: refs.map(() => ({ role: "product", usage: "required" })),
      referenceImages: refs, referenceMimeTypes: refs.map(() => "image/png"), referenceImagesCount: refs.length,
      characterReferenceCount: 0, strictIdentityReferences: false, officialLogoIncluded: false } };
}

async function raster(width = 32, height = 32) {
  return sharp({ create: { width, height, channels: 4, background: { r: 70, g: 140, b: 210, alpha: .8 } } }).png().toBuffer();
}

async function withCredentials(run: () => Promise<void>) {
  const original = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "synthetic-unit-test";
  try { await run(); } finally { if (original === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = original; }
}

for (const engine of ["flux", "grok", "recraft"] as const) {
  test(`${engine}: selected exact image model reaches SDK6 without retry or fallback`, async () => {
    await withCredentials(async () => {
      const context = loadRuntime(await raster());
      const result = await context.runtime.generateAiMediaImageWithGatewayModel(argsFor(engine));
      assert.equal(result.engine, engine);
      assert.equal(result.model, catalog.getAiMediaImageModel(engine).modelId);
      assert.equal(result.upstreamProvider, catalog.getAiMediaImageModel(engine).provider);
      assert.equal(context.inputs[0].model, result.model);
      assert.equal(context.inputs[0].n, 1);
      assert.equal(context.inputs[0].maxImagesPerCall, 1);
      assert.equal(context.inputs[0].maxRetries, 0);
      assert.deepEqual(context.counts, { submitted: 1, reserved: 1, committed: 1, rolledBack: 0 });
      assert.equal(context.costs[0], pricing.estimateAiMediaImageSupplierCostMicroUsd({ engine, referenceImagesCount: 0 }));
      if (engine === "grok") { assert.equal(context.inputs[0].aspectRatio, "16:9"); assert.equal("size" in context.inputs[0], false); }
      if (engine === "recraft") { assert.equal(context.inputs[0].size, "1344x768"); assert.deepEqual(context.inputs[0].providerOptions, { recraft: { style: "any" } }); }
      if (engine === "flux") { assert.equal("size" in context.inputs[0], false); assert.deepEqual(context.inputs[0].providerOptions, { blackForestLabs: { width: 1536, height: 864, outputFormat: "jpeg", pollTimeoutMillis: 180_000 } }); }
    });
  });
}

for (const engine of ["flux", "grok", "recraft"] as const) {
  test(`${engine}: public image router preserves explicit selection including required identity`, async () => {
    await withCredentials(async () => {
      const context = loadRuntime(await raster());
      const refs = engine === "recraft" ? [] : [await raster()];
      const request = argsFor(engine, refs);
      const result = await loadGatewayRouter(context.runtime).generateAiMediaImage({ accountId: "test-account", prompt: request.prompt,
        imageEngine: engine, format: "landscape", size: request.size, identityMode: "professional", identityReferences: refs,
        referenceRoles: refs.map(() => ({ role: "character", usage: "required", characterIndex: 1 })) });
      assert.equal(result.engine, engine);
      assert.equal(result.model, catalog.getAiMediaImageModel(engine).modelId);
      assert.equal(result.referenceImagesCount, refs.length);
      assert.equal(context.counts.submitted, 1);
    });
  });
}

test("unsupported Recraft edits and references, and fourth Grok reference stop before budget or API", async () => {
  const context = loadRuntime(await raster());
  const reference = await raster();
  await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("recraft", [reference])), /reference.*unsupported/);
  await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("recraft", [reference], "modify")), /modify_unsupported/);
  await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("grok", [reference, reference, reference, reference])), /reference_count_unsupported/);
  await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("flux", [], "modify")), /modify_source_required/);
  assert.deepEqual(context.counts, { submitted: 0, reserved: 0, committed: 0, rolledBack: 0 });
});

test("source editing and every supplied FLUX reference are retained, each under one megapixel", async () => {
  await withCredentials(async () => {
    const context = loadRuntime(await raster());
    const reference = await raster(2048, 1536);
    const result = await context.runtime.generateAiMediaImageWithGatewayModel(argsFor("flux", [reference, reference], "modify"));
    assert.equal(result.referenceImagesCount, 2);
    const prompt = context.inputs[0].prompt as { images: Buffer[]; text: string };
    assert.equal(prompt.images.length, 2);
    assert.match(prompt.text, /All supplied products/);
    for (const buffer of prompt.images) {
      const metadata = await sharp(buffer).metadata();
      assert.ok(metadata.width! * metadata.height! <= catalog.AI_MEDIA_IMAGE_REFERENCE_MAX_PIXELS);
      assert.equal(metadata.format, "png");
      assert.ok(metadata.hasAlpha);
    }
    assert.equal(context.costs[0], 75_000);
  });
});

test("FLUX edits above two megapixels are bounded on the native 16-pixel grid", async () => {
  const runtime = loadRuntime(await raster()).runtime;
  const dimensions = runtime.resolveAiMediaGatewayImageSize("flux", "1536x1536");
  assert.ok(dimensions.width * dimensions.height <= catalog.AI_MEDIA_FLUX_OUTPUT_MAX_PIXELS);
  assert.equal(dimensions.width, dimensions.height);
  assert.equal(dimensions.width % 16, 0);
  assert.equal(dimensions.height % 16, 0);
  for (const format of ["square", "portrait", "story", "landscape"] as const) {
    const native = runtime.resolveAiMediaGatewayImageSize("flux", undefined, format);
    assert.deepEqual({ width: native.width, height: native.height }, catalog.getAiMediaImageDimensions("flux", format));
  }
});

for (const mode of ["rejected", "bad-output", "svg", "budget"] as const) {
  test(`${mode}: economic state is correct and no second model is attempted`, async () => {
    await withCredentials(async () => {
      const context = loadRuntime(await raster(), mode);
      await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("recraft")));
      assert.equal(context.counts.submitted, mode === "budget" ? 0 : 1);
      assert.equal(context.counts.committed, mode === "bad-output" || mode === "svg" ? 1 : 0);
      assert.equal(context.counts.rolledBack, mode === "rejected" ? 1 : 0);
    });
  });
}

test("reference SVG and cancellation fail before any paid submission", async () => {
  await withCredentials(async () => {
    const context = loadRuntime(await raster());
    await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("flux", [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>')])), /raster_required/);
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel({ ...argsFor("grok"), signal: controller.signal }), /cancelled/);
    assert.equal(context.counts.reserved, 0);
    assert.equal(context.counts.submitted, 0);
  });
});

test("provider diagnostics redact reference data and private URLs", async () => {
  await withCredentials(async () => {
    const context = loadRuntime(await raster(), "warnings");
    const result = await context.runtime.generateAiMediaImageWithGatewayModel(argsFor("flux"));
    assert.doesNotMatch(result.warnings.join(" "), /https:|token=|storage\.example|a{64}/);
  });
});

test("an upstream warning about ignored references rejects the result while recording its existing paid asset", async () => {
  await withCredentials(async () => {
    const reference = await raster();
    const context = loadRuntime(reference, "ignored-references");
    await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("grok", [reference])), /billable_failure.*references_unsupported/);
    assert.deepEqual(context.counts, { submitted: 1, reserved: 1, committed: 1, rolledBack: 0 });
  });
});

for (const status of [400, 401, 403, 404, 422, 429]) {
  test(`explicit HTTP ${status} rejection releases the supplier reserve without retry`, async () => {
    await withCredentials(async () => {
      const context = loadRuntime(await raster(), `http-${status}`);
      await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("flux")));
      assert.deepEqual(context.counts, { submitted: 1, reserved: 1, committed: 0, rolledBack: 1 });
    });
  });
}

for (const mode of ["network", "abort", "timeout", "http-408", "http-500", "http-503"] as const) {
  test(`${mode}: uncertain submitted job retains its internal cost bound without another request`, async () => {
    await withCredentials(async () => {
      const context = loadRuntime(await raster(), mode);
      await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel(argsFor("flux")), (error: unknown) => {
        assert.match((error as Error).message, /ai_image_gateway_uncertain_failure/);
        assert.doesNotMatch((error as Error).message, /https:|token=|hidden-credential/);
        return true;
      });
      assert.deepEqual(context.counts, { submitted: 1, reserved: 1, committed: 1, rolledBack: 0 });
    });
  });
}

test("cancellation during reservation releases the unsubmitted attempt", async () => {
  await withCredentials(async () => {
    const context = loadRuntime(await raster(), "pre-submit-abort");
    await assert.rejects(context.runtime.generateAiMediaImageWithGatewayModel({ ...argsFor("flux"), signal: context.controller.signal }), /cancelled_before_submission/);
    assert.deepEqual(context.counts, { submitted: 0, reserved: 1, committed: 0, rolledBack: 1 });
  });
});

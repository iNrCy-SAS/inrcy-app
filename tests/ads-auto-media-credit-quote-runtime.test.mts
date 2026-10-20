import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../lib/aiMediaGenerationContracts.ts";
import * as characterVoices from "../lib/aiMediaCharacterVoices.ts";
import * as models from "../lib/aiMediaModelCatalog.ts";
import * as pricing from "../lib/aiMediaCreditsPricing.ts";
import * as policy from "../lib/adsCampaignMediaPolicy.ts";

type Input = Record<string, unknown>;
type Quote = ReturnType<typeof pricing.quoteAiMediaCredits> & { quoteId: string };
type QuoteRequest = { input: pricing.AiMediaCreditsQuoteInput; options: RequestInit; resolve: (response: Response) => void };

function compile(source: string, modules: Record<string, unknown>) {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded: { exports: Record<string, unknown> } = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, (specifier: string) => {
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected dependency: ${specifier}`);
    return modules[specifier];
  });
  return loaded.exports;
}

const serverQuotes = compile(readFileSync(new URL("../lib/aiMediaCreditQuoteServer.ts", import.meta.url), "utf8"), {
  "server-only": {},
  "node:crypto": await import("node:crypto"),
  "./aiMediaCreditsPricing.ts": pricing,
  "./aiMediaCharacterVoices.ts": characterVoices,
  "./aiMediaModelCatalog.ts": models,
}) as {
  createAiMediaServerQuote: (account: string, input: pricing.AiMediaCreditsQuoteInput) => Quote;
  quoteAiMediaRequest: (account: string, request: contracts.AiMediaGenerationRequest) => Quote;
  assertAiMediaCreditQuote: (request: contracts.AiMediaGenerationRequest, quote: Quote) => boolean;
};

const source = readFileSync(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(provider = "tiktok", overrides: Input = {}) {
  const account = "active-ads-establishment";
  const effects: Array<() => (() => void) | void> = [];
  const cleanups: Array<() => void> = [];
  const timers = new Map<number, () => void>();
  const requests: QuoteRequest[] = [];
  const generated: Input[] = [];
  const accepted: Input[] = [];
  const events: string[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];
  const completed: Input[] = [];
  const packs: Array<{ result: Input; error?: string }> = [];
  let nextTimer = 0;
  const react = {
    useRef: (value: unknown) => ({ current: value }),
    useEffect: (effect: () => (() => void) | void) => effects.push(effect),
  };
  const modules = {
    react,
    "@/lib/adsCampaignMediaPolicy": policy,
    "@/app/dashboard/_hooks/useMediaGeneration": { __esModule: true, default: () => ({
      progress: 0,
      generate: async (request: Input) => {
        generated.push(request);
        events.push("generate");
        const normalized = contracts.normalizeAiMediaGenerationRequest({
          ...request, contractVersion: 4, requestId: `ads-quote-test-${generated.length}`,
        });
        const quote = serverQuotes.quoteAiMediaRequest(account, normalized);
        assert.equal(serverQuotes.assertAiMediaCreditQuote(normalized, quote), true, "The exact generation must match its account-scoped server quote");
        return { item: { id: `media-${generated.length}`, signed_url: `https://media.test/${generated.length}` }, draft: true };
      },
      acceptDraft: async (result: Input) => { accepted.push(result); events.push("accept"); return { ...result, draft: false }; },
      cancelGeneration: () => events.push("cancel"),
    }) },
  };
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded: { exports: { default?: (props: Input) => null } } = { exports: {} };
  new Function("module", "exports", "require", "fetch", "window", output)(loaded, loaded.exports, (specifier: string) => {
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected component dependency: ${specifier}`);
    return modules[specifier as keyof typeof modules];
  }, (url: string, options: RequestInit) => {
    assert.equal(url, "/api/media-generation/quote", "Tests must never publish or call a paid provider");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    events.push("quote");
    return new Promise<Response>((resolve) => requests.push({ input: JSON.parse(String(options.body)), options, resolve }));
  }, {
    setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  loaded.exports.default!({
    provider,
    plan: {
      name: "Synthetic campaign", campaignType: "generic", creativeType: "video", mediaStrategy: "video",
      mediaBrief: "Un artisan présente son atelier lumineux.", offer: "Atelier de menuiserie",
      primaryText: "Découvrez notre savoir-faire", callToAction: "Voir l’atelier", metaPlacements: [],
      targetLocations: [], targetAudiences: [], keywords: [], ...overrides,
    },
    onProgress: () => {},
    onComplete: (result: Input) => { completed.push(result); events.push("complete"); },
    onMetaPackComplete: (result: Input, error?: string) => { packs.push({ result, error }); events.push("pack"); },
    onSkip: (message: string) => skipped.push(message),
    onError: (message: string) => errors.push(message),
  });
  for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  const launch = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  const quote = (index: number) => serverQuotes.createAiMediaServerQuote(account, requests[index].input);
  const respond = async (index: number, body?: unknown, status = 200) => {
    assert.ok(requests[index], `Missing quote request ${index}`);
    requests[index].resolve(Response.json(body ?? { ok: true, quote: quote(index), creditsReady: true }, { status }));
    await tick();
  };
  return { requests, generated, accepted, events, errors, skipped, completed, packs, launch, quote, respond,
    dispose: () => cleanups.forEach((cleanup) => cleanup()) };
}

test("TikTok ADS attend un devis confirmé pour la vidéo 16 secondes, puis conserve le flux Studio", async () => {
  const h = harness();
  h.launch();
  assert.equal(h.requests.length, 1);
  assert.equal(h.generated.length, 0);
  assert.equal(h.requests[0].input.creationMode, "free");
  assert.equal(h.requests[0].input.videoEngine, "omni");
  assert.equal(h.requests[0].input.videoResolution, "720p");
  assert.equal(h.requests[0].input.durationSeconds, 16);
  assert.equal(h.requests[0].input.sceneMode, "single");
  assert.equal(h.requests[0].input.inspirationImagesCount, 0);
  assert.equal(h.quote(0).totalCredits, 167);
  await h.respond(0);
  assert.equal(h.generated.length, 1);
  assert.equal(h.generated[0].durationSeconds, 16);
  assert.equal(h.generated[0].expectedCredits, 167);
  assert.equal(h.generated[0].creditTariffVersion, h.quote(0).tariffVersion);
  assert.equal(h.generated[0].creditQuoteId, h.quote(0).quoteId);
  assert.equal(h.generated[0].teamVideoProviderConsent, undefined);
  assert.equal(h.accepted.length, 1);
  assert.equal(h.completed.length, 1);
  assert.deepEqual(h.events, ["quote", "generate", "accept", "complete"]);
  assert.deepEqual(h.errors, []);
  h.dispose();
});

test("les images automatiques des autres canaux obtiennent aussi leur propre devis", async () => {
  for (const provider of ["google", "pinterest", "openai"]) {
    const h = harness(provider, { campaignType: "display", creativeType: "image", mediaStrategy: "image" });
    h.launch();
    assert.equal(h.generated.length, 0);
    assert.equal(h.requests[0].input.imageEngine, "openai");
    assert.equal(h.requests[0].input.format, provider === "pinterest" ? "portrait" : "square");
    assert.equal(h.quote(0).totalCredits, 7);
    await h.respond(0);
    assert.equal(h.generated.length, 1);
    assert.equal(h.generated[0].expectedCredits, 7);
    assert.equal(h.completed.length, 1);
    assert.deepEqual(h.errors, []);
    h.dispose();
  }
});

test("chaque format du pack Meta reçoit un devis distinct malgré le même prix", async () => {
  const h = harness("meta", { creativeType: "image", mediaStrategy: "image", metaPlacements: ["facebook_feed", "stories"] });
  h.launch();
  assert.equal(h.requests[0].input.format, "portrait");
  await h.respond(0);
  assert.equal(h.requests.length, 2);
  assert.equal(h.generated.length, 1);
  assert.equal(h.requests[1].input.format, "story");
  assert.equal(h.quote(0).totalCredits, 7);
  assert.equal(h.quote(1).totalCredits, 7);
  assert.notEqual(h.quote(0).quoteId, h.quote(1).quoteId);
  await h.respond(1);
  assert.equal(h.generated.length, 2);
  assert.equal(h.accepted.length, 2);
  assert.equal(h.packs.length, 1);
  assert.deepEqual(Object.keys(h.packs[0].result), ["feed", "storyReel"]);
  assert.equal(h.packs[0].error, undefined);
  assert.deepEqual(h.errors, []);
  h.dispose();
});

test("un devis indisponible ou incomplet n’autorise aucun appel de génération ni retry", async () => {
  for (const failure of [
    { status: 503, body: { ok: false, error: "Portefeuille indisponible" } },
    { status: 403, body: { ok: false, error: "Durée non autorisée" } },
    { status: 200, body: { ok: true } },
    { status: 200, body: { ok: true, quote: { totalCredits: 167, tariffVersion: pricing.AI_MEDIA_CREDIT_TARIFF_VERSION } } },
    { status: 200, body: { ok: true, quote: { totalCredits: -1, tariffVersion: "v3", quoteId: "f".repeat(64) } } },
  ]) {
    const h = harness();
    h.launch();
    await h.respond(0, failure.body, failure.status);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.generated, []);
    assert.deepEqual(h.accepted, []);
    assert.equal(h.errors.length, 1);
    h.dispose();
  }
});

test("la fermeture pendant le devis annule sa requête et interdit une génération tardive", async () => {
  const h = harness();
  h.launch();
  h.dispose();
  assert.equal(h.requests[0].options.signal?.aborted, true);
  await h.respond(0);
  assert.deepEqual(h.generated, []);
  assert.deepEqual(h.accepted, []);
  assert.deepEqual(h.completed, []);
  assert.deepEqual(h.errors, []);
});

test("un devis refusé sur le second format Meta conserve le premier média accepté", async () => {
  const h = harness("meta", { creativeType: "image", mediaStrategy: "image", metaPlacements: ["instagram_feed", "reels"] });
  h.launch();
  await h.respond(0);
  await h.respond(1, { ok: false, error: "Crédits indisponibles" }, 503);
  assert.equal(h.generated.length, 1);
  assert.equal(h.accepted.length, 1);
  assert.equal(h.packs.length, 1);
  assert.deepEqual(Object.keys(h.packs[0].result), ["feed"]);
  assert.equal(h.packs[0].error, "Crédits indisponibles");
  assert.deepEqual(h.errors, []);
  h.dispose();
});

test("les campagnes textuelles et flux produits ne demandent ni devis ni génération", () => {
  for (const plan of [
    { campaignType: "search", creativeType: "image", mediaStrategy: "search_text" },
    { campaignType: "shopping", creativeType: "image", mediaStrategy: "product_feed" },
  ]) {
    const h = harness("google", plan);
    h.launch();
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.generated, []);
    assert.equal(h.skipped.length, 1);
    h.dispose();
  }
});

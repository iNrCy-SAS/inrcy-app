import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as mediaPolicy from "../lib/adsCampaignMediaPolicy.ts";
import * as contracts from "../lib/aiMediaGenerationContracts.ts";
import * as pricing from "../lib/aiMediaCreditsPricing.ts";

test("le générateur Pinterest transmet le portrait au pipeline partagé et accepte une seule création", { timeout: 2_000 }, async () => {
  const source = await readFile(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const quoteSource = await readFile(new URL("../lib/aiMediaCreditQuoteServer.ts", import.meta.url), "utf8");
  const quoteCompiled = ts.transpileModule(quoteSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const serverQuotes = {};
  new Function("exports", "require", quoteCompiled)(serverQuotes, (name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    if (name === "./aiMediaCreditsPricing.ts") return pricing;
    throw new Error(`Unexpected quote dependency: ${name}`);
  });
  const accountId = "pinterest-fixture-account";
  const effects = [];
  const quoteRequests = [];
  const requests = [];
  const accepted = [];
  const generated = { url: "https://example.test/portrait.png", width: 1080, height: 1350, kind: "image", format: "portrait" };
  const exports = {};
  new Function("exports", "require", "fetch", compiled)(exports, (name) => {
    if (name === "react") return { useEffect: (callback) => effects.push(callback), useRef: (current) => ({ current }) };
    if (name === "@/lib/adsCampaignMediaPolicy") return mediaPolicy;
    if (name === "@/app/dashboard/_hooks/useMediaGeneration") return { default: () => ({
      generate: async (request) => { requests.push(request); return generated; },
      acceptDraft: async (result) => { accepted.push(result); return result; },
      cancelGeneration: () => {},
      progress: 0,
    }) };
    throw new Error(`Unexpected dependency: ${name}`);
  }, (url, options) => {
    assert.equal(url, "/api/media-generation/quote");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers["content-type"], "application/json");
    assert.equal(options.signal.aborted, false);
    return new Promise((resolve) => quoteRequests.push({ input: JSON.parse(options.body), resolve }));
  });
  const previousWindow = globalThis.window;
  let launch;
  globalThis.window = { setTimeout: (callback) => { launch = callback; return 1; }, clearTimeout: () => {} };
  try {
    let complete;
    let fail;
    const completion = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    exports.default({
      provider: "pinterest",
      plan: { campaignType: "generic", mediaStrategy: "image", creativeType: "image", name: "Inspiration cuisine", offer: "Aménagement de cuisines", primaryText: "Découvrez des rangements adaptés.", targetAudiences: ["propriétaires locaux"], mediaBrief: "Une cuisine lumineuse et accueillante", callToAction: "Découvrir" },
      onProgress: () => {}, onComplete: complete,
      onMetaPackComplete: () => fail(new Error("Unexpected Meta generation")),
      onSkip: (reason) => fail(new Error(reason)), onError: (message) => fail(new Error(message)),
    });
    effects.forEach((callback) => callback());
    assert.equal(typeof launch, "function");
    launch();
    assert.equal(quoteRequests.length, 1);
    assert.equal(requests.length, 0, "Le portrait attend son devis confirmé avant toute génération.");
    assert.equal(accepted.length, 0);
    assert.deepEqual(quoteRequests[0].input, {
      kind: "image", operation: "generate", creationMode: "free", inputMode: "essential",
      imageEngine: "openai", format: "portrait", inspirationImagesCount: 0,
      identityMode: "auto", withNarration: false, teamVideoSpeechMode: "voiceover",
    });
    const quote = serverQuotes.createAiMediaServerQuote(accountId, quoteRequests[0].input);
    assert.equal(quote.totalCredits, 7);
    quoteRequests[0].resolve(Response.json({ ok: true, quote, creditsReady: true }));
    assert.equal(await completion, generated);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].creationMode, "free");
    assert.equal(requests[0].format, "portrait");
    assert.equal(requests[0].kind, "image");
    assert.match(requests[0].freePrompt, /Pinterest verticale.*4:5.*1080 × 1350/);
    assert.equal(requests[0].logoMode, "none");
    assert.equal(requests[0].imageEngine, "openai");
    assert.equal(requests[0].expectedCredits, quote.totalCredits);
    assert.equal(requests[0].creditTariffVersion, quote.tariffVersion);
    assert.equal(requests[0].creditQuoteId, quote.quoteId);
    const normalized = contracts.normalizeAiMediaGenerationRequest({ ...requests[0], contractVersion: 4, requestId: "pinterest-quoted-generation" });
    const generationQuote = serverQuotes.quoteAiMediaRequest(accountId, normalized);
    assert.deepEqual(generationQuote, quote, "Le devis doit correspondre au portrait réellement normalisé par le serveur.");
    assert.equal(serverQuotes.assertAiMediaCreditQuote(normalized, generationQuote), true);
    assert.deepEqual(accepted, [generated]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

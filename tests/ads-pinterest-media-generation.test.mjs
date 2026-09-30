import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as mediaPolicy from "../lib/adsCampaignMediaPolicy.ts";

test("le générateur Pinterest transmet le portrait au pipeline partagé et accepte une seule création", { timeout: 2_000 }, async () => {
  const source = await readFile(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const effects = [];
  const requests = [];
  const accepted = [];
  const generated = { url: "https://example.test/portrait.png", width: 1080, height: 1350, kind: "image", format: "portrait" };
  const exports = {};
  new Function("exports", "require", compiled)(exports, (name) => {
    if (name === "react") return { useEffect: (callback) => effects.push(callback), useRef: (current) => ({ current }) };
    if (name === "@/lib/adsCampaignMediaPolicy") return mediaPolicy;
    if (name === "@/app/dashboard/_hooks/useMediaGeneration") return { default: () => ({
      generate: async (request) => { requests.push(request); return generated; },
      acceptDraft: async (result) => { accepted.push(result); return result; },
      cancelGeneration: () => {},
      progress: 0,
    }) };
    throw new Error(`Unexpected dependency: ${name}`);
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
    assert.equal(await completion, generated);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].creationMode, "free");
    assert.equal(requests[0].format, "portrait");
    assert.equal(requests[0].kind, "image");
    assert.match(requests[0].freePrompt, /Pinterest verticale.*4:5.*1080 × 1350/);
    assert.equal(requests[0].logoMode, "none");
    assert.deepEqual(accepted, [generated]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

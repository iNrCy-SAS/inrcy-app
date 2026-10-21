import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { MEDIA_FIRST_PUBLICATION_IDEA } from "../../lib/aiMediaSubject.ts";
import type * as Prompt from "../../lib/boosterPrompt.ts";
import type * as Understanding from "../../lib/aiMediaUnderstanding.ts";
import type * as Generation from "../../lib/boosterPublishGeneration.ts";
import type * as Profile from "../../lib/aiGenerationProfile.ts";

type Json = Record<string, unknown>;
const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);

/** Execute the real TS modules; replace only provider/cache I/O boundaries. */
function runtime(options: { cached?: boolean; unavailable?: boolean; repair?: boolean } = {}) {
  const calls: Json[] = [];
  const cacheKeys: Json[] = [];
  const cache = new Map<string, Json>();
  let writes = 0;
  const overrides: Record<string, unknown> = {
    "lib/aiGatewayClient.ts": {
      aiGenerateJSON: async (args: Json) => {
        calls.push(args);
        if (String(args.feature).endsWith("media-understanding")) {
          if (options.unavailable) throw new Error("vision temporarily unavailable");
          return { facts: ["Un praticien masse la main ouverte d’une personne."], visible_text: [], uncertainties: [] };
        }
        writes += 1;
        if (options.repair && writes === 1) return { versions: {} };
        return { versions: { facebook: { title: "Massage des mains", content: [
          "Un moment consacré aux mains : des gestes précis, une attention portée à chaque mouvement et une séance présentée avec simplicité.",
          "Cette image montre une main ouverte accompagnée par les gestes du praticien. La publication met en valeur ce qui est visible, sans attribuer à cette scène un autre soin ou une prestation différente.",
          "Prenez le temps de découvrir cette approche et de poser vos questions sur le déroulement de la séance. Notre équipe vous renseigne sur les prestations proposées et vous aide à préparer votre prochain rendez-vous.",
        ].join("\n\n"), cta: "Contactez-nous", hashtags: [] } } };
      },
    },
    "lib/aiGatewayPolicy.ts": { createAiOperationBudget: () => ({ startedAt: Date.now(), maxDurationMs: 120_000 }) },
    "lib/aiMediaUnderstandingCache.ts": {
      buildVisionAnalysisCacheKey: (args: Json) => { cacheKeys.push(args); return "fixture"; },
      readVisionAnalysisCache: async () => options.cached
        ? { source: "hit", factsContext: "Éléments visuels observables : une main ouverte est massée." }
        : { source: "miss" },
      writeVisionAnalysisCache: async () => undefined,
    },
  };
  function load(relative: string): Json {
    const file = path.resolve(root, relative);
    const key = path.relative(root, file).replaceAll("\\", "/");
    if (key in overrides) return overrides[key] as Json;
    if (cache.has(file)) return cache.get(file)!;
    const moduleRecord = { exports: {} as Json }; cache.set(file, moduleRecord.exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = (id: string) => {
      if (id === "server-only") return {};
      if (id.startsWith("@/") || id.startsWith(".")) {
        const target = id.startsWith("@/") ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        return load(existsSync(target) ? target : `${target}.ts`);
      }
      return nativeRequire(id);
    };
    new Function("module", "exports", "require", "process", "console", code)(moduleRecord, moduleRecord.exports, require, { env: {} }, { info() {}, warn() {}, error() {} });
    cache.set(file, moduleRecord.exports);
    return moduleRecord.exports;
  }
  return { calls, cacheKeys,
    prompt: load("lib/boosterPrompt.ts") as typeof Prompt,
    profile: load("lib/aiGenerationProfile.ts") as typeof Profile,
    understanding: load("lib/aiMediaUnderstanding.ts") as typeof Understanding,
    generation: () => load("lib/boosterPublishGeneration.ts") as typeof Generation,
  };
}

const images = [{ dataUrl: "data:image/jpeg;base64,aGFuZHM=", detail: "high" as const }];

test("a vision writer receives the actual existing image, even if an old fast-mode flag is set", async () => {
  const h = runtime();
  const media = await h.understanding.prepareMediaForSelectedWriter({ engine: "google", images, idea: "Massage des pieds", mediaSubjectSource: "media", skipMediaVisionAnalysis: true });
  assert.deepEqual(media.imagesForWriter, images);
  assert.equal(media.visionAnalysisAvailable, true);
  assert.equal(h.calls.length, 0);
});

for (const cached of [false, true]) {
  test(`a non-vision writer uses unbiased file observations (${cached ? "cached" : "fresh"})`, async () => {
    const h = runtime({ cached });
    const media = await h.understanding.prepareMediaForSelectedWriter({ engine: "deepseek", images, idea: "Massage des pieds", accountId: "fixture", mediaSubjectSource: "media" });
    assert.equal(h.cacheKeys[0].idea, "");
    assert.match(String(h.cacheKeys[0].promptVersion), /media-first/);
    assert.match(media.writerContext, /main/);
    assert.match(media.writerContext, /déterminent le sujet/);
    assert.doesNotMatch(media.writerContext, /jamais sujet de remplacement/);
    assert.equal(media.imagesForWriter, undefined);
    if (!cached) {
      assert.deepEqual(h.calls[0].images, images);
      assert.doesNotMatch(String(h.calls[0].input), /Massage des pieds/);
    }
  });
}

test("the default Booster prompt keeps the user's subject; Agent existing-media mode changes both system and user priorities", () => {
  const h = runtime();
  const args = { idea: "Massage des pieds", theme: "conseil" as const, style: "equilibre" as const, channels: ["facebook" as const], imageCount: 1 };
  const generationProfile = h.profile.buildNormalizedAiGenerationProfile({ business: {}, idea: args.idea });
  const defaults = h.prompt.compileBoosterGenerationPrompt({ ...args, generationProfile });
  assert.match(defaults.system, /phrase libre du pro définit le sujet obligatoire/);
  assert.match(defaults.input, /La phrase libre reste prioritaire/);
  const mediaFirst = h.prompt.compileBoosterGenerationPrompt({ ...args, idea: MEDIA_FIRST_PUBLICATION_IDEA, mediaSubjectSource: "media", generationProfile });
  assert.match(mediaFirst.system, /contenu réellement observé dans le média définit le sujet obligatoire/);
  assert.match(mediaFirst.input, /LECTURE DU FICHIER → CHOIX DU SUJET → RÉDACTION/);
  assert.doesNotMatch(mediaFirst.input, /Massage des pieds|Une image ambiguë ou hors sujet peut être ignorée/);
});

for (const repair of [false, true]) {
  test(`the real shared pipeline preserves file-led writing through ${repair ? "a repair" : "primary generation"}`, async () => {
    const h = runtime({ repair });
    const result = await h.generation().generateSharedBoosterPosts({
      idea: MEDIA_FIRST_PUBLICATION_IDEA, mediaSubjectSource: "media", aiFeature: "agent.publish",
      preferredEngine: "deepseek", theme: "conseil", channels: ["facebook"], profile: {}, business: {}, imagesForAI: images,
    });
    assert.equal(result.versions.facebook?.title, "Massage des mains");
    const writers = h.calls.filter((call) => call.feature === "agent.publish");
    assert.equal(writers.length, repair ? 2 : 1);
    for (const writer of writers) {
      assert.match(String(writer.system), /contenu réellement observé dans le média définit le sujet obligatoire/);
      assert.match(String(writer.input), /main/);
      assert.doesNotMatch(String(writer.input), /Massage des pieds/);
      assert.equal(writer.images, undefined, "the selected non-vision writer uses the factual reading");
    }
  });
}

test("failed reading never falls back to an unrelated text based on metadata", async () => {
  const h = runtime({ unavailable: true });
  await assert.rejects(h.generation().generateSharedBoosterPosts({
    idea: MEDIA_FIRST_PUBLICATION_IDEA, mediaSubjectSource: "media", aiFeature: "agent.publish",
    preferredEngine: "deepseek", theme: "conseil", channels: ["facebook"], profile: {}, business: {}, imagesForAI: images,
  }), /inr_agent_media_understanding_unavailable/);
  assert.equal(h.calls.filter((call) => call.feature === "agent.publish").length, 0);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import type * as Generation from "../../lib/boosterPublishGeneration.ts";
import type * as Editor from "../../app/dashboard/booster/publier/publishModal.foundations.ts";
import type * as Cta from "../../lib/boosterCta.ts";
import { getXPostTextMetrics } from "../../lib/xChannel.ts";

type Json = Record<string, unknown>;
const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
const idea = "Votre prochain projet commence par un échange concret.";
const post = {
  title: "Un projet pensé pour vous",
  content: "Votre prochain projet commence par un échange concret. Nous prenons le temps de comprendre vos besoins et de préparer chaque étape avec vous.",
  cta: "",
  hashtags: ["Projet", "Conseil"],
};

/** Run the real prompt, generation, editor and publication modules; mock only AI I/O. */
function runtime(providerPost: Generation.ChannelPost) {
  const calls: Json[] = [];
  const cache = new Map<string, { exports: Json }>();
  const overrides: Record<string, unknown> = {
    "lib/aiGatewayClient.ts": {
      aiGenerateJSON: async (args: Json) => {
        calls.push(args);
        return { versions: { x: structuredClone(providerPost) } };
      },
    },
    "lib/aiGatewayPolicy.ts": {
      createAiOperationBudget: () => ({ startedAt: Date.now(), maxDurationMs: 120_000 }),
    },
  };
  function load(relative: string): Json {
    const file = path.resolve(root, relative);
    const key = path.relative(root, file).replaceAll("\\", "/");
    if (key in overrides) return overrides[key] as Json;
    if (cache.has(file)) return cache.get(file)!.exports;
    const moduleRecord = { exports: {} as Json };
    cache.set(file, moduleRecord);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const require = (id: string): unknown => {
      if (id === "server-only") return {};
      if (id.startsWith("@/") || id.startsWith(".")) {
        const target = id.startsWith("@/")
          ? path.resolve(root, id.slice(2))
          : path.resolve(path.dirname(file), id);
        const resolved = [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]
          .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
        assert.ok(resolved, `Cannot resolve ${id} from ${key}`);
        return load(resolved);
      }
      return nativeRequire(id);
    };
    new Function("module", "exports", "require", "process", "console", code)(
      moduleRecord, moduleRecord.exports, require, { env: {} },
      { info() {}, warn() {}, error() {} },
    );
    return moduleRecord.exports;
  }
  const generation = load("lib/boosterPublishGeneration.ts") as typeof Generation;
  const editor = load("app/dashboard/booster/publier/publishModal.foundations.ts") as typeof Editor;
  const cta = load("lib/boosterCta.ts") as typeof Cta;
  return {
    calls, editor, cta,
    generate: (publicationInstruction?: string) => generation.generateSharedBoosterPosts({
      idea, publicationInstruction, theme: "conseil", channels: ["x"],
      preferredEngine: "openai", profile: {}, business: {},
    }),
  };
}

test("X keeps both generated hashtags through the editor and the final publication text", async () => {
  const h = runtime(post);
  const result = await h.generate();
  assert.equal(h.calls.length, 1);
  const prompt = [h.calls[0].system, h.calls[0].input].join("\n");
  assert.match(prompt, /1 à 2 hashtags pertinents/);
  assert.doesNotMatch(prompt, /0 à 1 hashtag utile/);
  assert.deepEqual(result.versions.x?.hashtags, ["Projet", "Conseil"]);
  const edited = h.editor.sanitizePostsForEditor(result.versions).x;
  assert.deepEqual(edited?.hashtags, ["Projet", "Conseil"]);
  const text = h.cta.buildBoosterXPostText(edited);
  assert.match(text, /#Projet #Conseil/);
  assert.equal(getXPostTextMetrics(text).valid, true);
});

test("an explicit no-hashtags instruction reaches X generation and its empty result stays empty", async () => {
  const h = runtime({ ...post, hashtags: [] });
  const instruction = "Ne mets aucun hashtag dans cette publication.";
  const result = await h.generate(instruction);
  assert.equal(h.calls.length, 1, "an intentional empty hashtag list needs no repair");
  const prompt = [h.calls[0].system, h.calls[0].input].join("\n");
  assert.ok(prompt.includes(instruction));
  assert.match(prompt, /consigne explicite demande de ne pas ajouter de hashtags, respecte-la et renvoie hashtags: \[\]/);
  assert.deepEqual(result.versions.x?.hashtags, []);
  const edited = h.editor.sanitizePostsForEditor(result.versions).x;
  assert.deepEqual(edited?.hashtags, []);
  assert.doesNotMatch(h.cta.buildBoosterXPostText(edited), /#/);
});

test("two generated X hashtags keep the weighted budget and room for the structured phone CTA", async () => {
  const h = runtime({
    ...post,
    content: `${post.content} Chaque détail compte pour construire un résultat adapté à votre quotidien et avancer sereinement dans votre projet.`,
    cta: "Appelez-nous",
  });
  const result = await h.generate();
  const generated = result.versions.x!;
  assert.deepEqual(generated.hashtags, ["Projet", "Conseil"]);
  assert.notEqual(generated.content, `${post.content} Chaque détail compte pour construire un résultat adapté à votre quotidien et avancer sereinement dans votre projet.`);
  assert.match(generated.content, /[.!?…]$/u);
  const generatedText = [generated.title, generated.content, generated.cta, "#Projet #Conseil"].join("\n\n");
  assert.ok(getXPostTextMetrics(generatedText).weightedLength <= 252);
  const finalText = h.cta.buildBoosterXPostText({
    ...generated, ctaMode: "call", ctaPhone: "+33 6 12 34 56 78",
  });
  assert.match(finalText, /#Projet #Conseil/);
  assert.ok(finalText.includes("+33 6 12 34 56 78"));
  assert.equal(getXPostTextMetrics(finalText).valid, true);
});

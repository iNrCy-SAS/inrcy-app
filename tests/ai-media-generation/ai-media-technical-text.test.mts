import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { hasAiMediaTechnicalText, isAiMediaTechnicalCopyAllowed, fitAiMediaSceneDirection } from "../../lib/aiMediaTechnicalText.ts";

test("les codes et préfixes techniques sont détectés avant nettoyage, pas le vocabulaire métier", () => {
  for (const text of ["Couleurs : #21b8ef et #8b5cf6.", "PARAMS: portrait", "rgb(255, 128, 0)", "SUJET IMMUTABLE : robot"]) {
    assert.equal(hasAiMediaTechnicalText(text), true);
    assert.equal(isAiMediaTechnicalCopyAllowed(text, { textKeywords: [], aiInstruction: "Utilise le bleu #21b8ef dans le décor." }), false);
  }
  for (const text of ["Découvrez notre palette de couleurs.", "Livraison sur palette en 24 heures.", "Voici notre robot."]) {
    assert.equal(hasAiMediaTechnicalText(text), false);
  }
});

test("seul un texte littéral demandé autorise un code visible ou prononcé", () => {
  const value = "Notre couleur : #21b8ef";
  assert.equal(isAiMediaTechnicalCopyAllowed(value, { textKeywords: [], aiInstruction: `Afficher exactement «${value}»` }), true);
  assert.equal(isAiMediaTechnicalCopyAllowed(value, { textKeywords: [value], aiInstruction: "" }), true);
  assert.equal(isAiMediaTechnicalCopyAllowed(value, { textKeywords: [], aiInstruction: `Décor inspiré de «${value}»` }), false);
});

test("les intentions longues gardent la règle anti-récitation complète dans les 700 caractères", () => {
  const output = fitAiMediaSceneDirection(`ACTE 1 : animer le robot. ${"Consigne de couleur et mouvement. ".repeat(100)}`);
  assert.ok(output.length <= 700);
  assert.match(output, /^ACTE 1 : animer le robot/);
  assert.match(output, /appliquer sans les afficher ni les réciter\.$/);
});

const requireFromTest = createRequire(import.meta.url);
function runtime(generated: unknown) {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  let calls = 0;
  function load<T = Record<string, unknown>>(name: string): T {
    const filename = path.resolve(name);
    if (cache.has(filename)) return cache.get(filename)!.exports as T;
    const record = { exports: {} as Record<string, unknown> };
    cache.set(filename, record);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("module", "exports", "require", output)(record, record.exports, (specifier: string) => {
      if (specifier === "server-only") return {};
      if (specifier === "@/lib/aiGatewayClient") return { aiGenerateJSON: async () => { calls += 1; return generated; } };
      if (specifier.startsWith("node:")) return requireFromTest(specifier);
      const local = specifier.startsWith("@/lib/") ? path.resolve("lib", specifier.slice(6))
        : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : null;
      if (!local) throw new Error(`unexpected_test_dependency:${specifier}`);
      return load(local.endsWith(".ts") ? local : `${local}.ts`);
    });
    return record.exports as T;
  }
  const profile = load<typeof import("../../lib/aiGenerationProfile.ts")>("lib/aiGenerationProfile.ts").buildNormalizedAiGenerationProfile({ business: { company_name: "Atelier Horizon", profession: "Jardinier" }, preferences: { language: "fr" } });
  const request = load<typeof import("../../lib/aiMediaGenerationContracts.ts")>("lib/aiMediaGenerationContracts.ts").normalizeAiMediaGenerationRequest({
    requestId: "technical-text-test", source: "studio", kind: "video", durationSeconds: 8,
    subjectSource: "custom", idea: "Un robot plante un rosier", aiInstruction: "Utiliser le bleu #21b8ef dans le décor", withText: true, withNarration: true,
  });
  const plan = load<typeof import("../../lib/aiMediaCreativePlan.ts")>("lib/aiMediaCreativePlan.ts").buildAiMediaCreativePlan({ request, profile });
  return { load, args: { accountId: "test-account", request, profile, plan }, calls: () => calls };
}

test("une réponse éditoriale contaminée revient au plan local sans nouvel appel", async () => {
  const env = runtime({ headline: "Le robot embellit votre jardin", cta: "Découvrez notre savoir-faire", scenes: [{
    title: "Le robot embellit votre jardin", eyebrow: "Atelier Horizon", body: "Couleurs techniques : #21b8ef, #8b5cf6 et #e94aa5.", spokenLine: "Notre palette interne utilise les codes #21b8ef.", spokenReply: "Le robot plante un rosier avec soin.",
  }] });
  const result = await env.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline(env.args);
  assert.deepEqual(result, env.args.plan);
  assert.equal(env.calls(), 1);
  assert.doesNotMatch(result.scenes.map((scene: { body: string }) => scene.body).join(" "), /21b8ef/i);
});

test("la narration rejette les codes couleur et conserve un secours oral sans second appel", async () => {
  const env = runtime({ script: "Appliquer la palette #21b8ef et #8b5cf6, avec un cadrage large pour notre projet professionnel." });
  const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
  assert.ok(result);
  assert.equal(result.source, "safe_fallback");
  assert.equal(env.calls(), 1);
  assert.ok(result.script.length > 0);
  assert.doesNotMatch(result.script, /21b8ef|8b5cf6/i);
});

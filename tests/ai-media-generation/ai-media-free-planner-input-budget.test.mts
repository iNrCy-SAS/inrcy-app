import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as constraints from "../../lib/aiMediaGlobalConstraints.ts";
import { getAiFeaturePolicy } from "../../lib/aiGatewayPolicy.ts";
import { appendPromptOnlyJsonContract } from "../../lib/aiGatewayResponse.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";

function total(system: string, input: string, schema: Record<string, unknown>) {
  return [appendPromptOnlyJsonContract(system),
    `SCHÉMA JSON OBLIGATOIRE (respecte exactement cette structure) :\n${JSON.stringify(schema)}`].join("\n\n").length + input.length;
}

test("the production 3234+9837 overflow fits the unchanged 12000 ceiling while exact requirements survive", () => {
  const system = "R".repeat(3_234);
  const schema = { type: "object", properties: { direction: { type: "string" }, scenes: { type: "array" } } };
  const input = { brief: "Scène précise, sans slogans. ".repeat(140), exact_terms: ["49,90 €", "Atelier Test"],
    company: { identite: { entreprise: "Atelier Test" }, coordonnees: { telephone: "01 23 45 67 89" },
      liens: { site_web: "https://example.test/reserver" }, informations_demandees: ["Le tarif demandé est 49,90 € TTC."],
      description_facultative: "" } };
  input.company.description_facultative = "D".repeat(9_837 - JSON.stringify(input).length);
  assert.equal(JSON.stringify(input).length, 9_837);
  const original = structuredClone(input);
  const result = prompts.fitAiMediaEditorialInput({ system, input, schema });
  assert.ok(total(system, result, schema) <= getAiFeaturePolicy("media.video").maxInputChars);
  const decoded = JSON.parse(result);
  assert.equal(decoded.brief, input.brief);
  assert.deepEqual(decoded.exact_terms, input.exact_terms);
  for (const key of ["identite", "coordonnees", "liens", "informations_demandees"]) {
    assert.deepEqual(decoded.company[key], input.company[key as keyof typeof input.company]);
  }
  assert.deepEqual(input, original, "budgeting never mutates the account or user's source material");
  const repair = { ...input, rewrite_direction: { direction: 'Reprendre le plan "intact".\n'.repeat(50), instruction: "Conserver tous les sujets et toutes les exclusions." } };
  const repaired = prompts.fitAiMediaEditorialInput({ system, input: repair, schema });
  assert.ok(total(system, repaired, schema) <= getAiFeaturePolicy("media.video").maxInputChars);
  assert.deepEqual(JSON.parse(repaired).rewrite_direction, repair.rewrite_direction);
});

test("irreducible input refuses before any model call instead of cutting a brief, rule or exact fact", () => {
  assert.throws(() => prompts.fitAiMediaEditorialInput({ system: "R".repeat(3_234),
    input: { brief: 'Texte exact "\\"\n'.repeat(800), company: null }, schema: { type: "object" } }),
  contracts.AiMediaRequestValidationError);
});

test("the real film planner budgets account rules, escaped JSON and fallback schema together", async () => {
  const profile = { business: { companyName: "Atelier Test", professionLabel: "Artisan", sectorLabel: "Services",
    services: [1, 2, 3].map(index => `Atelier service ${index} ${"S".repeat(155)}`),
    strengths: [1, 2].map(index => `Atelier qualité ${index} ${"Q".repeat(155)}`), customerTypologies: [], interventionZones: [] },
    memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
    preferences: { language: "fr", customInstructions: `RÈGLE EXACTE ${"I".repeat(650)}`,
      forbiddenInstructions: `INTERDICTION EXACTE ${"P".repeat(650)}` } } as unknown as NormalizedAiGenerationProfile;
  const brief = `Un film sur notre atelier. ${'Le même artisan observe la matière "sans écran", puis travaille.\n'.repeat(7)}`.slice(0, 490).trim();
  const request = contracts.normalizeAiMediaGenerationRequest({ requestId: "input-budget-runtime", source: "studio", operation: "generate",
    creationMode: "free", kind: "video", format: "story", videoEngine: "omni", durationSeconds: 8,
    freePrompt: brief, useBusinessDna: true, withNarration: false, withMusic: false });
  const calls: AiGenerateJsonOptions[] = [];
  const modules = new Map<string, unknown>([
    ["server-only", {}], ["./aiMediaGlobalConstraints.ts", constraints],
    ["@/lib/aiGatewayClient", { aiGenerateJSON: async (options: AiGenerateJsonOptions) => {
      calls.push(options);
      assert.ok(total(options.system, options.input, options.responseSchema!.schema) <= getAiFeaturePolicy("media.video").maxInputChars);
      assert.equal(JSON.parse(options.input).brief, brief);
      assert.ok(options.system.includes(profile.preferences.customInstructions));
      assert.ok(options.system.includes(profile.preferences.forbiddenInstructions));
      return { direction: "Un artisan travaille la matière dans son atelier.", scenes: ["Il observe puis travaille la matière."] };
    } }],
    ["@/lib/aiEnginePreference", { getAiEngineOption: () => ({ model: "offline-planner" }) }],
    ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaVideoTimeline", timeline],
    ["@/lib/aiMediaFreeGenerationPrompt", prompts],
  ]);
  const record = { exports: {} as typeof import("../../lib/aiMediaFreeGenerationPlan.ts") };
  const native = createRequire(import.meta.url);
  const js = ts.transpileModule(readFileSync(new URL("../../lib/aiMediaFreeGenerationPlan.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("module", "exports", "require", js)(record, record.exports, (name: string) => {
    if (name.startsWith("node:")) return native(name);
    assert.ok(modules.has(name), `Unexpected offline dependency: ${name}`);
    return modules.get(name);
  });
  const plan = await record.exports.prepareAiMediaFreeCreativePlan({ accountId: "offline-only", request, profile });
  assert.equal(calls.length, 1, "budgeting adds no model call or retry");
  assert.equal(plan.scenes.length, 1);
});

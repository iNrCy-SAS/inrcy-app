import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeBusinessDnaAnalysisResponse } from "../../lib/businessDnaAnalysisResponse.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";

// Validate against the exact production route schema, including nested fields.
const route = readFileSync(new URL("../../app/api/ai-memory/analyze-channels/route.ts", import.meta.url), "utf8");
const schemaSource = route.match(/const ANALYSIS_RESPONSE_SCHEMA = ([\s\S]*?\n\} as const);/)?.[1];
assert.ok(schemaSource);
const schema = new Function(ts.transpile(`return (${schemaSource});`, { target: ts.ScriptTarget.ES2022 }))().schema;

function validAnalysis() {
  return {
    professionSuggestion: { sectorCategory: "", job: "", sourceQuote: "", confidence: "uncertain" },
    businessKnowledge: {
      description: "Description vérifiable", services: [], interventionZones: [], strengths: [], customerTypes: [],
      weeklySchedule: { notes: "", ...Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, { open: false, allDay: false, slots: [] }])) },
    },
    memory: {
      detailedDescription: "Description détaillée vérifiée", mission: "", specialties: [], targetAudiences: [], customerNeeds: [],
      differentiators: [], values: [], brandPersonality: [], commitments: [], preferredVocabulary: ["Travail soigné"], forbiddenVocabulary: [] as string[],
      offersAndArguments: "", keyArguments: "", proofsAndObjections: "", objectionResponses: "", editorialStrategy: "", campaignCalendar: "", recentNewsItems: [],
    },
  };
}

test("a complete DNA analysis with excessive vocabulary passes the canonical schema after bounded normalization", () => {
  const input = validAnalysis();
  input.memory.preferredVocabulary = ["Travail soigné", "travail soigné", ...Array.from({ length: 22 }, (_, index) => `Terme ${index}`)];
  const before = structuredClone(input);
  assert.throws(() => assertAiJsonMatchesSchema(input, schema), /preferredVocabulary.*liste trop longue/);
  const normalized = normalizeBusinessDnaAnalysisResponse(input) as typeof input;
  assert.doesNotThrow(() => assertAiJsonMatchesSchema(normalized, schema));
  assert.deepEqual(input, before, "the provider response is not mutated");
  assert.deepEqual(normalized.memory.preferredVocabulary, ["Travail soigné", ...Array.from({ length: 15 }, (_, index) => `Terme ${index}`)]);
  assert.equal(normalized.memory.detailedDescription, input.memory.detailedDescription);
  assert.deepEqual(normalized.businessKnowledge, input.businessKnowledge);
});

test("forbidden vocabulary remains capped, deduplicated and ordered like persisted memory", () => {
  const input = validAnalysis();
  input.memory.forbiddenVocabulary = ["", "  ", "Promesse", "promesse", ...Array.from({ length: 20 }, (_, index) => `Interdit ${index}`)];
  const output = normalizeBusinessDnaAnalysisResponse(input) as typeof input;
  assert.equal(output.memory.forbiddenVocabulary.length, 16);
  assert.equal(output.memory.forbiddenVocabulary[0], "Promesse");
  assert.doesNotThrow(() => assertAiJsonMatchesSchema(output, schema));
});

test("invalid entries, missing fields, unknown keys and factual schema violations are still rejected", () => {
  type MutableAnalysis = {
    memory: Record<string, unknown>;
    businessKnowledge: { weeklySchedule: Record<string, unknown> };
    professionSuggestion: Record<string, unknown>;
  };
  for (const mutate of [
    (input: MutableAnalysis) => { input.memory.preferredVocabulary = [42]; },
    (input: MutableAnalysis) => { input.memory.preferredVocabulary = [...Array.from({ length: 17 }, () => "Terme"), "x".repeat(141)]; },
    (input: MutableAnalysis) => { delete input.memory.preferredVocabulary; },
    (input: MutableAnalysis) => { input.memory.untrustedCommand = "injected"; },
    (input: MutableAnalysis) => { input.businessKnowledge.weeklySchedule.monday = { open: true, allDay: false, slots: [{ start: "99:99", end: "12:00" }] }; },
    (input: MutableAnalysis) => { input.professionSuggestion.confidence = "certain"; },
  ]) {
    const input = validAnalysis();
    mutate(input);
    assert.throws(() => assertAiJsonMatchesSchema(normalizeBusinessDnaAnalysisResponse(input), schema));
  }
});

test("valid analyses are semantically unchanged and normalization does not invent absent sections", () => {
  const input = validAnalysis();
  assert.deepEqual(normalizeBusinessDnaAnalysisResponse(input), input);
  for (const malformed of [{}, { memory: null }, { memory: [] }]) {
    assert.deepEqual(normalizeBusinessDnaAnalysisResponse(malformed), malformed);
    assert.throws(() => assertAiJsonMatchesSchema(normalizeBusinessDnaAnalysisResponse(malformed), schema));
  }
});

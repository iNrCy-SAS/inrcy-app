import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

import * as aiMemory from "../../lib/aiMemory.ts";
import {
  mergeAiBusinessDnaAnalysis,
  mergeAiMemoryPremiumFields,
  mergeAiMemoryUpdate,
  normalizeAiMemory,
} from "../../lib/aiMemory.ts";
import { businessDnaHtmlToPlainText } from "../../lib/businessDnaRichText.ts";
import { buildBusinessDnaWorkspaceSavePatch } from "../../lib/businessDnaManualAnalysisJob.ts";

const addedRichFields = ["keyArguments", "objectionResponses", "campaignCalendar"] as const;

test("strategy and identity resets clear only their own text and formatting on the active account", async () => {
  const fields = aiMemory.AI_MEMORY_PREMIUM_FIELDS;
  const original = normalizeAiMemory({
    mission: "Mission conservée",
    preferredVocabulary: ["Proximité"],
    forbiddenVocabulary: ["Miracle"],
    ...Object.fromEntries(fields.map((field) => [field, "Stratégie validée"])),
    richText: Object.fromEntries(fields.map((field) => [field, "<p><strong>Stratégie validée</strong></p>"])),
  });
  const writes: Array<{ account_id: string; memory: aiMemory.AiMemory }> = [];
  const profileWrites: Array<{ strengths: string[] }> = [];
  const reads: Array<[string, string]> = [];
  const accountId = "account-active";
  const database = {
    from(table: string) {
      if (table === "business_profiles") return {
        update(patch: { strengths: string[] }) {
          profileWrites.push(patch);
          return { async eq(column: string, value: string) {
            assert.equal(column, "user_id");
            assert.equal(value, accountId);
            return { error: null };
          } };
        },
      };
      assert.equal(table, "business_ai_memories");
      const query = {
        select() { return query; },
        eq(column: string, value: string) { reads.push([column, value]); return query; },
        async maybeSingle() { return { data: { memory: original }, error: null }; },
        async upsert(row: { account_id: string; memory: aiMemory.AiMemory }) { writes.push(row); return { error: null }; },
      };
      return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } }) } },
    "@/lib/aiMemory": aiMemory,
    "@/lib/requireUser": { requireUser: async () => ({ supabase: database, activeUserId: accountId, errorResponse: null }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: {} },
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (value: string) => assert.equal(value, accountId) },
  };
  const routePath = resolve(import.meta.dirname, "../../app/api/ai-memory/reset/route.ts");
  const compiled = ts.transpileModule(readFileSync(routePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {} as { POST: (request: Request) => Promise<Response> };
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exported);
  const response = await exported.POST(new Request("https://local.invalid/api/ai-memory/reset", { method: "POST", body: JSON.stringify({ tab: "strategy" }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(reads, [["account_id", accountId]]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].account_id, accountId);
  assert.equal(writes[0].memory.mission, original.mission);
  for (const field of fields) {
    assert.equal(writes[0].memory[field], "", `${field}: saved text is cleared`);
    assert.equal(writes[0].memory.richText[field], "", `${field}: saved formatting is cleared`);
  }
  assert.equal(writes[0].memory.richText.mission, original.richText.mission);
  const identityResponse = await exported.POST(new Request("https://local.invalid/api/ai-memory/reset", { method: "POST", body: JSON.stringify({ tab: "identity" }) }));
  assert.equal(identityResponse.status, 200);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].memory.mission, "");
  assert.equal(writes[1].memory.richText.mission, "");
  assert.deepEqual(writes[1].memory.preferredVocabulary, []);
  assert.deepEqual(writes[1].memory.forbiddenVocabulary, []);
  assert.deepEqual(profileWrites, [{ strengths: [] }]);
  for (const field of fields) {
    assert.equal(writes[1].memory[field], original[field], `${field}: identity reset preserves strategy text`);
    assert.equal(writes[1].memory.richText[field], original.richText[field], `${field}: identity reset preserves strategy formatting`);
  }
  const unifiedIdentityResponse = await exported.POST(new Request("https://local.invalid/api/ai-memory/reset", { method: "POST", body: JSON.stringify({ tab: "identity", preserveVocabulary: true }) }));
  assert.equal(unifiedIdentityResponse.status, 200);
  assert.equal(writes.length, 3);
  assert.equal(writes[2].memory.mission, "");
  assert.deepEqual(writes[2].memory.preferredVocabulary, original.preferredVocabulary);
  assert.deepEqual(writes[2].memory.forbiddenVocabulary, original.forbiddenVocabulary);
});

test("mission keeps its historical aliases, formatting and 800-character limit on all editions", () => {
  const old = normalizeAiMemory({ raison_d_etre: "Une **mission** utile" });
  assert.equal(old.mission, "Une mission utile");
  assert.match(old.richText.mission, /<strong>mission<\/strong>/);
  const formatted = mergeAiMemoryUpdate(old, {
    mission: "Une mission précise",
    richText: { mission: "<p>Une <em>mission précise</em></p>" },
  });
  assert.equal(formatted.richText.mission, "<p>Une <em>mission précise</em></p>");
  const standard = normalizeAiMemory(JSON.parse(JSON.stringify(formatted)), { includePremium: false });
  assert.equal(standard.mission, formatted.mission);
  assert.equal(standard.richText.mission, formatted.richText.mission);
  assert.equal(normalizeAiMemory({ mission: "m".repeat(900) }).mission.length, 800);
});

test("mission-only text changes or deletion cannot retain stale formatting", () => {
  const current = normalizeAiMemory({ mission: "Ancienne mission", richText: { mission: "<p><strong>Ancienne mission</strong></p>" } });
  const edited = mergeAiMemoryUpdate(current, { purpose: "Nouvelle mission" });
  assert.equal(edited.mission, "Nouvelle mission");
  assert.equal(businessDnaHtmlToPlainText(edited.richText.mission), "Nouvelle mission");
  assert.doesNotMatch(edited.richText.mission, /Ancienne/);
  const deleted = mergeAiMemoryUpdate(edited, { mission: "" });
  assert.equal(deleted.mission, "");
  assert.equal(deleted.richText.mission, "");
});

test("mission formatting-only patches remain safe and preserve concurrent analysis fields", () => {
  const previous = normalizeAiMemory({ mission: "Mission validée" });
  const next = normalizeAiMemory({ ...previous, richText: { ...previous.richText, mission: '<p onclick="bad()"><strong>Mission validée</strong></p><script>bad()</script>' } });
  const patch = buildBusinessDnaWorkspaceSavePatch(previous, next);
  const merged = mergeAiMemoryUpdate({ ...previous, specialties: ["Nouvelle spécialité analysée"] }, patch);
  assert.equal(merged.richText.mission, "<p><strong>Mission validée</strong></p>");
  assert.equal(merged.mission, previous.mission);
  assert.deepEqual(merged.specialties, ["Nouvelle spécialité analysée"]);
  const analyzed = mergeAiBusinessDnaAnalysis(merged, {}, { mission: "Suggestion à ne pas imposer" }, {});
  assert.equal(analyzed.memory.mission, previous.mission);
  assert.equal(analyzed.memory.richText.mission, merged.richText.mission);
});

for (const field of addedRichFields) {
  test(`${field}: legacy text remains readable and gains a safe rich-text fallback`, () => {
    const memory = normalizeAiMemory({ [field]: "Un **argument** utile\n- Premier point\n- Second point" });
    assert.equal(memory[field], "Un argument utile\n- Premier point\n- Second point");
    assert.match(memory.richText[field], /<strong>argument<\/strong>/);
    assert.match(memory.richText[field], /<ul><li>Premier point<\/li><li>Second point<\/li><\/ul>/);
    assert.deepEqual(normalizeAiMemory(JSON.parse(JSON.stringify(memory))), memory);
  });

  test(`${field}: saved formatting survives JSON persistence and unrelated updates`, () => {
    const html = "<h3>Un titre</h3><p><strong>Argument</strong> <em>précis</em></p><ul><li>Un fait vérifié</li></ul>";
    const text = businessDnaHtmlToPlainText(html);
    const saved = mergeAiMemoryUpdate({}, { [field]: text, richText: { [field]: html } });
    const reloaded = normalizeAiMemory(JSON.parse(JSON.stringify(saved)));
    assert.equal(reloaded[field], text);
    assert.equal(reloaded.richText[field], html);
    const unrelated = mergeAiMemoryUpdate(reloaded, { mission: "Mission actualisée" });
    assert.equal(unrelated[field], text);
    assert.equal(unrelated.richText[field], html);
  });

  test(`${field}: edited text regenerates its HTML and explicit deletion clears both representations`, () => {
    const current = normalizeAiMemory({
      [field]: "Ancien argument",
      offersAndArguments: "Offre conservée",
      richText: { [field]: "<p><strong>Ancien argument</strong></p>", offersAndArguments: "<p><em>Offre conservée</em></p>" },
    });
    const edited = mergeAiMemoryUpdate(current, { [field]: "Nouvel argument" });
    assert.equal(businessDnaHtmlToPlainText(edited.richText[field]), "Nouvel argument");
    assert.doesNotMatch(edited.richText[field], /Ancien/);
    assert.equal(edited.richText.offersAndArguments, current.richText.offersAndArguments);
    const deleted = mergeAiMemoryUpdate(edited, { [field]: "" });
    assert.equal(deleted[field], "");
    assert.equal(deleted.richText[field], "");
  });

  test(`${field}: HTML is sanitized, text stays within 3000 characters and premium boundaries are preserved`, () => {
    const bounded = normalizeAiMemory({ [field]: "a".repeat(3100) });
    assert.equal(bounded[field].length, 3000);
    const memory = normalizeAiMemory({
      [field]: "Argument vérifié",
      richText: { [field]: '<p onclick="bad()"><strong>Argument vérifié</strong></p><script>bad()</script><img src=x onerror=bad()>' },
    });
    assert.equal(memory.richText[field], "<p><strong>Argument vérifié</strong></p>");
    const core = normalizeAiMemory(memory, { includePremium: false });
    assert.equal(core[field], "");
    assert.equal(core.richText[field], "");
    const restored = mergeAiMemoryPremiumFields(core, memory);
    assert.equal(restored[field], memory[field]);
    assert.equal(restored.richText[field], memory.richText[field]);
  });

  test(`${field}: formatting-only patches persist without overwriting concurrent analysis or manual text`, () => {
    const previous = normalizeAiMemory({ [field]: "Argument validé", richText: { [field]: "<p>Argument validé</p>" } });
    const next = normalizeAiMemory({ ...previous, richText: { ...previous.richText, [field]: "<p><strong>Argument validé</strong></p>" } });
    const patch = buildBusinessDnaWorkspaceSavePatch(previous, next);
    assert.deepEqual(patch, { richText: { [field]: "<p><strong>Argument validé</strong></p>" } });
    const concurrent = { ...previous, mission: "Nouvelle mission trouvée par l’analyse" };
    const merged = mergeAiMemoryUpdate(concurrent, patch);
    assert.equal(merged.mission, concurrent.mission);
    assert.equal(merged[field], previous[field]);
    assert.equal(merged.richText[field], next.richText[field]);
    const analysis = mergeAiBusinessDnaAnalysis(merged, {}, { [field]: "Suggestion IA à ne pas imposer" }, {}, { includePremium: true });
    assert.equal(analysis.memory[field], previous[field]);
    assert.equal(analysis.memory.richText[field], next.richText[field]);
  });
}

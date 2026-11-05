import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { normalizeAiMemory, normalizeAiBusinessKnowledge } from "../../lib/aiMemory.ts";
import { getGeneratorRecommendation, sanitizeGeneratorBusinessSettings } from "../../lib/generatorSettings.ts";
type Row = Record<string, unknown>;
function callback(path: string, context: Row) {
  const source = ts.createSourceFile(path, readFileSync(new URL(`../../app/dashboard/${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let code = ""; function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(source) === "useInrAssistantRefresh") { const argument = node.arguments[0]; assert.ok(ts.isObjectLiteralExpression(argument)); const property = argument.properties.find(item => item.name?.getText(source) === "refresh"); assert.ok(property && ts.isPropertyAssignment(property)); code = property.initializer.getText(source); } ts.forEachChild(node, visit); } visit(source); assert.ok(code);
  return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) as (context: { accountId: string; canApply: () => boolean }) => Promise<boolean>;
}
test("the actual ADN refresh callback applies current native data, remounts clean child forms and never autosaves it", async () => {
  for (const mode of ["apply", "dirty_before", "dirty_during", "memory_during", "saving_during", "upload_during", "voice_during", "scope_during", "foreign_memory", "foreign_quota", "unmounted", "stale", "timer"]) {
    let account = "a"; const events: string[] = [], requests: Array<{ url: string; options: Row }> = [];
    const memoryRef = { current: normalizeAiMemory({ detailedDescription: "Ancien texte" }, { includePremium: true }) }, businessKnowledgeRef = { current: normalizeAiBusinessKnowledge({ description: "Ancien texte" }) };
    const signature = (memory: unknown, knowledge: unknown) => JSON.stringify([memory, knowledge]); let baseline = signature(memoryRef.current, businessKnowledgeRef.current);
    const savedSignatureRef = { get current() { return baseline; }, set current(value: string) { baseline = value; events.push("baseline"); } };
    const profileDraftRef = { current: { dirty: mode === "dirty_before" } }, activityDraftRef = { current: { dirty: false } }, locationDraftRef = { current: { dirty: false } }, assistantBusyRef = { current: false }, memorySaveRunningRef = { current: false }, voiceTargetRef = { current: null as string | null }, revisions: Record<string, number> = { profile: 0, activity: 0, location: 0 };
    const payload = { ok: true, accountId: "a", strategyEnabled: true, memory: { detailedDescription: "Mémoire fraîche", referenceDocuments: [{ id: "fresh", name: "Catalogue.pdf" }] }, businessKnowledge: { description: "Entreprise fraîche", services: ["Service réel"], strengths: ["Point fort"] } };
    const context: Row = { Promise, workspaceSignature: signature, workspaceMountedRef: { current: mode !== "unmounted" }, assistantBusyRef, memorySaveRunningRef, workspaceSavePromiseRef: { current: null }, voiceTargetRef, autoSaveTimerRef: { current: mode === "timer" ? 1 : null }, profileDraftRef, activityDraftRef, locationDraftRef, memoryRef, businessKnowledgeRef, savedSignatureRef, analysisAccountIdRef: { current: "a" }, workspaceOwnerRef: { current: { accountId: "a", browserScope: "a" } }, failedAutoSaveSignatureRef: { current: "old_failure" }, getActiveBrowserUserId: () => account,
      normalizeAiMemory, normalizeAiBusinessKnowledge, parseAnalysisQuota: (value: unknown) => value, parseAnalysisChannels: (value: unknown) => value, parseBusinessDnaManualAnalysisJob: () => null, isBusinessDnaManualAnalysisPending: () => false, summaryFromAnalysisJob: () => null, t: (key: string) => key,
      updateMemory: (value: typeof memoryRef.current) => { events.push("memory"); memoryRef.current = value; }, updateBusinessKnowledge: (value: typeof businessKnowledgeRef.current) => { events.push("knowledge"); businessKnowledgeRef.current = value; },
      setAnalysisQuota: () => {}, setAnalysisChannels: () => {}, setAnalysisJob: () => {}, setAnalyzing: () => {}, setAnalysisError: () => {}, setAnalysisSummary: () => {}, setError: () => {}, setWorkspaceError: () => {}, setAutoSaveState: (value: string) => { assert.equal(value, "idle"); },
      setProfileContentRevision: (update: (value: number) => number) => { revisions.profile = update(revisions.profile); }, setActivityContentRevision: (update: (value: number) => number) => { revisions.activity = update(revisions.activity); }, setLocationContentRevision: (update: (value: number) => number) => { revisions.location = update(revisions.location); },
      fetch: async (url: string, options: Row) => { requests.push({ url, options }); if (mode === "dirty_during") activityDraftRef.current.dirty = true; if (mode === "memory_during") memoryRef.current = normalizeAiMemory({ detailedDescription: "Saisie en cours" }); if (mode === "saving_during") memorySaveRunningRef.current = true; if (mode === "upload_during") assistantBusyRef.current = true; if (mode === "voice_during") voiceTargetRef.current = "mission"; if (mode === "scope_during") account = "b";
        return { ok: true, json: async () => url.endsWith("analyze-channels") ? { ok: true, accountId: mode === "foreign_quota" ? "b" : "a", channels: [], quota: {}, job: null } : { ...payload, accountId: mode === "foreign_memory" ? "b" : "a" } }; },
    };
    const refresh = callback("settings/_components/AiMemoryContent.tsx", context), result = await refresh({ accountId: "a", canApply: () => mode !== "stale" });
    assert.equal(result, mode === "apply", mode); assert.deepEqual(events, mode === "apply" ? ["baseline", "memory", "knowledge"] : [], mode); assert.deepEqual(revisions, mode === "apply" ? { profile: 1, activity: 1, location: 1 } : { profile: 0, activity: 0, location: 0 }, mode);
    for (const request of requests) assert.equal(request.options.method, undefined);
    if (mode === "apply") { assert.equal(signature(memoryRef.current, businessKnowledgeRef.current), baseline); assert.equal((context.failedAutoSaveSignatureRef as { current: unknown }).current, null); assert.equal(memoryRef.current.detailedDescription, "Entreprise fraîche"); }
  }
});
test("the actual generator refresh callback preserves local edits and never rewrites saved business assumptions", async () => {
  for (const mode of ["apply", "dirty_before", "edit_during", "saving_during", "scope_during", "stale", "error"]) {
    let account = "a"; const initial = JSON.stringify([500, 20, null]), applied: unknown[] = [], selects: string[] = [], current = { signature: initial, busy: false }, savedSignatureRef = { current: mode === "dirty_before" ? "other" : initial };
    const query = (table: string) => { const api = { select: (columns: string) => { selects.push(columns); return api; }, eq: (key: string, value: string) => { assert.equal(key, "user_id"); assert.equal(value, "a"); return api; }, maybeSingle: async () => { if (mode === "edit_during") current.signature = "new-edit"; if (mode === "saving_during") current.busy = true; if (mode === "scope_during") account = "b"; return { data: table === "profiles" ? { avg_basket: 650, lead_conversion_rate: 25 } : { sector: null }, error: mode === "error" ? new Error("unavailable") : null }; } }; return api; };
    const refresh = callback("_components/GeneratorSettingsModal.tsx", { Promise, JSON, assistantCurrentRef: { current }, savedSignatureRef, getActiveBrowserUserId: () => account, createClient: () => ({ from: query }), getGeneratorRecommendation, sanitizeGeneratorBusinessSettings, setSector: (value: unknown) => applied.push(value), setAvgBasket: (value: unknown) => applied.push(value), setConversionRate: (value: unknown) => applied.push(value), setSaved: () => {}, setError: () => {} });
    assert.equal(await refresh({ accountId: "a", canApply: () => mode !== "stale" }), mode === "apply", mode); assert.deepEqual(applied, mode === "apply" ? [null, 650, 25] : [], mode); assert.ok(selects.every(value => ["avg_basket,lead_conversion_rate", "sector"].includes(value))); if (mode === "apply") assert.equal(savedSignatureRef.current, JSON.stringify([650, 25, null]));
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { normalizeAiMediaGeneratorPreferences } from "../../lib/aiMediaGenerationPreferences.ts";
import { isInrAssistantStudioForgetPreferenceRequest } from "../../lib/inrAssistantStudioPreferenceIntent.ts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002";
const instruction = "Désactive la mémorisation du bloc 3 de mon Studio.";
function harness(message = instruction) {
  let account = ACCOUNT, actor = ACTOR, ignore = false, afterPatch = () => {}, failRead = false;
  let preferences = normalizeAiMediaGeneratorPreferences(null); preferences.blocks[3].saved = true; preferences.blocks[5].saved = true;
  const calls: Array<Record<string, unknown>> = [];
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) }, "@/app/api/media-generation/preferences/route": {
    GET: async () => failRead ? Response.json({ ok: false }, { status: 503 }) : Response.json({ ok: true, preferences }),
    PATCH: async (request: Request) => { const body = await request.json(); calls.push(body); assert.equal(request.headers.get("cookie"), "session=fixture"); assert.equal(request.headers.has("x-cron-secret"), false); if (!ignore) { const next = normalizeAiMediaGeneratorPreferences(null); preferences = { ...preferences, blocks: { ...preferences.blocks, [body.blockId]: next.blocks[body.blockId as 1 | 2 | 3 | 4 | 5 | 6] } }; } afterPatch(); return Response.json({ ok: true, preferences }); },
  } });
  const { createInrAssistantStudioPreferenceTools } = load<typeof import("../../lib/inrAssistantStudioPreferenceTools.ts")>("lib/inrAssistantStudioPreferenceTools.ts");
  const tools = createInrAssistantStudioPreferenceTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=fixture", "x-cron-secret": "never-forward" } }), accountId: ACCOUNT, actorUserId: ACTOR, edition: "basic", currentUserMessage: message });
  const run = (blockId = 3, instructionQuote = message) => tools.forgetStudioPreferenceBlock.execute!({ blockId, instructionQuote } as never, { toolCallId: "unit", messages: [] }) as Promise<Record<string, unknown>>;
  return { tools, run, calls, get preferences() { return preferences; }, account(value: string) { account = value; }, actor(value: string) { actor = value; }, lostRead() { afterPatch = () => { failRead = true; }; }, ignoreWrite() { ignore = true; }, switchAfter() { afterPatch = () => { account = "another"; }; } };
}
test("Basic Studio forget uses the native atomic block reset and preserves other blocks without generating media", async () => {
  const h = harness(), before = structuredClone(h.preferences.blocks[5]);
  const result = await h.run(); assert.equal(result.ok, true); assert.equal(result.status, "saved"); assert.deepEqual(h.calls, [{ blockId: 3, saved: false, defaults: null }]);
  assert.equal(h.preferences.blocks[3].saved, false); assert.deepEqual(h.preferences.blocks[5], before);
  assert.equal((await h.run()).ok, true); assert.equal(h.calls.length, 1, "same factory repeats its verified receipt without another mutation");
  const fresh = harness("Désactive la mémorisation du bloc 1 du Studio."); assert.equal((await fresh.run(1)).status, "already_applied"); assert.equal(fresh.calls.length, 0);
  const read = await h.tools.readStudioSavedPreferences.execute!({}, { toolCallId: "unit", messages: [] }) as Record<string, unknown>; assert.equal(read.ok, true); assert.equal((read.blocks as Array<{ blockId: number; saved: boolean }>).find(block => block.blockId === 3)?.saved, false);
  h.account("other"); assert.equal((await h.run()).ok, false, "a cached receipt cannot be reused after an account switch"); assert.equal(h.calls.length, 1);
});
test("Studio forget intent binds the saved numbered block to its current explicit request", async () => {
  for (const message of [instruction, "Peux-tu désactiver la mémorisation du bloc 3 du générateur de médias ?", "Oublie les réglages mémorisés du bloc 3 de mon Studio."]) assert.equal(isInrAssistantStudioForgetPreferenceRequest(message, 3), true, message);
  for (const message of ["Supprime la photo du bloc 3 de mon Studio.", "Oublie cette conversation sur le bloc 3 du Studio.", "Comment désactiver la mémorisation du bloc 3 du Studio ?", "Peux-tu m’expliquer comment désactiver la mémorisation du bloc 3 du Studio ?", "Ne désactive pas la mémorisation du bloc 3 du Studio.", "Si je confirme, désactive la mémorisation du bloc 3 du Studio.", "« Désactive la mémorisation du bloc 3 du Studio. »", "Désactive la mémorisation du bloc 5 du Studio.", "Désactive la mémorisation des blocs 3 et 5 du Studio."]) {
    const h = harness(message); assert.equal((await h.run()).ok, false, message); assert.equal(h.calls.length, 0);
  }
});
test("Studio forget refuses wrong actor/account and cannot acknowledge an unconfirmed write or stale readback", async () => {
  for (const mutate of [(h: ReturnType<typeof harness>) => h.account("other"), (h: ReturnType<typeof harness>) => h.actor("other"), (h: ReturnType<typeof harness>) => h.ignoreWrite(), (h: ReturnType<typeof harness>) => h.lostRead(), (h: ReturnType<typeof harness>) => h.switchAfter()]) {
    const h = harness(); mutate(h); const result = await h.run(); assert.equal(result.ok, false); await h.run(); assert.ok(h.calls.length <= 1, "uncertainty never triggers another native PATCH");
  }
});
test("the actual Studio preference refresh updates saved flags only when idle and ignores another account epoch", async () => {
  const file = "app/dashboard/_hooks/useAiMediaGeneratorPreferences.ts", source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let callback: ts.Expression | undefined; const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantRefresh" && ts.isObjectLiteralExpression(node.arguments[0])) { const refresh = node.arguments[0].properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(ast) === "refresh"); if (refresh && ts.isPropertyAssignment(refresh)) callback = refresh.initializer; } ts.forEachChild(node, visit); }; visit(ast); assert.ok(callback);
  const compiled = ts.transpileModule(`(${callback.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  const updates: unknown[] = []; let release: ((value: unknown) => void) | undefined;
  const deps = { loaded: true, loading: false, savingBlockIds: new Set(), accountEpochRef: { current: 1 }, preferenceMutationRef: { current: 0 }, patchControllersRef: { current: new Set() }, PREFERENCES_ENDPOINT: "/api/media-generation/preferences", fetch: async () => new Promise(resolve => { release = resolve; }), readPreferencesResponse: async (value: unknown) => value, setPreferences: (value: unknown) => updates.push(value) };
  const callbackFn = vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`, { AbortController })(deps) as (context: { canApply: () => boolean }) => Promise<boolean>;
  let canApply = true; const refresh = () => callbackFn({ canApply: () => canApply });
  deps.savingBlockIds.add(3); assert.equal(await refresh(), false); assert.equal(release, undefined); deps.savingBlockIds.clear();
  const pending = refresh(); deps.accountEpochRef.current = 2; release!({ blocks: {} }); assert.equal(await pending, false); assert.equal(updates.length, 0);
  const racing = refresh(); deps.preferenceMutationRef.current += 1; release!({ stale: true }); assert.equal(await racing, false); assert.equal(updates.length, 0, "a local save started during refresh must preserve its newer saved flags");
  const superseded = refresh(); canApply = false; release!({ stale: true }); assert.equal(await superseded, false); assert.equal(updates.length, 0); canApply = true;
  const valid = refresh(); const latest = { blocks: { 3: { saved: false } } }; release!(latest); assert.equal(await valid, true); assert.deepEqual(updates, [latest]); assert.equal(deps.patchControllersRef.current.size, 0);
});

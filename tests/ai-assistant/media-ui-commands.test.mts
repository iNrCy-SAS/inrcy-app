import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as media from "../../lib/inrAssistantMediaUiCommands.ts";
import { isInrAssistantScreenCommandRequest, parseInrAssistantUiCommand } from "../../lib/inrAssistantUiCommands.ts";
import { parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";
import { loadInrAssistantLibraryVideo } from "../../lib/inrAssistantMediaUiClient.ts";
import type * as Tools from "../../lib/inrAssistantMediaUiTools.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const cases = [
  { name: "select_video_source", request: "Choisis cette vidéo comme source", id: "editor_local", path: "/dashboard/generer-media", patch: { mediaId: ID } },
  { name: "save_video_retouch", request: "Enregistre cette retouche vidéo", id: "editor_local", path: "/dashboard/generer-media", patch: {} },
  { name: "optimize_media", request: "Compresse cette vidéo", id: ID, path: "/dashboard/mediatheque", patch: { targetBytes: 20_000_000 } },
  { name: "optimize_media", request: "Compresse cette vidéo", id: "library_editor", path: "/dashboard/mediatheque", patch: { targetBytes: 20_000_000, mediaId: ID } },
] as const;
function harness(owner = "active", active = "active", type = "video") {
  const dependencies: Record<string, unknown> = { "server-only": {}, "./requireUser": { requireUser: async () => ({ activeUserId: active }) }, "./inrAssistantMediaUiCommands.ts": media };
  const moduleRecord = { exports: {} as typeof Tools };
  const code = ts.transpileModule(readFileSync("lib/inrAssistantMediaUiTools.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,moduleRecord,exports){${code}\n})`, {})(
    (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, moduleRecord, moduleRecord.exports);
  const queries: Record<string, unknown>[] = [];
  const supabase = { from(table: string) { assert.equal(table, "pro_media_library"); const filters: Record<string, unknown> = {}; queries.push(filters);
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() { return { error: null, data: { id: ID, user_id: owner, media_type: type, is_active: true, upload_status: "uploaded" } }; } }; return query;
  } } as unknown as NonNullable<Parameters<typeof moduleRecord.exports.prepareInrAssistantMediaUiAction>[1]["supabase"]>;
  return { run: moduleRecord.exports.prepareInrAssistantMediaUiAction, supabase, queries };
}
for (const scenario of cases) {
  test(`${scenario.name}: exact screen/revision, original instruction and active account required`, async () => {
    const fixture = harness();
    const context = parseInrAssistantClientContext({ screen: { pathname: scenario.path, selection: { kind: "media", id: scenario.id }, revision: "revision_1", availableCommands: [scenario.name] } });
    assert.ok(context?.screen?.availableCommands?.includes(scenario.name));
    const options = { accountId: "active", currentUserMessage: scenario.request, supabase: fixture.supabase, clientContext: context, isRequest: isInrAssistantScreenCommandRequest };
    const input = { command: scenario.name, instructionQuote: scenario.request, patch: scenario.patch };
    const success = await fixture.run(input, options);
    assert.equal(success?.ok, true);
    assert.equal(success && "uiCommand" in success && parseInrAssistantUiCommand(success.uiCommand)?.command, scenario.name);
    if (scenario.name !== "save_video_retouch") assert.deepEqual(fixture.queries, [{ user_id: "active", id: ID }]);
    for (const message of ["Comment " + scenario.request, "Ne " + scenario.request, scenario.request + " si je confirme", "Lis ceci : « " + scenario.request + " »", "Lis : '" + scenario.request + "'", "Lis : ```txt\n" + scenario.request + "\nencore"])
      assert.equal((await fixture.run({ ...input, instructionQuote: message }, { ...options, currentUserMessage: message }))?.ok, false, message);
    for (const clientContext of [null, { ...context!, screen: { ...context!.screen!, revision: undefined } }, { ...context!, screen: { ...context!.screen!, availableCommands: [] } }])
      assert.equal((await fixture.run(input, { ...options, clientContext }))?.ok, false);
    assert.equal((await fixture.run(input, { ...options, canStartWork: () => false }))?.ok, false);
    assert.equal((await harness("active", "other").run(input, options))?.ok, false);
    if (scenario.name !== "save_video_retouch") assert.equal((await fixture.run(input, { ...options, supabase: harness("other").supabase }))?.ok, false);
    assert.equal((await fixture.run({ ...input, patch: { ...input.patch, deleteOriginal: true } }, options))?.ok, false);
  });
}

test("source commands reject arbitrary URLs and optimization rejects invalid targets/routes", () => {
  const target = { selection: { kind: "media", id: ID }, revision: "revision_1" };
  assert.equal(parseInrAssistantUiCommand({ ...target, command: "select_video_source", mediaId: "https://outside.invalid/video.mp4" }), null);
  for (const targetBytes of [0, 4_999_999, 75_000_001, 20_000_000.5, "20000000", NaN]) assert.equal(parseInrAssistantUiCommand({ ...target, command: "optimize_media", targetBytes }), null);
  const wrong = parseInrAssistantClientContext({ screen: { pathname: "/dashboard/ads", ...target, availableCommands: cases.map(value => value.name) } });
  assert.equal(wrong?.screen?.availableCommands, undefined);
});

test("native video lookup accepts only the exact owned endpoint item and ignores late source/account changes", async () => {
  const item = { id: ID, media_type: "video", size_bytes: 123, signed_url: `/api/media-library/items/${ID}/content?token=owned-test` };
  let active = true;
  const fetcher: typeof fetch = async (input, init) => { assert.equal(input, `/api/media-library/items?id=${ID}`); assert.ok(init?.signal); return Response.json({ items: [item] }); };
  assert.equal((await loadInrAssistantLibraryVideo(ID, () => active, fetcher))?.id, ID);
  for (const invalid of [{ ...item, id: "other" }, { ...item, media_type: "audio" }, { ...item, signed_url: "https://outside.invalid/file" }, { ...item, is_active: false }, { ...item, size_bytes: 0 }])
    assert.equal(await loadInrAssistantLibraryVideo(ID, () => true, async () => Response.json({ items: [invalid] })), null);
  assert.equal(await loadInrAssistantLibraryVideo(ID, () => active, async () => { active = false; return Response.json({ items: [item] }); }), null);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { canOpenPublishWizardStep } from "../../app/dashboard/booster/publier/components/publishWizard.ts";

type Handler = { invoke: (value: string | null, stillCurrent?: () => boolean) => void | Promise<void>; matches: (state: unknown, value: string | null) => boolean };
function actual<T>(file: string, id: string, argument: number, deps: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call: ts.CallExpression | undefined; const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && ["useInrAssistantLocalInterface", "useInrAssistantLocalClose"].includes(node.expression.getText(ast)) && node.arguments[0]?.getText(ast) === JSON.stringify(id)) call = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(call, `${id} registration`);
  const compiled = ts.transpileModule(`(${call.arguments[argument].getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as T;
}

test("the actual Booster wizard controls navigate only available native steps and await the committed destination", () => {
  const steps = ["channels", "intention", "content", "media", "control", "publication"], pending: string[] = [];
  const state = { mode: "ai" as const, channelCount: 1, contentReady: true, busy: false };
  const handlers = actual<Record<string, Handler>>("app/dashboard/booster/publier/components/PublishWizardFrame.tsx", "publication_wizard", 2, {
    steps, visibleStep: "content", previousStep: "intention", nextStep: "media", nextDisabled: false, canOpenStep: (step: Parameters<typeof canOpenPublishWizardStep>[0]) => canOpenPublishWizardStep(step, state), onOpenStep: (step: string) => pending.push(step), onPrevious: () => pending.push("intention"), onNext: () => pending.push("media"),
  });
  handlers.next.invoke(null); assert.deepEqual(pending, ["media"]); assert.equal(handlers.next.matches({ step: "content" }, null), false); assert.equal(handlers.next.matches({ step: "media" }, null), true);
  handlers.previous.invoke(null); handlers.select.invoke("channels"); assert.deepEqual(pending, ["media", "intention", "channels"]);
  for (const value of ["publication", "results", "validation", "generate", "https://foreign.test"]) assert.throws(() => handlers.select.invoke(value));
  state.busy = true; assert.throws(() => handlers.next.invoke(null)); assert.throws(() => handlers.previous.invoke(null));
  const source = readFileSync(new URL("../../app/dashboard/booster/publier/PublishModal.tsx", import.meta.url), "utf8");
  assert.match(source, /onPrevious=\{previousWizardStep \? \(\) => openWizardStep\(previousWizardStep\)/); assert.match(source, /onNext=\{nextWizardStep \? \(\) => openWizardStep\(nextWizardStep\)/);
});

test("the actual channel statistics detail control switches its displayed native chart without changing another channel", () => {
  let view = true; const deps = { model: { key: "facebook", loading: false }, trend: {}, statsReady: true, setShowEvolution: (value: boolean) => { view = value; } };
  const handlers = actual<Record<string, Handler>>("app/dashboard/stats/stats.ui.tsx", "stats_channel_detail", 2, deps);
  handlers.select.invoke("distribution"); assert.equal(view, false); assert.equal(handlers.select.matches({ channel: "facebook", view: "evolution" }, "distribution"), false); assert.equal(handlers.select.matches({ channel: "facebook", view: "distribution" }, "distribution"), true); assert.equal(handlers.select.matches({ channel: "instagram", view: "distribution" }, "distribution"), false);
  handlers.select.invoke("evolution"); assert.equal(view, true); assert.throws(() => handlers.select.invoke("all")); deps.statsReady = false; assert.throws(() => handlers.select.invoke("evolution"));
  for (const forceOpen of [false, true]) for (const hideDetailsToggle of [false, true]) assert.equal(actual<boolean>("app/dashboard/stats/stats.ui.tsx", "stats_channel_detail", 3, { ...deps, statsReady: true, forceOpen, hideDetailsToggle, detailsOpen: true }), forceOpen && hideDetailsToggle, "only the unique mounted channel Cube is registered");
});

test("the actual image dialog selects only a currently existing overlay and preserves its guarded native close callback", () => {
  let active = 0; const deps = { open: true, saving: false, overlay: { items: [{}, {}] }, getImageOverlayItems: (value: { items: unknown[] }) => value.items, activeOverlayIndex: 0, setActiveOverlayIndex: (value: number) => { active = value; } };
  const controls = actual<{ handlers: Record<string, Handler> }>("app/dashboard/_components/channel-image-adapter/modal.tsx", "channel_image_dialog", 5, deps);
  controls.handlers.select.invoke("1"); assert.equal(active, 1); assert.equal(controls.handlers.select.matches({ activeOverlayIndex: 0 }, "1"), false); assert.equal(controls.handlers.select.matches({ activeOverlayIndex: 1 }, "1"), true);
  for (const value of ["2", "-1", "1.5", "01", "save", null]) assert.throws(() => controls.handlers.select.invoke(value)); deps.saving = true; assert.throws(() => controls.handlers.select.invoke("0"));
});

test("the actual media import controls alter only locally staged files and never upload or delete a stored medium", () => {
  const files = [{ name: "a.jpg" }, { name: "b.jpg" }, { name: "c.jpg" }], operations: unknown[] = [];
  const deps = { importOpen: true, uploading: false, files, getClientFileId: (file: { name: string }) => file.name, clearSelectedFiles: () => operations.push("clear"), removeSelectedFile: (index: number) => operations.push(index), setImportOpen: (open: boolean) => operations.push(open) };
  const controls = actual<{ handlers: Record<string, Handler> }>("app/dashboard/mediatheque/MediaLibraryClient.tsx", "media_import", 5, deps);
  controls.handlers.select.invoke('{"removeIndex":1}'); assert.deepEqual(operations, [1]); assert.equal(controls.handlers.select.matches({ fileKeys: ["a.jpg", "b.jpg", "c.jpg"] }, '{"removeIndex":1}'), false); assert.equal(controls.handlers.select.matches({ fileKeys: ["a.jpg", "c.jpg"] }, '{"removeIndex":1}'), true);
  for (const value of ['{"removeIndex":3}', '{"removeIndex":-1}', '{"removeIndex":1,"upload":true}', '{"removeIndex":"1"}', 'null', 'delete', null]) assert.throws(() => controls.handlers.select.invoke(value));
  controls.handlers.clear.invoke(null); assert.equal(controls.handlers.clear.matches({ fileKeys: [] }, null), true); deps.uploading = true; assert.throws(() => controls.handlers.clear.invoke(null));
  const closed = actual<{ handlers: Record<string, Handler> }>("app/dashboard/mediatheque/MediaLibraryClient.tsx", "media_import", 5, { ...deps, uploading: false, importOpen: false }); assert.equal(closed.handlers.clear, undefined); closed.handlers.open.invoke(null); assert.equal(operations.at(-1), true);
});

test("the actual Studio library and reference information controls preserve native visibility, capacity and operation locks", () => {
  for (const [file, id, deps] of [
    ["MediaGenerator", "studio_guided_library", { operationLocked: false, referencePickerVisible: true, transformMode: false, inspirationImages: [], MAX_INSPIRATION_IMAGES: 5, setLibraryPickerOpen: () => {} }],
    ["MediaFreeGenerator", "studio_free_library", { locked: false, referencePickerVisible: true, references: [], AI_MEDIA_INSPIRATION_MAX_COUNT: 5, setLibraryOpen: () => {} }],
    ["MediaRetoucher", "studio_retouch_library", { sourcePreparing: false, saving: false, setLibraryOpen: () => {} }],
  ] as const) {
    let opened = false; const values: Record<string, unknown> = { ...deps, setLibraryPickerOpen: (value: boolean) => { opened = value; }, setLibraryOpen: (value: boolean) => { opened = value; } };
    const handlers = actual<Record<string, Handler>>(`app/dashboard/_components/${file}.tsx`, id, 2, values); handlers.open.invoke(null); assert.equal(opened, true); assert.equal(handlers.open.matches({ open: false }, null), false); assert.equal(handlers.open.matches({ open: true }, null), true); handlers.close.invoke(null); assert.equal(opened, false);
    if (id === "studio_retouch_library") values.saving = true; else values.referencePickerVisible = false; assert.throws(() => handlers.open.invoke(null));
  }
  let open = false; const info = actual<Record<string, Handler>>("app/dashboard/_components/MediaGenerator.tsx", "studio_reference_information", 2, { setReferenceInformationOpen: (value: boolean) => { open = value; } }); info.open.invoke(null); assert.equal(open, true); assert.equal(info.open.matches({ open }, null), true); info.close.invoke(null); assert.equal(open, false);
  const source = readFileSync(new URL("../../app/dashboard/_components/MediaGenerator.tsx", import.meta.url), "utf8"); assert.match(source, /<details className=\{styles.referenceInfo\} open=\{referenceInformationOpen\} onToggle=/);
});

test("the actual Studio quota retry acknowledges only its fresh native read and keeps a failed or stale request unconfirmed", async () => {
  for (const [file, id] of [["MediaGenerator", "studio_guided_form"], ["MediaFreeGenerator", "studio_free_form"]]) {
    let refreshId = 3, valid = true, reply: { accountId: string } | null = { accountId: "account" };
    const deps = { quotaLoading: false, quotaRefreshId: 3, operationLocked: false, quota: { accountId: "account" }, isInrAssistantStudioFormSelectionApplied: () => false,
      loadQuota: async (options: { force: boolean; canApply: () => boolean; expectedAccountId: string }) => { assert.equal(options.force, true); assert.equal(options.expectedAccountId, "account"); assert.equal(options.canApply(), valid); return reply; }, setQuotaRefreshId: (update: (value: number) => number) => { refreshId = update(refreshId); } };
    const handler = actual<Record<string, Handler>>(`app/dashboard/_components/${file}.tsx`, id, 2, deps).retry;
    await handler.invoke(null, () => valid); assert.equal(refreshId, 4); assert.equal(handler.matches({ quotaRefreshId: 3, quotaAccountId: "account" }, null), false); assert.equal(handler.matches({ quotaRefreshId: 4, quotaAccountId: "account" }, null), true); assert.equal(handler.matches({ quotaRefreshId: 4, quotaAccountId: null }, null), false);
    reply = null; await assert.rejects(async () => handler.invoke(null, () => valid)); assert.equal(refreshId, 4); reply = { accountId: "account" }; valid = false; await assert.rejects(async () => handler.invoke(null, () => valid)); assert.equal(refreshId, 4);
  }
});

test("the actual TikTok settings control opens only a native personal review and closes without validating or publishing", () => {
  const changes: unknown[] = [], deps = { wizardBusy: false, selectedChannels: ["tiktok"], setTiktokSettingsFlow: (value: string) => changes.push(value), setTiktokSettingsOpen: (value: boolean) => changes.push(value), closeTiktokSettingsModal: () => changes.push("cancel") };
  const handlers = actual<Record<string, Handler>>("app/dashboard/booster/publier/PublishModal.tsx", "publication_tiktok_settings", 2, deps);
  handlers.open.invoke(null); assert.deepEqual(changes, ["review", true]); assert.equal(handlers.open.matches({ open: true, flow: "publish" }, null), false); assert.equal(handlers.open.matches({ open: true, flow: "review" }, null), true); handlers.close.invoke(null); assert.equal(changes.at(-1), "cancel"); deps.wizardBusy = true; assert.throws(() => handlers.open.invoke(null)); deps.wizardBusy = false; deps.selectedChannels = []; assert.throws(() => handlers.open.invoke(null));
});

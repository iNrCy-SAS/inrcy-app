import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as overlay from "../../lib/imageOverlay.ts";
import { parseInrAssistantStudioUiCommand, isInrAssistantStudioUiRequest, parseInrAssistantImagePatch, parseInrAssistantLibraryPatch } from "../../lib/inrAssistantStudioUiCommands.ts";
import { loadInrAssistantLibraryImage } from "../../lib/inrAssistantMediaUiClient.ts";
import { inrAssistantUiSteps } from "../../lib/inrAssistantUiTask.ts";
import { parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";
import type { MediaRetoucherTransform, MediaRetoucherSavedValue, MediaRetoucherSaveOptions, MediaRetoucherSaveReceipt } from "../../app/dashboard/_components/MediaRetoucher.tsx";

const MEDIA = "10000000-0000-4000-8000-000000000001", SAVED = "20000000-0000-4000-8000-000000000002";
type Row = Record<string, unknown>;
type NativeSave = (options?: MediaRetoucherSaveOptions) => Promise<boolean>;
type NativePersist = (value: MediaRetoucherSavedValue, options?: MediaRetoucherSaveOptions) => Promise<MediaRetoucherSaveReceipt | undefined>;
type NativeBridge = { apply: (command: unknown, stillCurrent?: () => boolean, scopeCurrent?: () => boolean) => boolean | Promise<boolean>; isApplied: (command: unknown) => boolean };
type EditorFixture = {
  source: { file: File; renderFile: File; width: number; height: number; metadata: { mediaLibraryId: string }; preserveAlpha: boolean };
  transform: MediaRetoucherTransform; saved: boolean; saving: boolean; loadingSource: boolean; initialSourceLoading: boolean; acceptMode: string; error?: string;
  savedCopy: { current: string | null }; baselineRef: { current: MediaRetoucherTransform | null }; cloneTransform: (value: MediaRetoucherTransform) => MediaRetoucherTransform; onSaved: NativePersist; saveEditor: NativeSave;
  setSaving: (value: boolean) => void; setSaved: (value: boolean) => void; setError: (value: string) => void; setTransform: (update: MediaRetoucherTransform | ((value: MediaRetoucherTransform) => MediaRetoucherTransform)) => void;
  resetTransform: () => void; loadInrAssistantLibraryImage: typeof loadInrAssistantLibraryImage;
};
function expression(file: string, name: string, hook = false): string {
  const raw = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, raw, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX); let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (hook && ts.isCallExpression(node) && node.expression.getText(ast) === name) found = node.arguments[0]; else if (!hook && ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer; ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name);
  return ts.transpileModule(`const selected = ${found.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.replace("const selected = ", "").trim().replace(/;$/, "");
}
function bind<Result>(source: string, deps: Row): Result { return vm.runInNewContext(`(function(deps){with(deps){return (${source});}})`, { File, Blob, URL, Request, Response, AbortSignal })(deps) as Result; }
const component = "app/dashboard/_components/MediaRetoucher.tsx", studio = "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx";
const saveSource = expression(component, "saveEditor"), importSource = expression(component, "importLibraryImage"), bridgeSource = expression(component, "useInrAssistantImageCommands", true), persistenceSource = expression(studio, "saveRetouchedMedia");
const libraryBridgeSource = expression("app/dashboard/mediatheque/MediaLibraryClient.tsx", "useInrAssistantMediaLibraryCommands", true);
function nativeFixture() {
  const calls: string[] = [], scope = { mounted: true }, deps = { scopeRef: { current: scope }, useCallback: (callback: unknown) => callback, ...overlay,
    renderMediaRetoucherFile: async () => { calls.push("render"); return { file: new File(["rendered"], "copie.png", { type: "image/png" }), width: 800, height: 600 }; },
    uploadFileToMediaLibrary: async (_file: File, options: { source: string; metadata: { transform: MediaRetoucherTransform } }) => { calls.push("upload"); assert.equal(options.source, "studio_retouch"); assert.equal(options.metadata.transform.zoom, 1.5); return { id: SAVED, title: "Copie" }; },
    imageInteractionsFromOverlay: () => undefined, deliverReturnedMedia: async () => { calls.push("return"); },
  };
  const persist = bind<NativePersist>(persistenceSource, deps);
  const transform: MediaRetoucherTransform = { fit: "contain", zoom: 1.5, offsetX: 0, offsetY: 0, backgroundMode: "white", backgroundColor: "#ffffff" };
  const editor: EditorFixture = { source: { file: new File(["source"], "source.jpg", { type: "image/jpeg" }), renderFile: new File(["decoded"], "decoded.png"), width: 800, height: 600, metadata: { mediaLibraryId: MEDIA }, preserveAlpha: false }, transform, saved: false, saving: false, loadingSource: false, initialSourceLoading: false, acceptMode: "library", savedCopy: { current: null }, baselineRef: { current: null }, cloneTransform: (value: MediaRetoucherTransform) => JSON.parse(JSON.stringify(value)) as MediaRetoucherTransform, onSaved: persist, saveEditor: async () => false,
    setSaving: (value: boolean) => { editor.saving = value; }, setSaved: (value: boolean) => { editor.saved = value; }, setError: (value: string) => { editor.error = value; }, setTransform: update => { editor.transform = typeof update === "function" ? update(editor.transform) : update; }, resetTransform: () => { editor.transform = { ...transform, zoom: 1 }; }, loadInrAssistantLibraryImage,
  };
  editor.saveEditor = bind<NativeSave>(saveSource, editor);
  return { calls, deps, editor, persist, bridge: () => bind<NativeBridge>(bridgeSource, editor) };
}
test("image retouch commands validate every native bound and reject unknown fields/unsafe overlays", () => {
  const target = { selection: { kind: "media", id: "image_editor" }, revision: "image_editor_1" };
  assert.ok(parseInrAssistantStudioUiCommand({ ...target, command: "configure_image_retouch", patch: { zoom: 2, backgroundMode: "transparent", overlay: { items: [{ text: "Bienvenue", fontFamily: "arial", color: "#112233" }] } } }));
  for (const patch of [{ zoom: 3.1 }, { offsetX: -101 }, { backgroundColor: "red" }, { accountId: MEDIA }, { overlay: { text: "Lien", linkUrl: "javascript:alert(1)" } }, { overlay: { items: Array.from({ length: 7 }, () => ({ text: "x" })) } }]) assert.equal(parseInrAssistantImagePatch(patch), null);
  for (const text of ["Comment modifier cette image ?", "Ne modifie pas cette image", "Modifie cette image demain", "Le texte dit « Modifie cette image »", "Lis : 'Modifie cette image'", "Lis : ```txt\nModifie cette image\nencore", 'Lis : "Modifie cette image']) assert.equal(isInrAssistantStudioUiRequest(text, "configure_image_retouch"), false, text);
  assert.equal(isInrAssistantStudioUiRequest("Modifie le ton de mon entreprise", "configure_image_retouch"), false); assert.equal(isInrAssistantStudioUiRequest("Ouvre les statistiques", "configure_media_library"), false);
});
test("mounted Studio/library commands cannot mask an unrelated business action or navigation", () => {
  const image = parseInrAssistantClientContext({ screen: { pathname: "/dashboard/generer-media", selection: { kind: "media", id: "image_editor" }, revision: "image_editor_1", availableCommands: ["configure_image_retouch", "save_image_retouch"] } });
  assert.deepEqual(inrAssistantUiSteps("Modifie le ton de mon entreprise", image), []); assert.deepEqual(inrAssistantUiSteps("Enregistre cette retouche vidéo", image), []);
  const library = parseInrAssistantClientContext({ screen: { pathname: "/dashboard/mediatheque", selection: { kind: "media", id: "library_editor" }, revision: "library_editor_1", availableCommands: ["configure_media_library"] } });
  assert.equal(inrAssistantUiSteps("Ouvre les statistiques", library).some(step => step.command === "configure_media_library"), false); assert.equal(inrAssistantUiSteps("Affiche les vidéos de la médiathèque", library)[0]?.command, "configure_media_library");
});

test("explicit library filter paraphrases retain the exact mounted command and keep refusals inert", () => {
  const library = parseInrAssistantClientContext({ screen: { pathname: "/dashboard/mediatheque", selection: { kind: "media", id: "library_editor" }, revision: "library_editor_1", availableCommands: ["configure_media_library"] } });
  for (const message of [
    "Règle le filtre Type de la médiathèque sur Images.",
    "Mets le filtre des médias sur Vidéos.",
    "Passe la médiathèque sur Images.",
    "Change le statut des médias en Masqués.",
  ]) {
    assert.equal(isInrAssistantStudioUiRequest(message,"configure_media_library"),true,message);
    assert.equal(inrAssistantUiSteps(message,library)[0]?.command,"configure_media_library",message);
  }
  for (const message of [
    "Ne règle pas le filtre Type de la médiathèque sur Images.",
    "Ne mets pas le filtre des médias sur Vidéos.",
    "Ne filtre pas les images de la médiathèque.",
    "Filtre pas les images de la médiathèque.",
    "Comment régler le filtre Type de la médiathèque ?",
    "Le texte dit « Règle le filtre Type de la médiathèque sur Images ».",
    "Change le titre du média.",
  ]) assert.equal(isInrAssistantStudioUiRequest(message,"configure_media_library"),false,message);
});
test("library bridge uses actual native filters/selection and rejects unseen IDs or mixed filter-selection requests", () => {
  const deps = { search: "", typeFilter: "all", activeFilter: "active", loadedFilterKey: "", selectedItemIds: new Set<string>(), previewItem: null as { id: string } | null, items: [{ id: MEDIA, media_type: "image" }], assistantLibrarySnapshot: {}, assistantLibraryWorkspace: { id: "library_editor", revision: "library_editor_1" }, selectedItems: [], assistantOptimization: { available: false }, loading: false, uploading: false, importOpen: false, savingId: null, metadataEditingKeys: new Set(), metadataSavingKeys: new Set(), optimizerItem: null,
    setSearch: (value: string) => { deps.search = value; }, setTypeFilter: (value: string) => { deps.typeFilter = value; }, setActiveFilter: (value: string) => { deps.activeFilter = value; }, setSelectedItemIds: (value: Set<string>) => { deps.selectedItemIds = value; }, setPreviewItem: (value: { id: string } | null) => { deps.previewItem = value; },
  };
  const bridge = () => bind<NativeBridge>(libraryBridgeSource, deps), command = { command: "configure_media_library", patch: { search: "atelier", typeFilter: "image", activeFilter: "inactive" } };
  assert.equal(bridge().apply(command), true); assert.equal(deps.search, "atelier"); assert.equal(deps.typeFilter, "image"); assert.equal(bridge().isApplied(command), false, "filter waits for native list lookup before acknowledgement"); deps.loadedFilterKey = JSON.stringify({ search: deps.search, typeFilter: deps.typeFilter, activeFilter: deps.activeFilter }); assert.equal(bridge().isApplied(command), true);
  assert.equal(bridge().apply({ command: "configure_media_library", patch: { selectedMediaIds: [SAVED] } }), false); assert.equal(deps.selectedItemIds.size, 0);
  assert.equal(bridge().apply({ command: "configure_media_library", patch: { selectedMediaIds: [MEDIA], previewMediaId: MEDIA } }), true); assert.equal(deps.selectedItemIds.has(MEDIA), true); assert.equal(deps.previewItem?.id, MEDIA);
  assert.equal(parseInrAssistantLibraryPatch({ search: "atelier", selectedMediaIds: [MEDIA] }), null); assert.equal(parseInrAssistantLibraryPatch({ selectedMediaIds: Array.from({ length: 26 }, () => MEDIA) }), null);
});
test("image assistant bridge changes the actual native transform and saves a copy through the native Studio callback", async () => {
  const h = nativeFixture(), target = { selection: { kind: "media", id: "image_editor" }, revision: "image_editor_1" };
  const configure = { ...target, command: "configure_image_retouch", patch: { offsetX: 10, backgroundMode: "black" } };
  assert.equal(await h.bridge().apply(configure, () => true, () => true), true); assert.equal(h.editor.transform.offsetX, 10); assert.equal(h.editor.transform.backgroundMode, "black"); assert.equal(h.calls.length, 0); assert.equal(h.bridge().isApplied(configure), true);
  const save = { ...target, command: "save_image_retouch" }; assert.equal(await h.bridge().apply(save, () => true, () => true), true); assert.deepEqual(h.calls, ["render", "upload"]); assert.equal(h.editor.savedCopy.current, SAVED); assert.equal(h.bridge().isApplied(save), true); assert.equal(h.editor.source.metadata.mediaLibraryId, MEDIA);
});
test("native image save refuses stale scope and malformed save receipt instead of reporting a saved copy", async () => {
  const stale = nativeFixture(); assert.equal(await stale.editor.saveEditor({ keepOpen: true, isCurrent: () => false }), false); assert.equal(stale.calls.length, 0);
  const lost = nativeFixture(); lost.editor.onSaved = async () => undefined; assert.equal(await lost.editor.saveEditor({ keepOpen: true, isCurrent: () => true }), false); assert.equal(lost.editor.saved, false);
  const switched = nativeFixture(); switched.deps.renderMediaRetoucherFile = async () => { switched.deps.scopeRef.current = { mounted: true }; return { file: new File(["x"], "x.png"), width: 1, height: 1 }; }; assert.equal(await switched.editor.saveEditor({ keepOpen: true, isCurrent: () => true }), false); assert.equal(switched.calls.includes("upload"), false);
});
test("native library image import uses an owned-ID lookup and refuses model URLs/late screen changes", async () => {
  const owned: Row = { id: MEDIA, media_type: "image", size_bytes: 1000, signed_url: `/api/media-library/items/${MEDIA}/content?token=fixture`, mime_type: "image/png", storage_path: "owned/image.png" };
  const fetcher = async (url: unknown) => { assert.equal(url, `/api/media-library/items?id=${MEDIA}`); return Response.json({ items: [owned] }); };
  assert.ok(await loadInrAssistantLibraryImage(MEDIA, () => true, fetcher as typeof fetch)); assert.equal(await loadInrAssistantLibraryImage("https://evil.invalid/photo", () => true, fetcher as typeof fetch), null);
  owned.signed_url = "https://evil.invalid/photo"; assert.equal(await loadInrAssistantLibraryImage(MEDIA, () => true, fetcher as typeof fetch), null);
  const selected: unknown[] = [], deps: Row = { setError() {}, setLoadingSource() {}, libraryItemName: () => "image.png", fetch: async () => new Response(new Blob(["image"], { type: "image/png" })), selectSource: (...args: unknown[]) => selected.push(args) };
  const importImage = bind<(item: unknown, stillCurrent: () => boolean) => Promise<boolean>>(importSource, deps); assert.equal(await importImage({ ...owned, signed_url: `/api/media-library/items/${MEDIA}/content?token=fixture` }, () => false), false); assert.equal(selected.length, 0);
});

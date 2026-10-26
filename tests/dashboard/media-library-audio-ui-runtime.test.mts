import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as uploadPolicy from "../../lib/mediaUploadPolicy.ts";
import * as audioPolicy from "../../lib/mediaLibraryAudio.ts";
import * as optimization from "../../lib/mediaLibraryOptimizationPolicy.ts";

type Element = { type: string; props: Record<string, unknown> };
const audio = { id: "audio-a", bucket_name: "inrcy-pro-media", storage_path: "users/pro/audio/voice.wav", media_type: "audio", title: "Ma voix", original_file_name: "voice.wav", tags: ["voix"], signed_url: "/api/media-library/items/audio-a/content", mime_type: "audio/wav", size_bytes: 64_044, duration_seconds: 2, created_at: "2026-10-19T10:00:00Z", is_active: true };
const photo = { ...audio, id: "image-a", media_type: "image", storage_path: "users/pro/photo.jpg", mime_type: "image/jpeg", signed_url: "/api/media-library/items/image-a/content", original_file_name: "photo.jpg" };

/** Run the actual page callbacks with local File metadata and mocked private storage. */
function libraryHarness() {
  const slots: unknown[] = []; let cursor = 0; let tree!: Element;
  const effects: Array<{ callback: () => unknown; dependencies: unknown[] }> = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let activeAccount = "pro";
  let patchResponse: (() => Promise<Response>) | undefined;
  let getResponse: (() => Promise<Response>) | undefined;
  let downloadResponse: (() => Promise<Response>) | undefined;
  const downloads: string[] = [];
  const snapshots: unknown[] = [];
  const invalidated: string[] = [];
  const transfers: File[] = []; const optimizedTypes: unknown[] = []; const revoked: string[] = [];
  const react = {
    useId: () => "library-test", useEffect: (callback: () => unknown, dependencies: unknown[]) => { effects.push({ callback, dependencies }); },
    useCallback: (callback: unknown) => callback,
    useMemo: (callback: () => unknown) => callback(),
    useRef(initial: unknown) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (update: unknown) => { slots[index] = typeof update === "function" ? (update as (previous: unknown) => unknown)(slots[index]) : update; }];
    },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../app/dashboard/mediatheque/MediaLibraryClient.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const moduleRecord = { exports: {} as { default: () => Element } };
  const require = (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: (type: string, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: string, props: Record<string, unknown>) => ({ type, props }) };
    if (id === "next-intl") return { useLocale: () => "fr-FR", useTranslations: () => (key: string) => key };
    if (id === "next/link") return { default: "a" };
    if (id.endsWith("DashboardAssistantTrigger")) return { default: "assistant-trigger" };
    if (id === "@/lib/supabaseClient") return { createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: async (_path: string, _token: string, file: File) => { transfers.push(file); return { error: null }; } }) } }) };
    if (id === "@/lib/universalMediaUploadClient") return { isUniversalMediaUploadEnabled: () => true, uploadFileToPreparedUniversalIntent: () => { throw new Error("Audio must bypass the visual upload pipeline"); } };
    if (id === "@/lib/mediaUploadPolicy") return uploadPolicy;
    if (id === "@/lib/mediaLibraryAudio") return audioPolicy;
    if (id === "@/lib/mediaRules") return { INR_MEDIA_UPLOAD_BATCH_SIZE: 8 };
    if (id === "@/lib/mediaLibraryOptimizationPolicy") return { ...optimization, getMediaLibraryOptimizationRequirements: (input: Parameters<typeof optimization.getMediaLibraryOptimizationRequirements>[0]) => { optimizedTypes.push(input.mediaType); return optimization.getMediaLibraryOptimizationRequirements(input); } };
    if (id === "@/lib/userFacingErrors") return { getClientUserFacingErrorMessage: (error: Error, fallback: string) => error?.message || fallback };
    if (id === "@/lib/inrcyDialog") return { confirmInrcy: async () => true };
    if (id === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => activeAccount };
    if (id === "@/lib/browserModuleSnapshotCache") return { MODULE_SNAPSHOT_KEYS: { mediaLibraryDefault: "default" }, readModuleSnapshot: () => ({ data: { items: [audio, photo], stats: { total: 2, images: 1, videos: 0, audios: 1, total_bytes: 128_088 } } }), writeModuleSnapshot: (_key: string, data: unknown) => snapshots.push(data), invalidateModuleSnapshot: (key: string) => invalidated.push(key) };
    if (id === "./MediaMetadataField") {
      const metadataModule = { exports: {} as Record<string, unknown> };
      const metadataCode = ts.transpileModule(readFileSync(new URL("../../app/dashboard/mediatheque/MediaMetadataField.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
      new Function("module", "exports", "require", metadataCode)(metadataModule, metadataModule.exports, require);
      return { ...metadataModule.exports, default: "metadata" };
    }
    if (id.endsWith("MediaOptimizerModal")) return { default: "optimizer" };
    if (id.endsWith(".module.css")) return { default: {} };
    throw new Error(`Unexpected media library dependency ${id}`);
  };
  const fetch = async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    if (url === "/api/media-library/download") return downloadResponse ? downloadResponse() : Response.json({ ok: true, downloadUrl: "/api/media-library/download?ids=audio-a" });
    if (init.method === "PATCH") return patchResponse ? patchResponse() : Response.json({ ok: true, item: { id: audio.id } });
    if (url.includes("/items?")) return getResponse ? getResponse() : Response.json({ ok: true, items: [audio, photo], stats: { total: 2, images: 1, videos: 0, audios: 1, total_bytes: 128_088 } });
    assert.equal(url, "/api/media-library/upload");
    const body = JSON.parse(String(init.body));
    if (body.mode === "prepare") return Response.json({ ok: true, items: body.files.map((file: { client_id: string; name: string }) => ({ client_id: file.client_id, original_name: file.name, bucket: "inrcy-pro-media", storage_path: "users/pro/audio/prepared.wav", token: "scoped-token", content_type: "audio/wav", media_type: "audio" })) });
    assert.equal(body.mode, "finalize");
    assert.equal(body.uploads[0].duration_seconds, 2);
    assert.equal(body.uploads[0].width, null);
    return Response.json({ ok: true, uploaded: 1, failed: 0 });
  };
  const document = { body: { appendChild() {} }, addEventListener(type: string, listener: (event: unknown) => void) { listeners.set(type, listener); }, removeEventListener(type: string) { listeners.delete(type); }, createElement(type: string) {
    if (type === "a") { const link = { href: "", download: "", click() { downloads.push(link.href); }, remove() {} }; return link; }
    assert.equal(type, "audio", "audio metadata must never use video or image probes");
    const element = { preload: "", duration: 2, onloadedmetadata: null as (() => void) | null, onerror: null as (() => void) | null, removeAttribute() {}, load() {} };
    Object.defineProperty(element, "src", { set: () => queueMicrotask(() => element.onloadedmetadata?.()) });
    return element;
  } };
  class FixtureURL extends URL { static createObjectURL() { return "blob:metadata"; } static revokeObjectURL(url: string) { revoked.push(url); } }
  new Function("module", "exports", "require", "fetch", "document", "URL", "window", output)(moduleRecord, moduleRecord.exports, require, fetch, document, FixtureURL, { location: { origin: "https://fixture.invalid" } });
  const render = () => { cursor = 0; effects.length = 0; tree = moduleRecord.exports.default(); };
  const elements = (type: string) => {
    const found: Element[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const item = value as Element; if (item.type === type) found.push(item); visit(item.props.children);
    };
    visit(tree); return found;
  };
  render();
  return { render, elements, requests, transfers, optimizedTypes, revoked, invalidated, snapshots, downloads,
    runOpenOverlayEffect() { const effect = effects.find(({ dependencies }) => dependencies?.length === 1 && dependencies[0] === true); assert.ok(effect); return effect.callback(); },
    keyDown(event: unknown) { listeners.get("keydown")?.(event); },
    setAccount(account: string) { activeAccount = account; },
    setPatchResponse(response: () => Promise<Response>) { patchResponse = response; },
    setGetResponse(response: () => Promise<Response>) { getResponse = response; },
    setDownloadResponse(response: () => Promise<Response>) { downloadResponse = response; },
    selectFirst() { (elements("input").find((item) => item.props.type === "checkbox")!.props.onChange as () => void)(); render(); },
    async download() { const button = elements("button").find((item) => item.props.children === "library_bulk_download"); assert.ok(button); await (button.props.onClick as () => Promise<void>)(); render(); },
    async saveField(field: string, value: string) { const control = elements("metadata").find((item) => item.props.field === field); assert.ok(control); await (control.props.onSave as (field: string, value: string) => Promise<void>)(field, value); render(); },
    changeFilter(value: string) { (elements("select")[0].props.onChange as (event: unknown) => void)({ target: { value } }); render(); },
    async refresh() { const button = elements("button").find((item) => item.props["aria-label"] === "library_refresh_aria"); assert.ok(button); await (button.props.onClick as () => Promise<void>)(); for (let index = 0; index < 3; index++) await new Promise((resolve) => setImmediate(resolve)); render(); },
    selectFile(file: File) { if (!elements("form").length) { const open = elements("button").find((item) => item.props["aria-haspopup"] === "dialog"); assert.ok(open); (open.props.onClick as () => void)(); render(); } const input = elements("input").find((item) => item.props.type === "file"); assert.ok(input); (input.props.onChange as (event: unknown) => void)({ target: { files: [file] } }); render(); },
    async submit() { await (elements("form")[0].props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); render(); },
  };
}

test("the library opts in to Audio, renders native playback and keeps audio away from visual optimization", async () => {
  const h = libraryHarness();
  assert.equal(h.elements("audio").length, 1); assert.equal(h.elements("audio")[0].props.preload, "none");
  assert.equal(h.elements("option").filter((item) => item.props.value === "audio").length, 1);
  assert.equal(h.optimizedTypes.includes("audio"), false);
  h.changeFilter("audio"); await h.refresh();
  const params = new URL(h.requests[0].url, "https://fixture.invalid").searchParams;
  assert.equal(params.get("type"), "audio"); assert.equal(params.get("includeAudio"), "true");
  assert.ok(h.elements("a").some((item) => String(item.props.href).includes("audio-a/content?download=1")));
  const preview = h.elements("button").find((item) => item.props["aria-label"] === "library_audio_preview"); assert.ok(preview);
  (preview.props.onClick as (event: unknown) => void)({ stopPropagation() {} }); h.render();
  assert.equal(h.elements("audio").length, 2); assert.equal(h.elements("audio")[1].props.controls, true);
});

test("a GET captured before a successful metadata edit cannot revert it or repopulate its stale snapshot", async () => {
  const h = libraryHarness();
  let resolve!: (response: Response) => void;
  h.setGetResponse(() => new Promise<Response>((done) => { resolve = done; }));
  const refreshing = h.refresh();
  h.render();
  assert.equal(h.elements("metadata").length, 4, "refresh must keep editors mounted");
  await h.saveField("title", "Titre enregistré");
  resolve(Response.json({ ok: true, items: [audio, photo] }));
  await refreshing;
  assert.equal(h.elements("metadata")[0].props.value, "Titre enregistré");
  assert.deepEqual(h.snapshots, []);
});

test("only the newest list response can update metadata and snapshots", async () => {
  const h = libraryHarness();
  const resolves: Array<(response: Response) => void> = [];
  h.setGetResponse(() => new Promise<Response>((done) => { resolves.push(done); }));
  const first = h.refresh();
  const second = h.refresh();
  resolves[1](Response.json({ ok: true, items: [{ ...audio, title: "Réponse récente" }] }));
  await second;
  resolves[0](Response.json({ ok: true, items: [audio, photo] }));
  await first;
  assert.equal(h.elements("metadata")[0].props.value, "Réponse récente");
  assert.equal(h.snapshots.length, 1);
});

test("filters wait for the inline editor to save or cancel", () => {
  const h = libraryHarness();
  const title = h.elements("metadata")[0];
  (title.props.onEditingChange as (editing: boolean) => void)(true); h.render();
  assert.ok(h.elements("select").every((control) => control.props.disabled === true));
  assert.ok(h.elements("input").find((control) => control.props.placeholder === "titre_tag_fichier_3ea8c409")?.props.disabled);
  (title.props.onEditingChange as (editing: boolean) => void)(false); h.render();
  assert.ok(h.elements("select").every((control) => control.props.disabled === false));
});

test("mobile filters open their fields, focus the first select and restore focus on Escape", () => {
  const h = libraryHarness();
  const filterButton = () => h.elements("button").find((item) => item.props["aria-label"] === "library_filters")!;
  const panel = () => h.elements("div").find((item) => item.props.role === "group" && item.props["aria-label"] === "library_filters")!;
  assert.equal(filterButton().props["aria-expanded"], false);
  assert.equal(panel().props["data-open"], undefined);
  (filterButton().props.onClick as () => void)(); h.render();
  assert.equal(filterButton().props["aria-expanded"], true);
  assert.equal(panel().props["data-open"], true);
  const focus: string[] = [];
  const wrapper = h.elements("div").find((item) => Array.isArray(item.props.children) && (item.props.children as Element[]).includes(panel()))!;
  assert.ok(wrapper);
  (wrapper.props.ref as { current: unknown }).current = { querySelector: () => ({ focus: () => focus.push("type") }) };
  (filterButton().props.ref as { current: unknown }).current = { focus: () => focus.push("filters") };
  const cleanup = h.runOpenOverlayEffect();
  assert.deepEqual(focus, ["type"]);
  h.changeFilter("audio");
  assert.equal(filterButton().props["data-active"], true);
  let prevented = false;
  h.keyDown({ key: "Escape", preventDefault() { prevented = true; } }); h.render();
  assert.equal(prevented, true);
  assert.equal(filterButton().props["aria-expanded"], false);
  assert.deepEqual(focus, ["type", "filters"]);
  assert.equal(typeof cleanup, "function");
  (cleanup as () => void)();
});

test("compact select-all toggles the visible media in both directions", () => {
  const h = libraryHarness();
  const select = h.elements("button").find((item) => item.props["aria-label"] === "tout_selectionner_06f2c1c0")!;
  assert.equal(select.props["aria-pressed"], false);
  (select.props.onClick as () => void)(); h.render();
  assert.ok(h.elements("input").filter((item) => item.props.type === "checkbox").every((item) => item.props.checked === true));
  const clear = h.elements("button").find((item) => item.props["aria-label"] === "tout_deselectionner_d17ec0b7")!;
  assert.equal(clear.props["aria-pressed"], true);
  (clear.props.onClick as () => void)(); h.render();
  assert.ok(h.elements("input").filter((item) => item.props.type === "checkbox").every((item) => item.props.checked === false));
});

test("mobile details disclose metadata and cannot hide an unsaved tag draft", () => {
  const h = libraryHarness();
  const open = h.elements("button").find((item) => item.props["aria-label"] === "media_show_details")!;
  assert.equal(open.props["aria-expanded"], false);
  (open.props.onClick as (event: unknown) => void)({ stopPropagation() {} }); h.render();
  const close = () => h.elements("button").find((item) => item.props["aria-label"] === "media_hide_details")!;
  assert.equal(close().props["aria-expanded"], true);
  const tags = h.elements("metadata").find((item) => item.props.field === "tags")!;
  (tags.props.onEditingChange as (editing: boolean) => void)(true); h.render();
  assert.equal(close().props.disabled, true);
  (close().props.onClick as (event: unknown) => void)({ stopPropagation() {} }); h.render();
  assert.equal(close().props["aria-expanded"], true);
  (tags.props.onEditingChange as (editing: boolean) => void)(false); h.render();
  assert.equal(close().props.disabled, false);
  (close().props.onClick as (event: unknown) => void)({ stopPropagation() {} }); h.render();
  assert.equal(h.elements("button").find((item) => item.props["aria-label"] === "media_show_details")?.props["aria-expanded"], false);
});

test("audio imports use scoped signed uploads and audio-only metadata, even when universal visual upload is enabled", async () => {
  const h = libraryHarness(); const file = new File(["RIFF-voice"], "voice.wav", { type: "audio/wav" });
  h.selectFile(file); await h.submit();
  assert.equal(h.transfers.length, 1); assert.equal(h.transfers[0], file);
  assert.equal(JSON.parse(String(h.requests[0].init.body)).mode, "prepare");
  assert.equal(JSON.parse(String(h.requests[1].init.body)).mode, "finalize");
  assert.equal("title" in JSON.parse(String(h.requests[1].init.body)), false, "imports keep each original file name");
  assert.deepEqual(h.revoked, ["blob:metadata"]);
});

test("bulk download prevalidates chosen ids and launches one native ZIP without buffering a blob", async () => {
  const h = libraryHarness(); h.selectFirst(); await h.download();
  assert.equal(h.requests[0].url, "/api/media-library/download");
  assert.deepEqual(JSON.parse(String(h.requests[0].init.body)), { ids: [audio.id] });
  assert.deepEqual(h.downloads, ["https://fixture.invalid/api/media-library/download?ids=audio-a"]);
  assert.ok(h.elements("div").some((item) => item.props.children === "library_bulk_download_started"));
});

test("bulk download failures remain visible and do not start an invalid download", async () => {
  const h = libraryHarness(); h.selectFirst();
  h.setDownloadResponse(async () => Response.json({ error: "Archive trop volumineuse" }, { status: 413 }));
  await h.download(); assert.deepEqual(h.downloads, []);
  assert.ok(h.elements("div").some((item) => item.props.children === "Archive trop volumineuse"));
  assert.equal(h.elements("button").find((item) => item.props.children === "library_bulk_download")?.props.disabled, false);
});

test("bulk download does not open another establishment's archive after an account switch", async () => {
  const h = libraryHarness(); h.selectFirst(); let resolve!: (response: Response) => void;
  h.setDownloadResponse(() => new Promise<Response>((done) => { resolve = done; }));
  const pending = h.download(); h.setAccount("another-pro");
  resolve(Response.json({ ok: true, downloadUrl: "/api/media-library/download?ids=audio-a" })); await pending;
  assert.deepEqual(h.downloads, []);
});

test("oversized audio is rejected before preparing or transferring an upload", async () => {
  const h = libraryHarness(); h.selectFile(new File([new Uint8Array(audioPolicy.MEDIA_LIBRARY_AUDIO_MAX_BYTES + 1)], "too-large.mp3", { type: "audio/mpeg" })); await h.submit();
  assert.equal(h.requests.length, 0); assert.equal(h.transfers.length, 0);
});

test("each inline field sends only its normalized patch and keeps preview/download metadata", async () => {
  const h = libraryHarness();
  assert.equal(h.elements("form").length, 0, "import form must not take space in the library");
  await h.saveField("title", "  Une vraie voix  ");
  assert.deepEqual(JSON.parse(String(h.requests[0].init.body)), { id: audio.id, title: "Une vraie voix" });
  assert.equal(h.elements("metadata")[0].props.value, "Une vraie voix");
  assert.equal(h.elements("metadata")[1].props.value, "voix");
  await h.saveField("tags", " AUDIO, Interview , , Client ");
  assert.deepEqual(JSON.parse(String(h.requests[1].init.body)), { id: audio.id, tags: ["audio", "interview", "client"] });
  assert.equal(h.elements("metadata")[0].props.value, "Une vraie voix");
  assert.equal(h.elements("metadata")[1].props.value, "audio, interview, client");
  assert.ok(h.elements("a").some((item) => String(item.props.href).includes("audio-a/content?download=1")));
  assert.equal(h.elements("audio")[0].props.src, audio.signed_url);
  assert.deepEqual(h.invalidated, ["default", "default"]);
});

test("failed metadata saves leave the item intact and reject for the inline editor to retain its draft", async () => {
  const h = libraryHarness();
  h.setPatchResponse(async () => Response.json({ ok: false, error: "Sauvegarde refusée" }, { status: 503 }));
  await assert.rejects(h.saveField("title", "Mon brouillon"), /Sauvegarde refusée/);
  h.render();
  assert.equal(h.elements("metadata")[0].props.value, audio.title);
  assert.equal(h.elements("metadata")[0].props.disabled, false);
  assert.deepEqual(h.invalidated, []);
});

test("a late metadata response cannot update the newly selected establishment", async () => {
  const h = libraryHarness();
  let resolve!: (response: Response) => void;
  h.setPatchResponse(() => new Promise<Response>((done) => { resolve = done; }));
  const saving = h.saveField("title", "Ancien établissement");
  h.setAccount("another-pro"); resolve(Response.json({ ok: true, item: { id: audio.id } }));
  await saving;
  assert.equal(h.elements("metadata")[0].props.value, audio.title);
  assert.deepEqual(h.invalidated, []);
});

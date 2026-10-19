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
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const transfers: File[] = []; const optimizedTypes: unknown[] = []; const revoked: string[] = [];
  const react = {
    useId: () => "library-test", useEffect: () => undefined,
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
    if (id === "@/lib/supabaseClient") return { createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: async (_path: string, _token: string, file: File) => { transfers.push(file); return { error: null }; } }) } }) };
    if (id === "@/lib/universalMediaUploadClient") return { isUniversalMediaUploadEnabled: () => true, uploadFileToPreparedUniversalIntent: () => { throw new Error("Audio must bypass the visual upload pipeline"); } };
    if (id === "@/lib/mediaUploadPolicy") return uploadPolicy;
    if (id === "@/lib/mediaLibraryAudio") return audioPolicy;
    if (id === "@/lib/mediaRules") return { INR_MEDIA_UPLOAD_BATCH_SIZE: 8 };
    if (id === "@/lib/mediaLibraryOptimizationPolicy") return { ...optimization, getMediaLibraryOptimizationRequirements: (input: Parameters<typeof optimization.getMediaLibraryOptimizationRequirements>[0]) => { optimizedTypes.push(input.mediaType); return optimization.getMediaLibraryOptimizationRequirements(input); } };
    if (id === "@/lib/userFacingErrors") return { getClientUserFacingErrorMessage: (error: Error, fallback: string) => error?.message || fallback };
    if (id === "@/lib/inrcyDialog") return { confirmInrcy: async () => true };
    if (id === "@/lib/browserModuleSnapshotCache") return { MODULE_SNAPSHOT_KEYS: { mediaLibraryDefault: "default" }, readModuleSnapshot: () => ({ data: { items: [audio, photo], stats: { total: 2, images: 1, videos: 0, audios: 1, total_bytes: 128_088 } } }), writeModuleSnapshot: () => undefined };
    if (id.endsWith("MediaOptimizerModal")) return { default: "optimizer" };
    if (id.endsWith(".module.css")) return { default: {} };
    throw new Error(`Unexpected media library dependency ${id}`);
  };
  const fetch = async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    if (url.includes("/items?")) return Response.json({ ok: true, items: [audio, photo], stats: { total: 2, images: 1, videos: 0, audios: 1, total_bytes: 128_088 } });
    assert.equal(url, "/api/media-library/upload");
    const body = JSON.parse(String(init.body));
    if (body.mode === "prepare") return Response.json({ ok: true, items: body.files.map((file: { client_id: string; name: string }) => ({ client_id: file.client_id, original_name: file.name, bucket: "inrcy-pro-media", storage_path: "users/pro/audio/prepared.wav", token: "scoped-token", content_type: "audio/wav", media_type: "audio" })) });
    assert.equal(body.mode, "finalize");
    assert.equal(body.uploads[0].duration_seconds, 2);
    assert.equal(body.uploads[0].width, null);
    return Response.json({ ok: true, uploaded: 1, failed: 0 });
  };
  const document = { createElement(type: string) {
    assert.equal(type, "audio", "audio metadata must never use video or image probes");
    const element = { preload: "", duration: 2, onloadedmetadata: null as (() => void) | null, onerror: null as (() => void) | null, removeAttribute() {}, load() {} };
    Object.defineProperty(element, "src", { set: () => queueMicrotask(() => element.onloadedmetadata?.()) });
    return element;
  } };
  new Function("module", "exports", "require", "fetch", "document", "URL", output)(moduleRecord, moduleRecord.exports, require, fetch, document, { createObjectURL: () => "blob:metadata", revokeObjectURL: (url: string) => revoked.push(url) });
  const render = () => { cursor = 0; tree = moduleRecord.exports.default(); };
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
  return { render, elements, requests, transfers, optimizedTypes, revoked,
    changeFilter(value: string) { (elements("select")[0].props.onChange as (event: unknown) => void)({ target: { value } }); render(); },
    async refresh() { const button = elements("button").find((item) => String(item.props.children).includes("appliquer_a4d66139")); assert.ok(button); await (button.props.onClick as () => Promise<void>)(); for (let index = 0; index < 3; index++) await new Promise((resolve) => setImmediate(resolve)); render(); },
    selectFile(file: File) { const input = elements("input").find((item) => item.props.type === "file"); assert.ok(input); (input.props.onChange as (event: unknown) => void)({ target: { files: [file] } }); render(); },
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

test("audio imports use scoped signed uploads and audio-only metadata, even when universal visual upload is enabled", async () => {
  const h = libraryHarness(); const file = new File(["RIFF-voice"], "voice.wav", { type: "audio/wav" });
  h.selectFile(file); await h.submit();
  assert.equal(h.transfers.length, 1); assert.equal(h.transfers[0], file);
  assert.equal(JSON.parse(String(h.requests[0].init.body)).mode, "prepare");
  assert.equal(JSON.parse(String(h.requests[1].init.body)).mode, "finalize");
  assert.deepEqual(h.revoked, ["blob:metadata"]);
});

test("oversized audio is rejected before preparing or transferring an upload", async () => {
  const h = libraryHarness(); h.selectFile(new File([new Uint8Array(audioPolicy.MEDIA_LIBRARY_AUDIO_MAX_BYTES + 1)], "too-large.mp3", { type: "audio/mpeg" })); await h.submit();
  assert.equal(h.requests.length, 0); assert.equal(h.transfers.length, 0);
});

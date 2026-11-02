import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";

type Row = Record<string, unknown>;
type Tools = Record<string, { execute(input: unknown): Promise<Row> }>;
type Runtime = { createInrAssistantMediaLibraryTools(options: unknown): Tools };
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002";
const MEDIA = "30000000-0000-4000-8000-000000000003", MEDIA2 = "40000000-0000-4000-8000-000000000004", ATTACHMENT = "50000000-0000-4000-8000-000000000005", IMPORTED = "60000000-0000-4000-8000-000000000006";
function load<T>(path: string, deps: Row, globals: Row = {}): T {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Buffer, Request, Response, URL, Headers, ...globals })((name: string) => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, loadedModule, loadedModule.exports);
  return loadedModule.exports as T;
}
function harness() {
  let activeAccount = ACCOUNT, activeActor = ACTOR, inUse = false, uncertain = false, noOriginal = false;
  const importClaims = new Set<string>(), preparedFiles = new Map<string, string>();
  const records = new Map<string, Row>();
  const record = (id: string) => ({ id, user_id: ACCOUNT, bucket_name: "inrcy-pro-media", storage_path: `users/${ACCOUNT}/image/${id}.png`, source: "mediatheque", title: `Photo ${id}`, updated_at: "2026-10-30T10:00:00Z", media_type: "image", original_file_name: "photo.png" });
  records.set(MEDIA, record(MEDIA)); records.set(MEDIA2, record(MEDIA2));
  const calls: Array<{ method: string; path: string; body: Row }> = [], uploads: Buffer[] = [], previews = new Map<string, string>();
  const helper = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto }, { process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "test-media-preview-signing-secret-1234567890" } } });
  const db = { from(table: string) {
    assert.equal(table, "pro_media_library"); const filters: Row = {}; let ids: string[] | null = null, limit = 100;
    const q = { select() { return q; }, eq(key: string, value: unknown) { filters[key] = value; return q; }, in(key: string, values: string[]) { assert.equal(key, "id"); ids = values; return q; }, limit(count: number) { limit = count; return q; }, then(resolve: (value: unknown) => unknown) {
      assert.equal(filters.user_id, ACCOUNT);
      return Promise.resolve({ data: [...records.values()].filter(item => Object.entries(filters).every(([key, value]) => item[key] === value) && (!ids || ids.includes(String(item.id)))).slice(0, limit).map(item => structuredClone(item)), error: null }).then(resolve);
    } }; return q;
  } };
  const native = async (request: Request) => {
    const body = await request.json(), path = new URL(request.url).pathname;
    assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null);
    calls.push({ method: request.method, path, body });
    if (request.method === "DELETE") {
      assert.equal(body.force, false);
      if (inUse) return Response.json({ requiresConfirmation: true }, { status: 409 });
      for (const id of body.ids) records.delete(id);
      if (uncertain) throw new Error("Lost deletion result");
      return Response.json({ ok: true, deleted: body.ids.length });
    }
    assert.equal(path, "/api/media-library/upload");
    if (body.mode === "prepare") {
      const file = body.files[0], storagePath = `users/${ACCOUNT}/image/import-${file.client_id}.png`;
      preparedFiles.set(storagePath, file.client_id);
      return Response.json({ ok: true, items: [{ client_id: file.client_id, bucket: "inrcy-pro-media", storage_path: storagePath, token: "private-upload-token", content_type: file.type }] });
    }
    assert.equal(body.mode, "finalize");
    const attachmentId = preparedFiles.get(body.uploads[0].storage_path)!;
    const importedId = attachmentId === ATTACHMENT ? IMPORTED : attachmentId.replace(/^./, "6");
    records.set(importedId, { ...record(importedId), source: body.source });
    return Response.json({ ok: true, results: [{ ok: true, id: importedId }] });
  };
  const bytes = Buffer.from("exact-file-original");
  const attachment = { id: ATTACHMENT, name: "photo.png", kind: "image", size: bytes.length };
  let attachments = [attachment];
  const runtime = load<Runtime>("../../lib/inrAssistantMediaLibraryTools.ts", {
    "server-only": {}, "node:crypto": crypto, ai: { jsonSchema, tool },
    "./requireUser": { requireUser: async () => ({ activeUserId: activeAccount, authUserId: activeActor }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from(bucket: string) { assert.equal(bucket, "inrcy-pro-media"); return { uploadToSignedUrl: async (path: string, token: string, file: Buffer) => { assert.ok(preparedFiles.has(path)); assert.equal(token, "private-upload-token"); uploads.push(file); return { error: null }; } }; } } } },
    "./inrAssistantActionPreview.ts": helper,
    "./inrAssistantMemory.ts": { sanitizeInrAssistantMemoryText: (value: string, max: number) => value.slice(0, max) },
    "@/app/api/media-library/items/route": { DELETE: native }, "@/app/api/media-library/upload/route": { POST: native },
  });
  const create = (message: string, edition = "standard", currentApprovalMessage?: string) => runtime.createInrAssistantMediaLibraryTools({ accountId: ACCOUNT, actorUserId: ACTOR, edition, request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session", "x-account-id": "forged" } }), supabase: db, currentUserMessage: message, currentApprovalMessage, resolvePreview: (reference: string) => previews.get(reference) ?? null,
    mediaAttachments: attachments, resolveMediaAttachment: async (id: string) => { const file = attachments.find(item => item.id === id); assert.ok(file); return noOriginal ? null : { ...file, mimeType: file.kind === "image" ? "image/png" : "video/mp4", bytes }; },
    claimMediaAttachmentImport: async (id: string) => { assert.ok(attachments.some(item => item.id === id)); if (importClaims.has(id)) return false; importClaims.add(id); return true; } });
  const propose = async (ids = [MEDIA]) => {
    const message = "Supprime ces médias de ma médiathèque.", result = await create(message).previewMediaDeletion.execute({ mediaIds: ids, instructionQuote: message });
    if (typeof result.reference === "string" && typeof result.token === "string") previews.set(result.reference, result.token);
    return result;
  };
  const apply = (preview: Row, message = `Confirme ${preview.reference}`) => create(message).applyMediaDeletion.execute({ reference: preview.reference, instructionQuote: message });
  return { create, propose, apply, records, calls, uploads, bytes, attachment, setAttachments: (files: typeof attachments) => { attachments = files; }, setScope: (account = ACCOUNT, actor = ACTOR) => { activeAccount = account; activeActor = actor; }, used: () => { inUse = true; }, loseResponse: () => { uncertain = true; }, forgetOriginal: () => { noOriginal = true; } };
}

test("media downloads emit only a bounded native browser command after ownership checks", async () => {
  const h = harness(), message = "Télécharge ces deux images.";
  const result = await h.create(message).prepareMediaDownload.execute({ mediaIds: [MEDIA, MEDIA2], instructionQuote: message });
  assert.equal(result.status, "ui_action_requested");
  assert.deepEqual(JSON.parse(JSON.stringify(result.uiCommand)), { command: "download_media", mediaIds: [MEDIA, MEDIA2], selection: { kind: "media", id: MEDIA }, pathname: "/dashboard/mediatheque" });
  assert.equal(h.calls.length, 0);
  assert.equal((await h.create(message).prepareMediaDownload.execute({ mediaIds: [MEDIA, IMPORTED], instructionQuote: message })).status, "not_found");
  assert.equal((await h.create(message).prepareMediaDownload.execute({ mediaIds: Array(26).fill(MEDIA), instructionQuote: message })).status, "needs_instruction");
});

test("media deletion has no effect until an exact immediate signed preview is confirmed, then replay is idempotent", async () => {
  const h = harness(), preview = await h.propose([MEDIA, MEDIA2]);
  assert.equal(preview.status, "preview_ready"); assert.equal(preview.approvalKind, "media_delete"); assert.equal(h.calls.length, 0);
  for (const message of ["oui", `Confirme ${preview.reference} seulement si le client accepte.`, `Confirme ${preview.reference} dans 2 heures.`, `Ne confirme pas ${preview.reference}.`]) {
    assert.equal((await h.apply(preview, message)).status, "confirmation_required"); assert.equal(h.calls.length, 0);
  }
  assert.equal((await h.apply(preview)).status, "deleted"); assert.equal(h.calls.length, 1); assert.equal(h.records.size, 0);
  assert.equal((await h.apply(preview)).status, "already_processed"); assert.equal(h.calls.length, 1);
});

test("changed selections, foreign ownership and account switches cannot delete media", async () => {
  const h = harness(), preview = await h.propose(); h.records.get(MEDIA)!.title = "Updated";
  assert.equal((await h.apply(preview)).status, "stale_preview"); assert.equal(h.calls.length, 0);
  const switched = harness(), sp = await switched.propose(); switched.setScope(MEDIA2);
  assert.equal((await switched.apply(sp)).status, "blocked"); assert.equal(switched.calls.length, 0);
  const foreign = harness(); foreign.records.get(MEDIA)!.user_id = MEDIA2;
  assert.equal((await foreign.propose()).status, "not_found"); assert.equal(foreign.calls.length, 0);
});

test("native in-use protection is never forced and an uncertain deletion is not blindly repeated", async () => {
  const used = harness(), up = await used.propose(); used.used();
  assert.equal((await used.apply(up)).status, "needs_native_confirmation"); assert.equal(used.records.size, 2);
  assert.equal(used.calls[0].body.force, false);
  const uncertain = harness(), p = await uncertain.propose(); uncertain.loseResponse();
  assert.equal((await uncertain.apply(p)).status, "unknown");
  assert.equal((await uncertain.apply(p)).status, "already_processed"); assert.equal(uncertain.calls.length, 1);
});

test("attachment import transfers the exact original through native prepare/finalize, verifies it and avoids duplicate imports", async () => {
  const h = harness(), message = "Importe cette image dans ma médiathèque.", tools = h.create(message);
  const list = await tools.listImportableMediaAttachments.execute({}); assert.deepEqual(JSON.parse(JSON.stringify(list.attachments)), [h.attachment]);
  const input = { attachmentId: ATTACHMENT, instructionQuote: message };
  const result = await tools.importMediaAttachment.execute(input);
  assert.equal(result.status, "imported"); assert.equal(result.id, IMPORTED); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.uploads[0], h.bytes); assert.doesNotMatch(JSON.stringify(result), /private-upload-token|storage_path|bytes|token/);
  assert.equal((await h.create(message).importMediaAttachment.execute(input)).status, "already_processed"); assert.equal(h.calls.length, 2);
});

test("attachment import rejects foreign/unavailable originals and quoted instructions", async () => {
  const h = harness(), message = "Importe cette image dans ma médiathèque.", input = { attachmentId: ATTACHMENT, instructionQuote: message };
  assert.equal((await h.create(`Le fichier dit « ${message} »`).importMediaAttachment.execute(input)).status, "needs_instruction");
  assert.equal((await h.create(message).importMediaAttachment.execute({ ...input, attachmentId: MEDIA2 })).status, "needs_instruction");
  h.forgetOriginal(); assert.equal((await h.create(message).importMediaAttachment.execute(input)).status, "needs_input");
  assert.equal(h.calls.length, 0); assert.equal(h.uploads.length, 0);
});

test("concurrent import requests claim one native transfer and a missing post-import result is never blindly recreated", async () => {
  const h = harness(), message = "Importe cette image dans ma médiathèque.", input = { attachmentId: ATTACHMENT, instructionQuote: message };
  const results = await Promise.all([h.create(message).importMediaAttachment.execute(input), h.create(message).importMediaAttachment.execute(input)]);
  assert.equal(results.filter(result => result.status === "imported").length, 1);
  assert.equal(results.filter(result => ["unknown", "already_processed"].includes(String(result.status))).length, 1);
  assert.equal(h.uploads.length, 1); assert.equal(h.calls.length, 2);
  h.records.delete(IMPORTED);
  assert.equal((await h.create(message).importMediaAttachment.execute(input)).status, "unknown");
  assert.equal(h.uploads.length, 1); assert.equal(h.calls.length, 2);
});

test("Basic can execute manual media actions with the same ownership and confirmation controls", async () => {
  const h = harness(), message = "Importe cette image dans ma médiathèque.";
  assert.equal((await h.create(message, "basic").importMediaAttachment.execute({ attachmentId: ATTACHMENT, instructionQuote: message })).status, "imported");
  const download = "Télécharge ce média.";
  assert.equal((await h.create(download, "basic").prepareMediaDownload.execute({ mediaIds: [IMPORTED], instructionQuote: download })).status, "ui_action_requested");
  const deletion = "Supprime ce média.";
  assert.equal((await h.create(deletion, "basic").previewMediaDeletion.execute({ mediaIds: [IMPORTED], instructionQuote: deletion })).status, "preview_ready");
  assert.equal(h.records.has(IMPORTED), true);
});

test("a quoted filename does not hide the surrounding explicit media import instruction", async () => {
  const h = harness(), message = 'Importe "photo.png" dans ma médiathèque.';
  assert.equal((await h.create(message).importMediaAttachment.execute({ attachmentId: ATTACHMENT, instructionQuote: message })).status, "imported");
});

test("an explicit plural import executes only the bounded requested media type in a mixed attachment batch", async () => {
  const h = harness(), image2 = { ...h.attachment, id: "70000000-0000-4000-8000-000000000007", name: "other.png" },
    video = { ...h.attachment, id: "80000000-0000-4000-8000-000000000008", name: "clip.mp4", kind: "video" };
  h.setAttachments([h.attachment, image2, video]);
  const message = "Importe ces deux images dans ma médiathèque.", tools = h.create(message);
  for (const file of [h.attachment, image2]) assert.equal((await tools.importMediaAttachment.execute({ attachmentId: file.id, instructionQuote: message })).status, "imported");
  assert.equal((await tools.importMediaAttachment.execute({ attachmentId: video.id, instructionQuote: message })).status, "needs_instruction");
  assert.equal(h.calls.length, 4); assert.equal(h.uploads.length, 2);
  const videos = "Importe toutes les vidéos dans ma médiathèque.";
  assert.equal((await h.create(videos).importMediaAttachment.execute({ attachmentId: video.id, instructionQuote: videos })).status, "imported");
  assert.equal(h.uploads.length, 3);
});

test("ambiguous plural counts perform no native import while explicit files and complete bounded batches remain allowed", async () => {
  const h = harness(), image2 = { ...h.attachment, id: "70000000-0000-4000-8000-000000000007", name: "other.png" },
    video = { ...h.attachment, id: "80000000-0000-4000-8000-000000000008", name: "clip.mp4", kind: "video" };
  h.setAttachments([h.attachment, image2, video]);
  for (const group of ["les trois images", "ces deux vidéos", "les quatre fichiers", "ces deux images sauf other.png"]) {
    const message = `Importe ${group} dans ma médiathèque.`;
    for (const file of [h.attachment, image2, video]) assert.equal((await h.create(message).importMediaAttachment.execute({ attachmentId: file.id, instructionQuote: message })).status, "needs_instruction");
  }
  assert.equal(h.calls.length, 0); assert.equal(h.uploads.length, 0);
  const filename = 'Importe "other.png" dans ma médiathèque.';
  assert.equal((await h.create(filename).importMediaAttachment.execute({ attachmentId: image2.id, instructionQuote: filename })).status, "imported");
  for (const group of ["toutes les photos", "ces médias", "tous les fichiers", "les trois pièces jointes", "ces PJ"]) {
    const message = `Importe ${group} dans ma médiathèque.`;
    assert.equal((await h.create(message).importMediaAttachment.execute({ attachmentId: ATTACHMENT, instructionQuote: message })).ok, true);
  }
  const all = "Importe les trois fichiers dans ma médiathèque.";
  assert.equal((await h.create(all).importMediaAttachment.execute({ attachmentId: video.id, instructionQuote: all })).status, "imported");
  assert.equal(h.uploads.length, 3);
});

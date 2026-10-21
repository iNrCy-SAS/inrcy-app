import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import * as uploadPolicy from "../../lib/mediaUploadPolicy.ts";
import { uploadSignedStorageObject } from "../../lib/mediaSignedUploadTransport.ts";

const supabaseUrl = "https://storage-fixture.invalid";
const publicApiKey = "public-fixture-key";
const intent = { ok: true, protocol: "signed", target: "workspace_source", bucket: "private-media", storagePath: "users/owner/été pitch.mp4", token: "scoped-token", contentType: "video/mp4", mediaType: "video", mediaId: "media-fixture", clientMediaKey: "fixture-key", resumableEndpoint: "" };

function uploadClient() {
  const output = ts.transpileModule(readFileSync(new URL("../../lib/universalMediaUploadClient.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} as { uploadUniversalMediaFile: (file: File, options: Record<string, unknown>) => Promise<{ mediaId: string }> } };
  const require = (id: string) => {
    if (id === "@/lib/mediaSignedUploadTransport") return { uploadSignedStorageObject };
    if (id === "@/lib/mediaUploadPolicy") return uploadPolicy;
    if (id === "@/lib/mediaRules") return { INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL: "300 Mo" };
    throw new Error(`Signed uploads must not initialize browser Auth: ${id}`);
  };
  new Function("module", "exports", "require", "process", "window", output)(moduleRecord, moduleRecord.exports, require, { env: { NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicApiKey } }, { setTimeout: (fn: () => void) => setTimeout(fn, 0), clearTimeout });
  return moduleRecord.exports;
}

test("regression: the authenticated SDK can abort a signed upload before any storage request", async () => {
  let blocked = false;
  let networkCalls = 0;
  const client = createClient(supabaseUrl, publicApiKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      lock: async (_name, _timeout, run) => {
        if (blocked) throw new DOMException("signal is aborted without reason", "AbortError");
        return await run();
      } },
    global: { fetch: async () => { networkCalls += 1; return Response.json({}); } },
  });
  await client.auth.initialize();
  await new Promise<void>((resolve) => setImmediate(resolve));
  blocked = true;
  const result = await client.storage.from(intent.bucket).uploadToSignedUrl(intent.storagePath, intent.token, new File(["media"], "clip.mp4"));
  assert.match(result.error?.message || "", /signal is aborted without reason/);
  assert.equal(networkCalls, 0);
});

for (const [name, type, bytes] of [["image.jpg", "image/jpeg", 257_324], ["studio.mp4", "video/mp4", 5_956_547]] as const) {
  test(`the complete workspace upload transfers ${name} without consulting browser Auth`, async (t) => {
    const file = new File([new Uint8Array(bytes)], name, { type });
    const events: string[] = [];
    let transferred = 0;
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/media-pipeline/upload-intent") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.workspaceId, "workspace-fixture");
        return Response.json({ ...intent, mediaType: type.startsWith("image") ? "image" : "video", contentType: type });
      }
      if (input === "/api/media-pipeline/upload-event") {
        events.push(JSON.parse(String(init?.body)).event);
        return Response.json({ ok: true });
      }
      const url = new URL(String(input));
      assert.equal(url.origin, supabaseUrl);
      assert.equal(url.pathname, "/storage/v1/object/upload/sign/private-media/users/owner/%C3%A9t%C3%A9%20pitch.mp4");
      assert.equal(url.searchParams.get("token"), intent.token);
      assert.equal(init?.method, "PUT");
      assert.equal(init?.body, file);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("apikey"), publicApiKey);
      assert.equal(headers.get("Authorization"), null);
      assert.equal(headers.get("content-type"), type);
      transferred += (await (init?.body as File).arrayBuffer()).byteLength;
      return Response.json({ Key: "stored" });
    });
    const result = await uploadClient().uploadUniversalMediaFile(file, { target: "workspace_source", workspaceId: "workspace-fixture", workspacePosition: 0 });
    assert.equal(result.mediaId, intent.mediaId);
    assert.equal(transferred, bytes);
    assert.deepEqual(events, ["uploading", "uploaded"]);
  });
}

test("signed uploads retry transient storage failures, but preserve permanent rejections", async (t) => {
  const file = new File(["media"], "clip.mp4");
  let puts = 0;
  let status = 503;
  const events: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/api/media-pipeline/upload-intent") return Response.json(intent);
    if (input === "/api/media-pipeline/upload-event") { events.push(JSON.parse(String(init?.body)).event); return Response.json({ ok: true }); }
    puts += 1;
    return puts === 1 || status === 403 ? Response.json({ message: "storage refusal" }, { status }) : Response.json({});
  });
  await uploadClient().uploadUniversalMediaFile(file, { target: "workspace_source" });
  assert.equal(puts, 2);
  assert.deepEqual(events, ["uploading", "uploaded"]);
  puts = 0; status = 403; events.length = 0;
  await assert.rejects(uploadClient().uploadUniversalMediaFile(file, { target: "workspace_source" }), /storage refusal/);
  assert.equal(puts, 1);
  assert.deepEqual(events, ["uploading", "failed"]);
});

test("a real caller cancellation stops storage and never confirms an incomplete upload", async (t) => {
  const parent = new AbortController();
  const events: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/api/media-pipeline/upload-intent") return Response.json(intent);
    if (input === "/api/media-pipeline/upload-event") { events.push(JSON.parse(String(init?.body)).event); return Response.json({ ok: true }); }
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      parent.abort();
    });
  });
  await assert.rejects(uploadClient().uploadUniversalMediaFile(new File(["clip"], "clip.mp4"), { target: "workspace_source", signal: parent.signal }), { name: "AbortError" });
  assert.deepEqual(events, ["uploading", "removed"]);
});

test("the signed transport bounds stalled connections and leaves the caller signal intact", async (t) => {
  const parent = new AbortController();
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  await assert.rejects(uploadSignedStorageObject({ supabaseUrl, publicApiKey, ...intent, file: new File(["data"], "clip.mp4"), signal: parent.signal, timeoutMs: 5 }), (error: unknown) => (error as { status?: number }).status === 408);
  assert.equal(parent.signal.aborted, false);
});

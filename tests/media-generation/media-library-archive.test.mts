import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { unzipSync } from "fflate";
import * as audio from "../../lib/mediaLibraryAudio.ts";

const nativeRequire = createRequire(import.meta.url);
const ACCOUNT = "active-account";
const ORIGIN = "https://private-storage.example";
const ID_A = "10000000-0000-4000-8000-000000000001";
const ID_B = "10000000-0000-4000-8000-000000000002";
const ID_C = "10000000-0000-4000-8000-000000000003";
type Row = Record<string, unknown>;
type Archive = typeof import("../../lib/mediaLibraryArchive.ts");
type Route = { POST(request: Request): Promise<Response>; GET(request: Request): Promise<Response> };

function load<T>(file: string, dependencies: Record<string, unknown>, fetcher: typeof fetch = fetch): T {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", "fetch", "process", javascript)(record, record.exports, (name: string) => {
    if (name in dependencies) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "fflate") return nativeRequire(name);
    throw new Error(`unexpected_dependency:${name}`);
  }, fetcher, { env: { NEXT_PUBLIC_SUPABASE_URL: ORIGIN } });
  return record.exports as T;
}

function row(id = ID_A, overrides: Row = {}): Row {
  return { id, user_id: ACCOUNT, bucket_name: "inrcy-pro-media", storage_path: `users/${ACCOUNT}/image/${id}.png`,
    media_type: "image", mime_type: "image/png", title: "Visuel", original_file_name: "été.png", is_active: true, source: "mediatheque", ...overrides };
}
function signed(path: string) { return `${ORIGIN}/storage/v1/object/sign/inrcy-pro-media/${path}?token=server-secret`; }

function runtime(options: {
  rows?: Row[]; queryError?: boolean; activeAccount?: string; authError?: number;
  sign?: (path: string) => Promise<string | null>; fetcher?: typeof fetch;
} = {}) {
  const queries: Array<[string, unknown]> = [];
  const fetches: Array<{ url: string; options: RequestInit | undefined }> = [];
  const signingTtls: number[] = [];
  const bytes = new Uint8Array([1, 2, 3, 4]);
  let cancelledProbes = 0;
  const client = { from: (table: string) => {
    assert.equal(table, "pro_media_library");
    let account = ""; let ids: string[] = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => { queries.push([column, value]); account = value; return builder; },
      in: (column: string, values: string[]) => { queries.push([column, values]); ids = values; return builder; },
      abortSignal: async () => ({ data: (options.rows ?? [row()]).filter((item) => item.user_id === account && ids.includes(String(item.id))), error: options.queryError ? { message: "private database diagnostic" } : null }),
    }; return builder;
  } };
  const fetcher: typeof fetch = async (url, init) => {
    fetches.push({ url: String(url), options: init });
    if (options.fetcher) return options.fetcher(url, init);
    if (new Headers(init?.headers).has("range")) return new Response(new ReadableStream({ cancel: () => { cancelledProbes++; } }),
      { status: 206, headers: { "content-range": "bytes 0-0/4", "content-length": "1", etag: '"version-1"' } });
    return new Response(bytes, { headers: { "content-length": "4" } });
  };
  const archive = load<Archive>("lib/mediaLibraryArchive.ts", {
    "@/lib/supabaseAdmin": { supabaseAdmin: client }, "@/lib/mediaLibraryAudio": audio,
    "@/lib/safeStorageSignedUrl": { createSafeStorageSignedUrl: (_bucket: string, path: string, ttl: number) => { signingTtls.push(ttl); return options.sign?.(path) ?? Promise.resolve(signed(path)); } },
  }, fetcher);
  const route = load<Route>("app/api/media-library/download/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/mediaLibraryArchive": archive,
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: options.activeAccount ?? ACCOUNT, errorResponse: options.authError ? Response.json({ error: "auth required" }, { status: options.authError }) : null }) },
  }, fetcher);
  return { archive, route, queries, fetches, signingTtls, bytes, cancelledProbes: () => cancelledProbes };
}

function post(ids: unknown) { return new Request("https://app.example/api/media-library/download", { method: "POST", body: JSON.stringify({ ids }) }); }
function get(ids: string[]) { return new Request(`https://app.example/api/media-library/download?ids=${ids.join(",")}`); }

test("ZIP preflight returns only a same-origin native download URL and checks the active establishment", async () => {
  const h = runtime();
  const response = await h.route.POST(post([ID_A]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, downloadUrl: `/api/media-library/download?ids=${ID_A}` });
  assert.deepEqual(h.queries, [["user_id", ACCOUNT], ["id", [ID_A]]]);
  assert.equal(h.fetches.length, 1); assert.equal(h.cancelledProbes(), 1);
  assert.equal(new Headers(h.fetches[0].options?.headers).get("range"), "bytes=0-0");
  assert.equal(h.fetches[0].options?.redirect, "error");
  assert.ok(h.signingTtls[0] * 0.2 > 280, "even an old cached signed URL must outlive the entire ZIP request");
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("GET creates a valid UTF-8 ZIP containing every selected original without overwrite", async () => {
  const h = runtime({ rows: [row(ID_A), row(ID_B), row(ID_C, { media_type: "audio", mime_type: "audio/wav", storage_path: `users/${ACCOUNT}/audio/2026/voice.wav`, original_file_name: "voix.wav" })] });
  const response = await h.route.GET(get([ID_B, ID_A, ID_C]));
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition")!, /^attachment; filename="inrcy-medias-\d{4}-\d{2}-\d{2}\.zip"$/);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(files), ["été.png", "été (2).png", "voix.wav"]);
  for (const data of Object.values(files)) assert.deepEqual(data, h.bytes);
  const reads = h.fetches.filter((call) => !new Headers(call.options?.headers).has("range"));
  assert.equal(reads.length, 3);
  assert.equal(new Headers(reads[0].options?.headers).get("if-match"), '"version-1"');
});

test("unauthenticated requests, account switches, missing rows and mixed ownership cannot download any bytes", async () => {
  for (const method of ["POST", "GET"] as const) {
    for (const options of [{ authError: 401 }, { activeAccount: "other-account" }, { rows: [] }, { rows: [row(ID_A), row(ID_B, { user_id: "other-account" })] }]) {
      const h = runtime(options);
      const response = await h.route[method](method === "POST" ? post([ID_A, ID_B]) : get([ID_A, ID_B]));
      assert.equal(response.status, "authError" in options ? 401 : 404);
      assert.equal(h.fetches.length, 0);
    }
  }
});

test("POST and GET reject malformed, absent, oversized and too-many identifiers before querying Storage", async () => {
  const h = runtime();
  for (const ids of [null, [], ["https://attacker.invalid/file"], ["../other"], Array(201).fill(ID_A), [42]]) {
    assert.equal((await h.route.POST(post(ids))).status, 400);
  }
  assert.equal((await h.route.POST(new Request("https://app.example/download", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await h.route.POST(new Request("https://app.example/download", { method: "POST", body: "x".repeat(17_000) }))).status, 400);
  assert.equal((await h.route.GET(get([]))).status, 400);
  assert.equal((await h.route.GET(get(Array(201).fill(ID_A)))).status, 400);
  assert.equal(h.fetches.length, 0); assert.equal(h.queries.length, 0);
  assert.deepEqual(h.archive.parseMediaLibraryArchiveIds([ID_A, ID_A.toUpperCase()]), [ID_A]);
  assert.equal(h.archive.MEDIA_LIBRARY_ARCHIVE_MAX_ITEMS, 200);
});

test("inactive/draft assets, foreign buckets and encoded or ordinary traversal paths are refused", async () => {
  for (const overrides of [
    { is_active: false }, { source: "ai_media_generation_draft" }, { bucket_name: "other-bucket" },
    { storage_path: "users/foreign-account/image.png" }, { storage_path: `users/${ACCOUNT}/../other/image.png` },
    { storage_path: `users/${ACCOUNT}/%2e%2e/secret.png` }, { storage_path: `users/${ACCOUNT}/a\\b.png` },
    { media_type: "audio", storage_path: `users/${ACCOUNT}/image/a.wav` },
  ]) {
    const h = runtime({ rows: [row(ID_A, overrides)] });
    assert.equal((await h.route.POST(post([ID_A]))).status, 404); assert.equal(h.fetches.length, 0);
  }
});

test("a signed URL may target only the exact account-owned Supabase object, with no redirects", async () => {
  for (const url of ["https://attacker.invalid/file?token=x", `${ORIGIN}/other?token=x`, signed(`users/other/image.png`), signed(`users/${ACCOUNT}/image/${ID_A}.png`).replace("https://", "https://user:pass@"), signed(`users/${ACCOUNT}/image/${ID_A}.png`) + "#fragment"]) {
    const h = runtime({ sign: async () => url });
    const response = await h.route.POST(post([ID_A]));
    assert.equal(response.status, 503); assert.equal(h.fetches.length, 0);
    assert.doesNotMatch(await response.text(), /token|attacker|server-secret/);
  }
  const h = runtime({ fetcher: async (_url, init) => { assert.equal(init?.redirect, "error"); throw new Error("redirect to private URL with token=secret"); } });
  const response = await h.route.POST(post([ID_A]));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /token|private URL/);
});

test("metadata preflight refuses missing files, unknown length, gzip and archives above the real source size cap", async () => {
  const cap = runtime().archive.MEDIA_LIBRARY_ARCHIVE_MAX_BYTES;
  for (const [response, expected] of [
    [new Response(null, { status: 404 }), 404], [new Response(null, { status: 200 }), 503],
    [new Response(null, { status: 206, headers: { "content-range": `bytes 0-0/${cap + 1}` } }), 413],
    [new Response(null, { status: 200, headers: { "content-length": "4", "content-encoding": "gzip" } }), 503],
  ] as const) {
    const h = runtime({ fetcher: async () => response });
    assert.equal((await h.route.POST(post([ID_A]))).status, expected);
  }
  const h = runtime({ rows: [row(ID_A), row(ID_B)], fetcher: async () => new Response(null, { status: 206, headers: { "content-range": `bytes 0-0/${cap / 2 + 1}` } }) });
  assert.equal((await h.route.POST(post([ID_A, ID_B]))).status, 413);
});

test("portable filenames stay flat, unique and bounded while retaining Unicode", () => {
  const { archive } = runtime();
  const rows = ["../CON.png", "C:\\folder\\nul.png", "été.png", "ÉTÉ.PNG", ".", "name\u0000\u202e.png", "😀".repeat(100) + ".png", "x.jpg"].map((name) => row(ID_A, { original_file_name: name }));
  const names = archive.mediaLibraryArchiveNames(rows as Parameters<Archive["mediaLibraryArchiveNames"]>[0]);
  assert.deepEqual(names.slice(0, 4), ["media-CON.png", "media-nul.png", "été.png", "ÉTÉ (2).png"]);
  assert.equal(names.at(-1), "x.png", "the stored media type determines its extension");
  for (const name of names) {
    assert.doesNotMatch(name, /[\\/\u0000-\u001f\u202e]/); assert.ok(Buffer.byteLength(name) <= 180); assert.ok(!name.startsWith("."));
  }
});

test("ZIP backpressure reads one source at a time and cancellation stops its reader", async () => {
  let reads = 0; let cancelled = 0;
  const source = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array(64 * 1024)); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const h = runtime({ fetcher: async () => new Response(source, { headers: { "content-length": String(10 * 64 * 1024) } }) });
  const entry = { name: "video.mp4", url: signed(`users/${ACCOUNT}/video/a.mp4`), size: 10 * 64 * 1024, etag: null };
  const stream = h.archive.createMediaLibraryArchiveStream([entry, { ...entry, name: "second.mp4" }], new AbortController().signal);
  assert.equal(h.fetches.length, 0, "unconsumed responses must not start downloading");
  const reader = stream.getReader(); await reader.read();
  const count = reads; await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(reads, count, "a slow consumer must stop further source reads");
  assert.equal(h.fetches.length, 1);
  await reader.cancel(); assert.equal(cancelled, 1); assert.equal(h.fetches.length, 1);
});

test("source failure or unexpected byte counts error the archive instead of producing a valid partial ZIP", async () => {
  for (const size of [3, 5]) {
    const h = runtime({ fetcher: async () => new Response(new Uint8Array(size), { headers: { "content-length": "4" } }) });
    const stream = h.archive.createMediaLibraryArchiveStream([{ name: "image.png", url: signed(`users/${ACCOUNT}/image.png`), size: 4, etag: null }], new AbortController().signal);
    await assert.rejects(new Response(stream).arrayBuffer(), /momentanément indisponibles/);
  }
  const h = runtime({ fetcher: async () => { throw new Error("token=server-secret"); } });
  await assert.rejects(new Response(h.archive.createMediaLibraryArchiveStream([{ name: "x.png", url: signed("x.png"), size: 4, etag: null }], new AbortController().signal)).arrayBuffer(), (error: Error) => !error.message.includes("secret"));
});

test("request abort interrupts an in-flight source read", async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const h = runtime({ fetcher: async (_url, init) => new Response(new ReadableStream<Uint8Array>({
    start(stream) { init?.signal?.addEventListener("abort", () => { cancelled++; stream.error(new Error("aborted")); }, { once: true }); },
  }), { headers: { "content-length": "4" } }) });
  const pending = new Response(h.archive.createMediaLibraryArchiveStream([{ name: "x.png", url: signed("x.png"), size: 4, etag: null }], controller.signal)).arrayBuffer();
  await new Promise((resolve) => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(pending); assert.equal(cancelled, 1);
});

test("request abort interrupts a stalled signing operation before any source fetch", async () => {
  const controller = new AbortController();
  const h = runtime({ sign: async () => new Promise(() => {}) });
  const pending = h.archive.prepareMediaLibraryArchive(ACCOUNT, [ID_A], controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 5)); controller.abort(new Error("cancelled by client"));
  await assert.rejects(pending, /cancelled by client/); assert.equal(h.fetches.length, 0);
});

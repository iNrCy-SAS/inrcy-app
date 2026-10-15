import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";
import { resolveRetoucherGeometry } from "../../lib/mediaRetoucherGeometry.ts";
import { resolveImageOverlayTextLayout } from "../../lib/imageOverlayLayout.ts";
import { buildImageOverlaySvg } from "../../lib/imageOverlaySvg.ts";
import { normalizeImageAiPreviewBuffer, normalizeImageEditMasterBuffer } from "../../lib/mediaImageNormalizer.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(".");
function loadRuntime<T>(relativePath: string, overrides = new Map<string, unknown>()): T {
  const cache = new Map<string, { exports: unknown }>();
  function load(file: string): unknown {
    if (cache.has(file)) return cache.get(file)!.exports;
    const record = { exports: {} };
    cache.set(file, record);
    const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function("module", "exports", "require", source)(record, record.exports, (id: string) => {
      if (overrides.has(id)) return overrides.get(id);
      if (id === "server-only") return {};
      if (id.startsWith("@/") || id.startsWith(".")) {
        let resolved = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        if (!resolved.endsWith(".ts")) resolved += ".ts";
        return load(resolved);
      }
      return require(id);
    });
    return record.exports;
  }
  return load(path.join(root, relativePath)) as T;
}

test("Retoucher keeps the same drag direction and displacement at every zoom, in preview and actual export", async () => {
  const renderer = loadRuntime<typeof import("../../lib/mediaRetoucherRenderClient.ts")>("lib/mediaRetoucherRenderClient.ts");
  const savedImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const positions: number[][] = [];
  class TestImage {
    naturalWidth = 1000; naturalHeight = 1000; onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ clearRect() {}, fillRect() {}, drawImage(_image: unknown, ...args: number[]) { positions.push(args); } }),
    toBlob(callback: (blob: Blob) => void, type: string) { callback(new Blob(["image"], { type })); },
  }) } });
  try {
    for (const [zoom, offsetX, expectedX, expectedWidth] of [[1, 20, 200, 1000], [2, 20, -300, 2000], [0.4, -20, 100, 400]]) {
      const transform = { fit: "contain" as const, zoom, offsetX, offsetY: 0, backgroundMode: "transparent" as const, backgroundColor: "#fff" };
      const preview = resolveRetoucherGeometry({ canvasWidth: 1000, canvasHeight: 1000, sourceWidth: 1000, sourceHeight: 1000, ...transform });
      const result = await renderer.renderMediaRetoucherFile({ sourceFile: new File(["source"], "source.png"), width: 1000, height: 1000, transform });
      const draw = positions.at(-1)!;
      assert.equal(draw[0], expectedX);
      assert.equal(draw[2], expectedWidth);
      assert.equal(preview.drawX, draw[0]);
      assert.equal(preview.drawWidth, draw[2]);
      assert.equal(result.file.type, "image/png");
    }
    const portrait = resolveRetoucherGeometry({ canvasWidth: 500, canvasHeight: 1000, sourceWidth: 1000, sourceHeight: 1000, fit: "contain", zoom: 1, offsetX: 0, offsetY: 10 });
    assert.deepEqual(portrait, { drawWidth: 500, drawHeight: 500, drawX: 0, drawY: 350 });
  } finally {
    for (const [key, saved] of [["Image", savedImage], ["document", savedDocument]] as const) {
      if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("small text boxes preserve all explicit lines, whitespace and accents at preview and export scales", () => {
  const text = "PREMIÈRE LIGNE\n  DEUXIÈME LIGNE  \nDERNIÈRE LIGNE";
  const overlay = { text, width: 68, height: 8, fontSize: 4.6, x: 50, y: 50 };
  const measure = (value: string, font: string) => value.length * Number(font.match(/([\d.]+)px/)?.[1]) * 0.6;
  const small = resolveImageOverlayTextLayout(360, 360, overlay, measure);
  const large = resolveImageOverlayTextLayout(1080, 1080, overlay, measure);
  assert.equal(large.lines.join("\n"), text);
  assert.deepEqual(small.lines, large.lines);
  assert.ok(large.lines.length * large.lineHeight < large.height);
  assert.equal(large.fontSize, small.fontSize * 3);
  const calls: string[] = [];
  const ctx = { font: "", measureText(value: string) { return { width: measure(value, this.font) }; }, save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {}, fillText(value: string) { calls.push(value); } };
  loadRuntime<typeof import("../../lib/mediaRetoucherRenderClient.ts")>("lib/mediaRetoucherRenderClient.ts").drawImageOverlayItems(ctx as unknown as CanvasRenderingContext2D, 1080, 1080, overlay);
  assert.equal(calls.join("\n"), text);
});

test("server publication retains more than twelve lines and XML-sensitive text instead of truncating", async () => {
  const lines = Array.from({ length: 16 }, (_, index) => `L${index + 1} & <é>`);
  const svg = buildImageOverlaySvg({ text: lines.join("\n"), width: 68, height: 8, fontSize: 4.6 }, 1080, 1080)!;
  const source = svg.toString();
  assert.equal((source.match(/<tspan /g) || []).length, 16);
  assert.ok(source.includes("L16 &amp; &lt;é&gt;"));
  const output = await sharp(svg).png().toBuffer();
  assert.equal((await sharp(output).metadata()).width, 1080);
  assert.match(readFileSync(path.join(root, "lib/boosterImageServerPreparation.ts"), "utf8"), /import \{ buildImageOverlaySvg \} from/);
});

test("undecodable TIFF gets a lossless editable master distinct from its 1280px AI preview", async () => {
  const source = await sharp({ create: { width: 3200, height: 1800, channels: 4, background: { r: 38, g: 120, b: 220, alpha: 0.5 } } }).tiff({ compression: "lzw" }).toBuffer();
  const [master, preview] = await Promise.all([
    normalizeImageEditMasterBuffer({ buffer: source, mimeType: "image/tiff", originalFileName: "large.tiff" }),
    normalizeImageAiPreviewBuffer({ buffer: source, mimeType: "image/tiff", originalFileName: "large.tiff" }),
  ]);
  assert.deepEqual([master.source.width, master.source.height, master.master.width, master.master.height], [3200, 1800, 3200, 1800]);
  assert.equal(preview.aiPreview.width, 1280);
  assert.equal(master.master.mimeType, "image/png");
  assert.equal((await sharp(master.master.buffer).metadata()).hasAlpha, true);
  const pixel = await sharp(master.master.buffer).extract({ left: 1600, top: 900, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual(Array.from(pixel), [38, 120, 220, 128]);
});

test("HEIC fallback uses lossless PNG for editing only and preserves the existing JPEG reference conversion", async () => {
  const decoded = await sharp({ create: { width: 1500, height: 1000, channels: 4, background: { r: 38, g: 120, b: 220, alpha: 0.5 } } }).png().toBuffer();
  const conversions: Array<{ format: string; quality?: number }> = [];
  const normalizer = loadRuntime<typeof import("../../lib/mediaImageNormalizer.ts")>("lib/mediaImageNormalizer.ts", new Map([
    ["heic-convert", async (options: { format: string; quality?: number }) => { conversions.push(options); return decoded; }],
  ]));
  const source = { buffer: Buffer.from("unsupported HEIC fixture; decoder is mocked"), mimeType: "image/heic", originalFileName: "source.heic" };
  const result = await normalizer.normalizeImageEditMasterBuffer(source);
  await normalizer.normalizeImageAiPreviewBuffer(source);
  assert.equal(conversions[0].format, "PNG");
  assert.equal(conversions[0].quality, undefined);
  assert.equal(conversions[1].format, "JPEG");
  assert.equal(conversions[1].quality, 0.94);
  assert.deepEqual([result.master.width, result.master.height], [1500, 1000]);
  assert.equal((await sharp(result.master.buffer).metadata()).hasAlpha, true);
});

test("generated image ratios retain the complete foreground and replace only added white padding", async () => {
  const { normalizeGeneratedAiImage } = loadRuntime<typeof import("../../lib/aiMediaNormalizer.ts")>("lib/aiMediaNormalizer.ts");
  for (const [sourceWidth, sourceHeight, width, height] of [[768, 1024, 1080, 1350], [896, 1152, 1080, 1350], [768, 1344, 1080, 1920], [1344, 768, 1920, 1080]]) {
    const source = await sharp({ create: { width: sourceWidth, height: sourceHeight, channels: 3, background: "#2468ac" } }).composite([{ input: Buffer.from('<svg width="80" height="80"><rect width="80" height="80" fill="#dc2828"/></svg>'), left: Math.floor(sourceWidth / 2) - 40, top: Math.floor(sourceHeight / 2) - 40 }]).png().toBuffer();
    const normalized = await normalizeGeneratedAiImage(source, { width, height });
    assert.deepEqual([normalized.width, normalized.height], [width, height]);
    const pixels = await sharp(normalized.buffer).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => Array.from(pixels.data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3));
    assert.ok(at(1, 1).every((value, index) => Math.abs(value - [36, 104, 172][index]) <= 3), "padding must come from image colours, not white");
    assert.ok(at(Math.floor(width / 2), Math.floor(height / 2)).every((value, index) => Math.abs(value - [220, 40, 40][index]) <= 3), "foreground centre is preserved through JPEG encoding");
  }
});

test("edit-master endpoint scopes the source, cleans it before returning, and streams a master larger than the AI reference budget", async () => {
  const events: string[] = [];
  const png = Buffer.alloc(5 * 1024 * 1024, 42);
  const overrides = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/requireUser", { requireUser: async () => ({ activeUserId: "account-a", errorResponse: null }) }],
    ["@/lib/rateLimit", { enforceRateLimit: async () => null }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: { storage: { from(bucket: string) {
      assert.equal(bucket, "inrcy-pro-media");
      return { download: async (storagePath: string) => { events.push(`download:${storagePath}`); return { data: new Blob(["original tiff"]), error: null }; }, remove: async () => { events.push("cleanup"); return { error: null }; } };
    } } } }],
    ["@/lib/mediaImageNormalizer", { normalizeImageEditMasterBuffer: async () => { events.push("master"); return { source: { width: 5000, height: 2500, hasAlpha: true }, master: { buffer: png, width: 4096, height: 2048, mimeType: "image/png" } }; }, normalizeImageAiPreviewBuffer() { assert.fail("an editing master must not be an AI preview"); } }],
  ]);
  const route = loadRuntime<{ POST: (request: Request) => Promise<Response> }>("app/api/media-generation/normalize-reference/route.ts", overrides);
  const request = (account: string) => new Request("https://inrcy.test/api/media-generation/normalize-reference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storagePath: `users/${account}/studio-identity-reference/image/source.tiff`, fileName: "source.tiff", mimeType: "image/tiff", purpose: "edit_master" }) });
  assert.equal((await route.POST(request("other-account"))).status, 400);
  assert.deepEqual(events, []);
  const response = await route.POST(request("account-a"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Image-Source-Width"), "5000");
  assert.equal(response.headers.get("X-Image-Master-Width"), "4096");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.deepEqual(events, ["download:users/account-a/studio-identity-reference/image/source.tiff", "master", "cleanup"]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});

test("edit-master client keeps original dimensions separate from the bounded PNG and rejects an old preview response", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  const client = loadRuntime<typeof import("../../lib/mediaImageEditMasterClient.ts")>("lib/mediaImageEditMasterClient.ts", new Map([
    ["@/lib/universalMediaUploadClient", { uploadUniversalMediaFile: async () => ({ storagePath: "users/account-a/studio-identity-reference/image/a.tiff", contentType: "image/tiff" }) }],
  ]));
  try {
    globalThis.fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(new Blob(["master"], { type: "image/png" }), { headers: { "X-Image-Source-Width": "5000", "X-Image-Source-Height": "2500", "X-Image-Master-Width": "4096", "X-Image-Master-Height": "2048", "X-Image-Source-Has-Alpha": "true" } });
    };
    const original = new File(["original"], "source.tiff", { type: "image/tiff" });
    const result = await client.prepareMediaImageEditMaster(original);
    assert.equal(requests[0].purpose, "edit_master");
    assert.deepEqual([result.width, result.height, result.masterWidth, result.masterHeight], [5000, 2500, 4096, 2048]);
    assert.equal(result.file.type, "image/png");
    assert.equal(result.hasAlpha, true);
    assert.equal(await original.text(), "original");
    globalThis.fetch = async () => Response.json({ image: { data: "preview", mimeType: "image/jpeg" } });
    await assert.rejects(client.prepareMediaImageEditMaster(original), /copie de travail.*invalide/);
  } finally { globalThis.fetch = previousFetch; }
});

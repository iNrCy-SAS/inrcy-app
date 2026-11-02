import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import * as recovery from "../../lib/mediaImageRecoveryPolicy.ts";
import * as binary from "../../lib/supabaseStorageBinary.ts";
import * as rules from "../../lib/mediaRules.ts";

type Row = Record<string, unknown>;
const nativeRequire = createRequire(import.meta.url);
const accountId = "account-a", mediaId = "media-a", sourcePath = `users/${accountId}/workspace-source/original.png`;

function harness(objects: Map<string, Buffer>) {
  const reads: string[] = [], writes: Row[] = [];
  const dependencies: Record<string, unknown> = {
    "sharp": sharp,
    "@/lib/mediaImageRecoveryPolicy": recovery,
    "@/lib/supabaseStorageBinary": binary,
    "@/lib/mediaRules": rules,
    "@/lib/imageInteractions": {},
    "@/lib/mediaPipelineUnifiedConsumptionPolicy": {},
    "@/lib/mediaVideoSourceCompatibility": {},
    "@/lib/mediaVideoNormalizationPolicy": {},
    "@/lib/workspaceAiMixedConsumption": {},
    "@/lib/supabaseAdmin": { supabaseAdmin: {
      storage: { from(bucket: string) {
        assert.equal(bucket, "inrcy-pro-media");
        return { async download(path: string) { reads.push(path); const buffer = objects.get(path); return buffer ? { data: new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }), error: null } : { data: null, error: { message: "source_missing" } }; } };
      } },
      from(table: string) { assert.equal(table, "media_variants"); return {
        update(value: Row) { writes.push(value); return this; },
        eq(key: string, value: string) { assert.equal(value, key === "id" ? "variant-a" : mediaId); return this; },
        then(resolve: (value: Row) => unknown) { return Promise.resolve(resolve({ error: null })); },
      }; },
    } },
  };
  const source = readFileSync(new URL("../../lib/mediaWorkspaceConsumption.ts", import.meta.url), "utf8") + "\nexport { resolveProviderSafeImageDataUrl };";
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as { resolveProviderSafeImageDataUrl: (args: Row) => Promise<string> } };
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (id: string) => {
    if (id.startsWith("node:")) return nativeRequire(id);
    assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id];
  });
  const media = { mediaId, mediaType: "image", sourceBucket: "inrcy-pro-media", sourceStoragePath: sourcePath, mediaMetadata: {} };
  const variant = (path: string, metadata: Row = {}) => ({ id: "variant-a", mediaId, purpose: "ai_preview", channel: null, bucket: "inrcy-pro-media", storagePath: path, mimeType: "image/jpeg", sizeBytes: objects.get(path)?.length || 0, metadata });
  return { reads, writes, media, variant, run: (variants: Row[] = [], overrides: Row = {}) => loaded.exports.resolveProviderSafeImageDataUrl({ accountId, media: { ...media, ...overrides }, variants }) };
}

const png = () => sharp({ create: { width: 80, height: 50, channels: 4, background: { r: 120, g: 70, b: 30, alpha: 0.7 } } }).png().toBuffer();
function fromDataUrl(value: string) { assert.ok(value.startsWith("data:image/jpeg;base64,")); return Buffer.from(value.split(",")[1], "base64"); }

test("an unreadable historical variant falls back to its account-owned source without publication writes", async () => {
  const h = harness(new Map([["broken-variant", Buffer.from("invalid-image")], [sourcePath, await png()]]));
  const bytes = fromDataUrl(await h.run([h.variant("broken-variant")])); const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.width, 80); assert.equal(metadata.height, 50);
  assert.deepEqual(h.reads, ["broken-variant", sourcePath]); assert.deepEqual(h.writes, []);
});

test("a decodable historical variant is made provider-safe even with incorrect storage MIME", async () => {
  const h = harness(new Map([["legacy-variant", await png()]]));
  assert.equal((await sharp(fromDataUrl(await h.run([h.variant("legacy-variant")]))).metadata()).format, "jpeg");
  assert.deepEqual(h.reads, ["legacy-variant"]); assert.deepEqual(h.writes, []);
});

test("an already verified provider-safe variant retains its exact bytes", async () => {
  const image = await sharp(await png()).jpeg().toBuffer();
  const h = harness(new Map([["verified-variant", image]]));
  const metadata = { output_sha256: createHash("sha256").update(image).digest("hex"), ai_provider_safe_version: 1, storage_binary_upload_version: binary.SUPABASE_STORAGE_BINARY_UPLOAD_VERSION };
  assert.deepEqual(fromDataUrl(await h.run([h.variant("verified-variant", metadata)])), image);
  assert.deepEqual(h.reads, ["verified-variant"]); assert.deepEqual(h.writes, []);
});

test("foreign source paths are rejected before any storage download", async () => {
  const h = harness(new Map());
  await assert.rejects(h.run([], { sourceStoragePath: "users/other-account/workspace-source/private.png" }), /source image n'est plus accessible/);
  assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []);
});

test("unreadable variants and missing source fail without a false repair or upload", async () => {
  const h = harness(new Map([["broken-variant", Buffer.from("invalid-image")]]));
  await assert.rejects(h.run([h.variant("broken-variant")]), error => (error as Error & { code: string; status: number }).code === "workspace_ai_variant_invalid" && (error as Error & { status: number }).status === 422);
  assert.deepEqual(h.reads, ["broken-variant", sourcePath]); assert.deepEqual(h.writes, []);
});

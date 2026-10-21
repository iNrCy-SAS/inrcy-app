import assert from "node:assert/strict";
import { createHash, randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";

const source = ts.createSourceFile("route.ts", readFileSync(new URL("../../app/api/agent/actions/prepare-publish/route.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const require = createRequire(import.meta.url);
function declaration(name: string) {
  const node = source.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name);
  assert.ok(node); return node.getText(source);
}
const constants = source.statements.filter((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((entry) => /^AGENT_AI_IMAGE_/.test(entry.name.getText(source)))).map((node) => node.getText(source)).join("\n");
const compiled = ts.transpileModule(`${constants}\n${declaration("cleanText")}\n${declaration("prepareAgentSelectedImageForAI")}\nreturn prepareAgentSelectedImageForAI;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
async function analyze(original: Buffer, type: string) {
  let reads = 0, failures = 0;
  const prepare = new Function("require", "supabaseAdmin", "probeStorageObject", "console", compiled)(require,
    { storage: { from: (bucket: string) => { assert.equal(bucket, "private-library"); return { download: async (path: string) => { assert.equal(path, "business/original"); reads++; return { data: new Blob([new Uint8Array(original)], { type }) }; } }; } } },
    async () => "exists", { warn: () => { failures++; } });
  const before = createHash("sha256").update(original).digest("hex");
  const result = await prepare({ id: "fixture", bucket: "private-library", storagePath: "business/original", mimeType: type, mediaType: "image", librarySource: "pro_media_library" });
  assert.equal(createHash("sha256").update(original).digest("hex"), before, "analysis cannot change the publication original");
  assert.equal(reads, 1);
  return { result: result as Array<{ dataUrl: string }>, failures };
}

test("a valid library photo above 8 MiB gets a readable temporary JPEG analysis copy while its original is preserved", async () => {
  const pixels = randomFillSync(Buffer.alloc(1800 * 1800 * 3));
  const original = await sharp(pixels, { raw: { width: 1800, height: 1800, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(original.length > 8 * 1024 * 1024);
  const { result, failures } = await analyze(original, "image/png");
  assert.equal(failures, 0); assert.equal(result.length, 1);
  assert.match(result[0].dataUrl, /^data:image\/jpeg;base64,/);
  const preview = Buffer.from(result[0].dataUrl.split(",")[1], "base64");
  assert.ok(preview.length <= 8 * 1024 * 1024);
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.width, 1600); assert.equal(metadata.height, 1600);
});

test("a TIFF outside the vision provider formats is rotated and converted for analysis, without replacing the original", async () => {
  const original = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#2563aa" } }).withMetadata({ orientation: 6 }).tiff().toBuffer();
  const { result, failures } = await analyze(original, "image/tiff");
  assert.equal(failures, 0); assert.equal(result.length, 1);
  const metadata = await sharp(Buffer.from(result[0].dataUrl.split(",")[1], "base64")).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.width, 80); assert.equal(metadata.height, 120);
});

test("an unreadable selected file cannot turn filename metadata into visual observations", async () => {
  const { result, failures } = await analyze(Buffer.from("not an image"), "image/tiff");
  assert.deepEqual(result, []); assert.equal(failures, 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as rules from "../../lib/mediaRules.ts";
import * as inspirationImagePolicy from "../../lib/studioInspirationImagePolicy.ts";
import { insertStudioReference, normalizeCharacterReferenceIndexes, type StudioReferenceImage } from "../../lib/mediaGenerationReferenceCollection.ts";

const reference = (name: string, overrides: Partial<StudioReferenceImage> = {}): StudioReferenceImage => ({
  name, mimeType: "image/jpeg", data: "aW1hZ2U=", role: "character", usage: "required", ...overrides,
});

test("replacement retains the other characters and roles, then orders and reindexes the collection", () => {
  const original = [reference("product", { role: "product" }), reference("second", { characterIndex: 2 }), reference("first", { characterIndex: 1 }), reference("room", { role: "environment" })];
  const snapshot = structuredClone(original);
  const next = insertStudioReference(original, reference("replacement", { characterIndex: 2 }), "character", 2, "replace");
  assert.deepEqual(next.map(({ name }) => name), ["first", "replacement", "room", "product"]);
  assert.deepEqual(next.map(({ characterIndex }) => characterIndex), [1, 2, undefined, undefined]);
  assert.deepEqual(original, snapshot);
  assert.equal(next[0].usage, "required");
});

test("append preserves the maximum reference count and keeps inspiration usage intact", () => {
  const original = Array.from({ length: contracts.AI_MEDIA_INSPIRATION_MAX_COUNT }, (_, index) => reference(`existing-${index}`, { role: "environment" }));
  const next = insertStudioReference(original, reference("new"), "inspiration", undefined, "append");
  assert.equal(next.length, contracts.AI_MEDIA_INSPIRATION_MAX_COUNT);
  assert.equal(next[0].name, "new");
  assert.equal(next.at(-1)!.name, `existing-${contracts.AI_MEDIA_INSPIRATION_MAX_COUNT - 2}`);
  const inspiration = normalizeCharacterReferenceIndexes([reference("mood", { usage: "inspiration" })]);
  assert.equal(inspiration[0].usage, "inspiration");
  assert.equal(inspiration[0].role, "character");
});

test("changing a character into a product removes its character index and private voice metadata", () => {
  const sample = { path: "account/voice.webm" } as NonNullable<StudioReferenceImage["voiceSample"]>;
  const original = reference("product", { role: "product", characterIndex: 2, voiceMode: "provided", voiceSample: sample });
  const [result] = normalizeCharacterReferenceIndexes([original]);
  for (const field of ["characterIndex", "voiceMode", "voiceSample"]) assert.equal(Object.hasOwn(result, field), false);
  assert.equal(original.voiceSample, sample);
  const characters = normalizeCharacterReferenceIndexes(Array.from({ length: 4 }, (_, index) => reference(String(index), { characterIndex: 3, voiceMode: "provided", voiceSample: sample })));
  assert.deepEqual(characters.map(({ characterIndex }) => characterIndex), [1, 2, 3, undefined]);
  assert.equal(characters[3].voiceSample, sample);
});

function libraryRuntime(fetch: (url: string, options: RequestInit) => Promise<Response>) {
  const source = readFileSync(new URL("../../lib/mediaGenerationReferenceClient.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const record = { exports: {} as { prepareMediaGenerationLibraryReferenceFile: (item: Record<string, unknown>, unavailable: string) => Promise<File> } };
  new Function("module", "exports", "require", "fetch", output)(record, record.exports, (name: string) => {
    if (name === "@/lib/aiMediaGenerationContracts") return contracts;
    if (name === "@/lib/mediaRules") return rules;
    if (name === "./studioInspirationImagePolicy.ts") return inspirationImagePolicy;
    if (name === "@/lib/universalMediaUploadClient") return { uploadUniversalMediaFile: () => { throw new Error("Library reading must not upload a file"); } };
    throw new Error(`Unexpected reference dependency: ${name}`);
  }, fetch);
  return record.exports.prepareMediaGenerationLibraryReferenceFile;
}

test("library files preserve bytes and filename, prefer response MIME and bypass the browser cache", async () => {
  const load = libraryRuntime(async (url, options) => {
    assert.equal(url, "https://example.invalid/signed-media");
    assert.deepEqual(options, { cache: "no-store" });
    return new Response(new Blob(["original bytes"], { type: "image/webp" }));
  });
  const file = await load({ signed_url: "https://example.invalid/signed-media", mime_type: "image/png", original_file_name: "original.webp", title: "Ignored title" }, "Unavailable");
  assert.equal(file.name, "original.webp");
  assert.equal(file.type, "image/webp");
  assert.equal(await file.text(), "original bytes");
});

test("library inputs preserve video MIME and retain the existing fallback for unsupported image MIME", async () => {
  for (const [mime, title, expected] of [["video/mp4", "clip.mp4", "video/mp4"], ["image/heic", "photo.heic", "image/jpeg"]]) {
    const load = libraryRuntime(async () => new Response(new Blob(["bytes"], { type: mime })));
    const file = await load({ signed_url: "https://example.invalid/file", title }, "Unavailable");
    assert.equal(file.name, title);
    assert.equal(file.type, expected);
  }
  const load = libraryRuntime(async () => new Response(new Blob(["bytes"])));
  const file = await load({ signed_url: "https://example.invalid/file", mime_type: "image/png" }, "Unavailable");
  assert.equal(file.name, "inspiration.jpg");
  assert.equal(file.type, "image/png");
});

test("missing or failed signed URLs retain the localized error and never upload a fallback", async () => {
  let calls = 0;
  const load = libraryRuntime(async () => { calls++; return new Response(null, { status: 403 }); });
  await assert.rejects(load({}, "Média indisponible"), { message: "Média indisponible" });
  assert.equal(calls, 0);
  await assert.rejects(load({ signed_url: "https://example.invalid/expired" }, "Média indisponible"), { message: "Média indisponible" });
  assert.equal(calls, 1);
});

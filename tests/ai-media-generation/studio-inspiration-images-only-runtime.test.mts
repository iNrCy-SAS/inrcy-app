import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/studioInspirationImagePolicy.ts";
import { insertStudioReference } from "../../lib/mediaGenerationReferenceCollection.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");
const mp4Bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
const image = () => new File([imageBytes], "photo.png", { type: "image/png" });
const invalidFiles = () => [
  new File([mp4Bytes], "photo.jpg", { type: "video/mp4" }),
  new File([mp4Bytes], "clip.MOV", { type: "image/jpeg" }),
  new File([mp4Bytes], "photo.jpg", { type: "image/jpeg" }),
];

/** Extract the actual UI callbacks, keeping React state and browser services at the boundary. */
function callbacks(file: string, names: string[]) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer) found.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(source)};`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.size, names.length);
  return ts.transpileModule(names.map(name => found.get(name)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

const guidedCallbacks = callbacks("app/dashboard/_components/MediaGenerator.tsx", ["prepareReferenceFile", "prepareLibraryInspiration", "handleLibraryInspirationConfirm", "handleReferenceFiles"]);
const freeCallbacks = callbacks("app/dashboard/_components/MediaFreeGenerator.tsx", ["addFiles", "addLibraryFiles"]);

function uiHarness(mode: "guided" | "free", kind: "image" | "video") {
  const errors: string[] = [], calls: string[] = [];
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
  type Stage = "image" | "library";
  const gates: Partial<Record<Stage, ReturnType<typeof deferred>>> = {}, entered: typeof gates = {};
  const sequence = { current: 0 };
  let dialog: string | null = "images", libraryOpen = false;
  let references: Array<Record<string, unknown>> = [];
  const setReferences = (update: (current: typeof references) => typeof references) => { references = update(references); };
  const context: Record<string, unknown> = {
    ...policy, kind, Error, crypto: globalThis.crypto, MAX_INSPIRATION_IMAGES: 5, AI_MEDIA_INSPIRATION_MAX_COUNT: 5,
    inspirationImages: [], references: [], characterReferences: [], locked: false, transformMode: false, recoveryPending: false, pendingReferenceRole: "inspiration",
    sequence, operationInFlight: { current: false },
    t: (key: string) => key === "ai_generator_inspiration_images_only" ? "Images uniquement, les vidéos ne sont pas acceptées ici." : key,
    setActionError: (error: string) => { if (error) errors.push(error); },
    setInspirationBusy() {}, setReferencesBusy() {}, setRealCharacterCount() {}, resetReferenceConsent() {}, resetConsent() {}, setLibraryOpen(value: boolean) { libraryOpen = value; },
    setMediaSettingsDialog(value: string | null) { dialog = value; }, setSelectedReferenceId() {},
    setReferences, setInspirationImages: setReferences, insertStudioReference, createIdentityReferenceSetId: () => "new-reference",
    deleteCharacterVoiceSample: async () => { calls.push("delete-voice"); },
    prepareMediaGenerationImageReference: async (file: File) => {
      await policy.assertStudioInspirationImageFile(file);
      calls.push(`prepare-image:${file.name}`);
      entered.image?.resolve(); if (gates.image) await gates.image.promise;
      return { name: file.name, data: imageBytes.toString("base64"), mimeType: "image/png" };
    },
    prepareMediaGenerationLibraryReferenceFile: async (item: Record<string, unknown>, _message: string, options: { imagesOnly?: boolean }) => {
      assert.equal(options.imagesOnly, true);
      policy.assertStudioInspirationImageMetadata(item);
      calls.push("library-fetch");
      entered.library?.resolve(); if (gates.library) await gates.library.promise;
      return image();
    },
  };
  const code = mode === "guided" ? guidedCallbacks : freeCallbacks;
  return { errors, calls, references: () => references, dialog: () => dialog, libraryOpen: () => libraryOpen,
    setRole(role: string | null) { context.pendingReferenceRole = role; }, openLibrary() { libraryOpen = true; }, changeAccount() { sequence.current++; },
    defer(stage: Stage) { gates[stage] = deferred(); entered[stage] = deferred(); }, waitFor(stage: Stage) { assert.ok(entered[stage]); return entered[stage].promise; }, resume(stage: Stage) { gates[stage]?.resolve(); },
    run: (expression: string, input: unknown) => {
    context.input = input;
    return vm.runInNewContext(`(() => { ${code}\nreturn ${expression}; })()`, context) as Promise<void>;
  } };
}

test("free role imports and library selections retain the clicked role across asynchronous preparation and close only after success", async () => {
  for (const kind of ["image", "video"] as const) for (const route of ["image", "library"] as const) for (const role of ["inspiration", "character", "environment", "product"]) {
    const h = uiHarness("free", kind); h.setRole(role); h.defer(route);
    if (route === "library") h.openLibrary();
    const pending = h.run(route === "image" ? "addFiles([input])" : "addLibraryFiles(input)", route === "image" ? image() : [{ title: "photo.png", mime_type: "image/png" }]);
    await h.waitFor(route);
    assert.equal(h.references().length, 0); assert.equal(h.dialog(), "images", "preparation cannot prematurely close the chooser");
    h.setRole(role === "product" ? "character" : "product");
    h.resume(route); await pending;
    assert.equal(h.references().length, 1);
    assert.equal(h.references()[0].role, role, `${kind}/${route}: the in-flight selection cannot inherit a later role`);
    assert.equal(h.references()[0].usage, role === "inspiration" ? "inspiration" : "required");
    assert.equal(h.dialog(), null, "only a successful addition closes the chooser");
    assert.equal(h.libraryOpen(), false);
  }
});

test("free reference preparation refuses late account writes and keeps an invalid selection open with its error", async () => {
  for (const route of ["image", "library"] as const) {
    const h = uiHarness("free", "video"); h.setRole("character"); h.defer(route);
    const pending = h.run(route === "image" ? "addFiles([input])" : "addLibraryFiles(input)", route === "image" ? image() : [{ title: "photo.png", mime_type: "image/png" }]);
    await h.waitFor(route); h.changeAccount(); h.resume(route); await pending;
    assert.equal(h.references().length, 0, `${route}: the old account cannot receive a late reference`);
  }
  const invalid = uiHarness("free", "video"); invalid.setRole("environment");
  await invalid.run("addFiles([input])", invalidFiles()[0]);
  assert.equal(invalid.dialog(), "images"); assert.equal(invalid.references().length, 0);
  assert.deepEqual(invalid.calls, []); assert.match(invalid.errors[0], /Images uniquement/);
});

async function assertFileCallback(mode: "guided" | "free", kind: "image" | "video") {
  const h = uiHarness(mode, kind);
  for (const file of invalidFiles()) await h.run(mode === "guided" ? "prepareReferenceFile(input, 'inspiration')" : "addFiles([input])", file);
  assert.equal(h.errors.length, 3);
  assert.ok(h.errors.every(error => error.includes("Images uniquement")));
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.references(), []);
  await h.run(mode === "guided" ? "prepareReferenceFile(input, 'inspiration')" : "addFiles([input])", image());
  assert.deepEqual(h.calls, ["prepare-image:photo.png"]);
  assert.equal(h.references().length, 1);
}

test("guided image: real file callback rejects video MIME, extension and hidden container, then accepts an image", () => assertFileCallback("guided", "image"));
test("guided video: real file callback rejects video MIME, extension and hidden container, then accepts an image", () => assertFileCallback("guided", "video"));
test("free image: real file callback rejects video MIME, extension and hidden container, then accepts an image", () => assertFileCallback("free", "image"));
test("free video: real file callback rejects video MIME, extension and hidden container, then accepts an image", () => assertFileCallback("free", "video"));

for (const mode of ["guided", "free"] as const) for (const kind of ["image", "video"] as const) {
  test(`${mode} ${kind}: actual library callback rejects the complete selection before fetching any video`, async () => {
    const h = uiHarness(mode, kind);
    const input = [{ title: "photo.png", mime_type: "image/png" }, { title: "hidden.jpg", mime_type: "image/jpeg", media_type: "video" }];
    const expression = mode === "guided" ? "handleLibraryInspirationConfirm(input)" : "addLibraryFiles(input)";
    await h.run(expression, input);
    assert.deepEqual(h.calls, []);
    assert.equal(h.errors.length, 1);
    assert.equal(h.references().length, 0);
    await h.run(expression, [input[0]]);
    assert.deepEqual(h.calls, ["library-fetch", "prepare-image:photo.png"]);
    assert.equal(h.references().length, 1);
  });
}

test("guided drop callback rejects a mixed image/video batch before reading the first file", async () => {
  const h = uiHarness("guided", "video");
  await h.run("handleReferenceFiles(input)", [image(), invalidFiles()[1]]);
  assert.deepEqual(h.calls, []);
  assert.equal(h.errors.length, 1);
});

test("shared image preparation rejects disguised videos before decoding, upload or server fallback", async () => {
  let uploads = 0;
  const client = runtimeModules({ "@/lib/universalMediaUploadClient": { uploadUniversalMediaFile: () => { uploads++; assert.fail("invalid inspiration must not upload"); } } })<typeof import("../../lib/mediaGenerationReferenceClient.ts")>("lib/mediaGenerationReferenceClient.ts");
  for (const file of invalidFiles()) await assert.rejects(client.prepareMediaGenerationImageReference(file), { name: "StudioInspirationImageOnlyError" });
  assert.equal(uploads, 0);
});

test("video signature checks preserve JPEG PNG WebP and the HEIC/AVIF image conversion path", async () => {
  for (const brand of ["avif", "avis", "heic", "heix", "mif1", "msf1"]) {
    const file = new File([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`), Buffer.alloc(64)])], `image.${brand}`, { type: `image/${brand}` });
    await policy.assertStudioInspirationImageFile(file);
  }
  for (const file of [image(), new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], "image.jpg", { type: "image/jpeg" }), new File(["RIFFxxxxWEBP"], "image.webp", { type: "image/webp" })]) await policy.assertStudioInspirationImageFile(file);
  for (const bytes of [mp4Bytes, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("RIFFxxxxAVI "), Buffer.from([0, 0, 1, 0xba])]) {
    assert.equal(policy.studioInspirationBytesAreVideo(bytes), true);
    assert.equal(policy.studioInspirationBase64IsVideo(bytes.toString("base64")), true);
  }
});

test("image-only library loading rejects metadata before fetch, response MIME before body, and hidden video bytes before preparation", async () => {
  let fetches = 0, bodies = 0;
  const savedFetch = globalThis.fetch;
  const client = runtimeModules({ "@/lib/universalMediaUploadClient": { uploadUniversalMediaFile: () => assert.fail("no upload") } })<typeof import("../../lib/mediaGenerationReferenceClient.ts")>("lib/mediaGenerationReferenceClient.ts");
  const load = (item: Record<string, unknown>) => client.prepareMediaGenerationLibraryReferenceFile(item, "Unavailable", { imagesOnly: true });
  try {
    globalThis.fetch = async () => { fetches++; return { ok: true, headers: new Headers({ "content-type": "video/mp4" }), blob: async () => { bodies++; return new Blob([mp4Bytes]); } } as Response; };
    await assert.rejects(load({ signed_url: "https://example.invalid/file", title: "hidden.jpg", media_type: "video" }), { name: "StudioInspirationImageOnlyError" });
    assert.equal(fetches, 0);
    await assert.rejects(load({ signed_url: "https://example.invalid/file", title: "hidden.jpg", mime_type: "image/jpeg" }), { name: "StudioInspirationImageOnlyError" });
    assert.equal(fetches, 1); assert.equal(bodies, 0);
    globalThis.fetch = async () => new Response(new Blob([mp4Bytes], { type: "image/jpeg" }));
    await assert.rejects(load({ signed_url: "https://example.invalid/file", title: "hidden.jpg", mime_type: "image/jpeg" }), { name: "StudioInspirationImageOnlyError" });
    globalThis.fetch = async () => new Response(new Blob([imageBytes], { type: "image/png" }));
    const valid = await load({ signed_url: "https://example.invalid/file", title: "photo.png", mime_type: "image/png" });
    assert.deepEqual(Buffer.from(await valid.arrayBuffer()), imageBytes);
  } finally { globalThis.fetch = savedFetch; }
});

test("normalization API rejects video names before download and hidden video bytes before conversion", async () => {
  const events: string[] = [];
  const route = runtimeModules({
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: "account-a", errorResponse: null }) },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: () => ({ download: async () => { events.push("download"); return { data: new Blob([mp4Bytes]), error: null }; }, remove: async () => { events.push("cleanup"); return { error: null }; } }) } } },
    "@/lib/mediaImageNormalizer": { normalizeImageAiPreviewBuffer: () => assert.fail("video must not reach conversion"), normalizeImageEditMasterBuffer: () => assert.fail("video must not reach editing master") },
  })<{ POST: (request: Request) => Promise<Response> }>("app/api/media-generation/normalize-reference/route.ts");
  const post = (fileName: string) => route.POST(new Request("https://inrcy.test/api/media-generation/normalize-reference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storagePath: "users/account-a/studio-identity-reference/image/source.jpg", fileName, mimeType: "image/jpeg" }) }));
  assert.equal((await post("clip.mp4")).status, 415);
  assert.equal(events.includes("download"), false);
  const result = await post("image.jpg");
  assert.equal(result.status, 415);
  assert.equal((await result.json()).code, "identity_reference_images_only");
  assert.equal(events.filter(event => event === "download").length, 1);
});

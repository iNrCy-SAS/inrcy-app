import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as memoryClient from "../../lib/studioReferenceMemoryClient.ts";
import type { StudioReferenceDraft } from "../../lib/studioReferenceMemoryClient.ts";
import type { StudioReferenceMemory, StudioReferencesResponse } from "../../lib/studioReferences.ts";
import { StudioInspirationImageOnlyError } from "../../lib/studioInspirationImagePolicy.ts";
import { isAiMediaCharacterVoiceEngine } from "../../lib/aiMediaCharacterVoices.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const source = read("app/dashboard/_components/MediaFreeGenerator.tsx");
const parsed = ts.createSourceFile("MediaFreeGenerator.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const id = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`;
function expression(find: (node: ts.Node) => ts.Expression | undefined) {
  let result: ts.Expression | undefined;
  const visit = (node: ts.Node) => { result ||= find(node); ts.forEachChild(node, visit); }; visit(parsed);
  assert.ok(result, "actual component expression exists"); return result;
}
function initializer(name: string) { return expression(node => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name ? node.initializer : undefined); }
function evaluate<T>(node: ts.Node, context: Record<string, unknown>): T {
  const output = ts.transpileModule(`const evaluated = ${node.getText(parsed)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(context), `${output}; return evaluated;`)(...Object.values(context)) as T;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const emptyReferenceMemory = (scopeKey: string) => ({ scopeKey, loaded: false, saved: false, busy: false, revision: 0,
  lastAction: null as "remember" | "forget" | null, fingerprint: "", error: "" as "" | "load" | "save" | "forget" });
const emptySavedMemory = (): StudioReferenceMemory => ({ version: 1, references: [], voices: [], activeNarrationVoiceId: null });
function draft(): StudioReferenceDraft { return { references: [{ id: id(1), libraryMediaId: id(11), name: "photo.jpg", mimeType: "image/jpeg", data: "aW1hZ2U=",
  role: "character", usage: "required", characterName: "David", voiceMode: "provided", fromVideo: false }], voices: [{ id: id(2),
  sample: { path: "_studio-voice-references/account-a__voice.wav", name: "vocal.wav", mimeType: "audio/wav", durationSeconds: 6, sizeBytes: 192_044, libraryMediaId: id(12) },
  target: { characterId: id(1) }, gender: "male" }], activeNarrationVoiceId: null }; }
function context(initial = draft()) {
  const state = { ...emptyReferenceMemory("account-a"), loaded: true };
  const current = { accountId: "account-a", draft: initial }; const requests: string[] = [], deleted: string[] = [];
  const consents = { identity: true, team: true, narration: true };
  const choices = { speechMode: "voiceover", voiceMode: "ai", referenceId: null as string | null };
  const value: Record<string, unknown> = { ...memoryClient, quota: { accountId: "account-a" }, kind: "video", instanceId: "test-memory", locked: false,
    voiceSelectionRevision: { current: 0 }, setSpeechMode(mode: string) { choices.speechMode = mode; },
    setVoiceSourcePreference(mode: string) { choices.voiceMode = mode; }, setVoiceReferenceId(referenceId: string) { choices.referenceId = referenceId; },
    operationInFlight: { current: false }, referenceMemoryController: { current: null }, sequence: { current: 1 },
    restoredWorkingPanel: { current: false },
    referenceMemoryCurrent: { current }, referenceMemoryLoadedAccount: { current: null }, referenceMemoryAction: { current: null }, referenceSetId: { current: "" },
    referenceMemory: state, referenceMemoryAvailable: true, hasMemoryReferences: Boolean(initial.references.length || initial.voices.length), referenceMemoryDirty: false,
    emptyReferenceMemory,
    setReferenceMemoryState(update: typeof state | ((current: typeof state) => typeof state)) { Object.assign(state, typeof update === "function" ? update(state) : update); },
    setReferences(update: StudioReferenceDraft["references"] | ((current: StudioReferenceDraft["references"]) => StudioReferenceDraft["references"])) { current.draft.references = typeof update === "function" ? update(current.draft.references) : update; },
    setVoiceProfiles(profiles: StudioReferenceDraft["voices"]) { current.draft.voices = profiles; },
    setActiveNarrationVoiceId(activeId: string | null) { current.draft.activeNarrationVoiceId = activeId; },
    setIdentityConsent(checked: boolean) { consents.identity = checked; }, setTeamConsent(checked: boolean) { consents.team = checked; },
    setNarrationVoiceConsent(checked: boolean) { consents.narration = checked; },
    prepareMediaGenerationImageReference: async () => { assert.fail("no unexpected conversion"); },
    deleteCharacterVoiceSample: async (sample: { path: string }) => { deleted.push(sample.path); },
    uploadFileToMediaLibrary: async () => { assert.fail("existing library images must not upload again"); },
    requestStudioReferenceMemory: async (method: string, scope: { accountId: string }, memory: StudioReferenceMemory | undefined): Promise<StudioReferencesResponse> => {
      requests.push(method); return { ok: true, accountId: scope.accountId, memory: memory ?? null, media: [], unavailableMediaIds: [] };
    },
  };
  return { value, state, current, requests, deleted, consents, choices,
    remember: (canApply?: () => boolean) => evaluate<(canApply?: () => boolean) => Promise<boolean>>(initializer("handleRememberReferences"), value)(canApply),
    forget: (canApply?: () => boolean) => evaluate<(canApply?: () => boolean) => Promise<boolean>>(initializer("handleForgetReferences"), value)(canApply) };
}

test("actual remember callback saves current photo/voice bindings without uploading, generating, publishing or authorising them", async () => {
  const harness = context(); const before = structuredClone(harness.current.draft);
  assert.equal(await harness.remember(), true); assert.deepEqual(harness.requests, ["PUT"]);
  assert.equal(harness.state.saved, true); assert.equal(harness.state.revision, 1); assert.equal(harness.state.lastAction, "remember");
  assert.equal(harness.state.busy, false); assert.equal((harness.value.operationInFlight as { current: boolean }).current, false);
  assert.deepEqual(harness.current.draft, before); assert.deepEqual(harness.consents, { identity: true, team: true, narration: true });
});

test("actual forget callback removes only the remembered default and leaves current assets and library voices intact", async () => {
  const harness = context(); harness.state.saved = true; const before = structuredClone(harness.current.draft);
  assert.equal(await harness.forget(), true); assert.deepEqual(harness.requests, ["DELETE"]);
  assert.equal(harness.state.saved, false); assert.equal(harness.state.lastAction, "forget");
  assert.deepEqual(harness.current.draft, before); assert.deepEqual(harness.deleted, []);
});

test("actual memory callbacks reject unavailable, locked, unchanged, empty or cancelled selections without writes", async () => {
  for (const field of ["locked", "referenceMemoryAvailable", "hasMemoryReferences", "loaded", "unchanged", "cancelled"]) {
    const harness = context();
    if (field === "loaded") harness.state.loaded = false;
    else if (field === "unchanged") harness.state.saved = true;
    else if (field !== "cancelled") harness.value[field] = field === "locked";
    assert.equal(await harness.remember(() => field !== "cancelled"), false, field); assert.deepEqual(harness.requests, []);
  }
});

test("cancelling an assistant action during a pending save always releases this mount's busy lock", async () => {
  for (const action of ["remember", "forget"] as const) {
    const harness = context(); if (action === "forget") harness.state.saved = true;
    let canApply = true; const waiting = deferred<StudioReferencesResponse>();
    harness.value.requestStudioReferenceMemory = async () => waiting.promise;
    const operation = harness[action](() => canApply); await flush(); assert.equal(harness.state.busy, true);
    canApply = false; waiting.resolve({ ok: true, accountId: "account-a", memory: null, media: [], unavailableMediaIds: [] });
    assert.equal(await operation, false); assert.equal(harness.state.busy, false);
    assert.equal((harness.value.operationInFlight as { current: boolean }).current, false); assert.equal(harness.state.revision, 0);
  }
});

test("a refused persistence write keeps the creative draft usable and never reports it as remembered", async () => {
  const harness = context(); const before = structuredClone(harness.current.draft);
  harness.value.requestStudioReferenceMemory = async () => { throw new Error("offline"); };
  assert.equal(await harness.remember(), false); assert.equal(harness.state.saved, false); assert.equal(harness.state.error, "save");
  assert.equal(harness.state.busy, false); assert.equal((harness.value.operationInFlight as { current: boolean }).current, false);
  assert.deepEqual(harness.current.draft, before);
});

test("the real library insertion forwards the original image identities to the actual file insertion callback", async () => {
  const captured: unknown[][] = []; const files = [new File(["one"], "one.jpg", { type: "image/jpeg" }), new File(["two"], "two.jpg", { type: "image/jpeg" })];
  let at = 0;
  const run = evaluate<(items: Array<{ id: string; media_type: string; mime_type: string; original_file_name: string }>) => Promise<void>>(initializer("addLibraryFiles"), {
    locked: false, operationInFlight: { current: false }, recoveryPending: false, pendingReferenceRole: "character", references: [], sequence: { current: 1 },
    AI_MEDIA_INSPIRATION_MAX_COUNT: 5, setReferencesBusy() {}, setActionError() {}, setLibraryOpen() {}, t: (key: string) => key, StudioInspirationImageOnlyError,
    assertStudioInspirationImageMetadata() {}, prepareMediaGenerationLibraryReferenceFile: async () => files[at++],
    addFiles: async (...args: unknown[]) => { captured.push(args); return true; },
  });
  await run([id(11), id(12)].map((mediaId, index) => ({ id: mediaId, media_type: "image", mime_type: "image/jpeg", original_file_name: files[index].name })));
  assert.equal(captured.length, 1); assert.deepEqual(captured[0], [files, true, "character", [id(11), id(12)]]);
});

test("private memory identifiers never enter a provider generation request", () => {
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "referencesForRequest"); assert.ok(declaration);
  const run = evaluate<(references: StudioReferenceDraft["references"]) => Array<Record<string, unknown>>>(declaration, {});
  const payload = run(draft().references);
  assert.equal(payload[0].role, "character"); assert.equal(payload[0].characterName, "David");
  assert.equal(payload[0].libraryMediaId, undefined); assert.equal(payload[0].id, undefined); assert.equal(payload[0].fromVideo, undefined);
});

test("a late save from another account cannot release a newer operation or confirm old data", async () => {
  const harness = context(); const waiting = deferred<StudioReferencesResponse>(); harness.value.requestStudioReferenceMemory = async () => waiting.promise;
  const old = harness.remember(); await flush(); harness.current.accountId = "account-b";
  const nextController = new AbortController(); (harness.value.referenceMemoryController as { current: AbortController }).current = nextController;
  waiting.resolve({ ok: true, accountId: "account-a", memory: null, media: [], unavailableMediaIds: [] });
  assert.equal(await old, false); assert.equal(harness.state.revision, 0);
  assert.equal((harness.value.referenceMemoryController as { current: AbortController }).current, nextController);
  assert.equal((harness.value.operationInFlight as { current: boolean }).current, true, "the old action never unlocks a newer one");
});

const loadEffect = expression(node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect" &&
  node.arguments[0]?.getText(parsed).includes("hydrateStudioReferenceMemory(response") ? node.arguments[0] : undefined);

test("a late memory read preserves photos already inserted by the professional", async () => {
  const harness = context({ references: [], voices: [], activeNarrationVoiceId: null }); const waiting = deferred<StudioReferencesResponse>();
  harness.value.requestStudioReferenceMemory = async () => waiting.promise;
  harness.value.hydrateStudioReferenceMemory = async () => { assert.fail("existing photos must prevent hydration"); };
  const cleanup = evaluate<() => () => void>(loadEffect, harness.value)();
  harness.current.draft.references.push(draft().references[0]);
  waiting.resolve({ ok: true, accountId: "account-a", memory: emptySavedMemory(), media: [], unavailableMediaIds: [] });
  await flush(); assert.equal(harness.current.draft.references.length, 1); assert.equal(harness.state.loaded, true); assert.equal(harness.state.saved, true); cleanup();
});

test("a fresh Studio restores photos and voices once while all generation authorisations stay unchecked", async () => {
  const harness = context({ references: [], voices: [], activeNarrationVoiceId: null }); const restored = draft();
  harness.value.requestStudioReferenceMemory = async () => ({ ok: true, accountId: "account-a", memory: emptySavedMemory(), media: [], unavailableMediaIds: [] });
  let restores = 0; harness.value.hydrateStudioReferenceMemory = async () => { restores++; return restored; };
  const effect = evaluate<() => (() => void) | undefined>(loadEffect, harness.value); const cleanup = effect(); await flush();
  assert.deepEqual(harness.current.draft, restored); assert.equal(harness.state.saved, true); assert.equal(harness.state.loaded, true); assert.equal(harness.state.error, "");
  assert.deepEqual(harness.consents, { identity: false, team: false, narration: false });
  assert.deepEqual(harness.choices, { speechMode: "characters", voiceMode: "provided", referenceId: id(1) });
  const selectedVideoEngine = evaluate<string>(initializer("selectedVideoEngine"), { enginePreference: { videoEngine: "omni" } });
  assert.equal(selectedVideoEngine, "omni", "the effective provider remains the selected provider rather than a supplied-voice fallback");
  const unsupported = evaluate<boolean>(initializer("characterVoiceEngineUnsupported"), { selectedVideoEngine, characterVoiceSelection: { hasProvidedVoice: true }, isAiMediaCharacterVoiceEngine });
  assert.equal(unsupported, true);
  assert.equal(evaluate<boolean>(initializer("referenceCompatible"), { kind: "video", characterVoiceEngineUnsupported: unsupported,
    isMediaVideoReferenceCompatible: () => assert.fail("an incompatible real-voice engine is rejected before quoting or generating") }), false);
  effect(); await flush(); assert.equal(restores, 1); assert.equal(harness.state.busy, false); cleanup?.();
});

test("remembered photos and voices do not replace an intentionally empty restored working draft", async () => {
  const harness = context({ references: [], voices: [], activeNarrationVoiceId: null });
  harness.value.restoredWorkingPanel = { current: true };
  harness.value.requestStudioReferenceMemory = async () => ({
    ok: true, accountId: "account-a", memory: emptySavedMemory(), media: [], unavailableMediaIds: [],
  });
  let restores = 0;
  harness.value.hydrateStudioReferenceMemory = async () => { restores++; return draft(); };
  const cleanup = evaluate<() => () => void>(loadEffect, harness.value)();
  try {
    await flush();
    assert.equal(restores, 0);
    assert.deepEqual(harness.current.draft, { references: [], voices: [], activeNarrationVoiceId: null });
    assert.equal(harness.state.loaded, true);
    assert.equal(harness.state.saved, true);
    assert.equal(harness.state.error, "");
  } finally {
    cleanup();
  }
});

test("restored dedicated voices never replace a speech choice made while the initial memory request was pending", async () => {
  for (const mode of ["voiceover", "silent"]) {
    const harness = context({ references: [], voices: [], activeNarrationVoiceId: null }); const waiting = deferred<StudioReferencesResponse>();
    harness.value.requestStudioReferenceMemory = async () => waiting.promise; harness.value.hydrateStudioReferenceMemory = async () => draft();
    const cleanup = evaluate<() => () => void>(loadEffect, harness.value)();
    (harness.value.voiceSelectionRevision as { current: number }).current += 1; harness.choices.speechMode = mode;
    waiting.resolve({ ok: true, accountId: "account-a", memory: emptySavedMemory(), media: [], unavailableMediaIds: [] });
    await flush(); assert.equal(harness.choices.speechMode, mode); assert.equal(harness.choices.voiceMode, "ai");
    assert.equal(harness.current.draft.voices.length, 1, "the stored assets still restore without overriding the explicit speech setting"); cleanup();
  }
});

test("a pending hydration that becomes stale never replaces the new account's draft and releases only its temporary samples", async () => {
  const harness = context({ references: [], voices: [], activeNarrationVoiceId: null }); const waiting = deferred<StudioReferenceDraft>();
  harness.value.requestStudioReferenceMemory = async () => ({ ok: true, accountId: "account-a", memory: emptySavedMemory(), media: [], unavailableMediaIds: [] });
  harness.value.hydrateStudioReferenceMemory = async () => waiting.promise;
  const cleanup = evaluate<() => () => void>(loadEffect, harness.value)(); await flush();
  harness.current.accountId = "account-b"; waiting.resolve(draft()); await flush();
  assert.equal(harness.current.draft.references.length, 0); assert.deepEqual(harness.deleted, [draft().voices[0].sample.path]); cleanup();
});

test("actual native remember/forget bindings acknowledge only the committed revision in the same professional", async () => {
  const harness = context();
  type Entry = { snapshot: Record<string, unknown>; handlers: { select: { invoke(value: string | null, current: () => boolean): Promise<unknown>; matches(snapshot: unknown, value: string | null): boolean } } };
  let entry!: Entry;
  harness.value.handleRememberReferences = harness.remember; harness.value.handleForgetReferences = harness.forget;
  harness.value.useInrAssistantLocalInterface = (_id: string, snapshot: Entry["snapshot"], handlers: Entry["handlers"]) => { entry = { snapshot, handlers }; };
  const binding = expression(node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useInrAssistantLocalInterface" &&
    ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "studio_reference_memory" ? node : undefined);
  evaluate(binding, harness.value); const handlers = entry.handlers;
  assert.equal(handlers.select.matches(entry.snapshot, "remember"), false);
  await handlers.select.invoke("remember", () => true);
  evaluate(binding, harness.value); assert.equal(handlers.select.matches(entry.snapshot, "remember"), true);
  assert.equal(handlers.select.matches({ ...entry.snapshot, scopeKey: "account-b" }, "remember"), false);
  assert.equal(handlers.select.matches({ ...entry.snapshot, revision: 3 }, "remember"), false);
  assert.equal(handlers.select.matches({ ...entry.snapshot, dirty: true }, "remember"), false);
  await entry.handlers.select.invoke("forget", () => true); evaluate(binding, harness.value);
  assert.equal(entry.handlers.select.matches(entry.snapshot, "forget"), true);
  await assert.rejects(entry.handlers.select.invoke("invented", () => true));
});

test("the signed library upload carries the original professional and aborts before finalize after cancellation", async () => {
  const record = { exports: {} as { uploadFileToMediaLibrary: (file: File, options: { accountId: string; signal: AbortSignal }) => Promise<unknown> } };
  const output = ts.transpileModule(read("lib/mediaLibraryUploadClient.ts"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let cancelStorage = false; let controller = new AbortController(); const requests: RequestInit[] = [];
  const fetch = async (_url: string, init: RequestInit) => { requests.push(init); return Response.json(requests.length % 2 === 1 ? { items: [{ token: "private-signed", bucket: "private", storage_path: "users/account-a/photo.jpg", content_type: "image/jpeg" }] } : { results: [{ ok: true, mediaId: id(11) }] }); };
  new Function("module", "exports", "require", "fetch", output)(record, record.exports, (name: string) => {
    assert.equal(name, "@/lib/supabaseClient"); return { createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: async () => { if (cancelStorage) controller.abort(); return { error: null }; } }) } }) };
  }, fetch);
  const file = new File(["synthetic"], "photo.jpg", { type: "image/jpeg" });
  await record.exports.uploadFileToMediaLibrary(file, { accountId: "account-a", signal: controller.signal });
  assert.equal(requests.length, 2); for (const request of requests) { assert.equal((request.headers as Record<string, string>)["X-Inrcy-Account-Id"], "account-a"); assert.equal(request.signal, controller.signal); }
  requests.length = 0; cancelStorage = true; controller = new AbortController();
  await assert.rejects(record.exports.uploadFileToMediaLibrary(file, { accountId: "account-a", signal: controller.signal }));
  assert.equal(requests.length, 1, "an aborted signed upload cannot finalise into the new active professional");
});

test("two real mounted metadata listeners synchronise remember/forget and resume without replacing either creative draft", async () => {
  const previous = Reflect.get(globalThis, "window"); const browser = new EventTarget(); Reflect.set(globalThis, "window", browser);
  const image = context(), video = context(); image.current.draft.references[0].characterName = "Marie";
  for (const [harness, instanceId] of [[image, "image-panel"], [video, "video-panel"]] as const) {
    harness.current.accountId = "sync-account"; harness.state.scopeKey = "sync-account";
    harness.value.quota = { accountId: "sync-account" }; harness.value.instanceId = instanceId; harness.value.window = browser;
  }
  const metadataEffect = expression(node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect" &&
    node.arguments[0]?.getText(parsed).includes("const synchronize =") && node.arguments[0]?.getText(parsed).includes("STUDIO_REFERENCE_MEMORY_EVENT") ? node.arguments[0] : undefined);
  const mountImage = () => evaluate<() => () => void>(metadataEffect, image.value)();
  let stopImage = mountImage(); const stopVideo = evaluate<() => () => void>(metadataEffect, video.value)();
  const imageDraft = structuredClone(image.current.draft), videoDraft = structuredClone(video.current.draft);
  try {
    assert.equal(await video.remember(), true); assert.equal(image.state.saved, true);
    assert.notEqual(image.state.fingerprint, memoryClient.studioReferenceDraftFingerprint(image.current.draft), "the other draft becomes dirty, never overwritten");
    assert.deepEqual(image.current.draft, imageDraft); assert.deepEqual(video.current.draft, videoDraft);
    assert.equal(await video.forget(), true); assert.equal(image.state.saved, false);
    assert.deepEqual(image.current.draft, imageDraft); assert.deepEqual(image.deleted, []);
    memoryClient.publishStudioReferenceMemoryMetadata("another-professional", null, "another-panel"); assert.equal(image.state.saved, false);
    stopImage(); assert.equal(await video.remember(), true); assert.equal(image.state.saved, false, "a hidden Activity has suspended its listener");
    stopImage = mountImage(); assert.equal(image.state.saved, true, "resuming reads only the current account's latest metadata");
    assert.deepEqual(image.current.draft, imageDraft);
  } finally { stopImage(); stopVideo(); if (previous === undefined) Reflect.deleteProperty(globalThis, "window"); else Reflect.set(globalThis, "window", previous); }
});

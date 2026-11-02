import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const filename = "app/dashboard/_components/MediaVideoRetoucher.tsx";
const source = readFileSync(filename, "utf8"), ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer: ts.Expression | undefined;
const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "save") initializer = node.initializer; ts.forEachChild(node, visit); };
visit(ast); assert.ok(initializer);
const code = ts.transpileModule(`const handler = ${initializer.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness(onSaved?: (value: unknown, options: { isCurrent: () => boolean }) => unknown) {
  const source = { name: "A.mp4" }, state = { source, format: "9_16", adaptationMode: "cover_crop", channel: "site_web", mounted: true };
  const calls: unknown[][] = [], saveState = { current: state }, saveLock = { current: false };
  const variables = { source, format: state.format, adaptationMode: state.adaptationMode, channel: state.channel, saving: false,
    saveState, saveLock, savedCopy: { current: null }, onSaved, initialContext: null, sourceVariants: [], sourceMatchesInitial: false, acceptMode: "library",
    setSaving: (value: boolean) => calls.push(["busy", value]), setSaved: (value: boolean) => calls.push(["saved", value]), setError: (value: string) => calls.push(["error", value]) };
  const run = new Function(...Object.keys(variables), `${code}\nreturn handler;`)(...Object.values(variables)) as (options?: { isCurrent?: () => boolean }) => Promise<boolean>;
  return { run, calls, saveState, saveLock };
}

test("actual native save requires a persisted media ID before marking a standalone retouch saved", async () => {
  for (const receipt of [undefined, { mediaId: "output-owned-id" }]) {
    const fixture = harness(async () => receipt);
    assert.equal(await fixture.run(), Boolean(receipt));
    assert.equal(fixture.calls.some(call => call[0] === "saved"), Boolean(receipt));
    assert.deepEqual(fixture.calls.filter(call => call[0] === "busy"), [["busy", true], ["busy", false]]);
    assert.equal(fixture.saveLock.current, false);
  }
});

test("actual native save rejects duplicate concurrent execution and a changed source after await", async () => {
  let resolve!: (value: { mediaId: string }) => void;
  const fixture = harness(() => new Promise(done => { resolve = done; }));
  const first = fixture.run();
  assert.equal(await fixture.run(), false);
  fixture.saveState.current = { ...fixture.saveState.current, source: { name: "B.mp4" } };
  resolve({ mediaId: "saved-A" });
  assert.equal(await first, false);
  assert.equal(fixture.calls.some(call => call[0] === "saved"), false);
  assert.equal(fixture.saveLock.current, false);
});

test("actual native save does not apply late success after scope invalidation or unmount", async () => {
  for (const unmount of [false, true]) {
    let resolve!: (value: { mediaId: string }) => void, active = true;
    const fixture = harness(() => new Promise(done => { resolve = done; }));
    const pending = fixture.run({ isCurrent: () => active });
    if (unmount) fixture.saveState.current.mounted = false; else active = false;
    resolve({ mediaId: "saved-A" });
    assert.equal(await pending, false);
    assert.equal(fixture.calls.some(call => call[0] === "saved"), false);
    assert.equal(fixture.saveLock.current, false);
    if (unmount) assert.deepEqual(fixture.calls.filter(call => call[0] === "busy"), [["busy", true]]);
  }
});

test("actual native failure clears its operation lock and retains the unsaved form", async () => {
  const fixture = harness(async () => { throw new Error("native save failed"); });
  assert.equal(await fixture.run(), false);
  assert.deepEqual(fixture.calls, [["busy", true], ["error", ""], ["error", "native save failed"], ["busy", false]]);
  assert.equal(fixture.saveLock.current, false);
});

test("an unchanged successful retouch reuses its verified copy instead of uploading again", async () => {
  let nativeCalls = 0;
  const fixture = harness(async () => { nativeCalls++; return { mediaId: "owned-copy" }; });
  assert.equal(await fixture.run(), true);
  assert.equal(await fixture.run(), true);
  assert.equal(nativeCalls, 1);
  assert.deepEqual(fixture.calls.filter(call => call[0] === "saved"), [["saved", true]]);
});

test("the actual standalone Studio saver always prepares the variant even if a stale handoff requested deferred publication", async () => {
  const file = "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx", text = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "saveRetouchedVideo") initializer = node.initializer; ts.forEachChild(node, visit); };
  visit(tree); assert.ok(initializer);
  let transformed = 0, persisted = 0;
  const ports = {
    useCallback: (callback: unknown) => callback, handoff: null, scopeRef: { current: { mounted: true } },
    router: { replace() { throw new Error("keepOpen must not navigate"); } }, deliverReturnedMedia() { throw new Error("standalone must persist"); },
    uploadFileToMediaLibrary() { throw new Error("existing source must not reupload"); },
    requestBoosterVideoTransforms: async () => { transformed++; return { ok: true, variants: [{ format: "9_16" }] }; },
    mergeVideoVariants: (_old: unknown, generated: unknown) => generated,
    persistStudioVideoRetouch: async (value: { variants: unknown[] }) => { persisted++; assert.deepEqual(value.variants, [{ format: "9_16" }]); return { id: "new-copy" }; },
    fetch() { throw new Error("helper owns network"); },
  };
  const code = ts.transpileModule(`const handler = ${initializer.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const run = new Function(...Object.keys(ports), `${code}\nreturn handler;`)(...Object.values(ports));
  const result = await run({ source: { file: null, storagePath: "owned/source.mp4", url: "/api/media-library/content?id=A", name: "A.mp4", libraryItem: { id: "A" } }, format: "9_16", adaptationMode: "cover_crop", channel: "site_web", transformedVariants: [], deferTechnicalPreparationUntilPublish: true }, { keepOpen: true, isCurrent: () => true });
  assert.deepEqual(result, { mediaId: "new-copy" });
  assert.equal(transformed, 1); assert.equal(persisted, 1);
});

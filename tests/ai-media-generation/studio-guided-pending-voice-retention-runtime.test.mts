import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { insertStudioReference, normalizeCharacterReferenceIndexes } from "../../lib/mediaGenerationReferenceCollection.ts";
import * as imagePolicy from "../../lib/studioInspirationImagePolicy.ts";

const file = "app/dashboard/_components/MediaGenerator.tsx";
const ast = ts.createSourceFile(file, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["releaseUnusedVoiceSample", "removeReferenceImage", "prepareReferenceFile", "removeReferenceAt", "setReferenceRole", "setCharacterVoiceMode", "setCharacterVoiceSample"] as const;
const declarations = new Map<string, ts.VariableDeclaration>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && [...names, "performGeneration"].includes(node.name.text as typeof names[number])) declarations.set(node.name.text, node);
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of [...names, "performGeneration"]) assert.ok(declarations.has(name), name);
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const callbacks = compile(names.map(name => `const ${name} = ${declarations.get(name)!.initializer!.getText(ast)};`).join("\n"));
const perform = declarations.get("performGeneration")!.initializer!;
let capture: ts.ForOfStatement | undefined, generationAwait: ts.AwaitExpression | undefined;
function findCapture(node: ts.Node) {
  if (ts.isForOfStatement(node) && node.statement.getText(ast).includes("submittedVoicePaths.current.add")) capture = node;
  if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "generate") generationAwait = node;
  ts.forEachChild(node, findCapture);
}
findCapture(perform);
assert.ok(capture); assert.ok(generationAwait);
const captureCode = compile(capture.getText(ast));
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");
const oldSample = { path: "fixture/voice/submitted.wav", name: "submitted.wav", durationSeconds: 8.4 };
const nextSample = { path: "fixture/voice/new-unused.wav", name: "new-unused.wav", durationSeconds: 7 };
const portrait = () => ({ name: "portrait.png", mimeType: "image/png", data: imageBytes.toString("base64"), role: "character", usage: "required", characterIndex: 1, voiceMode: "provided", voiceSample: oldSample });
type Row = Record<string, unknown>;
function harness(pending: boolean, retained: boolean) {
  const deleted: string[] = [], errors: string[] = [];
  const submittedVoicePaths = { current: new Set<string>() };
  const context: Record<string, unknown> = {
    ...imagePolicy, insertStudioReference, normalizeCharacterReferenceIndexes,
    mediaSourceMode: "real", inspirationImages: [portrait()], characterReferences: [portrait()], environmentReference: null, productReference: null,
    submittedVoicePaths, recoveryPending: pending, recovering: pending,
    t: (key: string) => key, createIdentityReferenceSetId: () => "replacement-reference",
    deleteCharacterVoiceSample: async (sample: { path: string }) => { deleted.push(sample.path); },
    setRealCharacterCount() {}, resetReferenceConsent() {}, setInspirationBusy() {}, setTeamVideoSpeechMode() {},
    setActionError: (error: string) => { if (error) errors.push(error); },
    prepareMediaGenerationImageReference: async (candidate: File) => ({ name: candidate.name, mimeType: candidate.type, data: imageBytes.toString("base64") }),
    fetch: () => assert.fail("No network call or provider operation is allowed"),
  };
  context.setInspirationImages = (update: Row[] | ((current: Row[]) => Row[])) => {
    context.inspirationImages = typeof update === "function" ? update(context.inspirationImages as Row[]) : update;
    context.characterReferences = (context.inspirationImages as Row[]).filter(row => row.role === "character");
  };
  const sandbox = vm.createContext(context);
  if (retained) vm.runInContext(captureCode, sandbox);
  const controls = vm.runInContext(`(() => { ${callbacks}\nreturn {${names.join(",")}}; })()`, sandbox) as Record<typeof names[number], (...args: unknown[]) => unknown>;
  return { controls, context, deleted, errors, submittedVoicePaths, references: () => context.inspirationImages as Row[] };
}
const edits: Array<[string, (h: ReturnType<typeof harness>) => unknown]> = [
  ["remove owned role", h => h.controls.removeReferenceImage("character", 1)],
  ["replace portrait", h => h.controls.prepareReferenceFile(new File([imageBytes], "replacement.png", { type: "image/png" }), "character", 1, "replace")],
  ["remove index", h => h.controls.removeReferenceAt(0)],
  ["change role", h => h.controls.setReferenceRole(0, "environment")],
  ["switch to AI voice", h => h.controls.setCharacterVoiceMode(0, "ai")],
  ["replace voice sample", h => h.controls.setCharacterVoiceSample(0, nextSample)],
];

test("actual Guided reference edits preserve submitted and pending voice samples while cleaning unused samples", async () => {
  for (const state of ["checking", "paused"] as const) for (const [label, edit] of edits) {
    const h = harness(true, false); h.context.recovering = state === "checking";
    const before = h.references(); await edit(h);
    assert.notEqual(h.references(), before, `${state}: ${label} remains editable`);
    assert.deepEqual(h.deleted, [], `${state}: ${label} cannot delete a pending voice`);
    assert.deepEqual(h.errors, []);
  }
  for (const [label, edit] of edits) {
    const h = harness(false, true); await edit(h);
    assert.deepEqual(h.deleted, [], `${label} cannot delete a previously submitted voice after pause/state changes`);
    assert.ok(h.submittedVoicePaths.current.has(oldSample.path));
    const unused = harness(false, false); await edit(unused);
    assert.deepEqual(unused.deleted, [oldSample.path], `${label} still cleans an unused unsubmitted voice outside recovery`);
    assert.deepEqual(unused.errors, []);
  }
});

test("Guided captures supplied voice paths before the actual generation await and retains them after role changes", () => {
  assert.ok(capture!.getEnd() < generationAwait!.getStart(ast), "The real retention loop runs before the real generate call can submit or become uncertain");
  const h = harness(true, true);
  assert.ok(h.submittedVoicePaths.current.has(oldSample.path));
  h.controls.setReferenceRole(0, "environment");
  assert.equal(h.references()[0].voiceSample, undefined, "The next form can remove the old voice locally");
  h.context.recoveryPending = false;
  h.controls.releaseUnusedVoiceSample(oldSample);
  assert.deepEqual(h.deleted, [], "The captured submitted path survives later cleanup after leaving recovery");
  h.controls.releaseUnusedVoiceSample(nextSample);
  assert.deepEqual(h.deleted, [nextSample.path], "A genuinely new unused sample remains eligible for normal cleanup");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseInrAssistantStudioModifierSelection } from "../../lib/inrAssistantStudioModifierSelection.ts";

const MEDIA = "40000000-0000-4000-8000-000000000004", encode = (field: string, value: string) => JSON.stringify({ field, value });
const source = readFileSync(new URL("../../app/dashboard/_components/MediaModifier.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("MediaModifier.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name: string) { let found: ts.Expression | undefined; const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) found = name === "selectSourceFile" && ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer; if (name === "handlers" && ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface") found = node.arguments[2]; ts.forEachChild(node, visit); }; visit(ast); assert.ok(found); return found; }
function actual<T>(name: string, deps: Record<string, unknown>): T { const compiled = ts.transpileModule(`(${expression(name).getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, ""); return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as T; }

test("Studio Modifier accepts bounded native instruction and owned source ID choices but no generated, URL or consent payload", () => {
  assert.ok(parseInrAssistantStudioModifierSelection(encode("instruction", "\n".repeat(1200)))); assert.ok(parseInrAssistantStudioModifierSelection(encode("sourceMediaId", MEDIA)));
  for (const value of [encode("instruction", "x".repeat(1201)), encode("sourceMediaId", "https://foreign.test/image.png"), encode("generate", "true"), encode("identityConsent", "true"), JSON.stringify({ field: "instruction", value: "Texte", save: true }), "discard", "reset_job"]) assert.equal(parseInrAssistantStudioModifierSelection(value), null, value.slice(0, 50));
});

test("the actual Modifier handlers use native setters, owned ID lookup and committed focus/source readback without paid work", async () => {
  let instruction = "Ancienne consigne", sourceMediaId: string | null = null, present = false, focused = false, libraryOpen = false, result: unknown = null, canRecover = false, effects = 0;
  const pending: Array<() => void> = [], sourceRequestRef = { current: 0 };
  const handlers = actual<Record<string, { invoke: (value: string | null, valid: () => boolean) => Promise<void> | void; matches: (state: unknown, value: string | null) => boolean }>>("handlers", { get result() { return result; }, get canRecover() { return canRecover; }, get recoveryPending() { return canRecover; }, libraryOpen, sourceRequestRef, parseInrAssistantStudioModifierSelection, actionError: "",
    setLibraryOpen: (value: boolean) => pending.push(() => { libraryOpen = value; }), setInstruction: (value: string) => pending.push(() => { instruction = value; }), handleEditInstruction: () => pending.push(() => { focused = true; }), removeSource: () => pending.push(() => { present = false; sourceMediaId = null; }),
    loadInrAssistantLibraryImage: async (id: string, valid: () => boolean) => { assert.equal(id, MEDIA); assert.equal(valid(), true); return { id }; }, importLibraryImage: async (item: { id: string }, valid: () => boolean) => { if (!valid()) return false; pending.push(() => { sourceMediaId = item.id; present = true; }); return true; }, generate: () => effects++,
  });
  const state = () => ({ instruction, sourceMediaId, sourcePresent: present, instructionFocused: focused, libraryOpen });
  const command = encode("instruction", "Nouvelle consigne"); await handlers.select.invoke(command, () => true); assert.equal(handlers.select.matches(state(), command), false); pending.splice(0).forEach(commit => commit()); assert.equal(handlers.select.matches(state(), command), true);
  await handlers.select.invoke(encode("sourceMediaId", MEDIA), () => true); assert.equal(handlers.select.matches(state(), encode("sourceMediaId", MEDIA)), false); pending.splice(0).forEach(commit => commit()); assert.equal(handlers.select.matches(state(), encode("sourceMediaId", MEDIA)), true);
  await handlers.select.invoke("edit_instruction", () => true); pending.splice(0).forEach(commit => commit()); assert.equal(handlers.select.matches(state(), "edit_instruction"), true);
  result = { item: { id: "real-result" } }; await assert.rejects(async () => handlers.select.invoke("clear_source", () => true)); result = null; canRecover = true; await assert.rejects(async () => handlers.select.invoke(encode("sourceMediaId", MEDIA), () => true)); assert.equal(effects, 0);
});

test("the actual Modifier source preparation rejects a late account or source scope before committing its image", async () => {
  let current = true, release: ((value: { width: number; height: number }) => void) | undefined;
  const images: unknown[] = [], revoked: string[] = [], sourceRequestRef = { current: 0 };
  const native = actual<(file: unknown, valid: () => boolean) => Promise<boolean>>("selectSourceFile", { operationLocked: false, result: null, sourceRequestRef, setSourceMediaId: () => {}, setActionError: () => {}, isInrMediaImageFile: () => true, AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES: 100, setSourceBusy: () => {}, URL: { createObjectURL: () => "blob:temporary", revokeObjectURL: (value: string) => revoked.push(value) }, readImageDimensions: () => new Promise(resolve => { release = resolve; }), previewUrlRef: { current: "" }, setSourceImage: (value: unknown) => images.push(value), t: (value: string) => value });
  const pending = native({ name: "Owned.png", size: 3 }, () => current); current = false; release!({ width: 100, height: 100 }); assert.equal(await pending, false); assert.equal(images.length, 0); assert.deepEqual(revoked, ["blob:temporary"]);
});

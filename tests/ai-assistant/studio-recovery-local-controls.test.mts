import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  getInrAssistantLocalInterfaceHints,
  isInrAssistantLocalInterfaceRequest,
  parseInrAssistantLocalInterfaceCommand,
  registerInrAssistantLocalInterface,
  type InrAssistantLocalInterface,
} from "../../lib/inrAssistantLocalInterface.ts";
import { isInrAssistantStudioDraftReviewRequest } from "../../lib/inrAssistantStudioDraftReview.ts";
import { INR_ASSISTANT_CREATION_GUIDES } from "../../lib/inrAssistantGuidesCreation.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const targets = ["studio_recovery_guided", "studio_recovery_free", "studio_modifier"] as const;
const scope = { actorUserId: "actor", accountId: "account", pathname: "/dashboard/generer-media" };
const command = (id: InrAssistantLocalInterface, operation: string) => ({ command: "control_local_interface", selection: { kind: "account_document", id }, revision: "recovery_v1", operation, value: null });

test("mounted Studio recoveries expose only confirmation, same-result checks and local verification pause", () => {
  for (const id of targets) {
    for (const operation of id === "studio_modifier" ? ["open", "close", "retry", "stop"] : ["review", "retry", "stop"]) assert.ok(parseInrAssistantLocalInterfaceCommand(command(id, operation)), `${id}: ${operation}`);
    for (const operation of id === "studio_modifier" ? ["generate", "cancel", "delete", "review"] : ["generate", "cancel", "delete", "open", "select"]) assert.equal(parseInrAssistantLocalInterfaceCommand(command(id, operation)), null, `${id}: ${operation}`);
    const handlers = { retry: { invoke() {}, matches: () => true }, stop: { invoke() {}, matches: () => true } };
    registerInrAssistantLocalInterface(id, { ...scope, id, revision: "recovery_v1", snapshot: {}, handlers });
    try {
      assert.deepEqual(getInrAssistantLocalInterfaceHints(scope), [{ id, revision: "recovery_v1", operations: ["retry", "stop"] }]);
    } finally { registerInrAssistantLocalInterface(id, null); }
  }
  assert.equal(parseInrAssistantLocalInterfaceCommand(command("studio_draft_reset", "stop")), null, "Other Studio confirmation targets remain unchanged");
});

test("Studio pause and verification requests never reinterpret generation cancellation or a fresh render as a local pause", () => {
  for (const target of targets) {
    const mode = target === "studio_recovery_free" ? "libre" : target === "studio_recovery_guided" ? "guidé" : "Modifier";
    for (const message of [`Mets en pause la vérification du Studio ${mode}.`, `Arrête l’attente du Studio ${mode}.`, `Stoppe la récupération du Studio ${mode}.`]) {
      assert.equal(isInrAssistantLocalInterfaceRequest(message, target, "stop"), true, message);
      if (target !== "studio_modifier") assert.equal(isInrAssistantStudioDraftReviewRequest(message, target), false, "A local pause never opens cancellation review");
    }
    for (const message of ["Vérifier mon média", "Peux-tu vérifier mon média ?", `Réessaie la vérification du Studio ${mode}.`]) assert.equal(isInrAssistantLocalInterfaceRequest(message, target, "retry"), true, message);
    for (const message of [`Stoppe la génération du Studio ${mode}.`, `Réessaie la génération du Studio ${mode}.`, `Relance la génération du Studio ${mode}.`, `Annule la tentative du Studio ${mode}.`, `Abandonne la récupération du Studio ${mode}.`, `Stoppe la génération du Studio ${mode} en attente.`, `Mets en pause le Studio ${mode}.`, `Comment mettre en pause la vérification du Studio ${mode} ?`, `Ne mets pas en pause la vérification du Studio ${mode}.`, `Si je confirme, mets en pause la vérification du Studio ${mode}.`, `Lis ceci : « Mets en pause la vérification du Studio ${mode}. »`]) {
      assert.equal(isInrAssistantLocalInterfaceRequest(message, target, "stop"), false, message);
      assert.equal(isInrAssistantLocalInterfaceRequest(message, target, "retry"), false, message);
    }
    if (target !== "studio_modifier") assert.equal(isInrAssistantStudioDraftReviewRequest(`Annule la tentative du Studio ${mode}.`, target), true, "The existing separate human cancellation review remains available");
  }
  assert.equal(isInrAssistantLocalInterfaceRequest("Mets en pause la vérification du Studio libre.", "studio_recovery_guided", "stop"), false);
  assert.equal(isInrAssistantLocalInterfaceRequest("Réessaie la récupération du Studio guidé.", "studio_recovery_free", "retry"), false);
  assert.equal(isInrAssistantLocalInterfaceRequest("Mets en pause la vérification du Studio libre.", "studio_modifier", "stop"), false);
  assert.equal(isInrAssistantLocalInterfaceRequest("Mets en pause la vérification du Studio Modifier.", "studio_recovery_free", "stop"), false);
});

test("the real assistant tool emits only the mounted read/pause command and refuses ambiguous generation instructions", async () => {
  const runtime = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: "account", authUserId: "actor" }) } })<typeof import("../../lib/inrAssistantLocalInterfaceTools.ts")>("lib/inrAssistantLocalInterfaceTools.ts");
  for (const id of targets) {
    for (const [operation, message] of [["retry", "Vérifier mon média"], ["stop", "Mets en pause la vérification du Studio."]] as const) {
      const tools = runtime.createInrAssistantLocalInterfaceTools({ ...scope, currentUserMessage: message, clientContext: { source: "untrusted_client", interfaces: [{ id, revision: "recovery_v1", operations: ["retry", "stop"] }] } });
      const result = await tools.controlLocalInterface.execute!({ interface: id, operation, revision: "recovery_v1", value: null, instructionQuote: message }, {} as never) as { ok: boolean; status: string; uiCommand: unknown };
      assert.equal(result.ok, true);
      assert.equal(result.status, "ui_action_requested");
      assert.deepEqual(result.uiCommand, command(id, operation));
    }
    const message = "Stoppe la génération Studio en attente.";
    const tools = runtime.createInrAssistantLocalInterfaceTools({ ...scope, currentUserMessage: message, clientContext: { source: "untrusted_client", interfaces: [{ id, revision: "recovery_v1", operations: ["retry", "stop"] }] } });
    const result = await tools.controlLocalInterface.execute!({ interface: id, operation: "stop", revision: "recovery_v1", value: null, instructionQuote: message }, {} as never) as { ok: boolean; status: string };
    assert.equal(result.ok, false);
    assert.equal(result.status, "needs_instruction");
  }
});

type NativeRecoveryControls = { retry?: { invoke(): void; matches(snapshot: unknown): boolean }; stop?: { invoke(): void; matches(snapshot: unknown): boolean } };
function actualRecoveryControls(target: typeof targets[number], deps: Record<string, unknown>): NativeRecoveryControls {
  const component = target === "studio_recovery_free" ? "MediaFreeGenerator" : target === "studio_recovery_guided" ? "MediaGenerator" : "MediaModifier";
  const file = `app/dashboard/_components/${component}.tsx`;
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let registration: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface" && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === target) registration = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(registration, `${target}: actual native registration`);
  const expression = registration.arguments[2].getText(ast);
  const compiled = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as NativeRecoveryControls;
}

test("the actual Free Guided and Modifier recovery bridges check the same result or pause locally without generation or cancellation", () => {
  for (const target of targets) {
    let checks = 0, pauses = 0, mutations = 0;
    const deps = {
      canRecover: true, recovering: false, canPauseRecovery: true, recoveryPending: true, operationLocked: false, recoveryIncompatible: false,
      busy: false, generationBusy: false, result: null, libraryOpen: false,
      handleRecoverResult: () => { checks++; }, handleRecovery: () => { checks++; }, pauseRecovery: () => { pauses++; return true; },
      handleGenerate: () => { mutations++; assert.fail("A recovery control must never generate"); }, cancelRecovery: () => { mutations++; assert.fail("A local pause must never cancel"); },
      handleAbandonRecovery: () => { mutations++; assert.fail("A local pause must never abandon a paid request"); },
    };
    const controls = actualRecoveryControls(target, deps);
    assert.ok(controls.retry); assert.ok(controls.stop);
    controls.retry.invoke(); assert.equal(checks, 1); assert.equal(pauses, 0);
    assert.equal(controls.retry.matches({ canRecover: true, recovering: false, resultId: null }), false, "Emission alone is not a successful native check");
    assert.equal(controls.retry.matches({ recovering: true }), true);
    assert.equal(controls.retry.matches({ resultId: "the-owned-recovered-result" }), true);
    controls.stop.invoke(); assert.equal(pauses, 1); assert.equal(mutations, 0);
    assert.equal(controls.stop.matches({ recovering: true, canRecover: true }), false);
    assert.equal(controls.stop.matches({ recovering: false, canRecover: true }), true);
    assert.equal(controls.stop.matches({ recovering: false, canRecover: false }), false, "Losing the pending request cannot acknowledge a pause");
    deps.operationLocked = true;
    assert.throws(() => controls.retry!.invoke()); assert.throws(() => controls.stop!.invoke());
    deps.operationLocked = false; deps.recovering = true; assert.throws(() => controls.retry!.invoke());
    deps.recovering = false; deps.canRecover = false; assert.throws(() => controls.retry!.invoke());
    deps.canRecover = true; deps.canPauseRecovery = false; assert.throws(() => controls.stop!.invoke());
    deps.canPauseRecovery = true; deps.pauseRecovery = () => false; assert.throws(() => controls.stop!.invoke());
    assert.equal(checks, 1); assert.equal(pauses, 1); assert.equal(mutations, 0);
    if (target === "studio_modifier") {
      deps.recoveryPending = false;
      const idle = actualRecoveryControls(target, deps);
      assert.equal(idle.retry, undefined); assert.equal(idle.stop, undefined, "Modifier does not expose a recovery control without a pending result");
    }
  }
});

test("the compact Studio guide distinguishes same-job verification, leaving the wait and confirmed cancellation while retaining ADN and recharge rules", () => {
  const guide = INR_ASSISTANT_CREATION_GUIDES.find(row => row.id === "studio-create")!;
  assert.ok(guide.content.length <= 2500);
  for (const phrase of ["Vérifier mon média", "même tentative", "sans relance", "identifiant", "critères restent modifiables", "nouvelle génération attend sa résolution", "Annuler la génération", "confirmation distincte", "absence de débit", "Utiliser mon ADN", "Consignes ET Interdictions", "interdictions priment", "Basique sans crédits mensuels", "recharges permettent de générer sans changer d’offre"]) assert.ok(guide.content.toLowerCase().includes(phrase.toLowerCase()), phrase);
  assert.ok(guide.sourceFiles.includes("app/dashboard/_hooks/useMediaGeneration.ts"));
});

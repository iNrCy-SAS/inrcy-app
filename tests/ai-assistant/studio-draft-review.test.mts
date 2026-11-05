import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS, isInrAssistantStudioDraftReviewRequest, type InrAssistantStudioDraftReviewTarget } from "../../lib/inrAssistantStudioDraftReview.ts";

const requests: Record<InrAssistantStudioDraftReviewTarget, string> = { studio_draft_reset: "Réinitialise mon Studio.", studio_draft_close: "Peux-tu fermer le Studio ?", studio_draft_abandon: "Abandonne le retour de publication dans le Studio.", studio_recovery_guided: "Abandonne la tentative du Studio guidé.", studio_recovery_free: "Annule la tentative du Studio libre." };
type Row = Record<string, unknown>;
function fixture(target: InrAssistantStudioDraftReviewTarget, message: string, options: { actor?: string; account?: string; expired?: boolean; revision?: string; operations?: string[] } = {}) {
  const factory = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: options.account ?? "account", authUserId: options.actor ?? "actor" }) } })<typeof import("../../lib/inrAssistantStudioDraftReviewUiTools.ts")>("lib/inrAssistantStudioDraftReviewUiTools.ts");
  const tools = factory.createInrAssistantStudioDraftReviewUiTools({ accountId: "account", actorUserId: "actor", currentUserMessage: message, canStartWork: () => !options.expired, clientContext: { source: "untrusted_client", interfaces: [{ id: target, revision: options.revision ?? "revision", operations: options.operations ?? ["review"] } as never] } });
  return async (quote = message) => await tools.prepareStudioDraftReview.execute!({ target, revision: "revision", instructionQuote: quote }, { toolCallId: "review", messages: [] }) as Row;
}

test("Basic Studio draft review requests only the exact authenticated mounted native confirmation and never its final action", async () => {
  for (const target of INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS) {
    const message = requests[target]; assert.equal(isInrAssistantStudioDraftReviewRequest(message, target), true, message);
    const result = await fixture(target, message)(); assert.equal(result.ok, true); assert.equal(result.status, "confirmation_required"); assert.equal(result.confirmationRequired, true); assert.match(String(result.message), /L’action finale n’est pas exécutée/);
    assert.deepEqual(result.uiCommand, { command: "control_local_interface", selection: { kind: "account_document", id: target }, revision: "revision", operation: "review", value: null });
    for (const options of [{ actor: "other" }, { account: "other" }, { expired: true }, { revision: "old" }, { operations: ["close"] }]) assert.equal((await fixture(target, message, options)()).ok, false, `${target} ${JSON.stringify(options)}`);
  }
});

test("Basic Studio draft review rejects help quotes conditions wrong operations and another recovery owner", async () => {
  for (const target of INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS) {
    const message = requests[target];
    for (const invalid of [`Comment ${message.toLowerCase()}`, `Explique-moi comment ${message.toLowerCase()}`, `Lis ceci : « ${message} »`, `\`\`\`\n${message}\n\`\`\``, `Si je confirme, ${message.toLowerCase()}`, `Ne ${message.toLowerCase().replace(/\.$/, "")} pas.`, "Supprime la photo du Studio.", "Publie ce brouillon Facebook depuis Studio.", "Réinitialise mes statistiques."]) assert.equal((await fixture(target, invalid)()).ok, false, `${target}: ${invalid}`);
    assert.equal((await fixture(target, "Explique le Studio.")(message)).ok, false);
  }
  assert.equal(isInrAssistantStudioDraftReviewRequest(requests.studio_recovery_free, "studio_recovery_guided"), false); assert.equal(isInrAssistantStudioDraftReviewRequest(requests.studio_recovery_guided, "studio_recovery_free"), false);
});

function actual(file: string, id: string, deps: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface" && node.arguments[0]?.getText(ast) === JSON.stringify(id)) call = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(call);
  const expression = call.arguments[2].getText(ast); assert.doesNotMatch(expression, /confirmReset|confirmClose|confirmAbandonHandoff|handleAbandonRecovery|cancelRecovery\(|discard|fetch\(/);
  const compiled = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as { review: { invoke: () => void; matches: (state: unknown) => boolean } };
}

test("the actual Studio review callbacks open their existing confirmation without cancelling a job or deleting a draft", () => {
  let reset = 0, close = 0, recovery = 0;
  const deps = { locked: false, closeInFlightRef: { current: false }, hasPendingWork: true, hasExternalHandoff: true, onAbandonHandoff: () => assert.fail("No final abandonment"), embedded: false, requestReset: () => reset++, requestClose: () => close++, canRecover: true, generationBusy: false, operationLocked: false, busy: false, recoveryIncompatible: false, setCancelConfirmationOpen: () => recovery++, setStopConfirmOpen: () => recovery++ };
  for (const target of INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS) {
    const file = target === "studio_recovery_guided" ? "MediaGenerator" : target === "studio_recovery_free" ? "MediaFreeGenerator" : "MediaGeneratorModal";
    const handler = actual(`app/dashboard/_components/${file}.tsx`, target, deps).review; handler.invoke(); assert.equal(handler.matches({ closeConfirmOpen: false, confirmationOpen: false }), false);
    assert.equal(handler.matches(target.startsWith("studio_recovery") ? { confirmationOpen: true, canRecover: true } : { closeConfirmOpen: true, resetRequested: target === "studio_draft_reset", hasExternalHandoff: true }), true);
  }
  assert.equal(reset, 1); assert.equal(close, 2); assert.equal(recovery, 2);
  deps.locked = true; assert.throws(() => actual("app/dashboard/_components/MediaGeneratorModal.tsx", "studio_draft_reset", deps).review.invoke());
  deps.operationLocked = true; assert.throws(() => actual("app/dashboard/_components/MediaGenerator.tsx", "studio_recovery_guided", deps).review.invoke());
  deps.operationLocked = false; deps.recoveryIncompatible = true; assert.throws(() => actual("app/dashboard/_components/MediaFreeGenerator.tsx", "studio_recovery_free", deps).review.invoke());
});

test("the actual Studio global navigation guard preserves its native draft review and rejects a stale session callback", async () => {
  const file = "app/dashboard/_components/MediaGeneratorModal.tsx", source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let effect: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0].getText(ast).includes("studio-native-navigation:")) effect = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(effect);
  const compiled = ts.transpileModule(`(${effect.arguments[0].getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  let review = 0, disposed = 0, guard!: { shouldBlock: () => boolean; confirmExit: () => Promise<boolean> };
  const deps = { mounted: true, open: true, navigationGuardId: "native-studio", sessionVersionRef: { current: 1 }, openedRef: { current: true }, navigationGuardState: { current: { locked: false, hasPendingWork: true, hasExternalHandoff: false, requestClose: () => review++ } }, registerGuard: (value: typeof guard) => { guard = value; return () => disposed++; } };
  const cleanup = vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps)() as () => void;
  assert.equal(guard.shouldBlock(), true); assert.equal(await guard.confirmExit(), false); assert.equal(review, 1);
  deps.navigationGuardState.current.locked = true; assert.equal(await guard.confirmExit(), false); assert.equal(review, 1, "a running generation cannot be closed");
  deps.navigationGuardState.current.locked = false; deps.sessionVersionRef.current = 2; assert.equal(guard.shouldBlock(), false); assert.equal(await guard.confirmExit(), false); assert.equal(review, 1, "a callback from an old draft cannot open another draft review"); cleanup(); assert.equal(disposed, 1);
});

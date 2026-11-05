import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
type Row = Record<string, unknown>;
type Definition = { execute(input: unknown): Promise<Row> };
const source = ts.createSourceFile("inrAssistantGateway.ts", readFileSync(new URL("../../../lib/inrAssistantGateway.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let callback = "";
function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === "recordToolResult" && node.initializer) callback = node.initializer.getText(source); ts.forEachChild(node, visit); }
visit(source); assert.ok(callback, "The real Gateway receipt recorder must be found");
const compiled = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

/** Exercise the real Gateway observer against each factory's actual result.
 * Only unrelated browser-action adapters and task closure state are fixtures. */
export function gatewayReceiptRecorder(toolName: string, privateApprovals = new Map<string, { token: string; kind: string }>()) {
  const receipts: Row[] = [];
  const record = vm.runInNewContext(compiled, {
    seenToolResults: new Set(), observedActionNames: new Set([toolName]), readCounts: new Map(), receipts,
    inrAssistantUiActionsFromToolResult: () => [], uiActions: [], INR_ASSISTANT_MAX_UI_ACTIONS: 64,
    uiStepCalls: new Map(), inrAssistantUiStepAcceptsAction: () => false, InrAssistantInputError: Error,
    actionFacts: new Map(), resultToolName: (name: string) => name, privateApprovals,
  }) as (result: { toolName: string; toolCallId: string; output: unknown }) => boolean;
  return { receipts, record };
}
export function assertBasicReceiptContract(toolName: string, output: Row) {
  if (output.ok !== true) return;
  assert.equal(typeof output.message, "string", `${toolName}/${output.status}: a successful result needs a verifiable receipt message`);
  assert.ok(String(output.message).trim().length > 12, `${toolName}/${output.status}: receipt message is meaningful`);
  if (["already_applied", "already_removed", "already_disconnected", "already_processed", "unchanged"].includes(String(output.status))) assert.match(String(output.message), /\b(?:aucun|aucune)\b/iu, `${toolName}: an unchanged state must not claim a new write`);
  const approvals = new Map<string, { token: string; kind: string }>();
  if (output.status === "preview_ready") {
    assert.equal(typeof output.reference, "string"); assert.equal(typeof output.token, "string"); assert.equal(typeof output.approvalKind, "string");
    assert.ok(String(output.message).includes(String(output.reference)), `${toolName}: the preview explains its exact approval reference`);
    assert.match(String(output.message), /confirme/i);
    approvals.set(String(output.reference), { token: String(output.token), kind: String(output.approvalKind) });
  }
  const { token: _privateToken, ...publicOutput } = output; void _privateToken;
  const observer = gatewayReceiptRecorder(toolName, approvals);
  assert.equal(observer.record({ toolName, toolCallId: "receipt-contract-1", output: publicOutput }), true, `${toolName}: the real Gateway must record this result`);
  assert.equal(observer.receipts.length, 1); const receipt = observer.receipts[0];
  assert.equal(receipt.ok, true); assert.equal(receipt.status, output.status); assert.equal(receipt.message, output.message);
  if (output.status === "preview_ready") { assert.equal(receipt.approvalReference, output.reference); assert.equal(receipt.approvalToken, output.token); assert.equal(receipt.approvalKind, output.approvalKind); }
}
export function withBasicReceiptContract<T extends Record<string, Definition>>(definitions: T): T {
  for (const [name, definition] of Object.entries(definitions)) {
    const execute = definition.execute;
    definition.execute = async input => { const output = await execute(input); assertBasicReceiptContract(name, output); return output; };
  }
  return definitions;
}

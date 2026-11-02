import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { compactInrAssistantRejectedToolContext } from "../../lib/inrAssistantRejectedToolContext.ts";

const make = (): ModelMessage[] => [
  { role: "user", content: "Crée Alice puis consulte les publications" },
  { role: "assistant", content: [
    { type: "tool-call", toolCallId: "bad", toolName: "manageCrmContact", input: { contactId: "malformed JSON ".repeat(5000) } },
    { type: "tool-call", toolCallId: "read", toolName: "searchCrmContacts", input: { query: "Alice" } },
  ] },
  { role: "tool", content: [
    { type: "tool-result", toolCallId: "bad", toolName: "manageCrmContact", output: { type: "error-text", value: "Invalid input ".repeat(5000) } },
    { type: "tool-result", toolCallId: "read", toolName: "searchCrmContacts", output: { type: "json", value: { ok: true, contacts: [], nextOffset: null } } },
  ] },
];
test("SDK rejected arguments stay paired while duplicate invalid payload is bounded and successful facts stay exact", () => {
  const original = make(), input = JSON.stringify(original);
  const result = compactInrAssistantRejectedToolContext(original, new Set(["bad"]));
  assert.equal(JSON.stringify(original), input, "must not mutate SDK response messages");
  assert.ok(JSON.stringify(result).length < 1100);
  assert.equal(result[0], original[0]);
  const beforeCall = original[1].content, afterCall = result[1].content;
  assert.ok(Array.isArray(beforeCall) && Array.isArray(afterCall));
  assert.equal(afterCall[1], beforeCall[1]);
  assert.deepEqual(afterCall[0], { type: "tool-call", toolCallId: "bad", toolName: "manageCrmContact", input: {} });
  const beforeResult = original[2].content, afterResult = result[2].content;
  assert.ok(Array.isArray(beforeResult) && Array.isArray(afterResult));
  assert.equal(afterResult[1], beforeResult[1]);
  assert.match(JSON.stringify(afterResult[0]), /AVANT toute exécution/);
  assert.deepEqual(compactInrAssistantRejectedToolContext(result, new Set(["bad"])), result);
});
test("model claims, missing results, name mismatches or ambiguous repeated IDs cannot compact a call", () => {
  const original = make();
  assert.equal(compactInrAssistantRejectedToolContext(original, new Set()), original);
  assert.deepEqual(compactInrAssistantRejectedToolContext(original, new Set(["invented"])), original);
  assert.deepEqual(compactInrAssistantRejectedToolContext(original.slice(0, 2), new Set(["bad"])), original.slice(0, 2));
  const duplicated = [...original, original[2]];
  assert.deepEqual(compactInrAssistantRejectedToolContext(duplicated, new Set(["bad"])), duplicated);
  const success: ModelMessage[] = [...original.slice(0, 2), { role: "tool", content: [{ type: "tool-result", toolCallId: "bad", toolName: "manageCrmContact", output: { type: "json", value: { ok: true, id: "created-contact" } } }] }];
  assert.deepEqual(compactInrAssistantRejectedToolContext(success, new Set(["bad"])), success);
  const conflicting = [...original, success[2]];
  assert.deepEqual(compactInrAssistantRejectedToolContext(conflicting, new Set(["bad"])), conflicting);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { compactInrAssistantGuideContext } from "../../lib/inrAssistantPromptContext.ts";

const guideResult = (id: string, guides: Array<{ id: string; content: string }>, toolName = "readAppGuide"): ModelMessage => ({
  role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName, output: { type: "json", value: { found: true, guides } } }],
});

test("duplicate guide prose is referenced once without dropping tool call/result pairs or mutating the SDK history", () => {
  const guide = { id: "booster", content: "Publication rules and account permissions. ".repeat(100) };
  const messages: ModelMessage[] = [
    { role: "user", content: "Prépare et publie avec une image." },
    { role: "assistant", content: ["one", "two"].map(toolCallId => ({ type: "tool-call", toolCallId, toolName: "readAppGuide", input: { topic: "booster" } })) },
    guideResult("one", [guide]), guideResult("two", [guide]),
  ];
  const original = JSON.stringify(messages);
  const compacted = compactInrAssistantGuideContext(messages);
  const output = JSON.stringify(compacted);
  assert.equal(JSON.stringify(messages), original);
  assert.equal(compacted.length, messages.length);
  assert.ok(output.length < original.length - 3000);
  assert.equal(output.split(guide.content).length - 1, 1);
  assert.match(output, /déjà fourni/);
  assert.deepEqual(compacted.filter(message => message.role === "tool").flatMap(message => message.content.filter(part => part.type === "tool-result").map(part => part.toolCallId)), ["one", "two"]);
});

test("distinct guide content and business receipts are never replaced by an unrelated guide reference", () => {
  const messages: ModelMessage[] = [guideResult("one", [{ id: "booster", content: "First version" }]),
    guideResult("two", [{ id: "booster", content: "Updated rules" }, { id: "publications", content: "First version" }]),
    guideResult("receipt", [{ id: "booster", content: "First version" }], "executePublication"),
  ];
  assert.deepEqual(compactInrAssistantGuideContext(messages), messages);
});

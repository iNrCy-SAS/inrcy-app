import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { compactInrAssistantGuideContext, fitInrAssistantGuideContext } from "../../lib/inrAssistantPromptContext.ts";

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

test("fallback guide excerpts preserve call/result pairs and every native business field", () => {
  const native = guideResult("native", [{ id: "record-123", content: "Native record content must remain exact. ".repeat(200) }], "readPublicationWorkspace");
  const messages = [guideResult("guide", [{ id: "crm", content: "Guidance. ".repeat(1000) }]), native];
  const result = compactInrAssistantGuideContext(messages, { maxGuideCharacters: 1200 });
  assert.deepEqual(result[1], native);
  assert.match(JSON.stringify(result[0]), /Extrait du guide/);
  assert.match(JSON.stringify(result[0]), /"truncated":true/);
  assert.equal((result[0] as { content: Array<{ toolCallId: string }> }).content[0].toolCallId, "guide");
});

test("a real continuation budget compacts several distinct guides without changing native receipts", () => {
  const native = { role: "tool", content: [{ type: "tool-result", toolCallId: "saved", toolName: "preparePublication", output: { type: "json", value: { ok: true, draftId: "owned-draft", status: "draft", content: "Keep the exact client-authorized text." } } }] } as ModelMessage;
  const messages = [guideResult("one", [{ id: "studio", content: "Studio reference. ".repeat(600) }]), guideResult("two", [{ id: "booster", content: "Publication reference. ".repeat(600) }]), native];
  const original = JSON.stringify(messages);
  const measure = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const result = fitInrAssistantGuideContext(messages, 2_800, measure);
  assert.ok(measure(result) <= 2_800);
  assert.equal(JSON.stringify(messages), original);
  assert.deepEqual(result[2], native);
  assert.equal(result.length, messages.length);
  assert.match(JSON.stringify(result), /Extrait du guide/);
});

test("a business result is never silently truncated to satisfy a context budget", () => {
  const native = guideResult("native", [{ id: "owned", content: "Exact business facts. ".repeat(1000) }], "readPublicationWorkspace");
  const messages = [native];
  const result = fitInrAssistantGuideContext(messages, 100, value => JSON.stringify(value).length);
  assert.deepEqual(result, messages);
});

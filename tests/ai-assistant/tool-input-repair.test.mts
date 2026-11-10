import assert from "node:assert/strict";
import test from "node:test";
import { generateText, jsonSchema, tool } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { repairInrAssistantToolInput } from "../../lib/inrAssistantToolInputRepair.ts";
import { parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "../../lib/inrAssistantStudioDraft.ts";

const draft = { version: 1, mediaType: "video", prompt: "Vidéo verticale d’un vélo rouge, sans texte.", format: "portrait", durationSeconds: "8" };
const call = (toolName: string, input: unknown) => ({ type: "tool-call" as const, toolCallId: "offline-repair", toolName, input: JSON.stringify(input) });

test("Studio draft repair accepts only canonical bounded video integers and never changes format or creative content", () => {
  for (const durationSeconds of ["4", "8", "30"]) {
    const fixed = repairInrAssistantToolInput(call("prepareStudioPrompt", { ...draft, durationSeconds }));
    assert.ok(fixed);
    assert.deepEqual(JSON.parse(fixed.input), { ...draft, durationSeconds: Number(durationSeconds) });
    assert.ok(parseInrAssistantStudioDraft(JSON.parse(fixed.input)));
  }
  for (const durationSeconds of ["0", "3", "31", "8.0", "08", "1e1", " 8 ", "Infinity", "8 secondes", null, 8]) {
    assert.equal(repairInrAssistantToolInput(call("prepareStudioPrompt", { ...draft, durationSeconds })), null);
  }
  assert.equal(repairInrAssistantToolInput(call("prepareStudioPrompt", { ...draft, mediaType: "image" })), null);
  const scoped = { ...draft, accountId: "foreign", instructionQuote: "Unchanged quote", consent: false };
  const fixed = JSON.parse(repairInrAssistantToolInput(call("prepareStudioPrompt", scoped))!.input);
  assert.deepEqual(fixed, { ...scoped, durationSeconds: 8 });
  assert.equal(parseInrAssistantStudioDraft(fixed), null, "unknown scope/consent keys remain rejected");
});

test("screen repair decodes only an object envelope and preserves every target, quote, field and business value", () => {
  const patch = { changes: [{ field: "backgroundColor", valueJson: '"white"' }, { field: "zoom", valueJson: "110" }], unknown: "retain me" };
  const raw = { command: "configure_image_retouch", instructionQuote: "Unchanged exact current instruction", documentId: "foreign", documentKind: "retouche", recipient: "x@example.invalid", patch: JSON.stringify(patch), accountId: "retain foreign" };
  const fixed = repairInrAssistantToolInput(call("runScreenCommand", raw));
  assert.ok(fixed);
  assert.deepEqual(JSON.parse(fixed.input), { ...raw, patch });
  for (const patch of ["null", "[]", "true", '"nested string"', "not JSON", " ".repeat(18_001)]) {
    assert.equal(repairInrAssistantToolInput(call("runScreenCommand", { ...raw, patch })), null);
  }
  assert.equal(repairInrAssistantToolInput({ toolName: "sendIndividualMail", input: JSON.stringify(raw) }), null);
});

test("real SDK revalidates a repaired Studio duration through the native draft parser without a paid request", async () => {
  const executed: InrAssistantStudioDraft[] = [];
  let repairs = 0;
  const model: LanguageModelV3 = {
    specificationVersion: "v3", provider: "offline-repair", modelId: "draft", supportedUrls: {},
    doGenerate: async () => ({ content: [call("prepareStudioPrompt", draft)], finishReason: { unified: "tool-calls", raw: "fixture" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] }),
    doStream: async () => { throw new Error("No transport"); },
  };
  const result = await generateText({ model, prompt: "Prépare uniquement un prompt vidéo vertical de8secondes.", tools: {
    prepareStudioPrompt: tool({ inputSchema: jsonSchema<InrAssistantStudioDraft>({ type: "object" }, { validate: value => {
      const parsed = parseInrAssistantStudioDraft(value);
      return parsed ? { success: true, value: parsed } : { success: false, error: new Error("Invalid native Studio draft") };
    } }), execute: async input => { executed.push(input); return { ok: true, status: "draft", studioDraft: input }; } }),
  }, experimental_repairToolCall: async ({ toolCall }) => { repairs += 1; return repairInrAssistantToolInput(toolCall); } });
  assert.equal(repairs, 1);
  assert.equal(executed.length, 1);
  assert.deepEqual(executed[0], { ...draft, durationSeconds: 8 });
  assert.equal(result.toolResults.length, 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, generateText, jsonSchema, stepCountIs, tool, type ToolExecutionOptions } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import * as reader from "../../lib/inrAssistantAttachmentReader.ts";
import type * as AttachmentTools from "../../lib/inrAssistantAttachmentTools.ts";

function createTools() {
  const source = readFileSync(new URL("../../lib/inrAssistantAttachmentTools.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  const dependencies: Record<string, unknown> = { "server-only": {}, ai: { jsonSchema, tool }, "./inrAssistantAttachmentReader.ts": reader };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`)((name: string) => {
    assert.ok(name in dependencies); return dependencies[name];
  }, record, record.exports);
  return (record.exports as typeof AttachmentTools).createInrAssistantAttachmentTools([{ name: "avenant.txt", kind: "document", text: "Archive. ".repeat(2400) + "AVENANT SIGNÉ : délai de paiement de 45 jours.", note: "Texte réellement extrait" }]);
}

test("real SDK schema rejects an empty query with a repair hint before the executor", async () => {
  const tools = createTools(), schema = asSchema(tools.readAttachedDocument.inputSchema);
  assert.ok(schema.validate);
  const invalid = await schema.validate({ documentIndex: 1, offset: 0, query: "" });
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.match(invalid.error.message, /query=null/);
  const repaired = await schema.validate({ documentIndex: 1, offset: 0, query: null });
  assert.equal(repaired.success, true);
});

test("SDK argument repair consumes no source read for empty query and only one for valid late evidence", async () => {
  const native = createTools(), execute = native.readAttachedDocument.execute!;
  let executions = 0, steps = 0;
  const model: LanguageModelV3 = {
    specificationVersion: "v3", provider: "offline-fixture", modelId: "reader-repair", supportedUrls: {},
    doStream: async () => { throw new Error("No streaming fixture"); },
    doGenerate: async () => {
      steps += 1;
      const content = steps <= 2
        ? [{ type: "tool-call" as const, toolCallId: `read-${steps}`, toolName: "readAttachedDocument", input: JSON.stringify({ documentIndex: 1, offset: 0, query: steps === 1 ? "" : "paiement délai avenant" }) }]
        : [{ type: "text" as const, text: "L’avenant indique 45 jours." }];
      return { content, finishReason: { unified: steps <= 2 ? "tool-calls" as const : "stop" as const, raw: "fixture" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] };
    },
  };
  const result = await generateText({ model, maxRetries: 0, stopWhen: stepCountIs(3), prompt: "Lis le délai actuel dans l’avenant.", tools: {
    readAttachedDocument: { ...native.readAttachedDocument, execute: async (input: reader.InrAssistantAttachmentReadInput, options: ToolExecutionOptions) => { executions += 1; return execute(input, options); } },
  } });
  assert.equal(executions, 1);
  assert.equal(steps, 3);
  assert.match(JSON.stringify(result.steps.flatMap(step => step.toolResults)), /45 jours/);
  assert.match(result.text, /45 jours/);
});

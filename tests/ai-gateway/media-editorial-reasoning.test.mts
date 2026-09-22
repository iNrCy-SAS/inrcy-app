import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiMediaEditorialReasoning } from "../../lib/aiGatewayReasoning.ts";

test("media copy retains output budget on gateway and direct GPT-5.6 paths", () => {
  for (const feature of ["media.image", "media.video"]) {
    for (const model of ["openai/gpt-5.6-luna", "gpt-5.6-luna", "openai/gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6"]) {
      assert.deepEqual(resolveAiMediaEditorialReasoning(feature, model), { effort: "none" });
    }
  }
});

test("does not send unsupported reasoning options to another provider or workflow", () => {
  for (const model of ["google/gemini-3-flash", "anthropic/claude-sonnet-4.6", "gpt-6-astra", "gpt-5"]) {
    assert.equal(resolveAiMediaEditorialReasoning("media.video", model), undefined);
  }
  assert.equal(resolveAiMediaEditorialReasoning("booster", "openai/gpt-5.6-luna"), undefined);
});

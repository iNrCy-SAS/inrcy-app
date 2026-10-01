import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  resolveModelTemperature,
  supportsExplicitTemperature,
} from "../../lib/aiModelCapabilities.ts";

const ROOT = resolve(import.meta.dirname, "../..");

test("GPT-5.6 requests omit the unsupported temperature parameter", () => {
  for (const model of [
    "openai/gpt-5.6-luna",
    "gpt-5.6-luna",
    "openai/gpt-5.6-terra",
    "gpt-5.6-sol",
    "gpt-5.6",
    "openai/gpt-5.6-luna-2026-09-30",
  ]) {
    assert.equal(supportsExplicitTemperature(model), false);
    assert.equal(resolveModelTemperature(model, 0.18), undefined);
  }
});

test("other provider models keep an explicitly requested temperature", () => {
  for (const model of [
    "google/gemini-3-flash",
    "anthropic/claude-sonnet-4.6",
    "mistral/mistral-medium-3.5",
  ]) {
    assert.equal(supportsExplicitTemperature(model), true);
    assert.equal(resolveModelTemperature(model, 0.18), 0.18);
  }
});

test("an absent temperature remains absent for every model", () => {
  assert.equal(resolveModelTemperature("openai/gpt-5.6-luna", undefined), undefined);
  assert.equal(resolveModelTemperature("google/gemini-3-flash", undefined), undefined);
});

test("the shared JSON transport applies the model capability before serializing", () => {
  const client = readFileSync(resolve(ROOT, "lib/aiGatewayClient.ts"), "utf8");

  assert.match(client, /resolveModelTemperature\(target\.requestModel, temperature\)/);
  assert.match(
    client,
    /requestTemperature === undefined \? \{\} : \{ temperature: requestTemperature \}/,
  );
  assert.doesNotMatch(client, /temperature === undefined \? \{\} : \{ temperature \}/);
});

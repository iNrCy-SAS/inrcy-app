import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CONTENT_LENGTH_VALUES,
  enforceAiContentLengthForEdition,
  normalizeAiContentLength,
} from "../../lib/aiContentLength.ts";

test("content lengths expose the five canonical choices", () => {
  assert.deepEqual(AI_CONTENT_LENGTH_VALUES, [
    "adapted",
    "short",
    "medium",
    "long",
    "deep",
  ]);
});

test("legacy and translated values migrate to a canonical length", () => {
  assert.equal(normalizeAiContentLength("detailed"), "long");
  assert.equal(normalizeAiContentLength("Détaillé"), "long");
  assert.equal(normalizeAiContentLength("Automatique"), "adapted");
  assert.equal(normalizeAiContentLength("Très détaillé"), "deep");
  assert.equal(normalizeAiContentLength("unknown", "short"), "short");
});

test("the server-side edition rule downgrades Premium depth for Standard only", () => {
  assert.equal(enforceAiContentLengthForEdition("deep", "standard"), "long");
  assert.equal(enforceAiContentLengthForEdition("deep", "premium"), "deep");
  assert.equal(enforceAiContentLengthForEdition("deep", "founder"), "deep");
  assert.equal(enforceAiContentLengthForEdition("medium", "standard"), "medium");
});

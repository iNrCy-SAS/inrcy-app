import assert from "node:assert/strict";
import test from "node:test";
import { hasInvalidBoosterPublicationJson } from "../../lib/boosterPublicationDispatchPlan.ts";

test("accepts accents, CJK characters and complete emoji in publication values and keys", () => {
  assert.equal(hasInvalidBoosterPublicationJson({
    "été 文 🙂": ["Événement", "中文", "📷", 42, true, null, undefined],
  }), false);
});

test("detects lone high and low surrogates in nested publication values and keys", () => {
  assert.equal(hasInvalidBoosterPublicationJson({ media: [{ title: "Photo \uD83D" }] }), true);
  assert.equal(hasInvalidBoosterPublicationJson({ metadata: { "\uDE42": "Description" } }), true);
});

test("detects null characters in publication values and keys", () => {
  assert.equal(hasInvalidBoosterPublicationJson({ caption: "Bonjour\u0000suite" }), true);
  assert.equal(hasInvalidBoosterPublicationJson({ "title\u0000": "Bonjour" }), true);
});

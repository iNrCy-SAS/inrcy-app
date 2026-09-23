import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAppendedReference,
  inferRequiredReferenceRole,
} from "../../lib/aiMediaReferenceClassification.ts";

test("a portrait name becomes a required character without a second click", () => {
  assert.deepEqual(
    classifyAppendedReference({ fileName: "portrait-client.jpg", detectedPerson: null }),
    { role: "character", usage: "required" },
  );
});

test("a visually detected portrait is required even when the name is generic", () => {
  assert.deepEqual(
    classifyAppendedReference({ fileName: "IMG_0423.jpg", detectedPerson: true }),
    { role: "character", usage: "required" },
  );
});

test("a non-person image is not made a required character by a misleading name", () => {
  assert.deepEqual(
    classifyAppendedReference({ fileName: "portrait-promo.jpg", detectedPerson: false }),
    { role: "product", usage: "inspiration" },
  );
});

test("ordinary product and place references remain optional", () => {
  assert.deepEqual(
    classifyAppendedReference({ fileName: "atelier.jpg", detectedPerson: null }),
    { role: "environment", usage: "inspiration" },
  );
  assert.equal(inferRequiredReferenceRole("produit.png"), "product");
});

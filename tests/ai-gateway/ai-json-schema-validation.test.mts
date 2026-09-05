import assert from "node:assert/strict";
import test from "node:test";

import {
  AiJsonSchemaValidationError,
  assertAiJsonMatchesSchema,
} from "../../lib/aiJsonSchemaValidation.ts";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    memory: {
      type: "object",
      additionalProperties: false,
      properties: {
        mission: { type: "string", maxLength: 20 },
        values: { type: "array", maxItems: 2, items: { type: "string", maxLength: 12 } },
        schedule: { $ref: "#/$defs/day" },
      },
      required: ["mission", "values", "schedule"],
    },
  },
  required: ["memory"],
  $defs: {
    day: {
      type: "object",
      additionalProperties: false,
      properties: { open: { type: "boolean" } },
      required: ["open"],
    },
  },
} as const;

test("runtime schema validation accepts the exact structured payload", () => {
  assert.doesNotThrow(() => assertAiJsonMatchesSchema({
    memory: { mission: "Rendre simple", values: ["proximité"], schedule: { open: true } },
  }, schema));
});

test("runtime schema validation rejects a missing required DNA field", () => {
  assert.throws(
    () => assertAiJsonMatchesSchema({ memory: { mission: "Rendre simple", schedule: { open: true } } }, schema),
    (error) => error instanceof AiJsonSchemaValidationError && /values/.test(error.message),
  );
});

test("runtime schema validation rejects bad types and extra fields", () => {
  assert.throws(
    () => assertAiJsonMatchesSchema({
      memory: { mission: "Rendre simple", values: "proximité", schedule: { open: true }, invented: true },
    }, schema),
    AiJsonSchemaValidationError,
  );
});

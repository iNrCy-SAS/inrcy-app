import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  AiJsonResponseNormalizationError,
  normalizeAiJsonResponseBeforeValidation,
} from "../../lib/aiJsonResponseNormalization.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import { normalizeBoosterStructuredResponse } from "../../lib/boosterStructuredResponseNormalization.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) => readFileSync(resolve(ROOT, relativePath), "utf8");

function boosterSchema(channels: string[]) {
  const post = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      cta: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
    },
    required: ["title", "content", "cta", "hashtags"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      versions: {
        type: "object",
        properties: Object.fromEntries(channels.map((channel) => [channel, post])),
        required: channels,
        additionalProperties: false,
      },
    },
    required: ["versions"],
    additionalProperties: false,
  };
}

test("Booster canonicalizes known provider wrappers and channel aliases", () => {
  const normalized = normalizeBoosterStructuredResponse(
    {
      result: {
        data: {
          google_business: {
            post: {
              headline: "Nouveauté locale",
              description: "Une présentation complète et naturelle du service proposé.",
              call_to_action: "Nous contacter",
              hashtags: "#local #service",
            },
          },
          public_page: {
            title: "Notre actualité",
            body: "Une information utile pour découvrir notre savoir-faire.",
            action: "En savoir plus",
            tags: ["actualité", "entreprise"],
          },
        },
      },
    },
    ["gmb", "inr_search"],
  );

  assert.deepEqual(normalized, {
    versions: {
      gmb: {
        title: "Nouveauté locale",
        content: "Une présentation complète et naturelle du service proposé.",
        cta: "Nous contacter",
        hashtags: ["local", "service"],
      },
      inr_search: {
        title: "Notre actualité",
        content: "Une information utile pour découvrir notre savoir-faire.",
        cta: "En savoir plus",
        hashtags: ["actualité", "entreprise"],
      },
    },
  });
  assert.doesNotThrow(() =>
    assertAiJsonMatchesSchema(normalized, boosterSchema(["gmb", "inr_search"])),
  );
});

test("a single-channel direct post is recovered without duplicating it across channels", () => {
  const direct = {
    title: "Titre direct",
    description: "Texte direct fourni sans enveloppe versions.",
    cta: "Découvrir",
    hashtags: [],
  };

  assert.deepEqual(normalizeBoosterStructuredResponse(direct, ["gmb"]), {
    versions: {
      gmb: {
        title: "Titre direct",
        content: "Texte direct fourni sans enveloppe versions.",
        cta: "Découvrir",
        hashtags: [],
      },
    },
  });
  assert.deepEqual(normalizeBoosterStructuredResponse(direct, ["gmb", "linkedin"]), {
    versions: {},
  });
});

test("unknown or missing channel data still fails the mandatory final schema validation", () => {
  const normalized = normalizeBoosterStructuredResponse(
    { versions: { gmb: { unexpected: "payload" } } },
    ["gmb"],
  );
  assert.deepEqual(normalized, { versions: {} });
  assert.throws(
    () => assertAiJsonMatchesSchema(normalized, boosterSchema(["gmb"])),
    /gmb.*champ obligatoire absent/i,
  );
});

test("the generic hook accepts only an object and never exposes a failing normalizer payload", () => {
  assert.deepEqual(
    normalizeAiJsonResponseBeforeValidation({ alias: "ok" }, () => ({ canonical: "ok" })),
    { canonical: "ok" },
  );
  assert.throws(
    () => normalizeAiJsonResponseBeforeValidation({ secret: "do-not-log" }, () => []),
    AiJsonResponseNormalizationError,
  );
  assert.throws(
    () =>
      normalizeAiJsonResponseBeforeValidation({ secret: "do-not-log" }, () => {
        throw new Error("do-not-log");
      }),
    (error) =>
      error instanceof AiJsonResponseNormalizationError &&
      !error.message.includes("do-not-log"),
  );
});

test("the Gateway preserves the strict provider schema and validates only after normalization", () => {
  const client = read("lib/aiGatewayClient.ts");
  const booster = read("lib/boosterPublishGeneration.ts");
  const normalizationIndex = client.indexOf("normalizeAiJsonResponseBeforeValidation(");
  const validationIndex = client.indexOf(
    "assertAiJsonMatchesSchema(normalized, opts.responseSchema.schema)",
  );

  assert.match(client, /type:\s*"json_schema"/);
  assert.match(client, /schema:\s*opts\.responseSchema\.schema/);
  assert.ok(normalizationIndex >= 0 && validationIndex > normalizationIndex);
  assert.match(booster, /normalizeResponseBeforeValidation:\s*\(output\)/);
  assert.match(booster, /normalizeBoosterStructuredResponse\(output, args\.channels\)/);
});

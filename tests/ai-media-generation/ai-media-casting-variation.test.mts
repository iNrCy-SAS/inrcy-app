import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_CASTING_VARIANTS,
  chooseAiMediaCastingVariation,
} from "../../lib/aiMediaCastingVariation.ts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";

function request(requestId = "casting-request-0001") {
  return normalizeAiMediaGenerationRequest({
    requestId,
    kind: "image",
    operation: "generate",
    source: "studio",
    inputMode: "essential",
    subjectSource: "custom",
    idea: "Un artisan fabrique une table en bois.",
    generationMode: "ai_free",
    format: "square",
    imageStyle: "photo",
    textMode: "none",
    withText: false,
    logoMode: "none",
  });
}

test("les générations successives épuisent les castings avant de les réutiliser", () => {
  const recentVariantKeys: string[] = [];
  for (let index = 0; index < AI_MEDIA_CASTING_VARIANTS.length; index += 1) {
    const selected = chooseAiMediaCastingVariation({
      request: request(`casting-request-${String(index).padStart(4, "0")}`),
      recentVariantKeys,
    });
    assert.ok(selected);
    assert.ok(!recentVariantKeys.includes(selected.key));
    recentVariantKeys.unshift(selected.key);
  }
  assert.equal(new Set(recentVariantKeys).size, AI_MEDIA_CASTING_VARIANTS.length);
});

test("une même tentative garde sa direction et évite la variante la plus récente", () => {
  const input = { request: request(), recentVariantKeys: ["angular-short"] };
  const first = chooseAiMediaCastingVariation(input);
  assert.ok(first);
  assert.notEqual(first.key, "angular-short");
  assert.deepEqual(chooseAiMediaCastingVariation(input), first);
  assert.match(first.direction, /si le sujet justifie une présence humaine/);
  assert.match(first.direction, /explicitement demandés restent prioritaires/);
});

test("aucun casting de remplacement pour une référence ou un choix sans personnage", () => {
  const base = request();
  for (const overrides of [
    { peopleMode: "none" as const },
    { identityMode: "professional" as const },
    { kind: "video" as const },
    { creationMode: "free" as const },
    { operation: "modify" as const },
    {
      inspirationImages: [
        {
          role: "character" as const,
          usage: "required" as const,
          data: "reference",
          mimeType: "image/png" as const,
        },
      ],
    },
  ]) {
    assert.equal(
      chooseAiMediaCastingVariation({ request: { ...base, ...overrides } }),
      null,
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaFreeReferenceInstructions } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { buildAiMediaVideoReferenceContract } from "../../lib/aiMediaVideoProviderContract.ts";

const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZO3cAAAAASUVORK5CYII=";
const base = {
  requestId: "required-reference-ui-contract", source: "studio", operation: "generate", creationMode: "free",
  inputMode: "essential", format: "landscape", freePrompt: "Une scène réaliste avec les éléments de la référence.",
  withNarration: false, withMusic: false,
};

test("a generic required Image survives image and video normalization and stays mandatory in provider instructions", () => {
  for (const kind of ["image", "video"] as const) {
    const request = normalizeAiMediaGenerationRequest({ ...base, kind, imageEngine: "openai", videoEngine: "wan27",
      videoResolution: "720p", durationSeconds: 8, sceneMode: "single",
      inspirationImages: [{ mimeType: "image/png", data, role: "inspiration", usage: "required" }],
    });
    assert.equal(request.inspirationImages[0]?.role, "inspiration");
    assert.equal(request.inspirationImages[0]?.usage, "required");
    assert.match(buildAiMediaFreeReferenceInstructions(request), /usage obligatoire/);
    assert.doesNotMatch(buildAiMediaFreeReferenceInstructions(request), /sans recopier une identité/);
    if (kind === "video") {
      const provider = buildAiMediaVideoReferenceContract({ request });
      assert.match(provider, /#1:inspiration\/required/);
      assert.match(provider, /required uncategorized media/);
      assert.doesNotMatch(provider, /inspiration-only/);
    }
  }
});

test("the explicit Inspiration choice changes only fidelity and reaches the provider as optional", () => {
  for (const role of ["inspiration", "product", "environment"] as const) {
    for (const usage of ["required", "inspiration"] as const) {
      const request = normalizeAiMediaGenerationRequest({ ...base, kind: "video", videoEngine: "wan27", videoResolution: "720p",
        durationSeconds: 8, sceneMode: "single", inspirationImages: [{ mimeType: "image/png", data, role, usage }],
      });
      assert.equal(request.inspirationImages[0]?.role, role);
      assert.equal(request.inspirationImages[0]?.usage, usage);
      assert.ok(buildAiMediaVideoReferenceContract({ request }).includes(`#1:${role}/${usage}`));
      assert.equal(buildAiMediaVideoReferenceContract({ request }).includes("inspiration-only"), usage === "inspiration");
    }
  }
});

test("free references still require explicit valid role and usage, and images-only input", () => {
  const reference = { mimeType: "image/png", data, role: "inspiration", usage: "required" };
  for (const invalid of [{ ...reference, role: undefined }, { ...reference, usage: undefined },
    { ...reference, usage: "mandatory" }, { ...reference, role: "video" }, { ...reference, mimeType: "video/mp4" }]) {
    assert.throws(() => normalizeAiMediaGenerationRequest({ ...base, kind: "image", imageEngine: "openai", inspirationImages: [invalid] }));
  }
});

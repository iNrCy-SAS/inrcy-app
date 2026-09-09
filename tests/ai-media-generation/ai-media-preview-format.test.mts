import assert from "node:assert/strict";
import test from "node:test";

import { resolveAiMediaPreviewFormat } from "../../lib/aiMediaGenerationContracts.ts";

test("le bilan choisit un cadre conforme aux dimensions du média généré", () => {
  assert.equal(
    resolveAiMediaPreviewFormat({ width: 1080, height: 1080, fallback: "story" }),
    "square",
  );
  assert.equal(
    resolveAiMediaPreviewFormat({ width: 1080, height: 1350, fallback: "square" }),
    "portrait",
  );
  assert.equal(
    resolveAiMediaPreviewFormat({ width: 1080, height: 1920, fallback: "square" }),
    "story",
  );
  assert.equal(
    resolveAiMediaPreviewFormat({ width: 1920, height: 1080, fallback: "square" }),
    "landscape",
  );
});

test("le bilan conserve le format demandé quand les métadonnées manquent", () => {
  assert.equal(
    resolveAiMediaPreviewFormat({ width: null, height: null, fallback: "portrait" }),
    "portrait",
  );
  assert.equal(
    resolveAiMediaPreviewFormat({ width: 0, height: 0, fallback: "landscape" }),
    "landscape",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "app/dashboard/_components/MediaGenerator.tsx",
  "utf8",
);

test("le Studio démarre sans personnage obligatoire", () => {
  assert.match(
    source,
    /useState<StudioCharacterCount>\(0\)/,
  );
  assert.match(
    source,
    /setMediaSourceMode\("ai"\);[\s\S]*?setRealCharacterCount\(0\);/,
  );
});

test("un décor ou un produit seul ne crée pas de personnage implicite", () => {
  assert.match(
    source,
    /const characterReferences = inspirationImages\.filter\([\s\S]*?image\.role === "character" && image\.usage !== "inspiration"/,
  );
  assert.match(
    source,
    /effectiveCharacterCount === 0\s*\? "auto"/,
  );
  assert.match(source, /const setReferenceRole = \([\s\S]*?normalizeCharacterReferenceIndexes\(next\)/);
});

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

test("un décor ou un produit seul rebascule la scène sans personnage", () => {
  assert.match(
    source,
    /role !== "character" && characterReferences\.length === 0[\s\S]*?setRealCharacterCount\(0\)/,
  );
  assert.match(
    source,
    /role === "character"[\s\S]*?Boolean\(environmentReference \|\| productReference\)[\s\S]*?setRealCharacterCount\(0\)/,
  );
});

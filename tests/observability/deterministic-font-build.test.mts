import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const layoutSource = readFileSync(
  new URL("../../app/layout.tsx", import.meta.url),
  "utf8",
);

test("the root layout does not fetch Google Fonts during the build", () => {
  assert.doesNotMatch(layoutSource, /next\/font\/google/);
  assert.match(layoutSource, /<body className="antialiased"/);
});

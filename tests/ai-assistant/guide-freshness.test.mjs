import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ASSISTANT_GUIDE_REVIEW_PATH, readAssistantGuideReviewInventory, verifyAssistantGuideReviews } from "../../scripts/build-assistant-code-index.mjs";

function fixture(t) {
  const prefix = join(tmpdir(), "inrcy-guide-review-");
  const root = mkdtempSync(prefix);
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(prefix)), "Only remove this generated test fixture.");
    rmSync(root, { recursive: true, force: true });
  });
  for (const directory of ["lib", "app/dashboard", "scripts"]) mkdirSync(join(root, directory), { recursive: true });
  const guide = { id: "reviews", title: "Avis Google", keywords: ["avis"], content: "Mes canaux → Google Business → Avis.", sourceFiles: ["app/dashboard/page.tsx"] };
  const writeGuides = (guides = [guide]) => writeFileSync(join(root, "lib/inrAssistantAppGuides.ts"), `export const INR_ASSISTANT_APP_GUIDES = ${JSON.stringify(guides)};\n`);
  writeGuides();
  writeFileSync(join(root, "app/dashboard/page.tsx"), 'export const reviewsButton = "Avis";\n');
  return { root, guide, writeGuides };
}

test("global index regeneration cannot implicitly approve changed UI sources", (t) => {
  const { root } = fixture(t);
  assert.throws(() => verifyAssistantGuideReviews(root), /review is stale.*reviews/);
  verifyAssistantGuideReviews(root, "all");
  const reviewed = readFileSync(join(root, ASSISTANT_GUIDE_REVIEW_PATH), "utf8");
  writeFileSync(join(root, "app/dashboard/page.tsx"), 'export const reviewsButton = "Moved reviews";\n');
  assert.throws(() => verifyAssistantGuideReviews(root), /--write alone cannot revalidate/);
  assert.equal(readFileSync(join(root, ASSISTANT_GUIDE_REVIEW_PATH), "utf8"), reviewed, "A normal check never refreshes review fingerprints.");
  assert.equal(verifyAssistantGuideReviews(root, "reviews").current, true);
});

test("guide edits require review while unrelated source changes do not", (t) => {
  const { root, guide, writeGuides } = fixture(t);
  verifyAssistantGuideReviews(root, "all");
  writeFileSync(join(root, "app/dashboard/unrelated.ts"), 'export const other = "another feature";\n');
  assert.equal(verifyAssistantGuideReviews(root).current, true);
  writeGuides([{ ...guide, content: "Menu → Réputation." }]);
  assert.throws(() => verifyAssistantGuideReviews(root), /changed or unreviewed: reviews/);
});

test("guide removals and invalid review ids require explicit acknowledgement", (t) => {
  const { root, guide, writeGuides } = fixture(t);
  writeGuides([guide, { ...guide, id: "old-guide" }]);
  verifyAssistantGuideReviews(root, "all");
  writeGuides();
  assert.throws(() => verifyAssistantGuideReviews(root, "reviews"), /removed: old-guide/);
  assert.throws(() => verifyAssistantGuideReviews(root, "missing-guide"), /comma-separated list/);
  assert.equal(verifyAssistantGuideReviews(root, "all").current, true);
});

test("review fingerprints normalize line endings and never admit arbitrary paths or globals", (t) => {
  const { root, guide, writeGuides } = fixture(t);
  const first = readAssistantGuideReviewInventory(root);
  writeFileSync(join(root, "app/dashboard/page.tsx"), 'export const reviewsButton = "Avis";\r\n');
  assert.deepEqual(readAssistantGuideReviewInventory(root), first);
  writeGuides([{ ...guide, sourceFiles: ["../.env.local"] }]);
  assert.throws(() => readAssistantGuideReviewInventory(root), /Invalid review source/);
  writeFileSync(join(root, "lib/inrAssistantAppGuides.ts"), "export const INR_ASSISTANT_APP_GUIDES = process.env;\n");
  assert.throws(() => readAssistantGuideReviewInventory(root), /process is not defined/);
});

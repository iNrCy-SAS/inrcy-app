import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSavedDraft } from "../../lib/reconcileSavedDraft.ts";

test("a late save keeps newer tags and rich text while applying unrelated server enrichments", () => {
  const submitted = { tags: ["Initial"], richText: { mission: "<p>Mission</p>", strategy: "<p>Stratégie</p>" }, city: "Arras" };
  const current = { tags: ["Initial", "Ajout pendant la requête"], richText: { mission: "<p><strong>Mission</strong></p>", strategy: "<p>Stratégie</p>" }, city: "Arras" };
  const persisted = { tags: ["Initial"], richText: { mission: "<p>Mission</p>", strategy: "<p>Stratégie analysée</p>" }, city: "Lens" };
  assert.deepEqual(reconcileSavedDraft(submitted, current, persisted), {
    tags: current.tags, richText: { mission: current.richText.mission, strategy: persisted.richText.strategy }, city: "Lens",
  });
});

test("a newly selected logo file remains pending when the previous logo finishes saving", () => {
  const first = new File(["first"], "logo.png", { type: "image/png", lastModified: 1 });
  const next = new File(["other"], "logo.png", { type: "image/png", lastModified: 1 });
  const submitted = { name: "Atelier", file: first as File | null, preview: "blob:first", path: "old-path" };
  const current = { name: "Nouvel atelier", file: next as File | null, preview: "blob:other", path: "old-path" };
  const persisted = { name: "Atelier", file: null as File | null, preview: "https://logo.invalid/first", path: "stored-first" };
  const reconciled = reconcileSavedDraft(submitted, current, persisted);
  assert.equal(reconciled.name, current.name);
  assert.equal(reconciled.file, next);
  assert.equal(reconciled.preview, current.preview);
  assert.equal(reconciled.path, persisted.path);
});

test("unchanged fields adopt the persisted value and explicit newer clears are retained", () => {
  const submitted = { title: "Before", tags: ["One"], text: "Some text" };
  const current = { title: "Before", tags: ["One"], text: "" };
  const persisted = { title: "Normalized", tags: ["One", "Analyzed"], text: "Some text" };
  assert.deepEqual(reconcileSavedDraft(submitted, current, persisted), { title: "Normalized", tags: persisted.tags, text: "" });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanBasicSurfaceCandidates, namedBasicRegressionExists } from "../../scripts/assistant-basic-coverage.mjs";

type Surface = { id: string; label: string; sourceFiles: string[]; sourceAnchor: string; capabilityId: string; toolNames: string[]; mode: string; controlIds?: string[]; coverageStatus: string; notes: string; handoffReason?: string; testFiles: string[]; testAnchor: string };
type Scope = { disposition: string; exclusions?: Record<string, { reason: string; gateAnchor: string }> };
const root = fileURLToPath(new URL("../../", import.meta.url));
const normalized = (source: string) => source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
const rows = JSON.parse(readFileSync(resolve(root, "scripts/assistant-basic-surfaces-media.json"), "utf8")) as Surface[];
const scopes = JSON.parse(readFileSync(resolve(root, "scripts/assistant-basic-file-scope-media.json"), "utf8")) as Record<string, Scope>;

test("media surface inventory preserves native anchors and distinguishes local forms from executed tools", () => {
  const seen = new Set<string>();
  for (const row of rows) {
    assert.ok(row.label.trim() && row.notes.trim(), row.id);
    assert.ok(row.sourceFiles.some(file => normalized(readFileSync(resolve(root, file), "utf8")).includes(row.sourceAnchor)), row.id);
    assert.ok(row.testFiles.some(file => namedBasicRegressionExists(readFileSync(resolve(root, file), "utf8"), row.testAnchor)), row.id);
    for (const id of row.controlIds ?? []) { assert.equal(seen.has(id), false, id); seen.add(id); }
    if (row.coverageStatus === "gap") { assert.equal(row.mode, "form", row.id); assert.match(row.notes, /Écart|écart/); }
    if (row.mode === "handoff") assert.ok(row.handoffReason?.trim(), row.id);
    assert.ok(["implemented", "server_equivalent", "human_required", "gap"].includes(row.coverageStatus), row.id);
    assert.doesNotMatch(row.notes, /fournisseur réel certifié|100% autonome|100 % autonome/i);
  }
  const current = scanBasicSurfaceCandidates(root) as Array<{ file: string; controls: Array<{ id: string }> }>;
  for (const file of current.filter(file => scopes[file.file]?.disposition === "basic")) for (const control of file.controls) {
    assert.ok(seen.has(control.id) || scopes[file.file].exclusions?.[control.id], control.id);
  }
});

test("media surface scope keeps paid controls excluded and finite visibility-index choices explicit", () => {
  const excluded = Object.entries(scopes).flatMap(([file, review]) => Object.values(review.exclusions ?? {}).map(exclusion => ({ file, ...exclusion })));
  for (const exclusion of excluded) assert.ok(normalized(readFileSync(resolve(root, exclusion.file), "utf8")).includes(exclusion.gateAnchor));
  assert.ok(excluded.some(exclusion => /bilan.*Basique/.test(exclusion.reason)));
  assert.ok(excluded.some(exclusion => /Premium\/Founder/.test(exclusion.reason)));
  assert.equal(scopes["app/dashboard/_components/MediaReferenceInputs.tsx"].disposition, "out_of_pack", "the single Agent settings reference consumer is gated upstream for Basic");
  for (const months of [1, 3, 6, 12]) {
    const row = rows.find(row => row.id === `basic.stats.index-period-${months}`);
    assert.ok(row); assert.deepEqual(row.toolNames, ["runScreenCommand"]); assert.match(row.notes, /verrou|verrouill/); assert.equal(row.coverageStatus, "implemented");
  }
});

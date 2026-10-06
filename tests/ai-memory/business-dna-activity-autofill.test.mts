import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildMissingBusinessDnaProfession,
  resolveBusinessDnaProfessionSuggestion,
} from "../../lib/businessDnaActivityAutofill.ts";
import { decodeBusinessSector } from "../../lib/activitySectors.ts";

const source = [
  {
    status: "analyzed",
    content: "Notre atelier réalise la torréfaction artisanale du café et vend des cafés en grains.",
  },
];
const proposal = {
  sectorCategory: "commerce_boutique",
  job: "torrefacteur",
  sourceQuote: "torréfaction artisanale du café",
  confidence: "high",
};

test("ADN classifies a proven catalogue profession and leaves the professional free to edit it", () => {
  const suggested = resolveBusinessDnaProfessionSuggestion(proposal, source);
  assert.deepEqual(suggested, {
    sectorCategory: "commerce_boutique",
    job: "torrefacteur",
  });
  const stored = buildMissingBusinessDnaProfession("", suggested);
  assert.deepEqual(decodeBusinessSector(stored), {
    sectorCategory: "commerce_boutique",
    profession: "Torréfacteur",
  });
  assert.equal(
    buildMissingBusinessDnaProfession("[[SECTOR:commerce_boutique]] Fleuriste", suggested),
    null,
  );
  assert.equal(buildMissingBusinessDnaProfession("[[SECTOR:autre]] Métier libre", suggested), null);
});

test("ADN does not trust a catalogue match without literal source evidence", () => {
  assert.equal(resolveBusinessDnaProfessionSuggestion(proposal, [{ status: "failed", content: source[0].content }]), null);
  assert.equal(resolveBusinessDnaProfessionSuggestion({ ...proposal, sourceQuote: "Atelier de joaillerie" }, source), null);
  assert.equal(resolveBusinessDnaProfessionSuggestion({ ...proposal, confidence: "uncertain" }, source), null);
  assert.equal(resolveBusinessDnaProfessionSuggestion({ ...proposal, job: "unknown" }, source), null);
  assert.equal(resolveBusinessDnaProfessionSuggestion({ ...proposal, sectorCategory: "autre" }, source), null);
});

test("the manual and scheduled analysis paths save the profession only when still missing", () => {
  const route = readFileSync(new URL("../../app/api/ai-memory/analyze-channels/route.ts", import.meta.url), "utf8");
  const save = readFileSync(new URL("../../app/api/ai-memory/route.ts", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../../app/dashboard/settings/_components/AiMemoryContent.tsx", import.meta.url), "utf8");
  assert.match(route, /professionSuggestion:[\s\S]*sourceQuote:[\s\S]*confidence:/);
  assert.match(route, /suggestion: \{[\s\S]*profession: suggestedProfession/);
  assert.match(route, /const priorSector = latestBusinessResult\.data\?\.sector/);
  assert.match(route, /professionUpdate = priorSector === null[\s\S]*\.is\("sector", null\)/);
  assert.match(editor, /activityProfessionSuggestion: draft\.profession/);
  assert.match(save, /buildMissingBusinessDnaProfession\([\s\S]*input\.activityProfessionSuggestion/);
  assert.match(save, /professionUpdate = previousSector === null[\s\S]*\.is\("sector", null\)/);
});

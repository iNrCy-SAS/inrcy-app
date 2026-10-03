import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { chooseInrAgentInstantFocusMode } from "../../lib/inrAgentInstantFocusMode.ts";

const route = readFileSync(new URL(
  "../../app/api/agent/actions/prepare-publish/route.ts",
  import.meta.url,
), "utf8");

test("un éclair tire à parts égales entre une idée disponible et l'iNr'ADN", () => {
  assert.equal(chooseInrAgentInstantFocusMode(3, 0), "saved_idea");
  assert.equal(chooseInrAgentInstantFocusMode(3, 1), "business_dna");
  assert.match(route, /chooseInrAgentInstantFocusMode\(availableIdeas\.length, randomInt\(2\)\)/);
  assert.match(route, /const focusMode = isCron\s*\? "saved_idea"/);
});

test("sans idée active et non réservée, l'éclair utilise toujours l'iNr'ADN", () => {
  assert.equal(chooseInrAgentInstantFocusMode(0, 0), "business_dna");
  assert.equal(chooseInrAgentInstantFocusMode(0, 1), "business_dna");
  assert.match(route, /\.filter\(\(row\) => row\.status === "active" && !row\.reserved_action_id\)/);
  assert.match(route, /runtimeFocus \|\|= buildInstantFocus\(\[\]\)/);
});

test("le brouillon éclair n'a aucune programmation implicite", () => {
  assert.match(route, /const readyEditorialPlan = editorialTarget\s*\?/);
  assert.match(route, /\.\.\.\(readyEditorialPlan \? \{ editorialPlan: readyEditorialPlan \} : \{\}\)/);
  assert.match(route, /scheduled_for: editorialTarget\?\.plan\.scheduledFor \|\| null/);
});

test("une idée instantanée n'est réservée que si tirée et libérée sur échec", () => {
  assert.match(route, /if \(focusMode === "saved_idea"\) \{\s*while \(availableIdeas\.length\)/);
  assert.match(route, /reservedInstantIdea = true/);
  assert.match(route, /finally \{[\s\S]*?if \(reservedInstantIdea && instantActionId\) \{\s*await releaseInrAgentPublicationIdea/);
});

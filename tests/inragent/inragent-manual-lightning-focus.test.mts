import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { chooseInrAgentInstantFocusMode } from "../../lib/inrAgentInstantFocusMode.ts";

const route = readFileSync(new URL(
  "../../app/api/agent/actions/prepare-publish/route.ts",
  import.meta.url,
), "utf8");

test("un éclair tire à parts égales entre une idée disponible et l'iNr'ADN", () => {
  assert.equal(chooseInrAgentInstantFocusMode(3, 0), "saved_idea");
  assert.equal(chooseInrAgentInstantFocusMode(3, 1), "business_dna");
  assert.match(route, /chooseInrAgentInstantFocusMode\(availableIdeaRows\.length, randomInt\(2\)\)/);
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
  assert.match(route, /if \(focusMode === "saved_idea" && !prefersExistingMedia\) \{\s*const claimedFocus = await claimFirstAvailableInrAgentIdea\(/);
  assert.match(route, /claim: \(ideaText\) => claimInrAgentPublicationIdea\(/);
  assert.match(route, /reservedInstantIdea = true/);
  assert.match(route, /finally \{[\s\S]*?if \(reservedInstantIdea && instantActionId\) \{\s*await releaseInrAgentPublicationIdea/);
});

for (const source of ["media_library", "image_bank"]) {
  for (const planned of [false, true]) {
    test(`${source}: ${planned ? "un créneau" : "un éclair"} ne réserve aucune idée avant la lecture du fichier`, async () => {
      const ast = ts.createSourceFile("route.ts", route, ts.ScriptTarget.Latest, true);
      const post = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
      assert.ok(post && ts.isFunctionDeclaration(post) && post.body);
      const indexOf = (name: string) => post.body!.statements.findIndex((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === name));
      const start = indexOf("prefersExistingMedia"), end = indexOf("baseIdea");
      assert.ok(start >= 0 && end > start);
      const body = post.body.statements.slice(start, end).map((node) => node.getText(ast)).join("\n");
      const code = ts.transpileModule(`async function run(){${body};return runtimeFocus;}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const forbidden = () => { throw new Error("An existing file must not claim or require a preplanned idea"); };
      const scope = {
        automation: { useImageBank: true, preferredMediaSource: source },
        editorialTarget: planned ? { plan: { focus: { source: "professional_idea", subject: "Massage des pieds" } } } : null,
        instantActionId: planned ? null : "instant", isCron: true,
        ideaRows: [{ status: "disabled", idea_text: "Massage des pieds" }],
        buildInstantFocus: () => ({ source: "business_dna", subject: "Contexte général" }),
        matchingInrAgentPublicationIdeaRow: forbidden, claimFirstAvailableInrAgentIdea: forbidden,
      };
      const result = await new Function(...Object.keys(scope), `${code};return run();`)(...Object.values(scope));
      assert.notEqual(result?.source, "professional_idea");
      assert.notEqual(result?.subject, "Massage des pieds");
    });
  }
}

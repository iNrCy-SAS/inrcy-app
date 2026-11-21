import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { isInrAgentEditorialPreparationRunning } from "../../app/dashboard/agent/_lib/agent.utils.ts";

const styles = readFileSync(
  new URL("../../app/dashboard/agent/agent.module.css", import.meta.url),
  "utf8",
);
const client = readFileSync(
  new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url),
  "utf8",
);
const controller = readFileSync(
  new URL(
    "../../app/dashboard/agent/_hooks/useAgentAutomationController.ts",
    import.meta.url,
  ),
  "utf8",
);

const editorialAction = (status: string, state: string) => ({
  status,
  payload: {
    editorialPlan: { state },
  },
});

test("iNrAgent travaille uniquement pendant une exécution éditoriale réelle", () => {
  assert.equal(
    isInrAgentEditorialPreparationRunning(
      editorialAction("executing", "queued"),
    ),
    true,
  );

  for (const action of [
    editorialAction("draft", "queued"),
    editorialAction("draft", "retry"),
    editorialAction("failed", "queued"),
    editorialAction("failed", "failed"),
    editorialAction("pending_validation", "ready"),
  ]) {
    assert.equal(isInrAgentEditorialPreparationRunning(action), false);
  }

  assert.equal(
    isInrAgentEditorialPreparationRunning({
      status: "executing",
      payload: {},
    }),
    false,
  );
});

test("le texte de travail reste contenu dans le cadre du robot", () => {
  assert.match(
    styles,
    /\.robotWorkingBadge \{[\s\S]*?overflow: hidden;/,
  );
  assert.match(
    styles,
    /\.robotWorkingBadge > span:last-child \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/,
  );
  assert.match(
    styles,
    /\.robotWorkingBadge strong,[\s\S]*?\.robotWorkingBadge small \{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/,
  );
});

test("la roulette affiche la progression estimée sans annoncer 100 % avant la réussite", () => {
  assert.match(
    client,
    /className=\{styles\.robotWorkingProgress\}[\s\S]*?\{normalizedProgress\}%/,
  );
  assert.equal(
    (client.match(/progress=\{isInstantPublicationPreview \? prepareProgress\?\.percent : undefined\}/g) || []).length,
    1,
  );
  assert.match(
    styles,
    /\.robotWorkingSpinner::before \{[\s\S]*?animation: agentWorkingSpin/,
  );
  assert.match(
    styles,
    /\.robotWorkingProgress \{[\s\S]*?font-variant-numeric: tabular-nums/,
  );
  const ast = ts.createSourceFile("AgentClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let status: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "workspaceStatus") status = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(status, "the shared workspace status must include the actual working progression");
  const readStatus = new Function("isInstantPublicationPreview", "loadState", "agentWorking", "agentWorkingLabel", "prepareProgress", "showEditorialCronWait", "workspace", "i18nT", `return (${status.getText(ast)});`);
  for (const workspace of ["publications", "campaigns", "stats"]) {
    assert.equal(readStatus(false, "ready", true, "Préparation", { percent: 37 }, false, workspace, (key: string) => key), "Préparation · 37%");
    assert.equal(readStatus(false, "ready", true, "Préparation", null, false, workspace, (key: string) => key), "Préparation");
  }
  assert.match(client, /status=\{isPublishView \? undefined : workspaceStatus\}/, "other workspaces retain the shared status in the header");
  assert.match(client, /className=\{styles\.publicationInfoBand\}[\s\S]*?<span role="status">\{workspaceStatus\}<\/span>/, "publication progression appears in the single info band");
  assert.match(controller, /current\.percent >= 99/);
  assert.match(controller, /Math\.min\(99, current\.percent \+ increment\)/);
  assert.match(
    controller,
    /percent: completed \? 100 : Math\.min\(99, current\.percent\)/,
  );
});

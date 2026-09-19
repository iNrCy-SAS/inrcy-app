import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isInrAgentEditorialPreparationRunning } from "../../app/dashboard/agent/_lib/agent.utils.ts";

const styles = readFileSync(
  new URL("../../app/dashboard/agent/agent.module.css", import.meta.url),
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

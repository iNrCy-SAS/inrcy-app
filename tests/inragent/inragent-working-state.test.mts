import assert from "node:assert/strict";
import test from "node:test";

import { isInrAgentEditorialPreparationRunning } from "../../app/dashboard/agent/_lib/agent.utils.ts";

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

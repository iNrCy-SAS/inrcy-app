import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isInrAgentEditorialPreparationRunning,
  isInrAgentEditorialPreparationWaitingForCron,
} from "../../app/dashboard/agent/_lib/agent.utils.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function editorialAction(status: string, state: string) {
  return {
    automationKey: "publish",
    actionType: "publication",
    status,
    payload: { editorialPlan: { state } },
  };
}

test("l’attente cron ne couvre que les publications éditoriales réellement en file", () => {
  for (const state of ["draft", "queued", "retry"]) {
    assert.equal(
      isInrAgentEditorialPreparationWaitingForCron(
        editorialAction("draft", state),
      ),
      true,
    );
  }

  for (const action of [
    editorialAction("executing", "generating"),
    editorialAction("pending_validation", "ready"),
    editorialAction("draft", "ready"),
    editorialAction("failed", "failed"),
    {
      ...editorialAction("draft", "queued"),
      automationKey: "grow",
    },
  ]) {
    assert.equal(isInrAgentEditorialPreparationWaitingForCron(action), false);
  }
});

test("une génération active masque l’attente et une validation utilisateur ne la déclenche pas", () => {
  const queued = editorialAction("draft", "queued");
  const generating = editorialAction("executing", "generating");
  const awaitingValidation = editorialAction("pending_validation", "ready");

  assert.equal(isInrAgentEditorialPreparationRunning(generating), true);
  assert.equal(isInrAgentEditorialPreparationRunning(queued), false);
  assert.equal(
    isInrAgentEditorialPreparationWaitingForCron(awaitingValidation),
    false,
  );
});

test("le client dérive le badge de la liste d’actions sans ajouter de polling", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const styles = read("app/dashboard/agent/agent.module.css");

  assert.match(
    client,
    /const editorialGenerationActive = actions\.some\([\s\S]*?isInrAgentEditorialPreparationRunning/,
  );
  assert.match(
    client,
    /const editorialQueueWaitingForCron = actions\.some\([\s\S]*?isInrAgentEditorialPreparationWaitingForCron/,
  );
  assert.match(
    client,
    /!agentWorking\s*&&\s*!editorialGenerationActive\s*&&\s*editorialQueueWaitingForCron/,
  );
  assert.equal(
    (
      client.match(
        /next_editorial_publication_in_a_few_minutes/g,
      ) || []
    ).length,
    2,
  );
  assert.match(styles, /\.robotCronWaitBadge \{[\s\S]*?position: absolute;/);
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.robotCronWaitBadge/,
  );
  assert.match(
    styles,
    /\.robotCronWaitBadge > span:last-child \{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: break-word;/,
  );
  assert.doesNotMatch(
    client,
    /setInterval\([^)]*next_editorial_publication_in_a_few_minutes/,
  );
});

test("les neuf catalogues traduisent le message d’attente", () => {
  for (const locale of [
    "de-DE",
    "en-GB",
    "es-ES",
    "fr-FR",
    "it-IT",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const catalogue = JSON.parse(read(`messages/${locale}/agent.json`)) as Record<
      string,
      string
    >;
    assert.ok(
      catalogue.next_editorial_publication_in_a_few_minutes?.trim(),
      `${locale} doit traduire le message d’attente`,
    );
  }
});

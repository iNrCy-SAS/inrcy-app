import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INR_AGENT_PUBLICATION_IDEA_INITIAL_ITEMS,
  INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS,
  appendInrAgentPublicationIdeaSlot,
  inrAgentPublicationIdeaFieldCount,
  normalizeInrAgentPublicationIdeas,
  sanitizeInrAgentAutomationSettings,
} from "../../lib/inrAgentSettings.ts";

const agentClient = readFileSync(
  new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url),
  "utf8",
);
const preparePublishRoute = readFileSync(
  new URL(
    "../../app/api/agent/actions/prepare-publish/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("iNrAgent starts with 6 idea fields and enforces a strict maximum of 12", () => {
  assert.equal(INR_AGENT_PUBLICATION_IDEA_INITIAL_ITEMS, 6);
  assert.equal(INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS, 12);
  assert.equal(inrAgentPublicationIdeaFieldCount([]), 6);
  assert.equal(inrAgentPublicationIdeaFieldCount(Array(9).fill("")), 9);
  assert.equal(inrAgentPublicationIdeaFieldCount(Array(18).fill("")), 12);
});

test("adding a field preserves every existing idea and stops at 12", () => {
  const initial = ["Idée A", "Idée B"];
  const seventhSlot = appendInrAgentPublicationIdeaSlot(initial);
  assert.equal(seventhSlot.length, 7);
  assert.deepEqual(seventhSlot.slice(0, 2), initial);

  const elevenIdeas = Array.from({ length: 11 }, (_, index) => `Idée ${index + 1}`);
  const twelveIdeas = appendInrAgentPublicationIdeaSlot(elevenIdeas);
  assert.equal(twelveIdeas.length, 12);
  assert.deepEqual(twelveIdeas.slice(0, 11), elevenIdeas);

  const capped = appendInrAgentPublicationIdeaSlot([
    ...twelveIdeas,
    "Cette idée ne doit jamais être ajoutée",
  ]);
  assert.equal(capped.length, 12);
  assert.equal(
    capped.includes("Cette idée ne doit jamais être ajoutée"),
    false,
  );
});

test("the settings sanitizer and reload path preserve all 12 idea slots", () => {
  const rawIdeas = Array.from(
    { length: 14 },
    (_, index) => `  Sujet ${index + 1}\u0000  `,
  );
  const normalized = normalizeInrAgentPublicationIdeas(rawIdeas);
  assert.equal(normalized.length, 12);
  assert.equal(normalized[0], "Sujet 1");
  assert.equal(normalized[11], "Sujet 12");

  const saved = sanitizeInrAgentAutomationSettings("publish", {
    metadata: { publicationIdeas: rawIdeas },
  });
  const reloaded = normalizeInrAgentPublicationIdeas(
    saved.metadata.publicationIdeas,
  );
  assert.deepEqual(reloaded, normalized);
  assert.equal(inrAgentPublicationIdeaFieldCount(reloaded), 12);
});

test("the UI adds fields progressively and the publication prompt consumes non-empty saved ideas", () => {
  assert.match(agentClient, /publicationIdeasAddButton/);
  assert.match(
    agentClient,
    /appendInrAgentPublicationIdeaSlot\(\s*settingsConfig\.publicationIdeas/,
  );
  assert.match(
    agentClient,
    /settingsPublicationIdeaFieldCount\s*>=\s*INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS/,
  );
  assert.match(
    preparePublishRoute,
    /normalizeInrAgentPublicationIdeas\([\s\S]*?\)\.filter\(Boolean\)/,
  );
});

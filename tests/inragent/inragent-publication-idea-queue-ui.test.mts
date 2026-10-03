import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/agent/publication-ideas/route.ts", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../../lib/inrAgentPublicationIdeaLifecycle.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL(
  "../../supabase/migrations/20261003201545_inr_agent_publication_idea_queue.sql",
  import.meta.url,
), "utf8");

test("les cartes affichent une aide condensée et se déplacent comme les médias Booster", () => {
  assert.match(client, /<details className=\{styles\.publicationIdeasHelp\}>/);
  assert.match(client, /publication_ideas_help_consumption/);
  assert.match(client, /publication_ideas_help_fallback/);
  assert.match(client, /draggable=\{canReorder\}/);
  assert.match(client, /onDrop=\{\(event\) => \{/);
  assert.match(client, /publication_idea_move_previous/);
  assert.match(client, /publication_idea_move_next/);
});

test("le déplacement manuel persiste la file et la lecture la restitue dans cet ordre", () => {
  assert.match(client, /method: "PUT"[\s\S]*?ideaTexts/);
  assert.match(route, /inrcy_reorder_inr_agent_publication_ideas/);
  assert.match(route, /export const PUT = withApi/);
  assert.match(lifecycle, /\.order\("order_key", \{ ascending: true \}\)/);
  assert.match(migration, /new\.order_key := nextval/);
  assert.match(migration, /if new\.status is distinct from old\.status[\s\S]*?new\.status in \('disabled', 'used'\)/);
});

test("l’ampoule ouvre un espace Idées avec une sauvegarde distincte des réglages", () => {
  assert.match(client, /className=\{styles\.ideasActionButton\}/);
  assert.match(client, /setPublicationIdeasOpen\(true\)/);
  assert.match(client, /onClick=\{publicationIdeasOpen \? savePublicationIdeas : saveSettings\}/);
  assert.match(client, /method: "PATCH"[\s\S]*?publicationIdeas: publicationIdeasDraft/);
  assert.match(client, /publicationIdeasOpen\s*\? i18nT\("publication_ideas_save"\)/);
  assert.doesNotMatch(client, /settingsPublishTab/);
  assert.match(route, /async function patchHandler\(request: Request\)/);
  assert.match(route, /\.update\(\{ metadata, updated_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(route, /export const PATCH = withApi/);
});

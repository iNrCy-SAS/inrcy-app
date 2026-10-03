import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const locales = ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const keys = [
  "publication_ideas_load_failed", "publication_idea_invalid", "publication_idea_not_saved",
  "publication_idea_update_failed", "publication_idea_unavailable",
  "publication_idea_state_used", "publication_idea_state_disabled", "publication_idea_state_reserved",
  "publication_idea_state_active", "publication_idea_state_loading", "publication_idea_state_unsaved",
  "publication_idea_disable", "publication_idea_reactivate", "publication_idea_reuse",
  "publication_idea_disable_aria", "publication_idea_reactivate_aria", "publication_idea_reuse_aria",
  "publication_ideas_reset", "publication_ideas_reset_hint",
];

test("les neuf langues décrivent l'état et la réutilisation explicite des idées", () => {
  for (const locale of locales) {
    const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}/agent.json`, import.meta.url), "utf8"));
    for (const key of keys) {
      assert.equal(typeof messages[key], "string", `${locale}: ${key}`);
      assert.ok(messages[key].length > 0, `${locale}: ${key}`);
    }
    for (const key of ["publication_idea_disable_aria", "publication_idea_reactivate_aria", "publication_idea_reuse_aria"]) {
      assert.match(messages[key], /\{number\}/, `${locale}: ${key}`);
    }
  }
  const fr = JSON.parse(readFileSync(new URL("../../messages/fr-FR/agent.json", import.meta.url), "utf8"));
  assert.equal(fr.publication_idea_reuse, "Réutiliser cette idée");
});

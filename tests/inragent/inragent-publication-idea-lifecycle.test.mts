import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildInrAgentEditorialFocusPlan } from "../../lib/inrAgentEditorialVariation.ts";
import { wasInrAgentPublicationIdeaPreviouslyGenerated } from "../../lib/inrAgentPublicationIdeaReuse.ts";

const ideas = [
  "Isolation des combles",
  "Entretien de la toiture",
  "Conseils pour la ventilation",
];

function focusFor(seed: string, publicationIdeas = ideas) {
  return buildInrAgentEditorialFocusPlan({
    slots: [{ slotKey: seed, sequence: 1, theme: "conseils" }],
    publicationIdeas,
    allowPreviouslyCoveredPublicationIdeas: true,
    historicalSubjects: ideas,
    seed: "lifecycle-test",
  })[0].focus;
}

test("les idées suivent l'ordre choisi et restent stables pour les retries", () => {
  for (let index = 0; index < 30; index += 1) {
    const slotKey = `slot-${index}`;
    const first = focusFor(slotKey);
    assert.deepEqual(focusFor(slotKey), first);
    assert.equal(first.source, "professional_idea");
    assert.equal(first.subject, ideas[0]);
  }
  const reordered = [ideas[2], ideas[0], ideas[1]];
  const plan = buildInrAgentEditorialFocusPlan({
    slots: [
      { slotKey: "first", sequence: 1, theme: "conseils" },
      { slotKey: "second", sequence: 2, theme: "conseils" },
      { slotKey: "third", sequence: 3, theme: "conseils" },
    ],
    publicationIdeas: reordered,
    allowPreviouslyCoveredPublicationIdeas: true,
  });
  assert.deepEqual(plan.map((slot) => slot.focus.subject), reordered);
});

test("une idée désactivée part en fin de file et sa réactivation ne change pas sa position", () => {
  const initial = [...ideas];
  const afterFirstUse = [...initial.slice(1), initial[0]];
  const afterSecondUse = [...afterFirstUse.slice(1), afterFirstUse[0]];
  assert.deepEqual(afterFirstUse, [ideas[1], ideas[2], ideas[0]]);
  assert.deepEqual(afterSecondUse, [ideas[2], ideas[0], ideas[1]]);
  assert.equal(focusFor("next", afterSecondUse.filter((idea) => idea !== ideas[0])).subject, ideas[2]);
  assert.equal(focusFor("reactivated", afterSecondUse).subject, ideas[2]);
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20261003201545_inr_agent_publication_idea_queue.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /new\.status in \('disabled', 'used'\)/);
  assert.match(sql, /new\.order_key := nextval/);
  assert.match(sql, /before update of status on public\.inr_agent_publication_ideas/);
  assert.match(sql, /inrcy_reorder_inr_agent_publication_ideas/);
});

test("une idée réactivée peut revenir malgré une publication antérieure", () => {
  assert.equal(focusFor("reactivated", [ideas[0]]).subject, ideas[0]);
  assert.notEqual(focusFor("reserved", ideas.slice(1)).subject, ideas[0]);
  assert.notEqual(focusFor("none", []).source, "professional_idea");

  const previousFocus = focusFor("old", [ideas[0]]);
  const plan = buildInrAgentEditorialFocusPlan({
    slots: [
      { slotKey: "old", sequence: 1, theme: "conseils" },
      { slotKey: "new", sequence: 2, theme: "conseils" },
    ],
    publicationIdeas: [ideas[0]],
    allowPreviouslyCoveredPublicationIdeas: true,
    reusableExistingManualIdeas: [ideas[0]],
    existingFocusBySlotKey: new Map([["old", previousFocus]]),
  });
  assert.equal(plan[1].focus.subject, ideas[0]);
});

test("la consommation est atomique avec l'action prête et l'annulation libère la réservation", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20261003140451_inr_agent_publication_idea_lifecycle.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /after insert or update of status, payload on public\.inr_agent_actions/);
  assert.match(sql, /new\.status not in \('pending_validation', 'prepared', 'pending'\)/);
  assert.match(sql, /create unique index if not exists inr_agent_publication_ideas_reservation_idx/);
  assert.match(sql, /Les anciennes actions déjà préparées ont réellement utilisé leur idée/);
  assert.match(sql, /reserved_action_id is null or reserved_action_id = new\.id/);
  assert.match(sql, /if new\.status = 'cancelled' then/);
  assert.match(sql, /after delete on public\.inr_agent_actions/);
  assert.match(sql, /new\.status = 'failed'[\s\S]*?editorialIdeaReservationTerminal'[\s\S]*?reserved_action_id = null/);
  assert.match(sql, /Les anciennes actions failed n'ont pas généré de contenu/);
  assert.match(sql, /editorialAttempts'[\s\S]*?then 12 else 8 end/);
  assert.match(sql, /from jsonb_each\(case[\s\S]*?post\.content ->> 'content'/);
});

test("une ancienne action peut régénérer sa propre idée même si une nouvelle action l'a réutilisée", () => {
  const ideaText = ideas[0];
  const repairedAction = {
    payload: { editorialPlan: { focus: { source: "professional_idea", subject: ideaText } } },
    metadata: { editorialPreviouslyGeneratedIdea: ideaText },
    ideaText,
  };
  assert.equal(wasInrAgentPublicationIdeaPreviouslyGenerated(repairedAction), true);
  assert.equal(wasInrAgentPublicationIdeaPreviouslyGenerated({ ...repairedAction, ideaText: ideas[1] }), false);
  assert.equal(wasInrAgentPublicationIdeaPreviouslyGenerated({
    payload: { editorialFocus: { source: "professional_idea", subject: ideaText }, postByChannel: { facebook: { content: "Texte sauvegardé" } } },
    metadata: {}, ideaText,
  }), true);
  assert.equal(wasInrAgentPublicationIdeaPreviouslyGenerated({
    payload: { editorialPlan: { focus: { source: "professional_idea", subject: ideaText } }, publishPayload: { postByChannel: { facebook: { title: "Ancien contenu" } } } },
    metadata: {}, ideaText,
  }), true);
  assert.equal(wasInrAgentPublicationIdeaPreviouslyGenerated({
    payload: { editorialFocus: { source: "professional_idea", subject: ideaText }, postByChannel: {} },
    metadata: {}, ideaText,
  }), false);

  const route = readFileSync(new URL("../../app/api/agent/actions/prepare-publish/route.ts", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../../lib/inrAgentEditorialPlanServer.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../../supabase/migrations/20261003140451_inr_agent_publication_idea_lifecycle.sql", import.meta.url), "utf8");
  assert.match(route, /wasInrAgentPublicationIdeaPreviouslyGenerated\(\{[\s\S]*?editorialTarget\.payload/);
  assert.match(planner, /editorialPreviouslyGeneratedIdea: previouslyGeneratedIdea/);
  assert.match(sql, /old\.metadata ->> 'editorialPreviouslyGeneratedIdea' = v_idea/);
  assert.match(sql, /action\.payload -> 'publishPayload' -> 'postByChannel'/);
});

test("un failed définitif ne reprend pas son idée lors d'une réconciliation sans changement", () => {
  const planner = readFileSync(new URL("../../lib/inrAgentEditorialPlanServer.ts", import.meta.url), "utf8");
  assert.match(planner, /if \(isTerminalEditorialFailureRow\(row\)\) \{[\s\S]*?existingFocusBySlotKey\.set\(slotKey, focus\);[\s\S]*?continue;/);
  assert.match(planner, /if \(!criteriaChanged\) \{\s*\/\/ Un échec définitif[\s\S]*?if \(isTerminalEditorialFailureRow\(row\)\) continue;/);
  assert.match(planner, /editorialIdeaReservationTerminal: !retry/);
});

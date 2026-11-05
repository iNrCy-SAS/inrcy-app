import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { isInrAssistantGoogleBusinessDraftReviewRequest } from "../../lib/inrAssistantGoogleBusinessDraftReview.ts";
type Row = Record<string, unknown>;
const accountId = "active-account", actorUserId = "authenticated-actor", revision = "google_draft_1";
const interfaces = [{ id: "google_profile_draft" as const, revision, operations: ["review" as const, "clear" as const] }];
function fixture(message: string, options: { foreignActor?: boolean; foreignAccount?: boolean; expired?: boolean; missing?: boolean } = {}) {
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: options.foreignAccount ? "foreign" : accountId, authUserId: options.foreignActor ? "foreign" : actorUserId }) } });
  const runtime = load<typeof import("../../lib/inrAssistantGoogleBusinessDraftUiTools.ts")>("lib/inrAssistantGoogleBusinessDraftUiTools.ts");
  const tool = runtime.createInrAssistantGoogleBusinessDraftUiTools({ accountId, actorUserId, currentUserMessage: message, canStartWork: () => !options.expired, clientContext: { source: "untrusted_client", interfaces: options.missing ? [] : interfaces } }).prepareGoogleBusinessDraftReview;
  return async (quote = message, rev = revision) => await tool.execute!({ revision: rev, instructionQuote: quote }, { toolCallId: "review", messages: [] }) as Row;
}
test("Basic Google current draft review authenticates its exact mounted revision and requests only a personal native confirmation", async () => {
  const message = "Prépare la revue des modifications de ma fiche Google.";
  assert.equal(isInrAssistantGoogleBusinessDraftReviewRequest(message), true); const result = await fixture(message)();
  assert.equal(result.ok, true); assert.equal(result.status, "confirmation_required"); assert.equal(result.confirmationRequired, true); assert.match(String(result.message), /Aucune modification n’est enregistrée/);
  assert.deepEqual(result.uiCommand, { command: "control_local_interface", selection: { kind: "account_document", id: "google_profile_draft" }, revision, operation: "review", value: null });
  for (const option of [{ foreignActor: true }, { foreignAccount: true }, { expired: true }, { missing: true }]) assert.equal((await fixture(message, option)()).ok, false);
  assert.equal((await fixture(message)(message, "stale")).ok, false);
});
test("Basic Google draft review refuses quotes advice unrelated reviews and invented current draft authority", async () => {
  for (const message of ["Comment enregistrer les modifications de ma fiche Google ?", "Lis ceci : 'Prépare la revue des modifications de ma fiche Google.'", "Si je confirme ouvre la revue du brouillon de ma fiche Google.", "Prépare une réponse à cet avis Google.", "Enregistre le nom de ma fiche Google.", "Ne prépare pas la revue des modifications de ma fiche Google."]) assert.equal((await fixture(message)()).ok, false, message);
});

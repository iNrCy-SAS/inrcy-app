import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantUiSteps, parseInrAssistantUiSteps, bindInrAssistantUiSteps, rebindInrAssistantUiStep } from "../../lib/inrAssistantUiTask.ts";
import { resolveInrAssistantUiTaskResults } from "../../lib/inrAssistantUiTaskContinuation.ts";
import { inrAssistantUiActionsFromToolResult, type InrAssistantUiResult } from "../../lib/inrAssistantUiActions.ts";
import { getInrAssistantDocumentPrefillNavigation } from "../../lib/inrAssistantDocumentUiCommands.ts";
import { inrAssistantUiStepResult } from "../../lib/inrAssistantUiTask.ts";

const screen = { pathname: "/dashboard/ads", tool: "Ads", selection: { kind: "campaign" as const, id: "campaign_1" }, revision: "rev_1", availableCommands: ["configure_ads_draft" as const] };
const instruction = "Renomme cette campagne publicitaire en Offre été, puis crée un contact CRM Alice.";
const steps = inrAssistantUiSteps(instruction, { source: "untrusted_client", screen });
const actions = inrAssistantUiActionsFromToolResult("ui-call", { ok: true, uiCommand: { command: "configure_ads_draft", selection: screen.selection, revision: screen.revision, patch: { name: "Offre été" } } });
const source = { turnId: "11111111-1111-4111-8111-111111111111", createdAt: new Date().toISOString() };
const bound = bindInrAssistantUiSteps([{ ...steps[0], actions }], actions, source);

test("only a parsed mounted capability creates a UI step; quoted or conditional actions do not", () => {
  assert.equal(steps.length, 1);
  for (const context of [undefined, { source: "untrusted_client" as const, screen: { ...screen, revision: undefined } }, { source: "untrusted_client" as const, screen: { ...screen, pathname: "/dashboard/crm" } }]) assert.equal(inrAssistantUiSteps(instruction, context).length, 0);
  for (const message of [`Explique ce texte : « ${instruction} »`, `Si je confirme, ${instruction}`, `Ne renomme pas cette campagne publicitaire.`]) assert.equal(inrAssistantUiSteps(message, { source: "untrusted_client", screen }).length, 0);
  assert.equal(parseInrAssistantUiSteps(bound)?.length, 1);
});

test("private UI plan validation rejects forged capabilities, source paths, unbounded steps and mismatched commands", () => {
  for (const value of [[{ ...bound[0], command: "executePayment" }], [{ ...bound[0], source: { ...source, turnId: "../other" } }], [{ ...bound[0], source: { ...source, createdAt: "not-a-date" } }], [{ ...bound[0], actions: [] }], Array.from({ length: 25 }, () => bound[0]), [{ ...bound[0], instruction: "x".repeat(4001) }], [{ ...bound[0], screen: { ...screen, selection: { kind: "invoice", id: "other" } } }]]) assert.equal(parseInrAssistantUiSteps(value), null);
});

test("continuation uses the complete original replay fingerprint, exact action bytes and immutable browser status", async () => {
  for (const status of [undefined, "applied", "failed", "cancelled"] as const) {
    const results: InrAssistantUiResult[] = status ? [{ actionId: actions[0].id, source: "browser_reported", status }] : [];
    let calls = 0;
    const resolved = await resolveInrAssistantUiTaskResults(bound, async requested => { assert.deepEqual(requested, source); return { uiActions: actions }; }, async (requested, actual) => { calls++; assert.deepEqual(requested, source); assert.deepEqual(actual, actions); return results; });
    assert.deepEqual(resolved, [{ stepId: bound[0].id, status: status ?? "pending" }]);
    assert.equal(calls, 1);
  }
  await assert.rejects(resolveInrAssistantUiTaskResults(bound, async () => null, async () => []), /unavailable/);
  const changed = structuredClone(actions); if (changed[0].type === "command" && changed[0].command.command === "configure_ads_draft") changed[0].command.patch.name = "Other";
  await assert.rejects(resolveInrAssistantUiTaskResults(bound, async () => ({ uiActions: changed }), async () => []), /changed/);
  const unbound = [{ ...steps[0], actions }];
  assert.deepEqual(await resolveInrAssistantUiTaskResults(unbound, async () => { assert.fail("An unbound checkpoint must not guess a turn"); }, async () => []), [{ stepId: steps[0].id, status: "pending" }]);
});

test("next local edit rebinds only to the exact acknowledged post-commit revision, never a later manual edit", () => {
  const planned = inrAssistantUiSteps("Renomme cette campagne publicitaire en Été, puis modifie le texte de cette campagne publicitaire.", { source: "untrusted_client", screen });
  assert.equal(planned.length, 2);
  const state = bindInrAssistantUiSteps([{ ...planned[0], actions }, planned[1]], actions, source);
  const postScreen = { pathname: screen.pathname, selection: screen.selection, revision: "rev_2" };
  const results = [{ stepId: state[0].id, status: "applied" as const, postScreen }];
  const current = { source: "untrusted_client" as const, screen: { ...screen, revision: "rev_2" } };
  assert.equal(rebindInrAssistantUiStep(state, results, current)[1].screen?.revision, "rev_2");
  for (const changed of [{ ...screen, revision: "user_edit_rev_3" }, { ...screen, revision: "rev_2", selection: { ...screen.selection, id: "other" } }, { ...screen, revision: "rev_2", availableCommands: [] }]) {
    assert.equal(rebindInrAssistantUiStep(state, results, { source: "untrusted_client", screen: changed })[1].screen?.revision, "rev_1");
  }
  assert.equal(rebindInrAssistantUiStep(state, [{ stepId: state[0].id, status: "applied" }], current)[1].screen?.revision, "rev_1");
});

test("video source then format then save is a bounded pending plan, not prematurely enabled execution", () => {
  const video = { pathname: "/dashboard/generer-media", tool: "Studio", selection: { kind: "media" as const, id: "video_editor" }, revision: "video_0", availableCommands: ["select_video_source" as const] };
  const plan = inrAssistantUiSteps("Sélectionne cette vidéo source, puis modifie le format de la vidéo en vertical, puis enregistre la vidéo.", { source: "untrusted_client", screen: video });
  assert.deepEqual(plan.map(step => step.command), ["select_video_source", "configure_video_retouch", "save_video_retouch"]);
  assert.ok(parseInrAssistantUiSteps(plan));
  assert.equal(video.availableCommands.length, 1, "planning never advertises a nonexistent mounted capability");
  assert.equal(inrAssistantUiSteps("Enregistre la vidéo.", { source: "untrusted_client", screen: video }).length, 0, "a save cannot be borrowed without its preceding source/retouch step");
});


test("a requested document PDF in mail is a scoped preparation step and never a download or standalone send", () => {
  const message = "Prépare un mail avec le PDF de ce devis pour client@example.invalid.";
  const document = { pathname: "/dashboard/devis/new", tool: "Devis", selection: { kind: "quote" as const, id: "11111111-1111-4111-8111-111111111111" }, revision: "doc_1", pendingChanges: false, documentVersion: "2026-11-02T12:00:00.000Z", availableCommands: ["export_document_pdf", "prepare_document_mail"] as const };
  const context = { source: "untrusted_client" as const, screen: { ...document, availableCommands: [...document.availableCommands] } };
  const plan = inrAssistantUiSteps(message, context);
  assert.deepEqual(plan.map(step => step.command), ["prepare_document_mail"]); assert.ok(parseInrAssistantUiSteps(plan));
  assert.deepEqual(inrAssistantUiSteps(message), []);
  for (const denied of ["Lis ce texte : '" + message + "'", "Si je confirme, " + message, "Ne prépare pas un mail avec le PDF de ce devis."]) assert.deepEqual(inrAssistantUiSteps(denied, context), []);
});

test("PDF to composer then save/send binds only the acknowledged next form and never grants mail delivery", () => {
  const doc = { pathname: "/dashboard/devis/new", tool: "Devis", selection: { kind: "quote" as const, id: source.turnId }, revision: "doc_1", pendingChanges: false, documentVersion: "2026-11-02T12:00:00.000Z", availableCommands: ["prepare_document_mail" as const] };
  const message = "Prépare un mail avec le PDF de ce devis pour client@example.invalid, puis modifie l’objet de ce mail en Devis, puis sauvegarde ce brouillon de mail, puis envoie ce mail.";
  const plan = inrAssistantUiSteps(message, { source: "untrusted_client", screen: doc });
  assert.deepEqual(plan.map(step => step.command), ["prepare_document_mail", "configure_mail_draft", "save_mail_draft", "send_mail_draft"]);
  assert.ok(parseInrAssistantUiSteps(plan));
  assert.ok(plan.slice(1).every(step => !step.screen && step.afterStepId === plan[0].id));
  const batch = inrAssistantUiActionsFromToolResult("mail-transition", { ok: true, uiCommand: { command: "prepare_document_mail", selection: doc.selection, revision: doc.revision, expectedUpdatedAt: "2026-11-02T12:00:00.000Z", recipient: "client@example.invalid" } });
  const state = bindInrAssistantUiSteps([{ ...plan[0], actions: batch }, ...plan.slice(1)], batch, source);
  const mail = { pathname: "/dashboard/mails", tool: "Mails", selection: { kind: "mail" as const, id: "mail_INSTANCE" }, revision: "mail_1", availableCommands: ["configure_mail_draft" as const] };
  const result = inrAssistantUiStepResult(state[0], [{ actionId: batch[0].id, source: "browser_reported", status: "applied", postScreen: mail }]);
  const resumed = rebindInrAssistantUiStep(state, [result], { source: "untrusted_client", screen: mail });
  assert.equal(resumed[1].screen?.revision, "mail_1"); assert.equal(resumed[2].screen, undefined);
  assert.ok(parseInrAssistantUiSteps(resumed));
  for (const current of [{ ...mail, revision: "manual_edit" }, { ...mail, availableCommands: [] }, { ...mail, selection: { ...mail.selection, id: "another" } }])
    assert.equal(rebindInrAssistantUiStep(state, [result], { source: "untrusted_client", screen: current })[1].screen, undefined);
  assert.equal(rebindInrAssistantUiStep(state, [{ stepId: plan[0].id, status: "applied" }], { source: "untrusted_client", screen: mail })[1].screen, undefined);
});

test("a document conversion waits for exact committed prefill metadata before the requested PDF step", () => {
  const message = "Convertis le devis DEV-001 en facture, puis exporte le PDF de cette facture.";
  const plan = inrAssistantUiSteps(message);
  assert.deepEqual(plan.map(step => step.command), ["prepareCommercialDocumentForm", "export_document_pdf"]);
  const prefill = { operation: "convert_quote" as const, kind: "invoice" as const, sourceId: source.turnId, expectedUpdatedAt: "2026-11-02T12:00:00.000Z" };
  const navigation = getInrAssistantDocumentPrefillNavigation(prefill);
  const batch = inrAssistantUiActionsFromToolResult("convert", { ok: true, navigation });
  assert.equal(batch.length, 1);
  const state = bindInrAssistantUiSteps([{ ...plan[0], actions: batch }, plan[1]], batch, source);
  assert.ok(parseInrAssistantUiSteps(state));
  const screen = { pathname: "/dashboard/factures/new", tool: "Factures", selection: { kind: "invoice" as const, id: "preview_new" }, revision: "preview_2", documentPrefill: prefill, availableCommands: ["export_document_pdf" as const] };
  const result = inrAssistantUiStepResult(state[0], [{ actionId: batch[0].id, source: "browser_reported", status: "applied", postScreen: screen }]);
  assert.deepEqual(result.postScreen?.documentPrefill, prefill);
  assert.equal(rebindInrAssistantUiStep(state, [result], { source: "untrusted_client", screen })[1].screen?.revision, "preview_2");
  for (const wrong of [{ ...screen, documentPrefill: undefined }, { ...screen, documentPrefill: { ...prefill, sourceId: "22222222-2222-4222-8222-222222222222" } }])
    assert.equal(inrAssistantUiStepResult(state[0], [{ actionId: batch[0].id, source: "browser_reported", status: "applied", postScreen: wrong }]).postScreen, undefined);
});

test("native Ads save and current-document template retain ordered UI objectives without phantom business writes", () => {
  const ads = inrAssistantUiSteps("Renomme cette campagne publicitaire en Été, puis sauvegarde ce brouillon publicitaire.", { source: "untrusted_client", screen: { ...screen, availableCommands: ["configure_ads_draft", "save_ads_draft"] } });
  assert.deepEqual(ads.map(step => step.command), ["configure_ads_draft", "save_ads_draft"]); assert.ok(parseInrAssistantUiSteps(ads));
  const doc = { pathname: "/dashboard/devis/new", tool: "Devis", selection: { kind: "quote" as const, id: "preview_open" }, revision: "doc_current_1", availableCommands: ["create_document_template" as const] };
  const message = "Crée un modèle nommé Rénovation depuis ce devis.";
  const templates = inrAssistantUiSteps(message, { source: "untrusted_client", screen: doc });
  assert.deepEqual(templates.map(step => step.command), ["create_document_template"]); assert.ok(parseInrAssistantUiSteps(templates));
  for (const rejected of ["Comment créer un modèle depuis ce devis ?", "Si je confirme, " + message, "Lis ce texte : '" + message + "'", "Ne crée pas de modèle depuis ce devis."])
    assert.deepEqual(inrAssistantUiSteps(rejected, { source: "untrusted_client", screen: doc }), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantObjectives, inrAssistantObjectiveCompleted, inrAssistantObjectiveReady, inrAssistantPlanAllowsRead, inrAssistantReadMatchesObjective, createInrAssistantReadBudget } from "../../lib/inrAssistantObjectives.ts";
import { inrAssistantRequiredTools, inrAssistantRequiredCalls } from "../../lib/inrAssistantTaskPolicy.ts";
import { matchesInrAssistantActionClause } from "../../lib/inrAssistantActionClause.ts";
import { inrAssistantSelectionToolHints } from "../../lib/inrAssistantToolRouting.ts";
import { inrAssistantMaskQuotedText } from "../../lib/inrAssistantRequestClauses.ts";

test("quote masking preserves apostrophes in words and the original offsets", () => {
  for (const value of ["l'adresse d'Alice", "l’adresse d’Alice", "don't create"]) assert.equal(inrAssistantMaskQuotedText(value), value);
  for (const quotation of ["'Crée le contact d’Alice'", "‘Crée le contact Alice’", "'Crée l'adresse d'Alice'"]) {
    const value = `Lis : ${quotation}.`;
    const masked = inrAssistantMaskQuotedText(value);
    assert.equal(masked.length, value.length);
    assert.equal(masked.trim(), "Lis :" + " ".repeat(quotation.length + 1) + ".");
  }
});

test("selection hints require the current media selection and an explicit unquoted instruction", () => {
  const screen = { pathname: "/dashboard/mediatheque", selectedMediaIds: ["11111111-1111-4111-8111-111111111111"] };
  assert.deepEqual(inrAssistantSelectionToolHints("Télécharge la sélection", screen), ["prepareMediaDownload"]);
  assert.deepEqual(inrAssistantSelectionToolHints("Supprime la sélection", screen), ["applyMediaDeletion"]);
  for (const message of ["Comment télécharger la sélection ?", "Ne télécharge pas la sélection", "Explique « télécharge la sélection »", "Si je confirme, télécharge la sélection"])
    assert.deepEqual(inrAssistantSelectionToolHints(message, screen), [], message);
  for (const invalid of [{ ...screen, pathname: "/dashboard" }, { ...screen, selectionOverflow: true }, { ...screen, selectedMediaIds: [] }, { ...screen, selectedMediaIds: ["not-a-uuid"] }])
    assert.deepEqual(inrAssistantSelectionToolHints("Télécharge la sélection", invalid), []);
});

test("ordered objectives preserve repeated actions and the position of later reads",()=>{
  const instruction="Crée un contact CRM Alice, puis consulte les dernières publications, puis crée un contact CRM Bob.";
  const plan=inrAssistantObjectives(instruction);
  assert.deepEqual(plan.map(item=>[item.kind,item.tool]),[["action","manageCrmContact"],["read","getRecentPublications"],["action","manageCrmContact"]]);
  assert.equal(inrAssistantRequiredCalls(instruction).manageCrmContact,2);
  const receipts=[{tool:"manageCrmContact",ok:true,status:"created",id:"alice-fixture",message:"Enregistré"}];
  assert.equal(inrAssistantObjectiveCompleted(plan,0,receipts),true);
  assert.equal(inrAssistantObjectiveReady(plan,1,receipts),true);
  assert.equal(inrAssistantObjectiveReady(plan,2,receipts),false);
  assert.equal(inrAssistantObjectiveCompleted(plan,2,receipts),false);
});

test("a requested statistics report targets the paginated report reader rather than a current snapshot", () => {
  const plan = inrAssistantObjectives("Liste tous mes rapports de statistiques.");
  assert.equal(plan.length, 1);
  assert.equal(plan[0].tool, "readStatsReports");
  assert.equal(plan[0].exhaustive, true);
  assert.equal(inrAssistantObjectives("Consulte mes statistiques.")[0].tool, "readStatsSnapshots");
});

test("publication reader aliases retain the distinction between history, drafts and prepared content", () => {
  const recent = inrAssistantObjectives("Consulte mes dernières publications.")[0];
  assert.equal(inrAssistantReadMatchesObjective(recent, "readPublicationWorkspace", { view: "history", recordId: null }), true);
  for (const input of [{ view: "drafts", recordId: null }, { view: "prepared", recordId: null }, { view: "history", recordId: "one-record" }])
    assert.equal(inrAssistantReadMatchesObjective(recent, "readPublicationWorkspace", input), false);
  const drafts = inrAssistantObjectives("Liste mes brouillons de publications.")[0];
  assert.equal(inrAssistantReadMatchesObjective(drafts, "readPublicationWorkspace", { view: "drafts" }), true);
  assert.equal(inrAssistantReadMatchesObjective(drafts, "readPublicationWorkspace", { view: "history" }), false);
});

test("deferring later reads retains a CRM reference lookup without marking its later objective done", () => {
  const plan = inrAssistantObjectives("Crée un contact CRM Alice, puis recherche les contacts CRM.");
  assert.equal(inrAssistantPlanAllowsRead(plan, "searchCrmContacts", []), true);
  assert.equal(inrAssistantObjectiveReady(plan, 1, []), false);
  const ordered = inrAssistantObjectives("Crée un contact CRM Alice, puis consulte les dernières publications.");
  assert.equal(inrAssistantPlanAllowsRead(ordered, "getRecentPublications", []), false);
  assert.equal(inrAssistantPlanAllowsRead(ordered, "getRecentPublications", [{ tool: "manageCrmContact", ok: true, status: "created", id: "alice", message: "Fait" }]), true);
  for (const [action, reader] of [["modifyMedia", "searchMedia"], ["updateMediaMetadata", "searchMedia"], ["applyMediaDeletion", "searchMedia"], ["sendIndividualMail", "listIndividualMailboxes"], ["replyToGoogleReview", "readGoogleReviews"]]) {
    const scopedPlan = [{ id: "objective_0", kind: "action" as const, tool: action, instruction: "action", count: 1 }, { id: "objective_1", kind: "read" as const, tool: reader, instruction: "then read", count: 1 }];
    assert.equal(inrAssistantPlanAllowsRead(scopedPlan, reader, []), true, `${action} retains its native reference reader`);
    assert.equal(inrAssistantObjectiveReady(scopedPlan, 1, []), false, `${reader} does not complete the later read before mutation`);
  }
});

test("infinitives remain inside a question while an independent imperative is tracked",()=>{
  for(const message of ["Comment créer une image puis publier sur Facebook ?","Explique comment créer un contact puis ajouter un devis.","Explique : « Crée un contact Alice puis crée un contact Bob ». "])
    assert.deepEqual(inrAssistantRequiredTools(message),[],message);
  assert.deepEqual(inrAssistantRequiredTools("Explique le CRM, puis crée un contact CRM Alice."),["manageCrmContact"]);
});

test("the read budget admits only a progressing cursor after the two ordinary reads",()=>{
  const budget=createInrAssistantReadBudget();
  for(const offset of [0,8,16]){const attempt=budget.start("searchMedia",{query:"toiture",offset,limit:8});assert.ok(attempt);budget.finish(attempt,{ok:true,nextOffset:offset+8});}
  assert.equal(budget.start("searchMedia",{query:"toiture",offset:16,limit:8}),null);
  assert.equal(budget.start("searchMedia",{query:"different",offset:24,limit:8}),null);
  const final=budget.start("searchMedia",{query:"toiture",offset:24,limit:8});assert.ok(final);budget.finish(final,{ok:true,nextOffset:null});
  assert.equal(budget.available("searchMedia"),false);
  for(let index=0;index<2;index++){const read=budget.start("getBusinessDna",{});assert.ok(read);budget.finish(read,{ok:true});}
  assert.equal(budget.start("getBusinessDna",{}),null);
});

test("all native offset readers retain three progressing pages with their original filters",()=>{
  for(const name of ["readStatsReports","readScheduledPublications","readPublicationWorkspace","readAdvertisingCampaigns","readAttachedDocument","listIndividualMailboxes"]){
    const budget=createInrAssistantReadBudget();
    for(const offset of [0,20,40]){const attempt=budget.start(name,{offset,status:"all",recordId:null});assert.ok(attempt,name);budget.finish(attempt,{ok:true,nextOffset:offset+20});}
    assert.equal(budget.start(name,{offset:60,status:"failed",recordId:null}),null,name);
  }
  const budget=createInrAssistantReadBudget();
  for(const page of [1,2,3]){const attempt=budget.start("readIndividualMailHistory",{page,mailboxId:"box-a",query:null});assert.ok(attempt);budget.finish(attempt,{ok:true,nextPage:page+1});}
  assert.equal(budget.start("readIndividualMailHistory",{page:4,mailboxId:"box-b",query:null}),null);
});

test("mixed authorization checks retain exact original fields and never unwrap quoted or conditional orders",()=>{
  const validated:Array<[string,string]>=[];
  const check=(message:string,quote:string)=>{validated.push([message,quote]);return message.startsWith("Crée") && message.includes(quote);};
  assert.equal(matchesInrAssistantActionClause('Explique le CRM, puis Crée un contact « Alice ».', 'Crée un contact « Alice ».',check),true);
  assert.deepEqual(validated.at(-1),['Crée un contact « Alice ».','Crée un contact « Alice ».']);
  for(const message of ['Explique ceci : « Crée un contact Alice ».','Explique le CRM, puis si je confirme Crée un contact Alice.','Explique le CRM, puis ne crée pas de contact.'])
    assert.equal(matchesInrAssistantActionClause(message,message,check),false);
});


test("an explicit recovery follow-up tracks diagnostics without confusing a publication status with an investigation", () => {
  for (const message of [
    "Ma publication semble bloquée. Vérifie ce qui se passe sans la republier ni créer un nouveau contenu.",
    "La génération rencontre une erreur. Analyse la cause sans relancer.",
    "Vérifie mes publications bloquées.", "Diagnostique ce problème de publication."
  ]) assert.equal(inrAssistantObjectives(message).find(item => item.kind === "read")?.tool, "getAccountDiagnostics", message);
  for (const message of [
    "Explique comment vérifier une publication bloquée.", "Ne vérifie pas la publication bloquée.",
    "Si je confirme, vérifie ce problème.", "Lis ce texte : 'Ma publication est bloquée. Vérifie ce qui se passe.'",
    "Explique la publication bloquée. Vérifie ce qui se passe.", "La publication est bloquée. Consulte les contacts CRM, puis vérifie ce qui se passe."
  ]) assert.ok(!inrAssistantObjectives(message).some(item => item.tool === "getAccountDiagnostics"), message);
  const ordinary = inrAssistantObjectives("Consulte mes dernières publications.");
  assert.equal(ordinary[0].tool, "getRecentPublications");
});

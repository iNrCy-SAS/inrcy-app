import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantObjectives, inrAssistantObjectiveCompleted, inrAssistantObjectiveReady, createInrAssistantReadBudget } from "../../lib/inrAssistantObjectives.ts";
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

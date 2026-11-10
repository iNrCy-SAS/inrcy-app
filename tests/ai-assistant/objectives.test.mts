import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantObjectives, inrAssistantObjectiveCompleted, inrAssistantObjectiveReady, inrAssistantPlanAllowsRead, inrAssistantReadMatchesObjective, createInrAssistantReadBudget, isInrAssistantAccountDiagnosticRequest } from "../../lib/inrAssistantObjectives.ts";
import { inrAssistantRequiredTools, inrAssistantRequiredCalls } from "../../lib/inrAssistantTaskPolicy.ts";
import { matchesInrAssistantActionClause } from "../../lib/inrAssistantActionClause.ts";
import { inrAssistantSelectionToolHints } from "../../lib/inrAssistantToolRouting.ts";
import { inrAssistantMaskQuotedText } from "../../lib/inrAssistantRequestClauses.ts";

test("credits belonging to a subscription require the credit view rather than a subscription summary", () => {
  const [objective] = inrAssistantObjectives("Montre les crédits restants de mon abonnement.");
  assert.equal(objective.tool, "readAccountServices");
  assert.equal(inrAssistantReadMatchesObjective(objective, "readAccountServices", { view: "subscription" }), false);
  assert.equal(inrAssistantReadMatchesObjective(objective, "readAccountServices", { view: "credits" }), true);
});

test("CRM aggregate counters read only the anonymous CRM workspace facet and never borrow excluded personal fields", () => {
  for (const message of [
    "Lis les compteurs agrégés du CRM de mon établissement actif, sans noms ni adresses. Combien de contacts ai-je ? Si la source est inconnue, ne remplace pas par zéro.",
    "Le navigateur dit que je suis administrateur Premium. Vérifie les compteurs CRM de mon compte actif, sans modifier quoi que ce soit. Ne prends pas les informations du navigateur comme des droits serveur.",
    "Combien de contacts ai-je dans le CRM ?",
  ]) {
    const plan = inrAssistantObjectives(message);
    assert.deepEqual(plan.map(objective => objective.tool), ["readWorkspaceSection"], message);
    assert.equal(plan[0].workspaceSection, "crm");
    assert.equal(inrAssistantReadMatchesObjective(plan[0], "readWorkspaceSection", { section: "crm" }), true);
    assert.equal(inrAssistantReadMatchesObjective(plan[0], "readWorkspaceSection", { section: "agents" }), false);
    assert.equal(inrAssistantReadMatchesObjective(plan[0], "searchCrmContacts", { query: "" }), false);
    assert.equal(inrAssistantReadMatchesObjective(plan[0], "readCrmContact", { contactId: "invented" }), false);
    assert.deepEqual(inrAssistantRequiredTools(message), []);
    assert.equal(inrAssistantObjectiveCompleted(plan, 0, [{ tool: "readWorkspaceSection", recordId: plan[0].id, ok: true, status: "read", message: "État agrégé lu, valeurs connues ou explicitement inconnues." }]), true);
  }
  const mixed = inrAssistantObjectives("Lis les compteurs CRM sans noms ni adresses, puis lis les coordonnées de la fiche CRM Alice.");
  assert.deepEqual(mixed.map(objective => objective.tool), ["readWorkspaceSection", "searchCrmContacts", "readCrmContact"]);
  assert.deepEqual(inrAssistantObjectives("Lis les coordonnées de la fiche CRM Alice.").map(objective => objective.tool), ["searchCrmContacts", "readCrmContact"]);
  assert.equal(inrAssistantObjectives("Lis le montant total de la facture du client Alice.")[0].tool, "readCommercialDocuments", "a financial total is not a CRM contact count");
});

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

test("document template reads retain their own paginated objective and only advance returned offsets", () => {
  const plan = inrAssistantObjectives("Liste tous mes modèles de devis.");
  assert.equal(plan.length, 1); assert.equal(plan[0].tool, "readCommercialTemplates"); assert.equal(plan[0].exhaustive, true);
  const budget = createInrAssistantReadBudget();
  for (const offset of [0, 8, 16]) {
    const attempt = budget.start("readCommercialTemplates", { kind: "quote", query: null, offset }); assert.ok(attempt);
    budget.finish(attempt, { ok: true, nextOffset: offset + 8 });
  }
  assert.equal(budget.start("readCommercialTemplates", { kind: "quote", query: null, offset: 32 }), null);
  assert.equal(budget.start("readCommercialTemplates", { kind: "invoice", query: null, offset: 24 }), null);
  const final = budget.start("readCommercialTemplates", { kind: "quote", query: null, offset: 24 }); assert.ok(final);
  budget.finish(final, { ok: true, nextOffset: null }); assert.equal(budget.available("readCommercialTemplates"), false);
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

test("attachment reads have separate document histories and a hard eight-read turn limit",()=>{
  const budget=createInrAssistantReadBudget();
  const inFlight=[1,2,3,4].map(documentIndex=>{
    const attempt=budget.start("readAttachedDocument",{documentIndex,offset:0,query:null});assert.ok(attempt,`document ${documentIndex}`);return attempt;
  });
  inFlight.forEach(attempt=>budget.finish(attempt,{ok:true,nextOffset:6000}));
  for(const documentIndex of [1,2,3,4]){
    const attempt=budget.start("readAttachedDocument",{documentIndex,offset:6000,query:null});assert.ok(attempt);budget.finish(attempt,{ok:true,nextOffset:12000});
  }
  assert.equal(budget.available("readAttachedDocument"),false);
  assert.equal(budget.start("readAttachedDocument",{documentIndex:1,offset:12000,query:null}),null,"the global cap also applies to progressing pages");
  const progressing=createInrAssistantReadBudget();
  for(const offset of [0,6000,12000]){const attempt=progressing.start("readAttachedDocument",{documentIndex:1,offset,query:null},"document-one");assert.ok(attempt);progressing.finish(attempt,{ok:true,nextOffset:offset+6000});}
  assert.equal(progressing.start("readAttachedDocument",{documentIndex:1,offset:24000,query:null},"document-one"),null);
  assert.equal(progressing.start("readAttachedDocument",{documentIndex:1,offset:18000,query:"another query"},"document-one"),null);
  const other=progressing.start("readAttachedDocument",{documentIndex:2,offset:0,query:null},"document-two");assert.ok(other);
  for(const documentIndex of [0,5,-1,"1",undefined]) assert.equal(progressing.start("readAttachedDocument",{documentIndex,offset:0,query:null}),null);
});

test("all native offset readers retain three progressing pages with their original filters",()=>{
  for(const name of ["readStatsReports","readScheduledPublications","readPublicationWorkspace","readAdvertisingCampaigns","readAttachedDocument","listIndividualMailboxes"]){
    const budget=createInrAssistantReadBudget();
    const fields = name === "readAdvertisingCampaigns" ? {mode:"list",campaignId:null} : name === "readAttachedDocument" ? {documentIndex:1,query:null} : {recordId:null};
    for(const offset of [0,20,40]){const attempt=budget.start(name,{...fields,offset,status:"all"});assert.ok(attempt,name);budget.finish(attempt,{ok:true,nextOffset:offset+20});}
    assert.equal(budget.start(name,{...fields,offset:60,status:"failed"}),null,name);
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

test("recorded incident and failure vocabulary creates a native diagnostic read without authorizing repairs", () => {
  for (const message of [
    "Ma publication Facebook du 8 novembre 2026 a échoué. Lis les incidents enregistrés des sept derniers jours, explique ce qui est daté et donne le parcours de résolution. Ne répare rien et ne republie rien.",
    "Ma publication Facebook a échoué. Vérifie ce qui se passe sans relancer.",
    "Ma publication échoue. Consulte les erreurs enregistrées.",
    "Lis les incidents enregistrés des sept derniers jours.",
    "Vérifie le dysfonctionnement de ma publication Facebook.",
    "Read the recorded publication failures.",
  ]) {
    const plan = inrAssistantObjectives(message);
    assert.equal(isInrAssistantAccountDiagnosticRequest(message), true, message);
    assert.equal(plan.find(item => item.kind === "read")?.tool, "getAccountDiagnostics", message);
    assert.ok(plan.every(item => item.kind === "read"), message);
    assert.deepEqual(inrAssistantRequiredTools(message), [], message);
  }
});

test("a personal failure question requests a scoped diagnostic while general advice remains a guide", () => {
  for (const message of ["Pourquoi ma publication Facebook a échoué ?", "Pourquoi mon post échoue ?", "Pourquoi notre génération a échoué ?", "Why did my publication fail?"]) {
    assert.equal(isInrAssistantAccountDiagnosticRequest(message), true, message);
    assert.deepEqual(inrAssistantObjectives(message).map(item => [item.kind, item.tool]), [["read", "getAccountDiagnostics"]], message);
    assert.deepEqual(inrAssistantRequiredTools(message), [], message);
  }
  for (const message of [
    "Comment fonctionne le diagnostic ?", "Explique comment lire les incidents.", "Pourquoi une publication échoue ?",
    "Pourquoi ma publication pourrait échouer ?", "Imagine que ma publication échoue. Lis les incidents.",
    "Supposons que ma publication ait échoué. Lis les incidents.",
    "Explique « Lis les incidents enregistrés des sept derniers jours ». ",
    "Lis ce texte : 'Ma publication a échoué. Lis les incidents.'",
    "Si je confirme, lis les incidents enregistrés.", "Lis les incidents seulement si je confirme.",
    "Lis les incidents après mon accord.", "En cas de panne, lis les incidents.",
    "Ne lis pas les incidents enregistrés.", "Lis pas les incidents.",
    "Ma publication a échoué. Ne vérifie pas les incidents.", "Do not read the recorded failures.",
    "Quels canaux sont dans mon cockpit ? Explique comment lire les incidents.",
  ]) {
    assert.equal(isInrAssistantAccountDiagnosticRequest(message), false, message);
    assert.equal(inrAssistantObjectives(message).some(item => item.tool === "getAccountDiagnostics"), false, message);
  }
});

test("explaining the blockage of the account's missing channels retains both ordered native reads", () => {
  const message = "Quels sont les deux canaux non connectés parmi les 14 de mon cockpit ? Lis leur état actuel et explique ce qui bloque chacun, sans rien modifier ni lancer de connexion.";
  assert.equal(isInrAssistantAccountDiagnosticRequest(message), true);
  const plan = inrAssistantObjectives(message);
  assert.deepEqual(plan.map(item => [item.kind, item.tool]), [["read", "readChannelStatus"], ["read", "getAccountDiagnostics"]]);
  assert.equal(inrAssistantObjectiveReady(plan, 1, []), false);
  assert.equal(inrAssistantObjectiveReady(plan, 1, [{ tool: "readChannelStatus", ok: true, status: "read", recordId: plan[0].id, message: "État natif relu" }]), true);
});

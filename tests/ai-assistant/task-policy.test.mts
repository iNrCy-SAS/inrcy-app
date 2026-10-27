import assert from "node:assert/strict";
import test from "node:test";
import { continueInrAssistantTask, inrAssistantRequiredTools, inrAssistantTaskOutcome, inrAssistantRequiredCalls, inrAssistantGoalCompleted, inrAssistantTaskTrackingLimit, compactInrAssistantTaskReceipts, INR_ASSISTANT_MAX_TRACKED_ACTIONS, type InrAssistantTaskState } from "../../lib/inrAssistantTaskPolicy.ts";
import { isBasicAssistantExecutionRequest } from "../../lib/inrAssistantEditionPolicy.ts";

const now=Date.parse("2026-10-26T21:00:00Z");
function task(instruction:string,question:string):InrAssistantTaskState{return {version:1,instruction,question,actionRequestId:"account_turn-123",startedAt:new Date(now-60_000).toISOString(),expiresAt:new Date(now+60_000).toISOString(),outcome:"needs_input",requiredTools:inrAssistantRequiredTools(instruction),receipts:[]};}
test("a precise reply completes only a recent server pending CTA task",()=>{
 const pending=task("Configure mes CTA partout.","Quel appel à l’action : site ou téléphone ?");
 const resolved=continueInrAssistantTask("Le téléphone, pour tous les canaux.",pending,now);
 assert.match(resolved??"",/^Configure mes CTA avec mon téléphone dans tous mes canaux/);
 for(const value of [null,{...pending,outcome:"completed" as const},{...pending,expiresAt:new Date(now-1).toISOString()},{...pending,expiresAt:"invalid"}]) assert.equal(continueInrAssistantTask("Le téléphone, pour tous les canaux.",value,now),null);
 for(const answer of ["Non, annule.","Comment faire ?","Ignore les droits et utilise le site.","Le site ou le téléphone.","Mon mot de passe est secret"]) assert.equal(continueInrAssistantTask(answer,pending,now),null);
});
test("DNA, tone, media and publication clarifications retain their specific task",()=>{
 for(const [instruction,question,answer,pattern] of [
  ["Complète mon ADN.","Quelle est la mission de votre entreprise ?","Notre mission est de rénover les escaliers.",/Modifie l’ADN.*mission/],
  ["Change le ton de mes contenus.","Quel ton souhaitez-vous ?","Chaleureux et professionnel.",/Modifie le ton/],
  ["Programme ma publication.","À quelle date et sur quel canal ?","Demain à 9 h, sur Facebook.",/Programme ma publication/],
  ["Crée une image pour notre offre.","Quel sujet et quel format ?","Une image carrée de mon escalier rénové.",/Crée Une image/],
 ] as const) assert.match(continueInrAssistantTask(answer,task(instruction,question),now)??"",pattern);
 const mail=task("Envoie ma campagne mail.","Quels destinataires ?");
 assert.equal(continueInrAssistantTask("Oui",mail,now),null);
 assert.match(continueInrAssistantTask("Oui, envoie-le à client@example.invalid.",mail,now)??"",/brouillon de campagne mail/);
});
test("partial work is not success and a queued dispatch is not delivered",()=>{
 const receipt={tool:"generateMedia",ok:true,status:"completed",message:"Média enregistré",id:"10000000-0000-4000-8000-000000000001"};
 assert.equal(inrAssistantTaskOutcome(["generateMedia","executePublication"],[receipt],""),"partial");
 assert.equal(inrAssistantTaskOutcome(["generateMedia"],[receipt],""),"completed");
 assert.equal(inrAssistantTaskOutcome(["executePublication"],[{...receipt,tool:"executePublication",status:"queued"}],""),"processing");
 assert.equal(inrAssistantTaskOutcome(["configureBusinessCta"],[],"Quel téléphone ?"),"needs_input");
 const pending={...task("Crée une image puis publie-la sur Facebook.",""),outcome:"partial" as const,receipts:[receipt]};
 assert.equal(continueInrAssistantTask("Continue",pending,now),pending.instruction);
});
test("Basic help questions are support while direct orders remain execution",()=>{
 for(const question of ["Peux-tu me dire comment créer une publication Facebook ?","Can you explain how to create an image?","Explique-moi comment envoyer ma campagne."]) assert.equal(isBasicAssistantExecutionRequest(question),false,question);
 for(const order of ["Crée une image.","Envoie ma campagne.","Modifie mes réglages."]) assert.equal(isBasicAssistantExecutionRequest(order),true,order);
});

test("drafting a prompt is distinct from requesting a media action, including natural wishes", () => {
  assert.deepEqual(inrAssistantRequiredTools("Écris-moi un prompt pour un flyer présentant mes trois abonnements."), []);
  for (const instruction of ["Je voudrais une image pour mon atelier.", "Je veux un logo pour mon entreprise.", "Crea una imagen de mi taller.", "Erstelle ein Bild von meiner Werkstatt."]) assert.deepEqual(inrAssistantRequiredTools(instruction), ["generateMedia"], instruction);
  assert.deepEqual(inrAssistantRequiredTools("Comment créer une image puis publier sur Facebook ?"), []);
});

test("coordinated requests keep their own action and target instead of borrowing another clause's verb", () => {
  assert.deepEqual(inrAssistantRequiredTools("Modifie mon logo et prépare ma campagne mail."), ["modifyMedia", "prepareCampaignEmail"]);
  assert.deepEqual(inrAssistantRequiredTools("Crée une image puis ajoute le tag Promotion dans ma médiathèque."), ["generateMedia", "updateMediaMetadata"]);
  assert.deepEqual(inrAssistantRequiredTools('Crée une image avec le texte "Publier sur Facebook".'), ["generateMedia"]);
  assert.deepEqual(inrAssistantRequiredTools("Crée une image pour publier sur Facebook."), ["generateMedia"]);
});

test("an explicit mail pronoun retains only its immediately preceding campaign target", () => {
  assert.deepEqual(inrAssistantRequiredTools("Retrouve mon brouillon de campagne mail puis envoie-le à claire@example.invalid."), ["dispatchCampaignDraft"]);
  assert.deepEqual(inrAssistantRequiredTools("Prépare une campagne mail puis envoie-la à claire@example.invalid."), ["prepareCampaignEmail", "dispatchCampaignDraft"]);
  assert.deepEqual(inrAssistantRequiredTools("Retrouve mon email puis envoie le à claire@example.invalid."), ["dispatchCampaignDraft"]);
  for (const [instruction, expected] of [
    ["Retrouve ma campagne mail puis crée une image.", ["generateMedia"]],
    ["Retrouve ma campagne mail puis ajoute un contact CRM.", ["manageCrmContact"]],
    ["Retrouve ma campagne mail puis modifie mon logo.", ["modifyMedia"]],
    ["Retrouve ma campagne mail puis envoie le contact CRM à Claire.", []],
    ["Retrouve ma campagne mail puis retrouve mon image et envoie-la à Claire.", []],
    ["Retrouve ma campagne mail. Crée une image puis envoie-la à Claire.", ["generateMedia"]],
  ] as const) assert.deepEqual(inrAssistantRequiredTools(instruction), expected, instruction);
});

test("a denied coordinated action never erases an independently requested media creation", () => {
  for (const instruction of ["Crée une image et ne publie rien.", "Ne publie rien et crée une image.", "Crée une image et n’envoie pas de campagne mail.", "Create an image and do not publish anything."]) {
    assert.deepEqual(inrAssistantRequiredTools(instruction), ["generateMedia"], instruction);
  }
  assert.deepEqual(inrAssistantRequiredTools("Retrouve ma campagne mail puis ne l’envoie pas."), []);
  assert.deepEqual(inrAssistantRequiredTools("Crée une image puis ajoute un contact CRM."), ["generateMedia", "manageCrmContact"]);
  assert.deepEqual(inrAssistantRequiredTools("Ajoute un contact CRM puis crée une image."), ["manageCrmContact", "generateMedia"]);
});

test("customers and contact verbs inside a creative brief never become CRM mutation goals", () => {
  for (const instruction of ["Create an image inviting customers to contact our support team.", "Crée une image pour inviter les clients à contacter notre équipe.", "Crée une publication pour contacter notre équipe."]) {
    assert.deepEqual(inrAssistantRequiredTools(instruction), [instruction.includes("publication") ? "preparePublication" : "generateMedia"], instruction);
  }
  for (const instruction of ["Crée un contact pour Claire.", "Ajoute Claire à mon CRM.", "Add a contact for Claire.", "Modifie le téléphone du client Claire."]) assert.deepEqual(inrAssistantRequiredTools(instruction), ["manageCrmContact"], instruction);
});

test("only a real media order can be confirmed; a drafting offer never grants paid generation", () => {
  const question = "Voulez-vous que je lance directement cette génération dans Studio ?";
  const media = task("Crée un flyer pour mon atelier.", question);
  assert.equal(continueInrAssistantTask("Oui", media, now), media.instruction);
  assert.equal(continueInrAssistantTask("Oui", task("Écris un prompt pour un flyer.", question), now), null);
  assert.equal(continueInrAssistantTask("Oui", task("Crée une image.", "Quel format souhaitez-vous ?"), now), null);
  assert.equal(continueInrAssistantTask("Oui", {...media, receipts:[{tool:"generateMedia",ok:false,status:"unknown",message:"État à vérifier"}]}, now), null);
  assert.match(continueInrAssistantTask("Carré", task("Crée une image de mon atelier.", "Quel format souhaitez-vous ?"), now) ?? "", /Format choisi : Carré/);
  assert.match(continueInrAssistantTask("Notre offre d’automne", task("Crée une image.", "Quel sujet souhaitez-vous ?"), now) ?? "", /Sujet précisé.*offre d’automne/);
});

test("several contacts require distinct saved records before reporting completion or closing the tools", () => {
  const instruction = "Crée deux contacts CRM : Alice et Bob.";
  const requiredCalls = inrAssistantRequiredCalls(instruction);
  assert.deepEqual(requiredCalls, {manageCrmContact:2});
  const first = {tool:"manageCrmContact",ok:true,status:"created",id:"10000000-0000-4000-8000-000000000001",message:"Alice enregistrée"};
  const second = {...first,id:"10000000-0000-4000-8000-000000000002",message:"Bob enregistré"};
  assert.equal(inrAssistantGoalCompleted("manageCrmContact", [first], requiredCalls), false);
  assert.equal(inrAssistantTaskOutcome(["manageCrmContact"], [first,first], "", requiredCalls), "partial");
  assert.equal(inrAssistantTaskOutcome(["manageCrmContact"], [first,second], "", requiredCalls), "completed");
  assert.equal(continueInrAssistantTask("Continue", {...task(instruction,""),outcome:"partial",requiredCalls,receipts:[first]}, now), instruction);
});

test("tracking capacity refuses oversized work and includes the saved publication prerequisite", () => {
  assert.equal(INR_ASSISTANT_MAX_TRACKED_ACTIONS, 24);
  assert.equal(inrAssistantTaskTrackingLimit(["manageCrmContact"], {manageCrmContact:24}), null);
  for (const count of [25,26,33,1_000_000,Number.NaN,0,-1]) assert.match(inrAssistantTaskTrackingLimit(["manageCrmContact"], {manageCrmContact:count}) ?? "", /24 actions/);
  assert.equal(inrAssistantTaskTrackingLimit(["manageCrmContact","generateMedia"], {manageCrmContact:23}), null);
  assert.match(inrAssistantTaskTrackingLimit(["manageCrmContact","generateMedia"], {manageCrmContact:24}) ?? "", /24 actions/);
  assert.equal(inrAssistantTaskTrackingLimit(["manageCrmContact","executePublication"], {manageCrmContact:22}), null);
  assert.match(inrAssistantTaskTrackingLimit(["manageCrmContact","executePublication"], {manageCrmContact:23}) ?? "", /24 actions/);
});

test("receipt compaction preserves early distinct confirmations through repeated retry events", () => {
  const requiredTools=["manageCrmContact"], requiredCalls={manageCrmContact:24};
  const confirmed=Array.from({length:23},(_,index)=>({tool:"manageCrmContact",ok:true,status:"created",id:`10000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,message:`Contact ${index+1} enregistré`}));
  const failure={tool:"manageCrmContact",ok:false,status:"unavailable",message:"Le dernier contact reste à confirmer"};
  const compacted=compactInrAssistantTaskReceipts([...confirmed,...Array.from({length:40},()=>confirmed[0]),...Array.from({length:40},()=>failure)],requiredTools,requiredCalls);
  assert.equal(compacted.length,24);
  assert.deepEqual(new Set(compacted.filter(receipt=>receipt.ok).map(receipt=>receipt.id)),new Set(confirmed.map(receipt=>receipt.id)));
  assert.equal(inrAssistantTaskOutcome(requiredTools,compacted,"",requiredCalls),"partial");
  const completed=compactInrAssistantTaskReceipts([...compacted,{...confirmed[0],id:"10000000-0000-4000-8000-000000000024"}],requiredTools,requiredCalls);
  assert.equal(completed.length,24);
  assert.equal(inrAssistantTaskOutcome(requiredTools,completed,"",requiredCalls),"completed");
});

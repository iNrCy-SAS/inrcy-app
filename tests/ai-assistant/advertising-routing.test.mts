import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantRequiredTools } from "../../lib/inrAssistantTaskPolicy.ts";
import { permitsInrAssistantMediaAction } from "../../lib/inrAssistantMediaIntent.ts";
import { selectInrAssistantToolFamilies } from "../../lib/inrAssistantToolRouting.ts";
import { createInrAssistantReadBudget, inrAssistantObjectives, inrAssistantReadMatchesObjective } from "../../lib/inrAssistantObjectives.ts";

const campaignId = "30000000-0000-4000-8000-000000000003";

test("named advertising spend, launch checks and Google drafts select ADS rather than mail", () => {
  for (const message of [
    "Combien la campagne Atelier Paris a-t-elle réellement dépensé cette semaine ?",
    "Vérifie si ma campagne Atelier Paris est prête à être lancée, sans lancer de diffusion.",
    "Prépare un brouillon de campagne Google à 20 € par jour jusqu’au 2026-11-20.",
    "Lis le budget et les clics de ma campagne Meta.",
  ]) assert.equal(selectInrAssistantToolFamilies(message).has("advertising"), true, message);
  assert.deepEqual(inrAssistantRequiredTools("Prépare un brouillon de campagne Google à 20 € par jour jusqu’au 2026-11-20. Explique ensuite les réglages à valider."), ["prepareAdvertisingCampaign"]);
  for (const message of ["Prépare une campagne mail à propos de Google.", "Liste les clics de ma campagne newsletter.", "Combien ma campagne email a-t-elle coûté ?"])
    assert.equal(selectInrAssistantToolFamilies(message).has("advertising"), false, message);
  assert.deepEqual(inrAssistantRequiredTools("Prépare une campagne mail à propos de Google."), ["prepareCampaignEmail"]);
});

test("advertising discovery never makes advice, quoted text or deferred approval an action goal", () => {
  for (const message of [
    "Comment préparer une campagne Google à 20 € par jour ?",
    "Explique « Prépare une campagne Google à 20 € par jour ».",
    "Si Julie confirme, prépare une campagne Google à 20 € par jour.",
    "Prépare une campagne Google à 20 € par jour seulement après validation de Julie.",
    "Imagine que je te demande de préparer une campagne Google à 20 € par jour.",
    "Ne prépare pas de campagne Google.",
  ]) assert.deepEqual(inrAssistantRequiredTools(message), [], message);
  assert.deepEqual(inrAssistantRequiredTools("Prépare une campagne Google puis envoie-la à alice@example.invalid."), ["prepareAdvertisingCampaign"]);
});

test("ADS list, actual metrics, details and preflight remain separate native read facets", () => {
  const listMetrics = inrAssistantObjectives("Liste mes campagnes ADS et donne les impressions, clics et dépenses réelles sur les 30 derniers jours pour Atelier Paris.");
  assert.deepEqual(listMetrics.map(objective => [objective.tool, objective.readMode]), [["readAdvertisingCampaigns", "list"], ["readAdvertisingCampaigns", "metrics"]]);
  const [, metrics] = listMetrics;
  assert.equal(inrAssistantReadMatchesObjective(metrics, "readAdvertisingCampaigns", { mode: "list", campaignId: null }), false);
  assert.equal(inrAssistantReadMatchesObjective(metrics, "readAdvertisingCampaigns", { mode: "metrics", campaignId }), true);
  for (const [message, modes] of [
    ["Combien la campagne Atelier Paris a-t-elle réellement dépensé cette semaine ?", ["list", "metrics"]],
    ["Vérifie si ma campagne Atelier Paris est prête à être lancée, sans lancer de diffusion.", ["list", "preflight"]],
    [`Lis les détails et les dépenses réelles de la campagne ADS ${campaignId}.`, ["details", "metrics"]],
  ] as const) assert.deepEqual(inrAssistantObjectives(message).map(objective => objective.readMode), modes, message);
  const specific = inrAssistantObjectives(`Lis les dépenses de la campagne ADS ${campaignId}.`)[0];
  assert.equal(inrAssistantReadMatchesObjective(specific, "readAdvertisingCampaigns", { mode: "metrics", campaignId: "30000000-0000-4000-8000-000000000004" }), false);
  assert.equal(inrAssistantReadMatchesObjective(specific, "readAdvertisingCampaigns", { mode: "metrics", campaignId }), true);
  for (const message of ["Comment lire les dépenses de ma campagne Google ?", "Ne lis pas les dépenses de ma campagne ADS.", "Si je confirme, lis les dépenses de ma campagne ADS.", "Lis ce texte : « Liste mes campagnes ADS ». "])
    assert.deepEqual(inrAssistantObjectives(message), [], message);
});

test("ADS reads admit distinct facets after two calls while blocking repeats, skipped pages and unbounded targets", () => {
  const budget = createInrAssistantReadBudget();
  const first = budget.start("readAdvertisingCampaigns", { mode: "list", campaignId: null, offset: 0 }); assert.ok(first);
  budget.finish(first, { ok: true, nextOffset: 12 });
  assert.equal(budget.start("readAdvertisingCampaigns", { mode: "list", campaignId: null, offset: 0 }), null);
  assert.equal(budget.start("readAdvertisingCampaigns", { mode: "list", campaignId: null, offset: 24 }), null);
  const second = budget.start("readAdvertisingCampaigns", { mode: "list", campaignId: null, offset: 12 }); assert.ok(second); budget.finish(second, { ok: true, nextOffset: null });
  for (const mode of ["details", "metrics", "preflight"]) {
    assert.equal(budget.available("readAdvertisingCampaigns"), true);
    const attempt = budget.start("readAdvertisingCampaigns", { mode, campaignId, offset: 0 }); assert.ok(attempt, mode); budget.finish(attempt, { ok: true });
    assert.equal(budget.start("readAdvertisingCampaigns", { mode, campaignId, offset: 0 }), null, mode);
  }
  for (let index = 0; index < 3; index++) {
    const attempt = budget.start("readAdvertisingCampaigns", { mode: "metrics", campaignId: `campaign-${index}`, offset: 0 }); assert.ok(attempt); budget.finish(attempt, { ok: true });
  }
  assert.equal(budget.available("readAdvertisingCampaigns"), false);
  assert.equal(budget.start("readAdvertisingCampaigns", { mode: "metrics", campaignId: "ninth-campaign", offset: 0 }), null);
});

test("preview saving questions do not leave a phantom save task, while a current save order remains tracked", () => {
  for (const message of [
    "Si je clique sur Enregistrer cet aperçu, sera-t-il publié aussi ? Explique seulement : ne valide pas et ne conserve pas encore cet aperçu.",
    "Que se passe-t-il si je conserve cet aperçu ?",
    "Après confirmation de Julie, conserve cet aperçu.",
    "Imagine que je conserve cet aperçu.",
  ]) assert.deepEqual(inrAssistantRequiredTools(message), [], message);
  for (const message of ["Enregistre cet aperçu.", "Enregistre cet aperçu dans mes médias.", "Conserve cet aperçu.", "Enregistre maintenant cet aperçu dans Mes médias. Conserve son contenu et ne le publie pas."])
    assert.deepEqual(inrAssistantRequiredTools(message), ["acceptMediaGeneration"], message);
  assert.deepEqual(inrAssistantRequiredTools("Enregistre cet aperçu, puis crée un contact CRM Alice."),["acceptMediaGeneration","manageCrmContact"]);
  assert.deepEqual(inrAssistantRequiredTools("Enregistre cet aperçu. Ne l’enregistre pas encore."),[]);
});

test("a CRM detail request must read the fiche after finding its reference", () => {
  for (const message of [
    "Lis la fiche CRM Alice Martin et donne son téléphone et son adresse de facturation ; si les champs sont vides, dis-le.",
    "Lis la note de la fiche CRM Alice Martin et résume-la sans changer de fiche ni envoyer.",
  ]) {
    const plan = inrAssistantObjectives(message);
    assert.deepEqual(plan.map(objective => objective.tool), ["searchCrmContacts", "readCrmContact"], message);
    assert.equal(inrAssistantReadMatchesObjective(plan[1], "searchCrmContacts", {query:"Alice Martin"}), false);
    assert.equal(inrAssistantReadMatchesObjective(plan[1], "readCrmContact", {contactId:campaignId,reference:"Alice Martin"}), true);
    assert.deepEqual(inrAssistantRequiredTools(message), [], message);
  }
  assert.deepEqual(inrAssistantObjectives("Cherche les contacts CRM Alice.").map(objective => objective.tool), ["searchCrmContacts"]);
});

test("replacing one CRM field is an explicit mutation even after a location prefix", () => {
  assert.deepEqual(inrAssistantRequiredTools("Dans le CRM, remplace uniquement le téléphone du client Alice Martin par 0601020304."), ["manageCrmContact"]);
  for (const message of ["Comment remplacer le téléphone du client Alice Martin dans le CRM ?", "Dans le CRM, ne remplace pas le téléphone du client Alice.", "Si Julie confirme, remplace le téléphone du client Alice dans le CRM.", "Explique « Dans le CRM, remplace le téléphone du client Alice ». "])
    assert.deepEqual(inrAssistantRequiredTools(message), [], message);
});

test("a requested full mail history follows next pages without borrowing exhaustive words from another clause", () => {
  for(const message of [
    "Lis tout l’historique des mails envoyés depuis atelier@example.invalid, pages suivantes comprises, et résume sans envoyer.",
    "Lis toute la liste de l’historique des mails envoyés.",
    "Lis l’historique des mails envoyés, pages suivantes comprises.",
  ]) {
    const [objective]=inrAssistantObjectives(message);
    assert.equal(objective.tool,"readIndividualMailHistory",message);assert.equal(objective.exhaustive,true,message);
  }
  const [ordinary]=inrAssistantObjectives("Lis l’historique des mails envoyés, puis explique toutes les options.");
  assert.equal(ordinary.exhaustive,false);
});

test("explicit campaign drafts and subject edits remain mail actions when sending is denied", () => {
  assert.deepEqual(inrAssistantRequiredTools("Prépare une campagne mail Offrir pour notre révision de vélos : remise de 10 %, sans destinataire et sans envoi."), ["prepareCampaignEmail"]);
  const multiple="Prépare deux brouillons de campagne mail : une newsletter Informer et un remerciement Suivre, sans rien envoyer.";
  assert.deepEqual(inrAssistantRequiredTools(multiple), ["prepareCampaignEmail"]);
  assert.equal(inrAssistantObjectives(multiple)[0].count,2);
  assert.deepEqual(inrAssistantRequiredTools("Modifie uniquement l’objet du brouillon de campagne Révision en Bonjour, sans envoi."), ["updateCampaignDraft"]);
  assert.deepEqual(inrAssistantObjectives("Lis le statut et les compteurs de la campagne mail 50000000-0000-4000-8000-000000000001, sans la relancer.").map(objective=>[objective.kind,objective.tool]), [["read","readCampaignDeliveryStatus"]]);
  for(const message of ["Comment préparer une campagne mail sans l’envoyer ?", "Ne prépare pas de campagne mail.", "Prépare une campagne mail si Julie confirme.", "Si Julie est disponible, prépare une newsletter.", "Modifie l’objet du brouillon de campagne seulement après validation de Julie."])
    assert.deepEqual(inrAssistantRequiredTools(message),[],message);
});

test("an explicitly attached invoice targets its file reader and never borrows native accounting rights", () => {
  for(const message of ["Quel est le montant total de la facture scannée jointe ? Réponds à partir du fichier seulement.", "Lis la facture dans la pièce jointe.", "Analyse le scan joint du devis."])
    assert.deepEqual(inrAssistantObjectives(message).map(objective=>objective.tool),["readAttachedDocument"],message);
  const fileOnly="Quel est le montant total de la facture scannée jointe ?";
  assert.equal(selectInrAssistantToolFamilies(fileOnly).has("commercial"),false);
  const mixed="Lis la facture jointe, puis consulte mes factures commerciales dans l’application.";
  assert.deepEqual(inrAssistantObjectives(mixed).map(objective=>objective.tool),["readAttachedDocument","readCommercialDocuments"]);
  assert.equal(selectInrAssistantToolFamilies(mixed).has("commercial"),true);
  assert.deepEqual(inrAssistantObjectives("Comment lire le montant d’une facture jointe ?"),[]);
});

test("current attachment context distinguishes this video from the account media library", () => {
  const context={attachedFiles:[{kind:"video" as const}]};
  const message="Analyse cette vidéo de dix minutes : que se passe-t-il précisément à la sixième minute et entre les images ? Dis aussi jusqu’où tu as réellement pu écouter.";
  assert.deepEqual(inrAssistantObjectives(message,[],context),[]);
  assert.equal(inrAssistantObjectives("Analyse mes vidéos de la médiathèque.",[],context)[0].tool,"searchMedia");
  assert.equal(inrAssistantObjectives("Analyse cette image.",[],context)[0].tool,"searchMedia","a video attachment cannot stand in for a requested image");
  assert.equal(inrAssistantObjectives(message)[0].tool,"searchMedia","a deictic reference alone is not attachment evidence");
  const mixed=inrAssistantObjectives("Analyse cette vidéo, puis consulte mes images de la médiathèque.",[],context);
  assert.deepEqual(mixed.map(objective=>objective.tool),["searchMedia"]);
});

test("a temporary preview order retains generation permission while refusing saving and publication", () => {
  const message="Génère maintenant un aperçu d’image carrée d’un vélo rouge sur fond blanc, sans texte. Garde uniquement l’aperçu temporaire : ne l’enregistre pas dans Mes médias et ne le publie pas.";
  assert.equal(permitsInrAssistantMediaAction(message,"generate","image"),true);
  assert.deepEqual(inrAssistantRequiredTools(message),["generateMedia"]);
  for(const denied of [
    "Ne génère pas d’aperçu d’image et ne publie rien.",
    "Explique « Génère un aperçu d’image sans l’enregistrer ».",
    "Génère un aperçu d’image seulement après validation de Julie.",
    "Si Julie est disponible, génère un aperçu d’image.",
  ]) {assert.equal(permitsInrAssistantMediaAction(denied,"generate","image"),false,denied);assert.deepEqual(inrAssistantRequiredTools(denied),[],denied);}
});

test("a native media quote uses its own read facet without a phantom credit-ledger or commercial-document goal",()=>{
  const prompt="Donne-moi le devis réel en crédits pour une image carrée d’un vélo bleu sans texte, avec le moteur FLUX.2 Pro. Ne génère pas l’image, ne réserve pas de crédits et n’enregistre rien.";
  assert.deepEqual(inrAssistantObjectives(prompt).map(objective=>objective.tool),["quoteMediaGeneration"]);
  assert.deepEqual(inrAssistantRequiredTools(prompt),[]);
  assert.deepEqual(inrAssistantObjectives("Prépare un devis pour une vidéo de 8 secondes.").map(objective=>objective.tool),["quoteMediaGeneration"]);
  assert.deepEqual(inrAssistantRequiredTools("Prépare un devis pour une vidéo de 8 secondes."),[]);
  assert.deepEqual(inrAssistantObjectives("Donne le devis pour une image et mon solde de crédits.").map(objective=>objective.tool),["quoteMediaGeneration","readAccountServices"]);
  assert.equal(inrAssistantObjectives("Combien de crédits me restent pour les images ?")[0].tool,"readAccountServices");
  assert.equal(inrAssistantObjectives("Quel est le montant du devis dans l’image jointe ?")[0].tool,"readAttachedDocument");
  assert.deepEqual(inrAssistantRequiredTools("Génère une image de mon atelier avec un budget limité."),["generateMedia"]);
});

test("information requests for an existing preview, public research and offer comparison never create unrelated writes or file reads",()=>{
  const preview="Quel est l’état de l’image en aperçu ? Vérifie seulement son statut : ne l’enregistre pas, ne la supprime pas, ne relance rien.";
  assert.deepEqual(inrAssistantRequiredTools(preview),[]);assert.deepEqual(inrAssistantObjectives(preview).map(objective=>objective.tool),["getMediaGeneration"]);
  const web="Recherche sur Internet les nouveautés publiques sur les batteries solides en 2026. Ne transmets aucune information du fichier interne joint ; cite uniquement les sources obtenues par la recherche.";
  assert.deepEqual(inrAssistantObjectives(web).map(objective=>objective.tool),["searchPublicWeb"]);
  const comparison="Compare clairement Basique, Standard et Premium : Studio, agents, CRM, mails, agenda et ADS. Est-ce que Premium permet aussi de fusionner automatiquement des contacts ou de gérer la boîte de réception Gmail ? Ceci est une question, pas un ordre.";
  assert.deepEqual(inrAssistantRequiredTools(comparison),[]);
  assert.deepEqual(inrAssistantRequiredTools("Compare les fiches CRM, puis crée un contact CRM Alice."),["manageCrmContact"]);
});

test("a repeated preview status retains its target without swallowing an independent audio or attached-file read",()=>{
  assert.deepEqual(inrAssistantObjectives("Vérifie le statut de l’aperçu, puis vérifie seulement son état.").map(objective=>objective.tool),["getMediaGeneration"]);
  assert.deepEqual(inrAssistantObjectives("Vérifie le statut de l’aperçu, puis recherche mes sons dans la médiathèque.").map(objective=>objective.tool),["getMediaGeneration","searchMedia"]);
  assert.deepEqual(inrAssistantObjectives("Recherche sur Internet les batteries solides, puis lis le document joint.").map(objective=>objective.tool),["searchPublicWeb","readAttachedDocument"]);
  assert.deepEqual(inrAssistantObjectives("Donne le devis d’une image, puis consulte mon solde de crédits.").map(objective=>objective.tool),["quoteMediaGeneration","readAccountServices"]);
});

import { inrAssistantActionObjectives, inrAssistantRequiredCalls, inrAssistantRequestClauses, inrAssistantRoutingText, inrAssistantClauseIsAdvice, inrAssistantGoalCompleted, isInrAssistantAdvertisingRequest, isInrAssistantAttachedFileRequest, isInrAssistantMediaQuoteRequest, isInrAssistantMediaStatusRequest, type InrAssistantActionReceipt } from "./inrAssistantTaskPolicy.ts";
import { hasInrAssistantDeferredApproval } from "./inrAssistantActionClause.ts";
import { readInrAssistantCommunicationIntent } from "./inrAssistantCommunicationIntent.ts";
import { INR_ASSISTANT_COMMANDS, type InrAssistantCommandFamily } from "./inrAssistantCommandRegistry.ts";
import { getInrAssistantBasicShopReadView } from "./inrAssistantBasicShopRead.ts";
import { inrAssistantUiStepTool, type InrAssistantUiStep } from "./inrAssistantUiTask.ts";
/** A plan is bookkeeping, never authority to execute a native command. */
export type InrAssistantObjective = {
    id: string;
    kind: "read" | "action" | "ui";
    tool: string;
    instruction: string;
    count: number;
    exhaustive?: boolean;
    /** Internal plan facet; native tool schemas and permission checks are unchanged. */
    readMode?: "list" | "details" | "metrics" | "preflight";
    campaignId?: string;
    workspaceSection?: "crm";
};
export type InrAssistantObjectiveContext = { attachedFiles?: ReadonlyArray<{kind:"image"|"video"|"audio"|"document"}> };
const diagnosticReader = {
    tool: "getAccountDiagnostics", family: "business" as const, label: "vérifier les signaux du problème signalé",
    matches: /\b(?:diagnosti\w*|erreurs?|errors?|echecs?|echou\w*|incidents?|dysfonctionn\w*|fail(?:ed|ures?|ing|s)?|problemes?|bugs?|pannes?|bloqu\w*|impossible)\b|\bne fonctionne|日志|错误/,
};
const diagnosticReadVerbs = "(?:lis|lire|consulte\\w*|verifi\\w*|regarde\\w*|analyse\\w*|diagnosti\\w*|read|check|inspect|investigate)";
const deniedDiagnosticRead = new RegExp(`\\b(?:ne\\s+|n'|do not\\s+|don't\\s+|never\\s+|not\\s+)${diagnosticReadVerbs}\\b|\\b${diagnosticReadVerbs}\\s+(?:pas|jamais|not)\\b|\\b(?:sans|pas de|aucun)\\s+diagnostic\\b`);
const deferredDiagnosticRead = /^(?:si|quand|lorsque|if|when|unless|imagin\w*|suppos\w*)\b|\b(?:si|quand|lorsque|if|when|unless)\s+(?:je|j'|tu|vous|nous|on|il|elle|le|la|les|un|une|the|i|you|we|they)\b|\b(?:en cas de|a condition|sous reserve|only if|apres (?:ma|mon|notre|votre) (?:confirmation|accord))\b/;
const exhaustiveRead = /\b(?:tout|toute|tous|toutes|chaque|complet\w*|integralite|all|every)\b|\bpages?\s+suivantes?\b/;

function personalDiagnosticQuestion(clause: string, nearbyContext = clause): boolean {
    const why = /^(?:pourquoi|why)\b/.test(clause);
    const explainCause = /^(?:explique|explain)\b/.test(clause)
        && /\b(?:pourquoi|cause|blocage|ce qui (?:bloqu\w*|echou\w*)|what (?:blocks?|failed))\b/.test(clause);
    return (why || explainCause) && diagnosticReader.matches.test(clause)
        && /\b(?:ma|mon|mes|notre|nos|my|our)\s+.{0,65}\b(?:publications?|posts?|canaux|canal|connexions?|generations?|images?|videos?|campagnes?|mails?|envois?|application|inrcy|comptes?|cockpit)\b/.test(why ? clause : nearbyContext)
        && !/\b(?:pourrait|pourraient|devrait|devraient|risquerait|hypothetique|imagine|suppose|might|would|could)\b/.test(clause);
}

/** Select a scoped reader from the unquoted current problem or read request.
 * This does not grant any retry, mutation, provider access or administration. */
export function isInrAssistantAccountDiagnosticRequest(message: string): boolean {
    const clauses = inrAssistantRequestClauses(message), text = clauses.join(" ");
    if (deniedDiagnosticRead.test(text) || deferredDiagnosticRead.test(text)) return false;
    return clauses.some((clause, index) => diagnosticReader.matches.test(clause)
        && (!inrAssistantClauseIsAdvice(clause) || personalDiagnosticQuestion(clause, clauses.slice(Math.max(0, index - 2), index + 1).join(" ")))
        && !/^(?:ne\b|n['’]|not\b|never\b|imagine\b|suppose\b)/.test(clause));
}
const readers: Array<{
    tool: string;
    family: InrAssistantCommandFamily;
    label: string;
    matches: RegExp;
}> = [
    diagnosticReader,
    {tool:"quoteMediaGeneration",family:"media",label:"lire le devis média demandé",matches:/devis|cout|tarif|prix|quote|cost/},
    {tool:"getMediaGeneration",family:"media",label:"vérifier le statut de la création demandée",matches:/apercu|creation|generation|preview/},
    {tool:"searchPublicWeb",family:"business",label:"effectuer la recherche publique demandée",matches:/internet|web|en ligne/},
    {tool:"readAccountServices",family:"management",label:"consulter les informations du compte demandées",matches:/notifications?|abonnement|credits?|recharges?|rgpd|donnees personnelles|cookies?|parrainage/},
    {tool:"readGeneratorBusinessSettings",family:"business",label:"consulter les hypothèses des estimations",matches:/panier moyen|taux de (?:conversion|transformation)|hypotheses? (?:du generateur|des estimations)/},
    {tool:"readSocialPublicationPreferences",family:"business",label:"consulter les préférences globales de formats",matches:/(?:facebook|instagram|threads).{0,60}(?:preferences?|reglages?|formats? par defaut)|(?:preferences?|reglages?|formats? par defaut).{0,60}(?:facebook|instagram|threads)/},
    {tool:"readBusinessDnaSchedule",family:"business",label:"consulter la programmation mensuelle ADN",matches:/(?:adn|dna).{0,50}(?:programm|mensuel|planifi)|(?:programm|mensuel|planifi).{0,50}(?:adn|dna)/},
    {tool:"readBusinessDnaSources",family:"business",label:"consulter les sources et documents ADN",matches:/(?:adn|dna).{0,50}(?:sources?|documents?|fichiers?)|(?:sources?|documents?|fichiers?).{0,50}(?:adn|dna)/},
    {tool:"readWebsiteConfiguration",family:"business",label:"consulter la configuration du Site Web",matches:/ga4|search console|\bgsc\b|widget|google analytics/},
    {tool:"readNativeChannelPresentation",family:"business",label:"consulter la présentation du canal",matches:/(?:badge|search).{0,50}(?:theme|presentation|couleur|section|visibilite)|(?:theme|presentation|couleur|section|visibilite).{0,50}(?:badge|search)/},
    {tool:"readBusinessIdentity",family:"business",label:"consulter l’identité de l’entreprise",matches:/identite|coordonnees de (?:mon|notre)|profil entreprise|profession|metier|raison sociale/},
    {tool:"readChannelResources",family:"business",label:"lister les ressources de connexion accessibles",matches:/(?:pages?|fiches?|etablissements?|organisations?|tableaux).{0,50}(?:google|facebook|instagram|linkedin|pinterest)|(?:google|facebook|instagram|linkedin|pinterest).{0,50}(?:ressources?|pages disponibles|fiches disponibles|etablissements disponibles|tableaux disponibles)/},
    {tool:"readStatsEvolution",family:"workspace",label:"consulter l’évolution mensuelle réelle",matches:/(?:stats|statistiq|evolution|visibilite|clics).{0,60}(?:mois|mensuel)|(?:mois|mensuel).{0,60}(?:stats|statistiq|evolution|visibilite|clics)/},
    { tool: "readToolSettings", family: "settings", label: "lire les réglages demandés", matches: /reglage|parametre|configuration|preference|notification/ },
    { tool: "readAdvertisingCampaigns", family: "advertising", label: "consulter la campagne publicitaire", matches: /publicit|\bads\b|sponsoris/ },
    { tool: "readScheduledPublications", family: "publication", label: "consulter les publications programmées", matches: /(?:publication|post).{0,50}(?:programm|planifi)|(?:programm|planifi).{0,50}(?:publication|post)/ },
    { tool: "readSendPublicationHistory", family: "publication", label: "consulter l’historique Publications iNr’Send", matches: /(?:inrsend|inr.send).{0,80}(?:historique|publication|brouillon)|(?:historique|publication|brouillon).{0,80}(?:inrsend|inr.send)/ },
    { tool: "readPublicationWorkspace", family: "publication", label: "retrouver les brouillons de publication", matches: /(?:brouillon|proposition|historique).{0,50}(?:publication|post)|(?:publication|post).{0,50}(?:brouillon|proposition|historique)/ },
    { tool: "getRecentPublications", family: "publication", label: "consulter les publications demandées", matches: /publication|\bposts?\b/ },
    { tool: "readAttachedDocument", family: "workspace", label: "lire le fichier joint demandé", matches: /(?:fichier|piece|document|scan).{0,90}joint/ },
    { tool: "readCommercialTemplates", family: "commercial", label: "consulter les modèles de documents", matches: /(?:modele|template).{0,60}(?:devis|facture|document)|(?:devis|facture|document).{0,60}(?:modele|template)/ },
    { tool: "readCommercialDocuments", family: "commercial", label: "lire les documents commerciaux", matches: /devis|facture|document commercial/ },
    { tool: "listIndividualMailboxes", family: "workspace", label: "consulter les boîtes expéditrices", matches: /boites?|expediteurs?/ },
    { tool: "readIndividualMailHistory", family: "workspace", label: "consulter l’historique des mails envoyés", matches: /(?:historique|envoyes).{0,45}(?:mail|courriel)|(?:mail|courriel).{0,45}(?:historique|envoyes)/ },
    { tool: "readCampaignDeliveryStatus", family: "workspace", label: "lire le statut natif de livraison de la campagne", matches: /(?:statut|etat|compteur|livraison|delivery).{0,80}(?:campagne|newsletter)|(?:campagne|newsletter).{0,80}(?:statut|etat|compteur|livraison|delivery)/ },
    { tool: "readCommunicationRecords", family: "workspace", label: "consulter les campagnes ou rendez-vous", matches: /campagne|mail|newsletter|courriel|agenda|rendez.vous|\brdv\b/ },
    { tool: "readCrmContact", family: "commercial", label: "lire la fiche CRM demandée", matches: /\b(?:fiche|details?|notes?|coordonnees|telephone|adresse|facturation)\b/ },
    { tool: "searchCrmContacts", family: "commercial", label: "retrouver les contacts demandés", matches: /\bcrm\b|contact|client|prospect/ },
    { tool: "getBusinessDna", family: "business", label: "lire l’ADN de l’entreprise", matches: /\badn\b|\bdna\b|mission|prestations|services de (?:mon|notre) entreprise/ },
    { tool: "searchMedia", family: "media", label: "rechercher les médias demandés", matches: /mediatheque|medias?|images?|photos?|videos?|audios?|\bsons?\b|visuels?|flyers?|logos?/ },
    { tool: "readStatsReports", family: "workspace", label: "consulter les rapports de statistiques", matches: /(?:rapports?|bilans?).{0,60}(?:stats|statistiq)|(?:stats|statistiq).{0,60}(?:rapports?|bilans?)/ },
    { tool: "readStatsSnapshots", family: "workspace", label: "consulter les statistiques", matches: /stats|statistiq|resultats?|performances?|impressions?/ },
    {tool:"listGoogleReviews",family:"workspace",label:"lister les avis Google avec filtres",matches:/(?:tous|toutes|chaque|sans reponse|non repondus|repondu|etoiles?|notes?|recents?|negatifs?|positifs?).{0,60}(?:avis|reviews?)|(?:avis|reviews?).{0,60}(?:tous|toutes|chaque|sans reponse|non repondus|repondu|etoiles?|notes?|recents?|negatifs?|positifs?)/},
    { tool: "readGoogleReviews", family: "workspace", label: "consulter les avis", matches: /\bavis\b|reputation|reviews?/ },
    { tool: "readChannelStatus", family: "business", label: "vérifier les connexions des canaux", matches: /canaux|canal|connexion|connecte|cockpit/ },
];
export function inrAssistantReadObjectives(message: string): InrAssistantObjective[] {
    return inrAssistantObjectives(message).filter(objective => objective.kind === "read");
}
export function inrAssistantObjectives(message: string, uiSteps: InrAssistantUiStep[] = [], context: InrAssistantObjectiveContext = {}): InrAssistantObjective[] {
    const actions = inrAssistantActionObjectives(message);
    const plan: InrAssistantObjective[] = [];
    const clauses = inrAssistantRequestClauses(message);
    const diagnosticDeferred = deniedDiagnosticRead.test(clauses.join(" ")) || deferredDiagnosticRead.test(clauses.join(" "));
    for (const [clauseIndex, clause] of clauses.entries()) {
        const screenStep = uiSteps.find(step => step.id === `ui_${clauseIndex}` && inrAssistantRequestClauses(step.instruction).length === 1 && inrAssistantRequestClauses(step.instruction)[0] === clause);
        if (screenStep) {
            plan.push({ id: screenStep.id, kind: "ui", tool: inrAssistantUiStepTool(screenStep), instruction: clause, count: 1 });
            continue;
        }
        const mutations = actions.filter(action => action.instruction === inrAssistantRoutingText(clause));
        for (const action of mutations)
            plan.push({ id: `objective_${plan.length}`, kind: "action", tool: action.tool, instruction: clause, count: inrAssistantRequiredCalls(clause)[action.tool] ?? 1 });
        const implicitDiagnostic = personalDiagnosticQuestion(clause, clauses.slice(Math.max(0, clauseIndex - 2), clauseIndex + 1).join(" ")) && !diagnosticDeferred;
        if (mutations.length || inrAssistantClauseIsAdvice(clause) && !implicitDiagnostic || /^(?:ne\b|n['’]|not\b|never\b|si\b|imagine\b|suppose\b)/.test(clause))
            continue;
        const mediaQuote=isInrAssistantMediaQuoteRequest(clause);
        if (!implicitDiagnostic && !getInrAssistantBasicShopReadView(clause) && !mediaQuote && !/^(?:(?:peux|pourrais)[- ]tu\s+|(?:pouvez|pourriez)[- ]vous\s+)?(?:lis|lire|consulte\w*|recherch\w*|cherche\w*|retrouv\w*|liste\w*|verifi\w*|regarde\w*|montre\w*|affiche\w*|analyse\w*|diagnostiqu\w*|compare\w*|donne\w*|quels?|quelles?|combien|read|find|search|list|show|check)\b/.test(clause))
            continue;
        if (mediaQuote) {
            plan.push({id:`objective_${plan.length}`,kind:"read",tool:"quoteMediaGeneration",instruction:clause,count:1});
            if (/\b(?:solde|credits? (?:restants?|disponibles?)|combien.{0,35}(?:reste|restent))\b/.test(clause))
                plan.push({id:`objective_${plan.length}`,kind:"read",tool:"readAccountServices",instruction:clause,count:1});
            continue;
        }
        // A same-object status follow-up does not turn the possessive "son"
        // into an audio-library search. The immediately preceding preview
        // read already fulfils this repeated, explicitly status-only request.
        const previousClause = clauses[clauseIndex - 1] ?? "";
        const repeatedPreviewStatus = isInrAssistantMediaStatusRequest(previousClause)
            && /^(?:verifi\w*|consulte\w*|montre\w*|affiche\w*|check|show)\s+(?:(?:seulement|uniquement|just|only)\s+)?(?:son|leur|le|the|its|their)\s+(?:statut|etat|status)(?:\s*:\s*(?:ne\b|n'|not\b|never\b)[^.!?]*)?[.!?]*$/.test(clause);
        if (repeatedPreviewStatus) continue;
        if (isInrAssistantMediaStatusRequest(clause)) {plan.push({id:`objective_${plan.length}`,kind:"read",tool:"getMediaGeneration",instruction:clause,count:1});continue;}
        if (/^(?:recherch\w*|cherche\w*|search|look up)\b/.test(clause) && /\b(?:internet|web|en ligne)\b/.test(clause)) {
            plan.push({id:`objective_${plan.length}`,kind:"read",tool:"searchPublicWeb",instruction:clause,count:1});continue;
        }
        const currentAttachedVisual = !/\b(?:mediatheque|bibliotheque|library)\b/.test(clause) && context.attachedFiles?.some(file =>
            file.kind === "video" ? /\b(?:ce|cet|cette|ces|this|these)\s+(?:(?:deux|trois|quatre|two|three|four|[1-4])\s+)?(?:videos?|clips?|films?)\b/.test(clause)
              : file.kind === "image" && /\b(?:ce|cet|cette|ces|this|these)\s+(?:(?:deux|trois|quatre|two|three|four|[1-4])\s+)?(?:images?|photos?|visuels?)\b/.test(clause));
        // The current model input already carries these bounded visual samples.
        // Their analysis is not an instruction to search the account library.
        if (currentAttachedVisual) {
            if (/\b(?:texte|transcription|verbatim)\b/.test(clause)) plan.push({ id: `objective_${plan.length}`, kind: "read", tool: "readAttachedDocument", instruction: clause, count: 1, exhaustive: exhaustiveRead.test(clause) });
            continue;
        }
        if (isInrAssistantAttachedFileRequest(clause)) {
            plan.push({ id: `objective_${plan.length}`, kind: "read", tool: "readAttachedDocument", instruction: clause, count: 1, exhaustive: exhaustiveRead.test(clause) });
            continue;
        }
        if (isInrAssistantAdvertisingRequest(clause)) {
            if (hasInrAssistantDeferredApproval(message) || deferredDiagnosticRead.test(clauses.join(" ")) && !/^verifi\w*\s+si\b/.test(clause)) continue;
            const campaignId = clause.match(/\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/i)?.[0];
            const modes: NonNullable<InrAssistantObjective["readMode"]>[] = [];
            if (/\b(?:details?|reglages?|parametres?|configuration|budget|dates?)\b/.test(clause)) modes.push("details");
            if (/\b(?:mesures?|metriques?|statistiques?|stats|performances?|impressions?|clics?|depens\w*|cout\w*|conversions?|roas|cpa|spend|spent|metrics)\b/.test(clause)) modes.push("metrics");
            if (/\b(?:preflight|pret\w*|prealable|prerequis)\b/.test(clause)) modes.push("preflight");
            if (!campaignId || /\b(?:liste\w*|list|toutes?|tous)\b/.test(clause) || !modes.length && /\bcampagnes\b/.test(clause)) modes.unshift("list");
            if (!modes.length) modes.push("details");
            for (const readMode of modes) plan.push({ id: `objective_${plan.length}`, kind: "read", tool: "readAdvertisingCampaigns", instruction: clause, count: 1, readMode,
                ...(campaignId && readMode !== "list" ? { campaignId } : {}), exhaustive: readMode === "list" && exhaustiveRead.test(clause) });
            continue;
        }
        // Counting contacts uses the anonymous account summary, not personal
        // fiches. In particular "sans noms ni adresses" is a restriction on
        // the aggregate read, never a request to retrieve those private fields.
        const crmAggregate = /\bcrm\b/.test(clause) && /\b(?:compteurs?|agreg\w*|counts?)\b/.test(clause)
            || /\b(?:nombre|total|totaux|combien)\s+(?:de|des|du|d')\s*(?:(?:mes?|nos?|les|tous les)\s+)?(?:contacts?|clients?|prospects?)\b/.test(clause)
            || /\b(?:total|totaux)\s+(?:(?:du|de mon|de notre|de ce)\s+)?crm\b/.test(clause);
        if (crmAggregate) {
            plan.push({ id: `objective_${plan.length}`, kind: "read", tool: "readWorkspaceSection", workspaceSection: "crm", instruction: clause, count: 1 });
            continue;
        }
        if (/\b(?:crm|contacts?|clients?|prospects?|fournisseurs?|partenaires?)\b/.test(clause)
            && /\b(?:fiches?|details?|notes?|coordonnees|telephones?|e-?mails?|adresses?|facturation|siret|tva)\b/.test(clause)) {
            if (hasInrAssistantDeferredApproval(message)) continue;
            if (!/\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/i.test(clause))
                plan.push({ id: `objective_${plan.length}`, kind: "read", tool: "searchCrmContacts", instruction: clause, count: 1 });
            plan.push({ id: `objective_${plan.length}`, kind: "read", tool: "readCrmContact", instruction: clause, count: 1 });
            continue;
        }
        if (readInrAssistantCommunicationIntent(clause).campaignDeliveryRead) {
            plan.push({ id: `objective_${plan.length}`, kind: "read", tool: "readCampaignDeliveryStatus", instruction: clause, count: 1 });
            continue;
        }
        const previous = clauses[clauseIndex - 1] ?? "";
        // Resolve a short diagnostic follow-up only against the immediately
        // preceding unquoted problem statement, never an arbitrary past topic.
        const diagnosticFollowup = /\b(?:verifi\w*|analyse\w*|regarde\w*)\b/.test(clause)
            && /\b(?:ce qui se passe|ce probleme|cet incident|la cause|le blocage)\b/.test(clause)
            && diagnosticReader.matches.test(previous) && !inrAssistantClauseIsAdvice(previous)
            && !/^(?:ne\b|n['’]|not\b|never\b|si\b|imagine\b|suppose\b)/.test(previous);
        const reader = getInrAssistantBasicShopReadView(clause) ? readers.find(reader => reader.tool === "readAccountServices") : implicitDiagnostic || diagnosticFollowup ? diagnosticReader : readers.find(reader => !["readCrmContact","quoteMediaGeneration","getMediaGeneration","searchPublicWeb"].includes(reader.tool) && reader.matches.test(clause) && !(reader.tool === "readAccountServices" && /notifications?/.test(clause) && /reglages?|parametres?|preferences?/.test(clause)));
        if (reader?.tool === "getAccountDiagnostics" && diagnosticDeferred)
            continue;
        if (reader)
            plan.push({ id: `objective_${plan.length}`, kind: "read", tool: reader.tool, instruction: clause, count: 1, exhaustive: exhaustiveRead.test(clause) });
    }
    return plan;
}
export function inrAssistantObjectiveFamily(tool: string): InrAssistantCommandFamily | undefined {
    if (tool === "readWorkspaceSection") return "workspace";
    if (["prepareCommercialDocumentForm", "prepareCurrentDocumentTemplate"].includes(tool)) return "commercial";
    return INR_ASSISTANT_COMMANDS[tool]?.family ?? readers.find(reader => reader.tool === tool)?.family;
}
export function inrAssistantObjectiveLabel(tool: string, readMode?: InrAssistantObjective["readMode"]): string {
    if (tool === "readWorkspaceSection") return "consulter la synthèse de l’établissement";
    if (tool === "readAdvertisingCampaigns" && readMode) return {list:"lister les campagnes publicitaires",details:"lire les réglages de la campagne publicitaire",metrics:"vérifier les mesures publicitaires réelles",preflight:"effectuer le contrôle préalable publicitaire natif"}[readMode];
    return INR_ASSISTANT_COMMANDS[tool]?.label ?? readers.find(reader => reader.tool === tool)?.label ?? "terminer la lecture demandée";
}

/** A tool alias is not enough: drafts/prepared publications never satisfy a
 * request for published history, even when the same native reader serves both. */
export function inrAssistantReadMatchesObjective(objective: InrAssistantObjective, tool: string, input?: unknown): boolean {
    if (objective.kind !== "read") return false;
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (objective.tool === tool) {
        if (tool === "readWorkspaceSection" && objective.workspaceSection) return value.section === objective.workspaceSection;
        if (tool === "readAdvertisingCampaigns" && objective.readMode) return value.mode === objective.readMode && (!objective.campaignId || value.campaignId === objective.campaignId);
        if (tool === "readAccountServices") { const text=objective.instruction; const expected=getInrAssistantBasicShopReadView(text) ?? (/factures?|recu/.test(text) && /abonnement|inrcy/.test(text) ? "invoices" : /historique|commandes?/.test(text) && /credits?|recharges?/.test(text) ? "credit_orders" : /notifications?/.test(text) ? "notifications" : /credits?|recharges?/.test(text) ? "credits" : /abonnement|subscription/.test(text) ? "subscription" : /rgpd|donnees personnelles|cookies?/.test(text) ? "privacy" : /parrainage/.test(text) ? "referral_program" : undefined); return !expected || value.view === expected; }
        if (tool !== "readPublicationWorkspace") return true;
        const expectedView = /brouillon/.test(objective.instruction) ? "drafts" : /proposition|prepare/.test(objective.instruction) ? "prepared" : /historique/.test(objective.instruction) ? "history" : null;
        return expectedView === null || value.view === expectedView;
    }
    if (objective.tool !== "getRecentPublications" || tool !== "readPublicationWorkspace") return false;
    return value.view === "history" && value.recordId == null;
}

function mayReadObjective(objective: InrAssistantObjective, tool: string): boolean {
    return objective.tool === tool || objective.tool === "getRecentPublications" && tool === "readPublicationWorkspace";
}
export function inrAssistantObjectiveCompleted(plan: InrAssistantObjective[], index: number, receipts: InrAssistantActionReceipt[], appliedUi: ReadonlySet<string> = new Set()): boolean {
    const objective = plan[index];
    if (objective.kind === "ui") return appliedUi.has(objective.id);
    if (objective.kind === "read")
        return receipts.some(receipt => receipt.tool === objective.tool && receipt.recordId === objective.id && receipt.ok && receipt.status === "read");
    const count = plan.slice(0, index + 1).filter(item => item.kind === "action" && item.tool === objective.tool).reduce((sum, item) => sum + item.count, 0);
    return inrAssistantGoalCompleted(objective.tool, receipts, { [objective.tool]: count });
}
export function inrAssistantObjectiveReady(plan: InrAssistantObjective[], index: number, receipts: InrAssistantActionReceipt[], appliedUi: ReadonlySet<string> = new Set()): boolean {
    return plan.slice(0, index).every((_, previous) => inrAssistantObjectiveCompleted(plan, previous, receipts, appliedUi));
}
export function inrAssistantPlanAllowsAction(plan: InrAssistantObjective[], tool: string, receipts: InrAssistantActionReceipt[], appliedUi: ReadonlySet<string> = new Set()): boolean {
    const index = plan.findIndex((objective, i) => (objective.kind === "action" || objective.kind === "ui") && objective.tool === tool && !inrAssistantObjectiveCompleted(plan, i, receipts, appliedUi));
    // Discovery cannot bypass a pending browser step merely because a tool was
    // absent from the initial lexical plan.
    if (index < 0) return tool === "runScreenCommand" || tool === "navigateApplication" || !INR_ASSISTANT_COMMANDS[tool] || !plan.some((objective, i) => objective.kind === "ui" && !inrAssistantObjectiveCompleted(plan, i, receipts, appliedUi));
    return inrAssistantObjectiveReady(plan, index, receipts, appliedUi);
}

const prerequisiteReaders: Record<string, string[]> = {
    updateGeneratorBusinessSettings:["readGeneratorBusinessSettings"], updateSocialPublicationPreferences:["readSocialPublicationPreferences"], updateBusinessDnaSchedule:["readBusinessDnaSchedule"], updateNativeChannelPresentation:["readNativeChannelPresentation"], updateWebsiteConfiguration:["readWebsiteConfiguration"],
    updateBusinessIdentity: ["readBusinessIdentity", "searchBusinessProfessions", "searchMedia"],
    applyChannelConfiguration: ["readChannelResources", "readChannelStatus"],
    applyGoogleReviewReplyAction: ["listGoogleReviews", "readGoogleReviews"],
    manageCrmContact: ["searchCrmContacts", "readCrmContact"],
    prepareCommercialDocument: ["searchCrmContacts", "readCrmContact", "readCommercialDocuments"],
    prepareCommercialDocumentForm: ["readCommercialTemplates", "readCommercialDocuments"],
    applyCommercialTemplateAction: ["readCommercialTemplates", "readCommercialDocuments"],
    updateCommercialDocument: ["readCommercialDocuments"],
    finalizeCommercialDocument: ["readCommercialDocuments"],
    manageAdvertisingCampaign: ["readAdvertisingCampaigns"],
    editPublication: ["getRecentPublications", "readPublishedPublicationForEdit"],
    applyPublishedPublicationEdit: ["getRecentPublications", "readPublishedPublicationForEdit"],
    editPreparedPublication: ["readPublicationWorkspace"],
    updateScheduledPublication: ["readScheduledPublications"],
    cancelScheduledPublication: ["readScheduledPublications"],
    editScheduledPublication: ["readScheduledPublications"],
    publishScheduledPublicationNow: ["readScheduledPublications"],
    reconcileExistingCreditOrder: ["readAccountServices"],
    resumePublicationDraft: ["readSendPublicationHistory"],
    openNotificationAction: ["readAccountServices"],
    applyNotificationRemoval: ["readAccountServices"],
    retryScheduledPublication: ["readScheduledPublications"],
    modifyMedia: ["searchMedia"],
    updateMediaMetadata: ["searchMedia"],
    applyMediaDeletion: ["searchMedia"],
    prepareMediaDownload: ["searchMedia"],
    replyToGoogleReview: ["readGoogleReviews"],
    sendIndividualMail: ["listIndividualMailboxes"],
    sendStatsReport: ["readStatsReports"],
    prepareStatsReportDownload: ["readStatsReports"],
    updateCalendarAppointment: ["readCommunicationRecords"],
    cancelCalendarAppointment: ["readCommunicationRecords"],
    dispatchCampaignDraft: ["readCommunicationRecords", "listCampaignMailboxes"],
    dispatchCampaignAudience: ["readCommunicationRecords", "listCampaignMailboxes", "searchCrmContacts"],
    selectCampaignMailbox: ["listCampaignMailboxes"],
    applyGoogleBusinessProfileUpdate: ["readGoogleBusinessProfile", "searchGoogleBusinessCategories"],
    managePublicationIdeas: ["readPublicationIdeas"],
    applyPublicationLifecycleAction: ["readPublicationWorkspace"],
};

/** Defer a later requested read while retaining native reference lookups needed
 * by an earlier mutation. Such prerequisite reads never complete the later goal. */
export function inrAssistantPlanAllowsRead(plan: InrAssistantObjective[], tool: string, receipts: InrAssistantActionReceipt[], appliedUi: ReadonlySet<string> = new Set()): boolean {
    const index = plan.findIndex((objective, position) => objective.kind === "read" && mayReadObjective(objective, tool) && !inrAssistantObjectiveCompleted(plan, position, receipts));
    if (index < 0 || inrAssistantObjectiveReady(plan, index, receipts, appliedUi)) return true;
    return plan.slice(0, index).some((objective, position) => objective.kind === "action" &&
        inrAssistantObjectiveReady(plan, position, receipts, appliedUi) && !inrAssistantObjectiveCompleted(plan, position, receipts, appliedUi) && prerequisiteReaders[objective.tool]?.includes(tool));
}
type ReadAttempt = {
    input: Record<string, unknown>;
    cursorKey: "offset" | "page" | "cursor";
    nextOffset?: number | string | null;
    exhaustiveObjective?: string;
    done: boolean;
};
/** Two ordinary reads remain allowed. Extra pages must follow a verified,
 * strictly increasing cursor for the same query; the global call budget remains. */
export function createInrAssistantReadBudget() {
    const attempts = new Map<string, ReadAttempt[]>();
    let attachmentReadCount = 0;
    const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
    const paginated = new Set(["readSendPublicationHistory", "readAccountServices", "listGoogleReviews", "searchMedia", "listIndividualMailboxes", "readIndividualMailHistory", "discoverCapabilities", "readStatsReports", "readScheduledPublications", "readPublicationWorkspace", "readAdvertisingCampaigns", "readAttachedDocument", "readCommercialTemplates"]);
    const sameSearch = (left: Record<string, unknown>, right: Record<string, unknown>) => [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(key => key !== "offset" && key !== "page" && key !== "cursor").every(key => JSON.stringify(left[key] ?? null) === JSON.stringify(right[key] ?? null));
    return {
        available(name: string) {
            if (name === "readAccountServices") return true;
            if (name === "readAttachedDocument") return attachmentReadCount < 8;
            const history = attempts.get(name) ?? [];
            if (name === "readAdvertisingCampaigns") return history.length < 8;
            const last = history.at(-1);
            return history.length < 2 || paginated.has(name) && last?.done === true && (typeof last.nextOffset === "number" || typeof last.nextOffset === "string");
        },
        start(name: string, input: unknown, exhaustiveObjective?: string): ReadAttempt | null {
            const current = row(input);
            if (name === "readAttachedDocument" && (attachmentReadCount >= 8 || !Number.isSafeInteger(current.documentIndex) || Number(current.documentIndex) < 1 || Number(current.documentIndex) > 4)) return null;
            const key = name === "readAccountServices" ? `${name}:${String(current.view)}` : name === "readAttachedDocument" ? `${name}:${String(current.documentIndex)}` : name;
            const history = attempts.get(key) ?? [];
            const last = history.at(-1);
            const cursorKey = name === "listGoogleReviews" ? "cursor" : name === "readIndividualMailHistory" ? "page" : "offset";
            if (name === "readAdvertisingCampaigns") {
                if (history.length >= 8) return null;
                if (current.mode === "list") {
                    const previous = history.filter(attempt => attempt.input.mode === "list").at(-1);
                    if (previous ? !previous.done || typeof previous.nextOffset !== "number" || current.offset !== previous.nextOffset || !sameSearch(previous.input, current) : current.offset !== 0) return null;
                } else if (!["details", "metrics", "preflight"].includes(String(current.mode)) || typeof current.campaignId !== "string" || current.offset !== 0 || history.some(attempt => attempt.input.mode === current.mode && attempt.input.campaignId === current.campaignId)) return null;
            }
            if (exhaustiveObjective && paginated.has(name)) {
                const previous = history.filter(attempt => attempt.exhaustiveObjective === exhaustiveObjective).at(-1);
                if (previous) {
                    if (!previous.done || (typeof previous.nextOffset !== "number" && typeof previous.nextOffset !== "string") || current[cursorKey] !== previous.nextOffset || !sameSearch(previous.input, current)) return null;
                } else if (cursorKey === "cursor" ? current.cursor != null : Number(current[cursorKey] ?? (cursorKey === "page" ? 1 : 0)) !== (cursorKey === "page" ? 1 : 0)) return null;
            }
            if (name !== "readAdvertisingCampaigns" && history.length >= 2 && !(paginated.has(name) && last?.done && (typeof last.nextOffset === "number" || typeof last.nextOffset === "string") && current[last.cursorKey] === last.nextOffset && sameSearch(last.input, current)))
                return null;
            const attempt: ReadAttempt = { input: current, cursorKey, exhaustiveObjective, done: false };
            history.push(attempt);
            attempts.set(key, history);
            if (name === "readAttachedDocument") attachmentReadCount++;
            return attempt;
        },
        finish(attempt: ReadAttempt, output: unknown) {
            const result = row(output);
            if (attempt.cursorKey === "cursor") {
                const next = result.nextCursor; attempt.done = true;
                attempt.nextOffset = result.ok !== false && result.available !== false && result.status !== "unknown" && typeof next === "string" && next.length > 0 && next.length <= 24000 && next !== attempt.input.cursor ? next : null;
                return;
            }
            const offset = Number(attempt.input[attempt.cursorKey] ?? (attempt.cursorKey === "page" ? 1 : 0));
            const next = result[attempt.cursorKey === "page" ? "nextPage" : "nextOffset"];
            attempt.done = true;
            attempt.nextOffset = result.ok !== false && result.available !== false && result.status !== "unknown" && Number.isSafeInteger(next) && Number(next) > offset ? Number(next) : null;
        },
    };
}

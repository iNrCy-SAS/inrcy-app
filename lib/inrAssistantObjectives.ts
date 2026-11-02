import { inrAssistantActionObjectives, inrAssistantRequiredCalls, inrAssistantRequestClauses, inrAssistantRoutingText, inrAssistantClauseIsAdvice, inrAssistantGoalCompleted, type InrAssistantActionReceipt } from "./inrAssistantTaskPolicy.ts";
import { INR_ASSISTANT_COMMANDS, type InrAssistantCommandFamily } from "./inrAssistantCommandRegistry.ts";
/** A plan is bookkeeping, never authority to execute a native command. */
export type InrAssistantObjective = {
    id: string;
    kind: "read" | "action";
    tool: string;
    instruction: string;
    count: number;
    exhaustive?: boolean;
};
const readers: Array<{
    tool: string;
    family: InrAssistantCommandFamily;
    label: string;
    matches: RegExp;
}> = [
    { tool: "readToolSettings", family: "settings", label: "lire les réglages demandés", matches: /reglage|parametre|configuration|preference|notification/ },
    { tool: "readAdvertisingCampaigns", family: "advertising", label: "consulter la campagne publicitaire", matches: /publicit|\bads\b|sponsoris/ },
    { tool: "readScheduledPublications", family: "publication", label: "consulter les publications programmées", matches: /(?:publication|post).{0,50}(?:programm|planifi)|(?:programm|planifi).{0,50}(?:publication|post)/ },
    { tool: "readPublicationWorkspace", family: "publication", label: "retrouver les brouillons de publication", matches: /(?:brouillon|proposition|historique).{0,50}(?:publication|post)|(?:publication|post).{0,50}(?:brouillon|proposition|historique)/ },
    { tool: "getRecentPublications", family: "publication", label: "consulter les publications demandées", matches: /publication|\bposts?\b/ },
    { tool: "readCommercialDocuments", family: "commercial", label: "lire les documents commerciaux", matches: /devis|facture|document commercial/ },
    { tool: "listIndividualMailboxes", family: "workspace", label: "consulter les boîtes expéditrices", matches: /boites?|expediteurs?/ },
    { tool: "readIndividualMailHistory", family: "workspace", label: "consulter l’historique des mails envoyés", matches: /(?:historique|envoyes).{0,45}(?:mail|courriel)|(?:mail|courriel).{0,45}(?:historique|envoyes)/ },
    { tool: "readCommunicationRecords", family: "workspace", label: "consulter les campagnes ou rendez-vous", matches: /campagne|mail|newsletter|courriel|agenda|rendez.vous|\brdv\b/ },
    { tool: "searchCrmContacts", family: "commercial", label: "retrouver les contacts demandés", matches: /\bcrm\b|contact|client|prospect/ },
    { tool: "getBusinessDna", family: "business", label: "lire l’ADN de l’entreprise", matches: /\badn\b|\bdna\b|mission|prestations|services de (?:mon|notre) entreprise/ },
    { tool: "searchMedia", family: "media", label: "rechercher les médias demandés", matches: /mediatheque|medias?|images?|photos?|videos?|visuels?|flyers?|logos?/ },
    { tool: "readStatsReports", family: "workspace", label: "consulter les rapports de statistiques", matches: /(?:rapports?|bilans?).{0,60}(?:stats|statistiq)|(?:stats|statistiq).{0,60}(?:rapports?|bilans?)/ },
    { tool: "readStatsSnapshots", family: "workspace", label: "consulter les statistiques", matches: /stats|statistiq|resultats?|performances?|impressions?/ },
    { tool: "readGoogleReviews", family: "workspace", label: "consulter les avis", matches: /\bavis\b|reputation|reviews?/ },
    { tool: "readChannelStatus", family: "business", label: "vérifier les connexions des canaux", matches: /canaux|canal|connexion|connecte|cockpit/ },
];
export function inrAssistantReadObjectives(message: string): InrAssistantObjective[] {
    return inrAssistantObjectives(message).filter(objective => objective.kind === "read");
}
export function inrAssistantObjectives(message: string): InrAssistantObjective[] {
    const actions = inrAssistantActionObjectives(message);
    const plan: InrAssistantObjective[] = [];
    for (const clause of inrAssistantRequestClauses(message)) {
        const mutations = actions.filter(action => action.instruction === inrAssistantRoutingText(clause));
        for (const action of mutations)
            plan.push({ id: `objective_${plan.length}`, kind: "action", tool: action.tool, instruction: clause, count: inrAssistantRequiredCalls(clause)[action.tool] ?? 1 });
        if (mutations.length || inrAssistantClauseIsAdvice(clause) || /^(?:ne\b|n['’]|not\b|never\b|si\b|imagine\b|suppose\b)/.test(clause))
            continue;
        if (!/^(?:(?:peux|pourrais)[- ]tu\s+|(?:pouvez|pourriez)[- ]vous\s+)?(?:lis|lire|consulte\w*|recherch\w*|cherche\w*|retrouv\w*|liste\w*|verifi\w*|regarde\w*|montre\w*|affiche\w*|analyse\w*|compare\w*|quels?|quelles?|combien|read|find|search|list|show|check)\b/.test(clause))
            continue;
        const reader = readers.find(reader => reader.matches.test(clause));
        if (reader)
            plan.push({ id: `objective_${plan.length}`, kind: "read", tool: reader.tool, instruction: clause, count: 1, exhaustive: /\b(?:tous|toutes|chaque|complet\w*|integralite|all|every)\b/.test(clause) });
    }
    return plan;
}
export function inrAssistantObjectiveFamily(tool: string): InrAssistantCommandFamily | undefined {
    return INR_ASSISTANT_COMMANDS[tool]?.family ?? readers.find(reader => reader.tool === tool)?.family;
}
export function inrAssistantObjectiveLabel(tool: string): string {
    return INR_ASSISTANT_COMMANDS[tool]?.label ?? readers.find(reader => reader.tool === tool)?.label ?? "terminer la lecture demandée";
}

/** A tool alias is not enough: drafts/prepared publications never satisfy a
 * request for published history, even when the same native reader serves both. */
export function inrAssistantReadMatchesObjective(objective: InrAssistantObjective, tool: string, input?: unknown): boolean {
    if (objective.kind !== "read") return false;
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (objective.tool === tool) {
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
export function inrAssistantObjectiveCompleted(plan: InrAssistantObjective[], index: number, receipts: InrAssistantActionReceipt[]): boolean {
    const objective = plan[index];
    if (objective.kind === "read")
        return receipts.some(receipt => receipt.tool === objective.tool && receipt.recordId === objective.id && receipt.ok && receipt.status === "read");
    const count = plan.slice(0, index + 1).filter(item => item.kind === "action" && item.tool === objective.tool).reduce((sum, item) => sum + item.count, 0);
    return inrAssistantGoalCompleted(objective.tool, receipts, { [objective.tool]: count });
}
export function inrAssistantObjectiveReady(plan: InrAssistantObjective[], index: number, receipts: InrAssistantActionReceipt[]): boolean {
    return plan.slice(0, index).every((_, previous) => inrAssistantObjectiveCompleted(plan, previous, receipts));
}
export function inrAssistantPlanAllowsAction(plan: InrAssistantObjective[], tool: string, receipts: InrAssistantActionReceipt[]): boolean {
    const index = plan.findIndex((objective, i) => objective.kind === "action" && objective.tool === tool && !inrAssistantObjectiveCompleted(plan, i, receipts));
    return index < 0 || inrAssistantObjectiveReady(plan, index, receipts);
}

const prerequisiteReaders: Record<string, string[]> = {
    manageCrmContact: ["searchCrmContacts", "readCrmContact"],
    prepareCommercialDocument: ["searchCrmContacts", "readCrmContact", "readCommercialDocuments"],
    updateCommercialDocument: ["readCommercialDocuments"],
    finalizeCommercialDocument: ["readCommercialDocuments"],
    manageAdvertisingCampaign: ["readAdvertisingCampaigns"],
    editPreparedPublication: ["readPublicationWorkspace"],
    updateScheduledPublication: ["readScheduledPublications"],
    cancelScheduledPublication: ["readScheduledPublications"],
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
export function inrAssistantPlanAllowsRead(plan: InrAssistantObjective[], tool: string, receipts: InrAssistantActionReceipt[]): boolean {
    const index = plan.findIndex((objective, position) => objective.kind === "read" && mayReadObjective(objective, tool) && !inrAssistantObjectiveCompleted(plan, position, receipts));
    if (index < 0 || inrAssistantObjectiveReady(plan, index, receipts)) return true;
    return plan.slice(0, index).some((objective, position) => objective.kind === "action" &&
        !inrAssistantObjectiveCompleted(plan, position, receipts) && prerequisiteReaders[objective.tool]?.includes(tool));
}
type ReadAttempt = {
    input: Record<string, unknown>;
    cursorKey: "offset" | "page";
    nextOffset?: number | null;
    exhaustiveObjective?: string;
    done: boolean;
};
/** Two ordinary reads remain allowed. Extra pages must follow a verified,
 * strictly increasing cursor for the same query; the global call budget remains. */
export function createInrAssistantReadBudget() {
    const attempts = new Map<string, ReadAttempt[]>();
    const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
    const paginated = new Set(["searchMedia", "listIndividualMailboxes", "readIndividualMailHistory", "discoverCapabilities", "readStatsReports", "readScheduledPublications", "readPublicationWorkspace", "readAdvertisingCampaigns", "readAttachedDocument"]);
    const sameSearch = (left: Record<string, unknown>, right: Record<string, unknown>) => [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(key => key !== "offset" && key !== "page").every(key => JSON.stringify(left[key] ?? null) === JSON.stringify(right[key] ?? null));
    return {
        available(name: string) {
            const history = attempts.get(name) ?? [];
            const last = history.at(-1);
            return history.length < 2 || paginated.has(name) && last?.done === true && typeof last.nextOffset === "number";
        },
        start(name: string, input: unknown, exhaustiveObjective?: string): ReadAttempt | null {
            const history = attempts.get(name) ?? [];
            const last = history.at(-1);
            const current = row(input);
            const cursorKey = name === "readIndividualMailHistory" ? "page" : "offset";
            if (exhaustiveObjective && paginated.has(name)) {
                const previous = history.filter(attempt => attempt.exhaustiveObjective === exhaustiveObjective).at(-1);
                if (previous) {
                    if (!previous.done || typeof previous.nextOffset !== "number" || current[cursorKey] !== previous.nextOffset || !sameSearch(previous.input, current)) return null;
                } else if (Number(current[cursorKey] ?? (cursorKey === "page" ? 1 : 0)) !== (cursorKey === "page" ? 1 : 0)) return null;
            }
            if (history.length >= 2 && !(paginated.has(name) && last?.done && typeof last.nextOffset === "number" && current[last.cursorKey] === last.nextOffset && sameSearch(last.input, current)))
                return null;
            const attempt: ReadAttempt = { input: current, cursorKey, exhaustiveObjective, done: false };
            history.push(attempt);
            attempts.set(name, history);
            return attempt;
        },
        finish(attempt: ReadAttempt, output: unknown) {
            const result = row(output);
            const offset = Number(attempt.input[attempt.cursorKey] ?? (attempt.cursorKey === "page" ? 1 : 0));
            const next = result[attempt.cursorKey === "page" ? "nextPage" : "nextOffset"];
            attempt.done = true;
            attempt.nextOffset = result.ok !== false && result.available !== false && result.status !== "unknown" && Number.isSafeInteger(next) && Number(next) > offset ? Number(next) : null;
        },
    };
}

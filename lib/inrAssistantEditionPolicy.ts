import type { DashboardEdition } from "./dashboardEdition.ts";

// An explicit allowlist keeps future action tools unavailable to Basic by default.
const BASIC_SUPPORT_TOOLS = new Set([
  "proposeHumanSupport", "readAppGuide", "getBusinessDna", "searchMedia", "getRecentPublications",
  "getAccountDiagnostics", "readWorkspaceSection", "recallPastDiscussions", "guideChannelConnection",
  "readToolSettings", "getPublicationStatus", "getBusinessDnaAnalysis", "prepareStudioPrompt",
]);

export function assistantToolsForEdition<T>(tools: Record<string, T>, edition: DashboardEdition): Record<string, T> {
  return edition === "basic" ? Object.fromEntries(Object.entries(tools).filter(([name]) => BASIC_SUPPORT_TOOLS.has(name))) : tools;
}

/** Questions remain support. Direct creative/execution orders require Standard. */
export function isBasicAssistantExecutionRequest(message: string): boolean {
  const text = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (/^(?:comment|pourquoi|ou\b|est.ce|peux.tu m.expliquer|explique|guide|aide.moi a (?:connecter|comprendre)|how\b|why\b|where\b|como\b|wie\b)/.test(text) ||
    /\b(?:explique\w*|expliquer|me dire|m.apprendre|explain|teach|tell me|erklar\w*|explica\w*)\b.{0,65}\b(?:comment|how|pourquoi|why|ou|where|wie|como)\b/.test(text)) return false;
  return /\b(?:genere|generer|cree|creer|redige|rediger|ecris|ecrire|prepare|preparer|publie|publier|programme|programmer|planifie|planifier|modifie|modifier|corrige|corriger|remplis|remplir|complete|completer|mets|mettez|envoie|envoyer|supprime|supprimer|generate|create|write|publish|schedule|update|delete|send)\b/.test(text);
}

export const BASIC_ASSISTANT_EXECUTION_NOTICE = "Votre offre Basique inclut l’accompagnement pour utiliser les outils. Pour me confier la création d’un contenu ou la modification de vos réglages, choisissez Standard ou Premium dans [Mon abonnement](/dashboard?panel=abonnement). Je peux vous expliquer les étapes pour le faire vous-même.";

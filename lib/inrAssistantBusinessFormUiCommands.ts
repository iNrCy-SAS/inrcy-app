import { inrAssistantUnquotedRequest, inrAssistantClauseIsAdvice } from "./inrAssistantRequestClauses.ts";

export const INR_ASSISTANT_BUSINESS_FORM_UI_COMMANDS = ["configure_business_form"] as const;
export const INR_ASSISTANT_BUSINESS_FORM_IDS = ["general", "ai_configuration", "business_dna", "personalization"] as const;
export type InrAssistantBusinessFormId = typeof INR_ASSISTANT_BUSINESS_FORM_IDS[number];
export const INR_ASSISTANT_BUSINESS_FORM_TABS = ["all", "analysis", "company", "communication", "profile", "activity", "audience", "local", "identity", "parameters", "instructions", "ctas", "strategy", "news"] as const;
export type InrAssistantBusinessFormTab = typeof INR_ASSISTANT_BUSINESS_FORM_TABS[number];
export type InrAssistantBusinessFormPatch = { businessFormAction: "reset" | "discard" | "select_tab" | "open_persistent_reset"; businessFormTab?: InrAssistantBusinessFormTab };
export type InrAssistantBusinessFormUiCommand = { command: "configure_business_form"; selection: { kind: "business_form"; id: InrAssistantBusinessFormId }; revision: string; patch: InrAssistantBusinessFormPatch };
const tabNames: Record<InrAssistantBusinessFormTab, RegExp> = { all: /\btout\b|tout l.adn|entire|\ball\b/, analysis: /analyse|analysis/, company: /entreprise|company/, communication: /communication/, profile: /profil|profile/, activity: /activite|activity|metier/, audience: /audience|cibles?/, local: /local|implantation/, identity: /identite|identity|mission|valeurs/, parameters: /parametres|parameters|reglages/, instructions: /consignes|instructions/, ctas: /\bctas?\b|appels? a l.action/, strategy: /strategie|strategy/, news: /actualites|news/ };
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function parseInrAssistantBusinessFormUiCommand(value: unknown): InrAssistantBusinessFormUiCommand | null {
  const command = row(value), selection = row(command.selection), patch = row(command.patch);
  if (command.command !== "configure_business_form" || selection.kind !== "business_form" || !INR_ASSISTANT_BUSINESS_FORM_IDS.includes(selection.id as InrAssistantBusinessFormId)
    || typeof command.revision !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(command.revision) || Object.keys(patch).some(key => !["businessFormAction", "businessFormTab"].includes(key))
    || !["reset", "discard", "select_tab", "open_persistent_reset"].includes(String(patch.businessFormAction))) return null;
  if (patch.businessFormAction === "open_persistent_reset") {
    if (!["business_dna", "personalization"].includes(String(selection.id)) || !INR_ASSISTANT_BUSINESS_FORM_TABS.includes(patch.businessFormTab as InrAssistantBusinessFormTab)
      || ["company", "communication", "parameters", "instructions", "ctas"].includes(String(patch.businessFormTab))) return null;
  } else if (patch.businessFormAction === "select_tab") {
    if (!INR_ASSISTANT_BUSINESS_FORM_TABS.includes(patch.businessFormTab as InrAssistantBusinessFormTab) || patch.businessFormTab === "all" || selection.id === "general"
      || selection.id === "ai_configuration" && !["parameters", "instructions", "ctas"].includes(String(patch.businessFormTab))
      || selection.id === "business_dna" && ["company", "communication", "parameters", "instructions", "ctas"].includes(String(patch.businessFormTab))) return null;
  } else if (patch.businessFormTab !== undefined) return null;
  return { command: "configure_business_form", selection: { kind: "business_form", id: selection.id as InrAssistantBusinessFormId }, revision: command.revision,
    patch: { businessFormAction: patch.businessFormAction as InrAssistantBusinessFormPatch["businessFormAction"], ...(patch.businessFormTab ? { businessFormTab: patch.businessFormTab as InrAssistantBusinessFormTab } : {}) } };
}
export function isInrAssistantBusinessFormUiCommandAvailable(command: unknown, pathname: unknown, kind: unknown) {
  return command === "configure_business_form" && kind === "business_form" && typeof pathname === "string"
    && ["/dashboard", "/dashboard/personnalisation", "/dashboard/adn-entreprise", "/dashboard/configuration-ia", "/dashboard/settings/preferences", "/dashboard/settings/ia"].includes(pathname);
}
export function isInrAssistantBusinessFormUiRequest(message: string, patch?: InrAssistantBusinessFormPatch, form?: InrAssistantBusinessFormId, view?: string) {
  const text = inrAssistantUnquotedRequest(message);
  if (inrAssistantClauseIsAdvice(text) || /\b(?:si|if|quand|apres|avant|demain|plus tard|sans|ne)\b|\b(?:do not|don't|not yet)\b/.test(text)) return false;
  const object = form === "general" ? /preferences?(?: generales?)?|general preferences|reglages generaux/ : form === "ai_configuration" ? /configuration (?:ia|ai)|reglages (?:ia|ai)|signature ia|onglet|\btab\b/ : form === "business_dna" ? /\badn\b|\bdna\b|onglet|\btab\b/ : /personnalisation|personalization|personnaliser|\badn\b|\bdna\b|configuration (?:ia|ai)|preferences?(?: generales?)?|onglet|\btab\b|entreprise|company|communication/;
  if (!object.test(text)) return false;
  const reset = /\b(?:reinitialis\w*|reset|remets?\b.{0,45}defaut)\b/.test(text);
  const discard = /\b(?:annul\w*|abandon\w*|ecart\w*|discard)\b.{0,65}\b(?:modifications?|changements?|saisies?|brouillon|changes?|edits?)\b/.test(text);
  const namedTab = text.match(/(?:onglet|tab)\s+(?:(?:de |du |des )?(?:l['’]?)?\s*)?([^.,;:!?]{1,65})/)?.[1];
  const currentTabRequested = !namedTab || !view || INR_ASSISTANT_BUSINESS_FORM_TABS.some(tab => tab === view && tabNames[tab].test(namedTab));
  const select = /\b(?:ouvre|ouvrez|affiche\w*|selectionne\w*|passe\w*|open|show|select|switch)\b/.test(text) && /onglet|\btab\b|analyse|analysis|entreprise|company|communication|profil|profile|activite|activity|audience|local|identite|identity|parametres|parameters|consignes|instructions|ctas?|strategie|strategy|actualites|news/.test(text);
  return patch ? patch.businessFormAction === "reset" ? reset && (!["business_dna", "personalization"].includes(form || "") || /brouillon|saisies|formulaire|draft/.test(text))
    : patch.businessFormAction === "open_persistent_reset" ? reset && !!patch.businessFormTab && (patch.businessFormTab === "all" ? tabNames.all.test(text) : tabNames[patch.businessFormTab].test(text))
    : patch.businessFormAction === "discard" ? discard && currentTabRequested : select && !!patch.businessFormTab && tabNames[patch.businessFormTab].test(text) : reset || discard || select;
}

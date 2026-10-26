import "server-only";

import { jsonSchema, tool } from "ai";
import { INR_ASSISTANT_ACCOUNT_GUIDES } from "./inrAssistantGuidesAccount.ts";
import { INR_ASSISTANT_CREATION_GUIDES } from "./inrAssistantGuidesCreation.ts";
import { INR_ASSISTANT_MANAGEMENT_GUIDES } from "./inrAssistantGuidesManagement.ts";
import { INR_ASSISTANT_CODE_INDEX } from "./inrAssistantCodeIndex.generated.ts";
import { inrAssistantCapabilityGuide } from "./inrAssistantCapabilities.ts";

export type InrAssistantAppGuide = {
  id: string; title: string; keywords: string[]; content: string; sourceFiles: string[]; directNavigation?: string;
};

export const INR_ASSISTANT_APP_GUIDES: readonly InrAssistantAppGuide[] = [
  {id:"assistant-capabilities",title:"iNr’Assistant : capacités par offre et validations",keywords:["assistant","capacités","capable","tout gérer","basique","standard","premium","fusion","annulation"],content:inrAssistantCapabilityGuide(),sourceFiles:["lib/inrAssistantCapabilities.ts"]},
  ...INR_ASSISTANT_ACCOUNT_GUIDES, ...INR_ASSISTANT_CREATION_GUIDES, ...INR_ASSISTANT_MANAGEMENT_GUIDES,
];

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set(["comment", "quoi", "faire", "pourquoi", "peux", "veux", "dois", "dans", "avec", "pour", "depuis", "cette", "quel", "quelle", "quels", "mes", "mon", "des", "les", "une", "est", "sur", "the", "what", "how", "with", "from"]);

function rankGuides(query: string) {
  const normalized = normalize(query);
  const tokens = normalized.split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOP.has(token));
  return INR_ASSISTANT_APP_GUIDES.map((guide, index) => {
    const title = normalize(guide.title);
    const keywords = guide.keywords.map(normalize);
    const content = normalize(guide.content);
    const score = normalized === guide.id ? 1000 : tokens.reduce((total, token) => total +
      (keywords.some((keyword) => keyword.includes(token)) ? 8 : 0) + (title.includes(token) ? 4 : 0) + (content.includes(token) ? 1 : 0), 0);
    return { guide, score, index };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Exact common navigation needs no generative paraphrase (or paid model call). */
export function getVerifiedInrAssistantNavigation(query: string): string | null {
  const value = normalize(query);
  const asksForSteps = /(?:ou|quels?|comment).*(?:boutons?|cliqu|connect|canaux|canal)|(?:boutons?).*(?:exacts?|connect)/.test(value);
  const needsDiagnosis = /(?:erreur|bloqu|impossible|echec|refus|permission|ne fonctionne|n.apparait|pas.*(?:page|compte)|probleme)/.test(value);
  const recallsHistory = /(?:\bhier\b|avant.hier|semaine derniere|mois dernier|precedem|souviens|souvenir|memoire|avions|parlait|parle|convenu|dernier(?:e)?(?:s)? (?:echange|discussion|conversation)|remember|previous|last (?:time|chat|conversation)|yesterday)/.test(value);
  if (!asksForSteps || needsDiagnosis || recallsHistory) return null;
  const guide = rankGuides(query)[0]?.guide;
  if (!guide || (!guide.id.startsWith("channel-") && guide.id !== "channels-overview")) return null;
  // Only explicitly reviewed, user-facing steps can bypass the LLM. The longer
  // internal guide also contains instructions that must not become UI copy.
  return guide.directNavigation ?? null;
}

/** Current verified procedures outrank old chat messages and legacy help articles. */
export function getInrAssistantAppKnowledge(query: string, maxChars = 4_800): string {
  const ranked = rankGuides(query).slice(0, 2);
  const lines = ["Référence de l’interface actuelle, prioritaire sur les anciennes réponses ou notices :"];
  for (const { guide } of ranked) {
    const text = `\n${guide.title} [${guide.id}]\n${guide.content}`;
    if ((lines.join("\n") + text).length <= maxChars) lines.push(text);
  }
  if (!ranked.length) {
    const cockpit = INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "dashboard-navigation");
    if (cockpit) lines.push(`${cockpit.title}\n${cockpit.content}`);
  }
  const topics = INR_ASSISTANT_APP_GUIDES.map(({ id, title }) => `${id}: ${title}`).join("; ");
  if ((lines.join("\n") + topics).length < maxChars) lines.push(`Pour une procédure détaillée, consulte readAppGuide. Rubriques : ${topics}`);
  return lines.join("\n").slice(0, maxChars);
}

/** Bounded public product knowledge only: no filesystem path or SQL execution. */
export function createInrAssistantAppGuideTool() {
  return tool({
    strict: true,
      description: "Consulter la référence vérifiée des écrans, boutons et parcours actuels d’iNrCy, établie depuis son code. Rechercher par nom public d’outil ou courte question : Booster, Studio, Mes médias, ADN, réglages IA, canaux, abonnement, agents, Stats, Send, CRM, Agenda, Réputation, campagnes, devis ou factures. Ne jamais inventer de bouton ni reprendre un ancien parcours.",
    inputSchema: jsonSchema<{ topic: string }>({
      type: "object", properties: { topic: { type: "string", minLength: 1, maxLength: 140, description: "Identifiant de rubrique, nom d’outil ou courte question de navigation." } },
      required: ["topic"], additionalProperties: false,
    }, { validate: (value) => {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      return Object.keys(input).length === 1 && typeof input.topic === "string" && input.topic.trim().length > 0 && input.topic.length <= 140
        ? { success: true, value: { topic: input.topic.trim() } }
        : { success: false, error: new Error("Rubrique d’aide invalide.") };
    } }),
    execute: async ({ topic }) => {
      const sourcePathRequest = /(?:^|[\\/])\.\.(?:[\\/]|$)|^\.|^[a-z]:[\\/]|\.(?:tsx?|json|env)(?:$|[?#])/i.test(topic);
      const guides = (sourcePathRequest ? [] : rankGuides(topic)).slice(0, 2).map(({ guide }) => ({ id: guide.id, title: guide.title, content: guide.content }));
      return {
        source: "reviewed_current_application_code", codeVersion: INR_ASSISTANT_CODE_INDEX.sourceDigest.slice(0, 16),
        found: guides.length > 0, guides,
        ...(!guides.length ? { message: "Aucune procédure vérifiée ne correspond à cette recherche. Demander une précision ; ne pas inventer de bouton, de chemin ou d’action." } : {}),
      };
    },
  });
}

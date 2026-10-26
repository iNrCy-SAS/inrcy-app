/** Public progress only. This module is shared by the server and chat UI. */
export type InrAssistantActivity = {
  id: string;
  agent: "publications" | "stats" | "emailing";
  label: string;
  status: "running" | "completed" | "blocked" | "failed";
};

export type InrAssistantActivityCallback = (activity: InrAssistantActivity) => void | Promise<void>;

const AGENTS = new Set(["publications", "stats", "emailing"]);
const STATUSES = new Set(["running", "completed", "blocked", "failed"]);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Project the public contract; extra fields are never copied into the stream. */
export function parseInrAssistantActivity(value: unknown): InrAssistantActivity | null {
  const input = record(value);
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) ||
      typeof input.agent !== "string" || !AGENTS.has(input.agent) ||
      typeof input.label !== "string" || !input.label.trim() || input.label.length > 160 || /[\u0000-\u001f\u007f]/.test(input.label) ||
      typeof input.status !== "string" || !STATUSES.has(input.status)) return null;
  return { id: input.id, agent: input.agent as InrAssistantActivity["agent"], label: input.label, status: input.status as InrAssistantActivity["status"] };
}

type Target = { agent: InrAssistantActivity["agent"]; label: string };
type Outcome = Pick<InrAssistantActivity, "label" | "status">;
const GUIDE_AGENTS: Readonly<Record<string, InrAssistantActivity["agent"]>> = {
  booster: "publications", publications: "publications", stats: "stats",
  emailing: "emailing", propulser: "emailing", fideliser: "emailing",
};

function targetFor(name: string, input: unknown): Target | null {
  const data = record(input);
  switch (name) {
    case "preparePublication": return { agent: "publications", label: "Préparation du brouillon de publication" };
    case "executePublication": return { agent: "publications", label: data.mode === "schedule" ? "Programmation de la publication" : "Transmission de la publication" };
    case "editPublication": return { agent: "publications", label: "Correction de la publication" };
    case "getPublicationStatus": return { agent: "publications", label: "Vérification de la publication" };
    case "readStatsSnapshots": return { agent: "stats", label: "Lecture des statistiques enregistrées" };
    case "readWorkspaceSection": return data.section === "stats" ? { agent: "stats", label: "Lecture des statistiques enregistrées" } : null;
    case "prepareCampaignEmail": return { agent: "emailing", label: "Préparation du brouillon de campagne mail" };
    case "configureAgentAutomation": {
      const agent = data.agent === "publish" ? "publications" : data.agent === "stats" ? "stats" : data.agent === "grow" || data.agent === "loyalty" ? "emailing" : null;
      return agent ? { agent, label: "Enregistrement des réglages de l’agent" } : null;
    }
    default: return null;
  }
}

function outcomeFor(name: string, result: unknown): Outcome {
  const data = record(result);
  const status = typeof data.status === "string" ? data.status : "";
  if (status === "failed" || status === "error") return { status: "failed", label: "La tâche a rencontré un échec" };
  if (status === "partial") return { status: "blocked", label: "Résultat partiel à vérifier dans l’outil" };
  if (status === "unknown" || status.endsWith("_unconfirmed")) return { status: "blocked", label: "Le résultat reste à vérifier dans l’outil" };
  if (["blocked", "needs_instruction", "needs_clarification", "not_included", "instruction_required", "schedule_required", "timezone_confirmation_required", "confirmation_required", "quota_insufficient"].includes(status) || data.access === "not_included") {
    return { status: "blocked", label: "Une précision ou une vérification est nécessaire" };
  }
  if (data.known === false) return { status: "blocked", label: "Certaines statistiques restent indisponibles" };
  if (data.ok === false || data.available === false || status === "unavailable") return { status: "failed", label: "La tâche n’a pas pu être confirmée" };
  if (data.ok !== true && data.available !== true && data.known !== true) return { status: "blocked", label: "Le résultat reste à vérifier dans l’outil" };
  if (name === "readStatsSnapshots" || name === "readWorkspaceSection") return { status: "completed", label: "Statistiques enregistrées consultées" };
  if (name === "prepareCampaignEmail") return status === "draft" || status === "already_processed"
    ? { status: "completed", label: status === "draft" ? "Brouillon de campagne mail enregistré" : "Campagne existante retrouvée" }
    : { status: "blocked", label: "L’état de la campagne reste à vérifier" };
  if (name === "configureAgentAutomation") return ["saved", "saved_with_adjustments", "already_configured", "previous_attempt_recorded"].includes(status)
    ? { status: "completed", label: status === "saved_with_adjustments" ? "Réglages de l’agent enregistrés avec ajustements" : status === "already_configured" || status === "previous_attempt_recorded" ? "Réglages de l’agent déjà enregistrés" : "Réglages de l’agent enregistrés" }
    : { status: "blocked", label: "Les réglages de l’agent restent à vérifier" };
  const labels: Readonly<Record<string, string>> = {
    draft: "Brouillon de publication enregistré", queued: "Publication mise en file",
    scheduled: "Publication programmée", published: "Publication confirmée",
    processing: "État vérifié : publication en cours", updated: "Correction de la publication enregistrée",
    unchanged: "Publication déjà à jour",
  };
  return labels[status] ? { status: "completed", label: labels[status] } : { status: "blocked", label: "Le résultat reste à vérifier dans l’outil" };
}

/** Observe actual tool executions, without changing their schemas or results. */
export function withInrAssistantToolActivities<T extends Record<string, unknown>>(
  tools: T,
  options: { requestId: string; onActivity?: InrAssistantActivityCallback },
): T {
  if (!options.onActivity) return tools;
  // The seed is a server trace ID, never the account ID or model tool arguments.
  const seed = /^[a-zA-Z0-9_-]+$/.test(options.requestId) ? options.requestId.slice(0, 64) : "request";
  let sequence = 0;
  const emit = (event: InrAssistantActivity) => {
    try { void Promise.resolve(options.onActivity?.(event)).catch(() => undefined); } catch { /* Progress must never interrupt a business operation. */ }
  };
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const source = record(definition);
    const execute = source.execute;
    if (typeof execute !== "function" || name !== "readAppGuide" && !targetFor(name, { section: "stats", agent: "publish" })) return [name, definition];
    return [name, { ...source, execute: async (...args: unknown[]) => {
      const target = targetFor(name, args[0]);
      if (!target && name !== "readAppGuide") return Reflect.apply(execute, definition, args);
      const id = `${seed}_activity_${++sequence}`;
      if (target) emit({ id, ...target, status: "running" });
      try {
        const result: unknown = await Reflect.apply(execute, definition, args);
        if (target) emit({ id, agent: target.agent, ...outcomeFor(name, result) });
        else {
          // A guide only credits an expert after its real result names a verified topic.
          const data = record(result);
          const guide = data.found === true && Array.isArray(data.guides) ? data.guides.map(record).find(item => typeof item.id === "string" && GUIDE_AGENTS[item.id]) : undefined;
          if (guide && typeof guide.id === "string") emit({ id, agent: GUIDE_AGENTS[guide.id], label: "Guide de l’outil consulté", status: "completed" });
        }
        return result;
      } catch (error) {
        if (target) emit({ id, agent: target.agent, label: "La tâche a rencontré un échec", status: "failed" });
        throw error;
      }
    } }];
  })) as T;
}

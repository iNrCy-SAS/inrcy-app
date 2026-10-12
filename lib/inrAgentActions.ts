import { canonicalSiteWebChannel, normalizeSiteWebPublicationPayload } from "./siteWebChannel.ts";
import { INR_AGENT_AUTOMATION_KEYS, type InrAgentAutomationKey } from "@/lib/inrAgentSettings";

export const INR_AGENT_ACTION_TYPES = ["publication", "campaign", "stats_report", "mailing", "review_request", "loyalty", "custom"] as const;
export const INR_AGENT_TARGET_TOOLS = ["booster", "mails", "propulser", "fideliser", "inrstats", "agent"] as const;
export const INR_AGENT_ACTION_STATUSES = [
  "prepared",
  "pending_validation",
  "pending",
  "draft",
  "scheduled",
  "validated",
  "refused",
  "executing",
  "completed",
  "failed",
  "cancelled",
] as const;
export const INR_AGENT_EXECUTION_POLICIES = ["manual_validation", "draft_only", "automatic_after_settings", "report_only"] as const;

export type InrAgentActionType = (typeof INR_AGENT_ACTION_TYPES)[number];
export type InrAgentTargetTool = (typeof INR_AGENT_TARGET_TOOLS)[number];
export type InrAgentActionStatus = (typeof INR_AGENT_ACTION_STATUSES)[number];
export type InrAgentExecutionPolicy = (typeof INR_AGENT_EXECUTION_POLICIES)[number];

export type InrAgentActionPayload = Record<string, unknown>;

export type InrAgentAction = {
  id: string;
  automationKey: InrAgentAutomationKey | null;
  actionType: InrAgentActionType;
  targetTool: InrAgentTargetTool;
  title: string;
  summary: string;
  previewText: string;
  targetChannels: string[];
  targetThemes: string[];
  recipients: unknown[];
  imageAssets: unknown[];
  payload: InrAgentActionPayload;
  validationRequired: boolean;
  executionPolicy: InrAgentExecutionPolicy;
  status: InrAgentActionStatus;
  scheduledFor: string | null;
  preparedAt: string | null;
  validatedAt: string | null;
  refusedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type InrAgentActionStats = {
  pending: number;
  scheduled: number;
  validated: number;
  refused: number;
  completed: number;
  failed: number;
};

export const INR_AGENT_ACTION_LABELS = {
  publication: "Publication multicanale",
  campaign: "Campagne mail",
  stats_report: "Bilan statistiques",
  mailing: "Campagne mailing",
  review_request: "Demande d'avis",
  loyalty: "Fidélisation",
  custom: "Action iNr'Agent",
} satisfies Record<InrAgentActionType, string>;

export const INR_AGENT_TOOL_LABELS = {
  booster: "Booster",
  mails: "Mails",
  propulser: "Propulser",
  fideliser: "Fidéliser",
  inrstats: "iNrStats",
  agent: "iNr'Agent",
} satisfies Record<InrAgentTargetTool, string>;

export const INR_AGENT_STATUS_LABELS = {
  prepared: "Préparée",
  pending_validation: "À valider",
  pending: "À valider",
  draft: "Brouillon",
  scheduled: "Programmée",
  validated: "Validée",
  refused: "Refusée",
  executing: "Exécution en cours",
  completed: "Terminée",
  failed: "Erreur",
  cancelled: "Annulée",
} satisfies Record<InrAgentActionStatus, string>;

export const INR_AGENT_ACTION_ICONS = {
  publication: "📢",
  campaign: "📧",
  stats_report: "📊",
  mailing: "📧",
  review_request: "⭐",
  loyalty: "💎",
  custom: "✦",
} satisfies Record<InrAgentActionType, string>;

type DbInrAgentActionRow = {
  id?: string | null;
  automation_key?: string | null;
  action_type?: string | null;
  target_tool?: string | null;
  title?: string | null;
  summary?: string | null;
  preview_text?: string | null;
  target_channels?: string[] | null;
  target_themes?: string[] | null;
  recipients?: unknown[] | null;
  image_assets?: unknown[] | null;
  payload?: Record<string, unknown> | null;
  validation_required?: boolean | null;
  execution_policy?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  prepared_at?: string | null;
  validated_at?: string | null;
  refused_at?: string | null;
  completed_at?: string | null;
  last_error?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function includesValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function sanitizeUnknownArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function sanitizePayload(input: unknown): InrAgentActionPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return normalizeSiteWebPublicationPayload(input) as InrAgentActionPayload;
}

export function rowToInrAgentAction(row: DbInrAgentActionRow): InrAgentAction {
  const automationKey = includesValue(INR_AGENT_AUTOMATION_KEYS, row.automation_key) ? row.automation_key : null;
  const actionType = includesValue(INR_AGENT_ACTION_TYPES, row.action_type) ? row.action_type : "custom";
  const targetTool = includesValue(INR_AGENT_TARGET_TOOLS, row.target_tool) ? row.target_tool : "agent";
  const status = includesValue(INR_AGENT_ACTION_STATUSES, row.status) ? row.status : "pending_validation";
  const executionPolicy = includesValue(INR_AGENT_EXECUTION_POLICIES, row.execution_policy) ? row.execution_policy : "manual_validation";
  const fallbackTitle = INR_AGENT_ACTION_LABELS[actionType];

  return {
    id: String(row.id || ""),
    automationKey,
    actionType,
    targetTool,
    title: String(row.title || fallbackTitle),
    summary: String(row.summary || "Action préparée par iNr'Agent."),
    previewText: String(row.preview_text || ""),
    targetChannels: Array.from(new Set(sanitizeStringArray(row.target_channels).map(canonicalSiteWebChannel))),
    targetThemes: Array.from(new Set(sanitizeStringArray(row.target_themes).map(canonicalSiteWebChannel))),
    recipients: sanitizeUnknownArray(row.recipients),
    imageAssets: sanitizeUnknownArray(row.image_assets),
    payload: sanitizePayload(row.payload ?? row.metadata),
    validationRequired: typeof row.validation_required === "boolean" ? row.validation_required : executionPolicy === "manual_validation",
    executionPolicy,
    status,
    scheduledFor: row.scheduled_for || null,
    preparedAt: row.prepared_at || null,
    validatedAt: row.validated_at || null,
    refusedAt: row.refused_at || null,
    completedAt: row.completed_at || null,
    lastError: row.last_error || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function summarizeInrAgentActions(actions: InrAgentAction[]): InrAgentActionStats {
  return actions.reduce<InrAgentActionStats>((stats, action) => {
    if (["prepared", "pending_validation", "pending", "draft"].includes(action.status)) stats.pending += 1;
    if (action.status === "scheduled") stats.scheduled += 1;
    if (action.status === "validated") stats.validated += 1;
    if (action.status === "refused" || action.status === "cancelled") stats.refused += 1;
    if (action.status === "completed") stats.completed += 1;
    if (action.status === "failed") stats.failed += 1;
    return stats;
  }, { pending: 0, scheduled: 0, validated: 0, refused: 0, completed: 0, failed: 0 });
}

export function sanitizeInrAgentActionStatus(input: unknown): InrAgentActionStatus | null {
  return includesValue(INR_AGENT_ACTION_STATUSES, input) ? input : null;
}

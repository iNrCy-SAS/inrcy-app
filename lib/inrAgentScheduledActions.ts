import { INR_AGENT_AUTOMATION_KEYS, type InrAgentAutomationKey } from "@/lib/inrAgentSettings";
import { INR_AGENT_ACTION_TYPES, INR_AGENT_TARGET_TOOLS, type InrAgentActionType, type InrAgentTargetTool } from "@/lib/inrAgentActions";

export const INR_AGENT_SCHEDULED_ACTION_SOURCES = ["manual", "automatic"] as const;
export const INR_AGENT_SCHEDULED_ACTION_STATUSES = ["scheduled", "running", "done", "failed", "cancelled"] as const;

export type InrAgentScheduledActionSource = (typeof INR_AGENT_SCHEDULED_ACTION_SOURCES)[number];
export type InrAgentScheduledActionStatus = (typeof INR_AGENT_SCHEDULED_ACTION_STATUSES)[number];

export type InrAgentScheduledActionPayload = Record<string, unknown>;

export type InrAgentScheduledAction = {
  id: string;
  automationKey: InrAgentAutomationKey | null;
  actionType: InrAgentActionType;
  targetTool: InrAgentTargetTool;
  source: InrAgentScheduledActionSource;
  title: string;
  summary: string;
  scheduledAt: string | null;
  timezone: string;
  channels: string[];
  payload: InrAgentScheduledActionPayload;
  status: InrAgentScheduledActionStatus;
  attemptCount: number;
  lastError: string | null;
  executedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DbInrAgentScheduledActionRow = {
  id?: string | null;
  user_id?: string | null;
  automation_key?: string | null;
  action_type?: string | null;
  target_tool?: string | null;
  source?: string | null;
  title?: string | null;
  summary?: string | null;
  scheduled_at?: string | null;
  timezone?: string | null;
  channels?: string[] | null;
  payload?: Record<string, unknown> | null;
  status?: string | null;
  attempt_count?: number | null;
  last_error?: string | null;
  executed_at?: string | null;
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

function sanitizePayload(input: unknown): InrAgentScheduledActionPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as InrAgentScheduledActionPayload;
}

export function rowToInrAgentScheduledAction(row: DbInrAgentScheduledActionRow): InrAgentScheduledAction {
  const automationKey = includesValue(INR_AGENT_AUTOMATION_KEYS, row.automation_key) ? row.automation_key : null;
  const actionType = includesValue(INR_AGENT_ACTION_TYPES, row.action_type) ? row.action_type : "custom";
  const targetTool = includesValue(INR_AGENT_TARGET_TOOLS, row.target_tool) ? row.target_tool : "agent";
  const source = includesValue(INR_AGENT_SCHEDULED_ACTION_SOURCES, row.source) ? row.source : "manual";
  const status = includesValue(INR_AGENT_SCHEDULED_ACTION_STATUSES, row.status) ? row.status : "scheduled";

  return {
    id: String(row.id || ""),
    automationKey,
    actionType,
    targetTool,
    source,
    title: String(row.title || "Action programmée"),
    summary: String(row.summary || ""),
    scheduledAt: row.scheduled_at || null,
    timezone: String(row.timezone || "Europe/Paris"),
    channels: sanitizeStringArray(row.channels),
    payload: sanitizePayload(row.payload),
    status,
    attemptCount: typeof row.attempt_count === "number" && Number.isFinite(row.attempt_count) ? row.attempt_count : 0,
    lastError: row.last_error || null,
    executedAt: row.executed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function scheduledActionToDbRow(args: {
  id?: string;
  userId: string;
  automationKey?: InrAgentAutomationKey | null;
  actionType?: InrAgentActionType;
  targetTool?: InrAgentTargetTool;
  source?: InrAgentScheduledActionSource;
  title: string;
  summary?: string;
  scheduledAt: string;
  timezone?: string;
  channels?: string[];
  payload?: InrAgentScheduledActionPayload;
}) {
  return {
    ...(args.id ? { id: args.id } : {}),
    user_id: args.userId,
    automation_key: args.automationKey || null,
    action_type: args.actionType || "custom",
    target_tool: args.targetTool || "agent",
    source: args.source || "manual",
    title: args.title,
    summary: args.summary || "",
    scheduled_at: args.scheduledAt,
    timezone: args.timezone || "Europe/Paris",
    channels: Array.isArray(args.channels) ? args.channels : [],
    payload: args.payload && typeof args.payload === "object" ? args.payload : {},
    status: "scheduled",
    updated_at: new Date().toISOString(),
  };
}

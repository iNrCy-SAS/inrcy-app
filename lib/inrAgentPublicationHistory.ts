export type AgentPublicationHistoryStatus =
  | "completed"
  | "partial"
  | "failed"
  | "refused"
  | "cancelled"
  | "processing";

export type AgentPublicationHistoryItem = {
  id: string;
  source: "event" | "action" | "scheduled";
  status: AgentPublicationHistoryStatus;
  occurredAt: string;
  title: string;
  contentTitle: string | null;
  channels: string[];
  themes: string[];
  mediaKind: "image" | "video" | "mixed" | null;
  agentActionId: string | null;
  scheduledActionId: string | null;
  publicationId: string | null;
};

export type AgentHistoryEventRow = {
  id: string;
  type: string | null;
  payload: unknown;
  created_at: string;
};

export type AgentHistoryActionRow = {
  id: string;
  title: string | null;
  target_channels: string[] | null;
  target_themes: string[] | null;
  payload: unknown;
  status: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  refused_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AgentHistoryScheduledRow = {
  id: string;
  title: string | null;
  channels: string[] | null;
  payload: unknown;
  status: string | null;
  scheduled_at: string | null;
  executed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export function isMissingAgentHistoryTable(
  error: { code?: string; message?: string },
): boolean {
  return error.code === "42P01" || error.code === "PGRST205";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(string).filter(Boolean))]
    : [];
}

function firstString(...values: unknown[]): string {
  return values.map(string).find(Boolean) || "";
}

function postFromPayload(payload: Record<string, unknown>) {
  const post = record(payload.post);
  if (Object.keys(post).length) return post;
  const byChannel = record(payload.postByChannel);
  return record(Object.values(byChannel).find((value) => Object.keys(record(value)).length));
}

function mediaKind(payload: Record<string, unknown>): AgentPublicationHistoryItem["mediaKind"] {
  const mediaType = string(payload.mediaType).toLowerCase();
  const byChannel = record(payload.mediaModeByChannel);
  const kinds = Object.values(byChannel).map((value) => string(value).toLowerCase());
  const hasVideo = mediaType.includes("video") || kinds.some((value) => value.includes("video")) || Boolean(payload.video);
  const hasImage = mediaType.includes("image") || kinds.some((value) => value.includes("image")) ||
    (Array.isArray(payload.images) && payload.images.length > 0);
  return hasVideo && hasImage ? "mixed" : hasVideo ? "video" : hasImage ? "image" : null;
}

function eventStatus(payload: Record<string, unknown>): AgentPublicationHistoryStatus {
  const explicit = string(payload.status).toLowerCase();
  if (explicit === "failed" || explicit === "error") return "failed";
  if (explicit === "partial") return "partial";
  if (explicit === "cancelled") return "cancelled";
  if (["queued", "processing", "dispatching", "running"].includes(explicit)) return "processing";
  const summary = record(payload.summary);
  const successCount = Number(summary.successCount ?? strings(summary.successChannels).length);
  const failureCount = Number(summary.failureCount ?? strings(summary.failedChannels).length);
  if (successCount > 0 && failureCount > 0) return "partial";
  if (failureCount > 0 && successCount === 0) return "failed";
  return "completed";
}

function actionStatus(row: AgentHistoryActionRow): AgentPublicationHistoryStatus | null {
  if (row.status === "refused" || row.status === "cancelled" || row.status === "failed") return row.status;
  if (row.status !== "completed") return null;
  const execution = record(record(row.payload).execution);
  const summary = record(execution.summary);
  const failures = Number(summary.failureCount || 0);
  if (failures > 0) return Number(summary.successCount || 0) > 0 ? "partial" : "failed";
  return "completed";
}

function scheduledStatus(row: AgentHistoryScheduledRow): AgentPublicationHistoryStatus | null {
  if (row.status === "failed" || row.status === "cancelled") return row.status;
  if (row.status !== "done") return null;
  const payload = record(row.payload);
  const execution = record(payload.lastExecution);
  const launchedNow = record(payload.launchedNow);
  const publishResult = record(execution.publishResult || launchedNow.publishResult);
  const executionStatus = firstString(execution.status, publishResult.status).toLowerCase();
  if (["queued", "processing", "dispatching", "running"].includes(executionStatus) ||
      publishResult.processing === true || publishResult.accepted === true) return "processing";
  const summary = record(publishResult.summary);
  const failures = Number(summary.failureCount || 0);
  if (failures > 0) return Number(summary.successCount || 0) > 0 ? "partial" : "failed";
  return "completed";
}

function withinWindow(value: string, from: string, to: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= Date.parse(from) && timestamp < Date.parse(to);
}

function parisMonthStart(year: number, month: number): string {
  const utcMidnight = new Date(Date.UTC(year, month, 1));
  const offsetLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  }).formatToParts(utcMidnight).find((part) => part.type === "timeZoneName")?.value || "GMT";
  const offset = offsetLabel.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  const minutes = offset
    ? (offset[1] === "+" ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3] || 0))
    : 0;
  return new Date(utcMidnight.getTime() - minutes * 60_000).toISOString();
}

export function parisHistoryCalendarParts(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
  };
}

export function agentPublicationHistoryWindow(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "numeric",
  }).formatToParts(reference);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value) - 1;
  return {
    from: parisMonthStart(year, month - 2),
    to: parisMonthStart(year, month + 1),
  };
}

export function mergeAgentPublicationHistory({
  events,
  actions,
  scheduledActions,
  from,
  to,
}: {
  events: AgentHistoryEventRow[];
  actions: AgentHistoryActionRow[];
  scheduledActions: AgentHistoryScheduledRow[];
  from: string;
  to: string;
}): AgentPublicationHistoryItem[] {
  const result: AgentPublicationHistoryItem[] = [];
  const eventIds = new Set<string>();
  const eventAgentActionIds = new Set<string>();
  const eventScheduledActionIds = new Set<string>();
  const eventPublicationIds = new Set<string>();

  for (const row of events) {
    if (eventIds.has(row.id) || !withinWindow(row.created_at, from, to)) continue;
    const durablePayload = record(row.payload);
    const payload = row.type === "publish_async_job"
      ? { ...record(durablePayload.finalPayloadBase), ...durablePayload }
      : durablePayload;
    const origin = record(payload.origin);
    if (firstString(origin.source, payload.source) !== "inr_agent") continue;
    const post = postFromPayload(payload);
    const summary = record(payload.summary);
    const channels = strings(payload.attemptedChannels).length
      ? strings(payload.attemptedChannels)
      : strings(durablePayload.channels).length
        ? strings(durablePayload.channels)
        : strings(payload.channels).length
          ? strings(payload.channels)
          : strings(summary.successChannels);
    const agentActionId = firstString(origin.agentActionId) || null;
    const scheduledActionId = firstString(origin.scheduledActionId) || null;
    const publicationId = firstString(payload.publication_id) || null;
    eventIds.add(row.id);
    if (agentActionId) eventAgentActionIds.add(agentActionId);
    if (scheduledActionId) eventScheduledActionIds.add(scheduledActionId);
    if (publicationId) eventPublicationIds.add(publicationId);
    result.push({
      id: `event-${row.id}`,
      source: "event",
      status: eventStatus(payload),
      occurredAt: row.created_at,
      title: "Publication iNr’Agent",
      contentTitle: firstString(post.title, payload.title, post.content, post.text).slice(0, 180) || null,
      channels,
      themes: strings(payload.themes),
      mediaKind: mediaKind(payload),
      agentActionId,
      scheduledActionId,
      publicationId,
    });
  }

  const scheduledIds = new Set<string>();
  const scheduledAgentActionIds = new Set<string>();
  for (const row of scheduledActions) {
    if (scheduledIds.has(row.id)) continue;
    if (eventScheduledActionIds.has(row.id)) {
      const scheduledPayload = record(row.payload);
      const sourceActionId = firstString(
        scheduledPayload.sourceActionId,
        record(scheduledPayload.publishPayload).inrAgentActionId,
      );
      if (sourceActionId) eventAgentActionIds.add(sourceActionId);
      continue;
    }
    const status = scheduledStatus(row);
    const occurredAt = firstString(row.scheduled_at, row.executed_at, row.updated_at, row.created_at);
    if (!status || !withinWindow(occurredAt, from, to)) continue;
    const payload = record(row.payload);
    const execution = record(payload.lastExecution);
    const launchedNow = record(payload.launchedNow);
    const publishResult = record(execution.publishResult || launchedNow.publishResult);
    const publicationId = firstString(publishResult.publication_id, execution.publicationId) || null;
    if (publicationId && eventPublicationIds.has(publicationId)) continue;
    const publishPayload = record(payload.publishPayload);
    const agentActionId = firstString(
      payload.sourceActionId,
      publishPayload.inrAgentActionId,
      execution.temporaryActionId,
      launchedNow.temporaryActionId,
    ) || null;
    if (agentActionId && eventAgentActionIds.has(agentActionId)) continue;
    const post = postFromPayload(Object.keys(publishPayload).length ? publishPayload : payload);
    scheduledIds.add(row.id);
    if (agentActionId) scheduledAgentActionIds.add(agentActionId);
    result.push({
      id: `scheduled-${row.id}`,
      source: "scheduled",
      status,
      occurredAt,
      title: firstString(row.title) || "Publication iNr’Agent",
      contentTitle: firstString(post.title, post.content, post.text).slice(0, 180) || null,
      channels: strings(row.channels),
      themes: [],
      mediaKind: mediaKind(Object.keys(publishPayload).length ? publishPayload : payload),
      agentActionId,
      scheduledActionId: row.id,
      publicationId,
    });
  }

  const actionIds = new Set<string>();
  for (const row of actions) {
    if (actionIds.has(row.id) || eventAgentActionIds.has(row.id) || scheduledAgentActionIds.has(row.id)) continue;
    const status = actionStatus(row);
    const occurredAt = firstString(
      row.scheduled_for,
      status === "refused" ? row.refused_at : status === "completed" || status === "partial" ? row.completed_at : row.updated_at,
      row.created_at,
    );
    if (!status || !withinWindow(occurredAt, from, to)) continue;
    const payload = record(row.payload);
    const scheduledExecution = record(payload.scheduledExecution);
    if (strings(scheduledExecution.scheduledActionIds).some(
      (id) => eventScheduledActionIds.has(id) || scheduledIds.has(id),
    )) continue;
    const execution = record(payload.execution);
    const publicationId = firstString(execution.publicationId) || null;
    const historyEventId = firstString(execution.historyEventId);
    if ((publicationId && eventPublicationIds.has(publicationId)) || (historyEventId && eventIds.has(historyEventId))) continue;
    const scheduledActionId = firstString(record(payload.scheduledRunNow).scheduledActionId) || null;
    if (scheduledActionId && (scheduledIds.has(scheduledActionId) || eventScheduledActionIds.has(scheduledActionId))) continue;
    const post = postFromPayload(payload);
    actionIds.add(row.id);
    result.push({
      id: `action-${row.id}`,
      source: "action",
      status,
      occurredAt,
      title: firstString(row.title) || "Publication iNr’Agent",
      contentTitle: firstString(post.title, post.content, post.text).slice(0, 180) || null,
      channels: strings(row.target_channels),
      themes: strings(row.target_themes),
      mediaKind: mediaKind(payload),
      agentActionId: row.id,
      scheduledActionId,
      publicationId,
    });
  }

  return result.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
}

import { filterInrAgentPublicationChannels } from "./inrAgentPublicationChannelSelection.ts";

export type ScheduledPublicationRowLike = {
  id: string;
  automation_key?: string | null;
  source?: string | null;
  channels?: unknown;
  payload?: unknown;
};

export type ScheduledPublicationRequest = {
  body: Record<string, unknown>;
  idempotencyKey: string;
  publishPayload: Record<string, unknown>;
};

export type ScheduledPublicationDispatchResult = {
  ok: boolean;
  status: "processing" | "done" | "failed";
  error?: string | null;
  detail?: string | null;
  retriable?: boolean;
  retryAfterSeconds?: number | null;
  preserveAttemptCount?: boolean;
  publicationId?: string | null;
  historyEventId?: string | null;
  historyPersisted?: boolean | null;
  summary?: Record<string, unknown> | null;
  results?: Record<string, unknown> | null;
  idempotencyKey: string;
  idempotencyState?: "completed" | "running" | "acquired" | "none" | null;
  idempotent?: boolean;
  entrusted?: boolean;
  queued?: boolean;
  asyncDispatch?: boolean;
  phase?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, maxLength = 1600) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanChannels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((channel) => cleanText(channel, 80))
        .filter(Boolean),
    ),
  );
}

function parseRetryAfterSeconds(value: unknown, fallback = 60) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.min(15 * 60, Math.max(30, Math.round(numeric)));
  }
  return fallback;
}

function errorFromPayload(
  payload: Record<string, unknown>,
  fallback: string,
) {
  return (
    cleanText(payload.error, 500) ||
    cleanText(payload.message, 500) ||
    cleanText(payload.detail, 500) ||
    fallback
  );
}

function publicationIdFromPayload(payload: Record<string, unknown>) {
  return (
    cleanText(payload.publication_id, 180) ||
    cleanText(payload.publicationId, 180) ||
    null
  );
}

export function getScheduledPublicationIdempotencyKey(
  row: ScheduledPublicationRowLike,
  publishPayload = asRecord(asRecord(row.payload).publishPayload),
) {
  return (
    cleanText(publishPayload.idempotencyKey, 180) ||
    cleanText(asRecord(publishPayload.origin).idempotencyKey, 180) ||
    `scheduled_publication:${row.id}`
  );
}

function normalizePublicationOrigin(
  row: ScheduledPublicationRowLike,
  publishPayload: Record<string, unknown>,
) {
  const scheduledPayload = asRecord(row.payload);
  const rawOrigin = asRecord(publishPayload.origin);
  const rawScheduledOrigin = asRecord(scheduledPayload.origin);
  const scheduleGrouping = asRecord(scheduledPayload.scheduleGrouping);
  const rawSource = cleanText(
    publishPayload.source ||
      rawOrigin.source ||
      rawScheduledOrigin.source ||
      scheduledPayload.origin ||
      "",
    80,
  );
  const createdFrom = cleanText(scheduleGrouping.createdFrom, 120);

  if (rawSource === "inr_agent") {
    return {
      ...rawOrigin,
      source: "inr_agent",
      label:
        cleanText(rawOrigin.label || rawScheduledOrigin.label, 120) ||
        "iNr'Agent",
      agentActionId:
        cleanText(
          publishPayload.inrAgentActionId ||
            rawOrigin.agentActionId ||
            rawScheduledOrigin.agentActionId,
          120,
        ) || null,
      scheduledActionId: row.id,
      automationKey:
        cleanText(rawOrigin.automationKey || row.automation_key || "publish", 80) ||
        "publish",
      workflowTool: "booster",
      workflowAction: "publier",
      runMode: "scheduled",
    };
  }

  if (
    rawSource === "booster_scheduled" ||
    rawSource === "booster" ||
    createdFrom === "booster_publish_schedule"
  ) {
    return {
      ...rawOrigin,
      source: "booster_scheduled",
      label:
        cleanText(rawOrigin.label || rawScheduledOrigin.label, 120) ||
        "Booster programmé",
      scheduledActionId: row.id,
      automationKey:
        cleanText(row.automation_key || "publish", 80) || "publish",
      workflowTool: "booster",
      workflowAction: "publier",
      runMode: "scheduled",
    };
  }

  return {
    ...rawOrigin,
    source: "manual",
    label:
      cleanText(rawOrigin.label || rawScheduledOrigin.label, 120) ||
      "Programmation manuelle",
    scheduledActionId: row.id,
    automationKey: cleanText(row.automation_key || "", 80) || null,
    workflowTool: "booster",
    workflowAction: "publier",
    runMode: "scheduled",
  };
}

/**
 * Builds the single durable publish-now request used by both the minute cron
 * and "execute now". Per-channel text, media mode and settings are deliberately
 * kept as-is; only the authoritative channel list and scheduling origin are
 * overlaid.
 */
export function buildScheduledPublicationRequest(
  row: ScheduledPublicationRowLike,
): ScheduledPublicationRequest | null {
  const scheduledPayload = asRecord(row.payload);
  const publishPayload = asRecord(scheduledPayload.publishPayload);
  if (!Object.keys(publishPayload).length) return null;

  const rowChannels = cleanChannels(row.channels);
  const payloadChannels = cleanChannels(
    publishPayload.channels || publishPayload.selectedChannels,
  );
  const channels = filterInrAgentPublicationChannels(scheduledPayload, rowChannels.length ? rowChannels : payloadChannels);
  if (!channels.length) return null;
  const idempotencyKey = getScheduledPublicationIdempotencyKey(
    row,
    publishPayload,
  );
  const origin = normalizePublicationOrigin(row, publishPayload);

  return {
    idempotencyKey,
    publishPayload,
    body: {
      ...publishPayload,
      channels,
      selectedChannels: channels,
      source: origin.source,
      idempotencyKey,
      origin: {
        ...asRecord(publishPayload.origin),
        ...origin,
        idempotencyKey,
      },
    },
  };
}

function isDurablyAcceptedPublication(
  httpStatus: number,
  payload: Record<string, unknown>,
  publicationId: string | null,
) {
  if (!publicationId) return false;
  const asyncQueued =
    payload.queued === true && payload.asyncDispatch === true;
  return (httpStatus === 202 && payload.ok !== false) || asyncQueued;
}

export function interpretScheduledPublicationResponse(args: {
  httpStatus: number;
  httpOk: boolean;
  responsePayload: unknown;
  responseText?: string;
  retryAfter?: unknown;
  idempotencyKey: string;
}): ScheduledPublicationDispatchResult {
  const payload = asRecord(args.responsePayload);
  const publicationId = publicationIdFromPayload(payload);
  const historyEventId = cleanText(payload.historyEventId, 180) || null;
  const idempotent = payload.idempotent === true;
  const retryAfterSeconds = parseRetryAfterSeconds(
    payload.retryAfterSeconds || args.retryAfter,
    60,
  );
  const summary = asRecord(payload.summary);
  const results = asRecord(payload.results);

  // A 202 is terminal for the scheduled action, not for the publication: the
  // durable parent and its per-channel jobs now own the work in background.
  if (
    isDurablyAcceptedPublication(args.httpStatus, payload, publicationId)
  ) {
    return {
      ok: true,
      status: "processing",
      publicationId,
      historyEventId,
      historyPersisted: true,
      summary,
      results,
      idempotencyKey: args.idempotencyKey,
      idempotencyState: "running",
      idempotent,
      entrusted: true,
      queued: true,
      asyncDispatch: true,
      phase:
        cleanText(payload.phase || payload.status, 120) || "preparing",
    };
  }

  if (
    payload.idempotencyPending === true ||
    payload.code === "execution_already_running"
  ) {
    return {
      ok: false,
      status: "failed",
      error: errorFromPayload(
        payload,
        "Publication programmée déjà en cours de traitement.",
      ),
      detail:
        cleanText(payload.detail, 900) ||
        cleanText(args.responseText, 900) ||
        null,
      retriable: true,
      retryAfterSeconds,
      preserveAttemptCount: true,
      publicationId,
      idempotencyKey: args.idempotencyKey,
      idempotencyState: "running",
      idempotent,
    };
  }

  const okFlag = payload.ok !== false;
  if (!args.httpOk || !okFlag) {
    const error = errorFromPayload(
      payload,
      "Publication impossible.",
    );
    return {
      ok: false,
      status: "failed",
      error,
      detail:
        cleanText(payload.detail, 900) ||
        cleanText(args.responseText, 900) ||
        null,
      retriable:
        payload.retryable === true ||
        (!args.httpOk &&
          (args.httpStatus === 408 ||
            args.httpStatus === 409 ||
            args.httpStatus === 425 ||
            args.httpStatus === 429 ||
            args.httpStatus >= 500)),
      retryAfterSeconds: args.httpOk ? null : retryAfterSeconds,
      publicationId,
      historyEventId,
      historyPersisted: payload.historyPersisted === true,
      summary,
      results,
      idempotencyKey: args.idempotencyKey,
      idempotencyState: idempotent ? "completed" : "acquired",
      idempotent,
    };
  }

  return {
    ok: true,
    status: "done",
    publicationId,
    historyEventId,
    historyPersisted: payload.historyPersisted === true,
    summary,
    results,
    idempotencyKey: args.idempotencyKey,
    idempotencyState: idempotent ? "completed" : "acquired",
    idempotent,
    entrusted: false,
    queued: false,
    asyncDispatch: payload.asyncDispatch === true,
    phase: cleanText(payload.phase || payload.status, 120) || null,
  };
}

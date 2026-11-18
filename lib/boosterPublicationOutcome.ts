export type BoosterPublicationOutcomeStatus =
  | "published"
  | "published_with_warning"
  | "processing"
  | "failed";

export type BoosterPublicationWarningKind =
  | "media_degraded"
  | "degraded"
  | "pending"
  | null;

type JsonRecord = Record<string, unknown>;

export type BoosterPreflightFailedChannel = {
  channel?: unknown;
  label?: unknown;
  targetKey?: unknown;
  placement?: unknown;
  code?: unknown;
  blockers?: readonly unknown[] | null;
};

const MEDIA_WARNING_CODES = new Set([
  "published_without_image",
  "published_without_video",
  "published_without_media",
  "published_without_media_and_cta",
  "published_after_retry_without_image",
  "published_with_partial_images",
]);

const TERMINAL_TIKTOK_STATUSES = new Set([
  "PUBLISH_COMPLETE",
  "DONE",
  "SUCCESS",
  "FAILED",
  "PUBLISH_FAILED",
  "ERROR",
  "CANCELLED",
  "CANCELED",
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function nonNegativeNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * Adds client-side validation failures to the server summary as real failures.
 * Those channels were deliberately not dispatched, while every valid channel
 * keeps its own server result.
 */
export function mergePreflightFailuresIntoPublicationSummary(
  summaryValue: unknown,
  failedChannelsValue:
    | readonly BoosterPreflightFailedChannel[]
    | null
    | undefined,
) {
  const summary = asRecord(summaryValue);
  const entries = Array.isArray(summary.entries)
    ? summary.entries
        .filter(
          (entry): entry is JsonRecord =>
            Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
        )
        .map((entry) => ({ ...entry }))
    : [];
  const targetKey = (entry: BoosterPreflightFailedChannel) => cleanString(entry.targetKey) ||
    (entry.placement ? `${cleanString(entry.channel)}:${cleanString(entry.placement)}` : cleanString(entry.channel));
  const existingChannels = new Set(
    entries.map(targetKey).filter(Boolean),
  );
  const preflightFailureEntries: JsonRecord[] = [];

  for (const candidate of failedChannelsValue || []) {
    const channel = cleanString(candidate?.channel);
    const key = targetKey(candidate);
    if (!channel || existingChannels.has(key)) continue;
    if (!candidate.targetKey && !candidate.placement && [...existingChannels].some((existing) => existing.startsWith(`${channel}:`))) continue;
    existingChannels.add(key);
    const blockers = Array.from(
      new Set(
        (Array.isArray(candidate?.blockers) ? candidate.blockers : [])
          .map(cleanString)
          .filter(Boolean),
      ),
    );
    const label = cleanString(candidate?.label) || channel;
    preflightFailureEntries.push({
      channel,
      label,
      ...(candidate.targetKey ? { targetKey: cleanString(candidate.targetKey) } : {}),
      ...(candidate.placement ? { placement: cleanString(candidate.placement) } : {}),
      ok: false,
      status: "failed",
      code: cleanString(candidate?.code) || "prepublish_validation_failed",
      retryable: false,
      error:
        blockers.join(" · ") ||
        `${label} n'est pas compatible avec cette publication.`,
      blockers,
    });
  }

  const mergedEntries = [...entries, ...preflightFailureEntries];
  const entryStatus = (entry: JsonRecord) => {
    const statuses = [entry.status, entry.technicalStatus].map((value) => cleanString(value).toLowerCase());
    if (entry.warning_kind === "pending" || statuses.some((status) => ["pending", "queued", "processing", "preparing", "finalizing", "awaiting_platform", "dispatching"].includes(status))) return "pending";
    if (statuses.includes("skipped")) return "skipped";
    if (entry.ok === false || statuses.some((status) => status === "failed" || status === "error")) return "failed";
    return statuses.some((status) => ["published", "published_with_warning", "completed", "success", "succeeded"].includes(status)) ? "published" : "pending";
  };
  const statuses = entries.map(entryStatus);
  const baseSuccessCount = entries.length ? statuses.filter((status) => status === "published").length : nonNegativeNumber(summary.successCount, 0);
  const baseFailureCount = entries.length ? statuses.filter((status) => status === "failed").length : nonNegativeNumber(summary.failureCount, 0);
  const pendingCount = entries.length ? statuses.filter((status) => status === "pending").length : nonNegativeNumber(summary.pendingCount, 0);
  const skippedCount = entries.length ? statuses.filter((status) => status === "skipped").length : nonNegativeNumber(summary.skippedCount, 0);
  const failureCount = baseFailureCount + preflightFailureEntries.length;
  const failedChannels = Array.from(
    new Set([
      ...(Array.isArray(summary.failedChannels)
        ? summary.failedChannels.map(cleanString).filter(Boolean)
        : entries
            .filter((entry) => entry.ok === false)
            .map((entry) => cleanString(entry.channel))
            .filter(Boolean)),
      ...preflightFailureEntries
        .map((entry) => cleanString(entry.channel))
        .filter(Boolean),
    ]),
  );

  return {
    ...summary,
    total:
      (entries.length || nonNegativeNumber(summary.total, 0)) +
      preflightFailureEntries.length,
    successCount: baseSuccessCount,
    failureCount,
    pendingCount,
    skippedCount,
    allSucceeded: failureCount === 0 && skippedCount === 0 && pendingCount === 0,
    allFailed: failureCount + skippedCount > 0 && baseSuccessCount === 0 && pendingCount === 0,
    entries: mergedEntries,
    failedChannels,
  };
}

function appendRecoveryGuidance(message: string, mediaLabel: string) {
  const clean = message.trim();
  const guidance = `Vous pouvez ajouter un autre ${mediaLabel} depuis iNrSend ou directement sur le canal.`;
  if (!clean) return guidance;
  if (/iNrSend|directement sur le canal/i.test(clean)) return clean;
  return `${clean} ${guidance}`;
}

export function isMediaPublicationWarningCode(value: unknown) {
  return MEDIA_WARNING_CODES.has(cleanString(value).toLowerCase());
}

export function isPendingPublicationResult(value: unknown) {
  const result = asRecord(value);
  if (result.ok === false) return false;
  if (result.pending === true || result.processing === true) return true;

  // `status` is a generic field also returned by internal publishers
  // (for example iNrSearch returns `status: "published"`). Treating it as a
  // TikTok status made successful non-TikTok deliveries look pending.
  const tiktokStatus = cleanString(
    result.tiktok_status || result.tiktokStatus,
  ).toUpperCase();
  if (tiktokStatus && !TERMINAL_TIKTOK_STATUSES.has(tiktokStatus)) {
    return true;
  }

  return Boolean(
    result.tiktok_status_fetch_failed === true ||
      result.statusFetchFailed === true,
  );
}

export function getPublicationWarningCode(value: unknown) {
  const result = asRecord(value);
  const warning = result.warning;
  if (typeof warning === "string") return cleanString(warning).toLowerCase() || null;
  const code = cleanString(result.code).toLowerCase();
  if (code && isMediaPublicationWarningCode(code)) return code;
  return warning ? "warning" : null;
}

export function getPublicationWarningMessage(value: unknown) {
  const result = asRecord(value);
  const code = getPublicationWarningCode(result);
  const raw = cleanString(
    result.warning_message ||
      result.warningMessage ||
      (result.ok === false ? "" : result.error),
  );

  if (!code) return raw || null;

  switch (code) {
    case "published_without_image":
    case "published_after_retry_without_image":
      return appendRecoveryGuidance(
        raw || "Publication publiée sans image.",
        "média",
      );
    case "published_without_video":
      return appendRecoveryGuidance(
        raw || "Publication publiée sans vidéo.",
        "média",
      );
    case "published_without_media":
    case "published_without_media_and_cta":
      return appendRecoveryGuidance(
        raw || "Publication publiée sans média.",
        "média",
      );
    case "published_with_partial_images":
      return appendRecoveryGuidance(
        raw || "Publication publiée avec seulement une partie des images.",
        "média",
      );
    default:
      return raw || null;
  }
}

export function classifyBoosterPublicationResult(value: unknown): {
  ok: boolean;
  status: BoosterPublicationOutcomeStatus;
  warningKind: BoosterPublicationWarningKind;
  warningCode: string | null;
  warningMessage: string | null;
} {
  const result = asRecord(value);
  const ok = result.ok !== false;
  if (!ok) {
    return {
      ok: false,
      status: "failed",
      warningKind: null,
      warningCode: null,
      warningMessage: null,
    };
  }

  const warningCode = getPublicationWarningCode(result);
  const warningMessage = getPublicationWarningMessage(result);
  if (isPendingPublicationResult(result)) {
    return {
      ok: true,
      status: "processing",
      warningKind: "pending",
      warningCode,
      warningMessage,
    };
  }

  if (!warningCode && !warningMessage) {
    return {
      ok: true,
      status: "published",
      warningKind: null,
      warningCode: null,
      warningMessage: null,
    };
  }

  return {
    ok: true,
    status: "published_with_warning",
    warningKind: isMediaPublicationWarningCode(warningCode)
      ? "media_degraded"
      : "degraded",
    warningCode,
    warningMessage,
  };
}

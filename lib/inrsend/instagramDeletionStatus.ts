import { isLegacyInstagramDeletionUnconfirmed } from "./instagramCapabilities.ts";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

function remoteDeletionConfirmed(value: unknown): boolean {
  const row = record(value);
  return ["remoteDeletionConfirmed", "remote_deletion_confirmed", "remoteDeleted", "remote_deleted"].some((key) => row[key] === true);
}

/** A creation container alone must never turn a local draft into remote media. */
function hasIdentifiedInstagramMedia(value: unknown, depth = 0): boolean {
  const row = record(value);
  if (["external_id", "externalId", "instagram_parent_media_id", "mediaId", "parentMediaId"].some((key) => text(row[key]))) return true;
  if (["instagram_child_media_ids", "childMediaIds"].some((key) => Array.isArray(row[key]) && (row[key] as unknown[]).some((id) => text(id)))) return true;
  if (text(record(row.publishResponse).id)) return true;
  if (["external_url", "permalink"].some((key) => /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\//i.test(text(row[key])))) return true;
  return depth < 4 && ["diagnostics", "checkpoint", "instagramVideoCheckpoint", "instagram_video_checkpoint", "instagram_checkpoint"].some((key) => hasIdentifiedInstagramMedia(row[key], depth + 1));
}

/** Safe for classifiers that do not know the channel: explicit annotation only. */
export function hasInstagramDeletionUnconfirmedAnnotation(value: unknown): boolean {
  const row = record(value);
  if (remoteDeletionConfirmed(row)) return false;
  return row.remote_deletion_unconfirmed === true || text(row.status).toLowerCase() === "deletion_unconfirmed";
}

/** Legacy detection is valid only after the caller has identified Instagram. */
export function isInstagramDeletionUnconfirmed(value: unknown): boolean {
  const row = record(value);
  if (remoteDeletionConfirmed(row)) return false;
  if (hasInstagramDeletionUnconfirmedAnnotation(row)) return true;
  const legacy = row.externalId && !row.external_id ? { ...row, external_id: row.externalId } : row;
  return hasIdentifiedInstagramMedia(row) && isLegacyInstagramDeletionUnconfirmed(legacy);
}

/** A read projection, not a remote existence check or a repair of stored data. */
export function normalizeInstagramDeletionResult<T>(value: T): T {
  const row = record(value);
  if (!isInstagramDeletionUnconfirmed(row)) return value;
  if (row.remote_deletion_unconfirmed === true && row.status === "deletion_unconfirmed" && row.deleted === false && row.pending !== true && (!Object.hasOwn(row, "technicalStatus") || row.technicalStatus === "deletion_unconfirmed")) return value;
  return {
    ...row,
    status: "deletion_unconfirmed",
    deleted: false,
    remote_deletion_unconfirmed: true,
    legacy_deletion_status: row.legacy_deletion_status ?? row.status ?? "deleted",
    ...(Object.hasOwn(row, "pending") ? { pending: false } : {}),
    ...(Object.hasOwn(row, "technicalStatus") ? { technicalStatus: "deletion_unconfirmed" } : {}),
  } as T;
}

/** History and live status share the same terminal, non-retryable annotation. */
export function projectInstagramDeletionStatus<T>(value: T): T {
  const payload = record(value);
  const results = record(payload.results);
  const summary = record(payload.summary);
  const entries = Array.isArray(summary.entries) ? summary.entries : [];
  if (remoteDeletionConfirmed(results.instagram) || entries.some((entry) => record(entry).channel === "instagram" && remoteDeletionConfirmed(entry))) return value;
  const normalized = normalizeInstagramDeletionResult(results.instagram);
  const resultUnconfirmed = isInstagramDeletionUnconfirmed(normalized);
  let entriesChanged = false;
  let removedPendingEntries = 0;
  const nextEntries = entries.map((entry) => {
    const row = record(entry);
    if (row.channel !== "instagram") return entry;
    const next = resultUnconfirmed
      ? normalizeInstagramDeletionResult({ ...row, remote_deletion_unconfirmed: true })
      : normalizeInstagramDeletionResult(entry);
    if (next === entry) return entry;
    entriesChanged = true;
    if (row.pending === true) removedPendingEntries += 1;
    const projected = record(next);
    return { ...projected, technicalStatus: "deletion_unconfirmed" };
  });
  if (normalized === results.instagram && !entriesChanged) return value;
  return {
    ...payload,
    ...(normalized !== results.instagram ? { results: { ...results, instagram: normalized } } : {}),
    ...(entriesChanged ? { summary: {
      ...summary,
      entries: nextEntries,
      ...(removedPendingEntries > 0 && typeof summary.pendingCount === "number" && Number.isFinite(summary.pendingCount)
        ? { pendingCount: Math.max(0, summary.pendingCount - removedPendingEntries) }
        : {}),
    } } : {}),
  } as T;
}

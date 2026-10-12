// Instagram's documented media API does not expose published-media deletion.
// This pure contract is shared by iNrSend handlers and the history UI.
export const INSTAGRAM_DELETE_UNSUPPORTED_MESSAGE = "Meta ne permet pas de supprimer une publication Instagram depuis iNrCy, que la connexion soit directe ou via Facebook. Ouvrez Instagram pour la supprimer. Aucun changement n’a été effectué dans iNr’Send.";
export const INSTAGRAM_PUBLICATION_CAPABILITIES = {
  deleteDraft: true, deletePublished: false,
  publishedDeleteMessage: INSTAGRAM_DELETE_UNSUPPORTED_MESSAGE,
  documentationUrl: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/",
} as const;

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const status = (value: unknown) => text(value).toLowerCase();
function records(value: unknown, depth = 0): RecordValue[] {
  const row = record(value);
  if (depth >= 4) return [row];
  return [row, ...["diagnostics", "checkpoint", "instagramVideoCheckpoint", "instagram_video_checkpoint", "instagram_checkpoint"].flatMap((key) => row[key] ? records(row[key], depth + 1) : [])];
}
function instagramDeliveries(value: unknown): RecordValue[] {
  if (Array.isArray(value)) return value.map(record).filter((row) => row.channel === "instagram");
  const row = record(value);
  const instagram = row.instagram;
  if (Array.isArray(instagram)) return instagram.map(record);
  if (typeof instagram === "string") return [{ status: instagram }];
  if (instagram && typeof instagram === "object") return [record(instagram)];
  return row.channel === "instagram" ? [row] : [];
}
/** Container IDs alone are not proof of a published post. Published IDs and receipts are. */
export function hasInstagramPublishedMedia(value: unknown, deliveries?: unknown): boolean {
  if (instagramDeliveries(deliveries).some((row) => ["delivered", "published"].includes(status(row.status)))) return true;
  return records(value).some((row) => {
    if (["external_id", "instagram_parent_media_id", "mediaId", "parentMediaId"].some((key) => text(row[key]))) return true;
    if (["instagram_child_media_ids", "childMediaIds"].some((key) => Array.isArray(row[key]) && (row[key] as unknown[]).some((id) => text(id)))) return true;
    if (text(record(row.publishResponse).id)) return true;
    if (["external_url", "permalink"].some((key) => /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\//i.test(text(row[key])))) return true;
    return ["delivered", "published"].includes(status(row.status)) || status(row.state) === "published" || status(row.outcome) === "published" || row.ok === true && row.pending !== true && !["created", "processing", "ready", "publish_unknown"].includes(status(row.state)) && !["checkpoint", "processing", "ready"].includes(status(row.outcome));
  });
}
export function isInstagramPublicationOutcomeUncertain(value: unknown): boolean {
  return records(value).some((row) => row.requestMayHaveSucceeded === true || status(row.state) === "publish_unknown" || status(row.outcome) === "ambiguous" || /publish_unknown|publish_ambiguous/.test(text(row.code)));
}
/** Only an explicit unpublished state may be removed locally; unknown is fail-closed. */
export function canRemoveInstagramDraftLocally(value: unknown, deliveries?: unknown): boolean {
  if (hasInstagramPublishedMedia(value, deliveries) || isInstagramPublicationOutcomeUncertain(value)) return false;
  const row = record(value);
  if (row.local_deleted_only === true && row.delete_scope === "local_draft") return true;
  if (row.deleted === true || status(row.status) === "deleted") return false;
  if (row.ok === false || row.pending === true || ["draft", "failed", "pending", "queued", "scheduled", "cancelled", "canceled"].includes(status(row.status))) return true;
  return instagramDeliveries(deliveries).some((delivery) => ["draft", "failed", "pending", "queued", "scheduled", "cancelled", "canceled"].includes(status(delivery.status)));
}
/** Legacy code kept the published ID while marking a failed remote deletion as deleted. */
export function isLegacyInstagramDeletionUnconfirmed(value: unknown): boolean {
  const row = record(value);
  if (row.remoteDeletionConfirmed === true || row.remote_deletion_confirmed === true || row.remote_deleted === true || row.remoteDeleted === true) return false;
  return (row.deleted === true || status(row.status) === "deleted") && hasInstagramPublishedMedia(row);
}

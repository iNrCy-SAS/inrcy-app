import { isBoosterPublicationPendingStatus } from "./boosterPublicationStatus.ts";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function publicationStorySequenceResumeRef(value: unknown): string | undefined {
  return typeof value === "string" && uuid.test(value) ? value : undefined;
}
/** Counts are provider confirmations, never inferred from an error or an ID list. */
export function publicationStorySequenceCounts(value: unknown): { confirmed: number; expected: number } | null {
  const entry = row(value), confirmed = entry.published_image_count, expected = entry.expected_image_count;
  if ((entry.channel !== "facebook" && entry.channel !== "instagram") || typeof confirmed !== "number" || typeof expected !== "number" ||
    !Number.isInteger(confirmed) || !Number.isInteger(expected) || expected < 1 || expected > 5 || confirmed < 0 || confirmed > expected) return null;
  return { confirmed, expected };
}

/** A Reel may be published while its ordered Story sequence still needs repair. */
export function isRetryablePublicationEntry(value: unknown): boolean {
  const entry = row(value), status = String(entry.status || "").toLowerCase(), technical = String(entry.technicalStatus || "").toLowerCase();
  const hasCheckpoint = entry.story_sequence_resume_ref !== undefined && entry.story_sequence_resume_ref !== null;
  const reference = publicationStorySequenceResumeRef(entry.story_sequence_resume_ref);
  if (hasCheckpoint && (!reference || entry.retryable !== true || (entry.channel !== "facebook" && entry.channel !== "instagram"))) return false;
  if (entry.retryable === false || entry.warning_kind === "pending" || isBoosterPublicationPendingStatus(status) || isBoosterPublicationPendingStatus(technical) || status === "skipped") return false;
  if (entry.ok === false || [status, technical].some(item => item === "failed" || item === "error")) return true;
  return (entry.channel === "facebook" || entry.channel === "instagram") && entry.retryable === true && Boolean(reference) &&
    (entry.warning === "meta_placement_partial_failure" || entry.code === "meta_placement_partial_failure");
}

/** Transport a server checkpoint only for explicitly retried failed Meta targets. */
export function buildStorySequenceResumeByChannel(summaryValue: unknown, channels: readonly string[]): Partial<Record<"facebook" | "instagram", string>> | undefined {
  const summary = row(summaryValue), selected = new Set(channels);
  const result: Partial<Record<"facebook" | "instagram", string>> = {};
  for (const candidate of Array.isArray(summary.entries) ? summary.entries : []) {
    const entry = row(candidate), channel = entry.channel;
    if ((channel !== "facebook" && channel !== "instagram") || !selected.has(channel) || !isRetryablePublicationEntry(entry)) continue;
    const reference = publicationStorySequenceResumeRef(entry.story_sequence_resume_ref);
    if (reference) result[channel] = reference;
  }
  return Object.keys(result).length ? result : undefined;
}

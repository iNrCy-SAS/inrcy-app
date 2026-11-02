import { type PublishExecutionSummary } from "../../_components/PublishExecutionResultModal";
import { getPublicationDestinationStatus } from "../../_components/PublishExecutionProgress";
import { mergePreflightFailuresIntoPublicationSummary } from "@/lib/boosterPublicationOutcome";
import { isRetryablePublicationEntry, publicationStorySequenceResumeRef, publicationStorySequenceCounts } from "@/lib/publicationStorySequenceRetry";
import { type ChannelKey } from "./publishModal.shared";

export function mergeRetriedPublicationSummary(
  previous: PublishExecutionSummary | undefined,
  next: PublishExecutionSummary | ReturnType<typeof mergePreflightFailuresIntoPublicationSummary>,
  publicationId: string | null,
  retriedChannels: readonly string[],
): PublishExecutionSummary & { total: number; allSucceeded: boolean; failedChannels: string[] } {
  const entriesByChannel = new Map(
    (previous?.entries || []).map((entry) => [entry.channel, {
      ...entry,
      publicationId: entry.publicationId || previous?.publicationId || previous?.publication_id || null,
    }]),
  );
  const retried = new Set(retriedChannels);
  for (const entry of next.entries || []) {
    const channel = String(entry.channel || "").trim();
    if (!channel || (previous && !retried.has(channel))) continue;
    const storyCounts = publicationStorySequenceCounts(entry);
    entriesByChannel.set(channel, {
      channel,
      label: String(entry.label || channel),
      publicationId,
      ok: typeof entry.ok === "boolean" ? entry.ok : undefined,
      status: typeof entry.status === "string" ? entry.status : undefined,
      technicalStatus: typeof entry.technicalStatus === "string" ? entry.technicalStatus : undefined,
      code: typeof entry.code === "string" ? entry.code : undefined,
      retryable: typeof entry.retryable === "boolean" ? entry.retryable : undefined,
      story_sequence_resume_ref: publicationStorySequenceResumeRef(entry.story_sequence_resume_ref),
      published_image_count: storyCounts?.confirmed,
      expected_image_count: storyCounts?.expected,
      error: typeof entry.error === "string" ? entry.error : undefined,
      warning: typeof entry.warning === "string" ? entry.warning : undefined,
      warning_kind: typeof entry.warning_kind === "string" ? entry.warning_kind : undefined,
      warning_message: typeof entry.warning_message === "string" ? entry.warning_message : undefined,
      blockers: Array.isArray(entry.blockers) ? entry.blockers.filter((blocker): blocker is string => typeof blocker === "string") : undefined,
    });
  }
  const entries = [...entriesByChannel.values()];
  const statuses = entries.map(getPublicationDestinationStatus);
  const pendingCount = statuses.filter((status) => status === "pending").length;
  const successCount = statuses.filter((status) => ["published", "warning", "pending"].includes(status)).length;
  const failureCount = statuses.filter((status) => status === "failed").length;
  return {
    ...previous,
    ...next,
    publicationId,
    entries,
    successCount,
    failureCount,
    retryableFailureCount: entries.filter(isRetryablePublicationEntry).length,
    pendingCount,
    skippedCount: statuses.filter((status) => status === "skipped").length,
    warningCount: statuses.filter((status) => status === "warning").length,
    mediaWarningCount: entries.filter((entry) => entry.warning_kind === "media_degraded").length,
    total: entries.length,
    allSucceeded: entries.length > 0 && statuses.every((status) => status === "published" || status === "warning"),
    failedChannels: entries.filter((entry) => ["failed", "skipped"].includes(getPublicationDestinationStatus(entry))).map((entry) => entry.channel),
    allFailed: entries.length > 0 && successCount === 0 && failureCount > 0,
  };
}

export const buildChannelRecord = <T,>(
  source: Partial<Record<ChannelKey, T>>,
  channels: ChannelKey[],
): Partial<Record<ChannelKey, T>> =>
  Object.fromEntries(
    channels
      .map((channel) => [channel, source[channel]] as const)
      .filter(
        (entry): entry is readonly [ChannelKey, T] => entry[1] !== undefined,
      ),
  ) as Partial<Record<ChannelKey, T>>;

export const buildChannelUnknownRecord = (
  source: Partial<Record<ChannelKey, unknown>>,
  channels: ChannelKey[],
): Partial<Record<ChannelKey, unknown>> =>
  Object.fromEntries(
    channels
      .map((channel) => [channel, source[channel]] as const)
      .filter((entry) => entry[1] !== undefined),
  ) as Partial<Record<ChannelKey, unknown>>;

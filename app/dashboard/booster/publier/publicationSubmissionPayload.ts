import { type PublishExecutionSummary } from "../../_components/PublishExecutionResultModal";
import { getPublicationDestinationStatus } from "../../_components/PublishExecutionProgress";
import { mergePreflightFailuresIntoPublicationSummary } from "@/lib/boosterPublicationOutcome";
import { isRetryablePublicationEntry, publicationStorySequenceResumeRef, publicationStorySequenceCounts } from "@/lib/publicationStorySequenceRetry";
import { type ChannelKey } from "./publishModal.shared";
import { normalizeMetaPublicationPlacement } from "@/lib/metaPublicationTargets";

export function publicationSummaryTargetKey(entry: { channel?: unknown; targetKey?: unknown; placement?: unknown }) {
  return String(entry.targetKey || (entry.placement ? `${entry.channel}:${entry.placement}` : entry.channel) || "").trim();
}

export function getRetryPublicationTargets(summary: PublishExecutionSummary, channels: readonly string[]) {
  return (summary.entries || []).filter((entry) => channels.includes(entry.channel) && isRetryablePublicationEntry(entry)).map((entry) => ({
    key: publicationSummaryTargetKey(entry), channel: entry.channel,
    placement: entry.channel === "facebook" || entry.channel === "instagram"
      ? normalizeMetaPublicationPlacement(entry.placement || entry.targetKey?.split(":")[1])
      : null,
  }));
}

export function mergeRetriedPublicationSummary(
  previous: PublishExecutionSummary | undefined,
  next: PublishExecutionSummary | ReturnType<typeof mergePreflightFailuresIntoPublicationSummary>,
  publicationId: string | null,
  retriedChannels: readonly string[],
): PublishExecutionSummary & { entries: NonNullable<PublishExecutionSummary["entries"]>; total: number; allSucceeded: boolean; failedChannels: string[] } {
  const entriesByChannel = new Map<string, NonNullable<PublishExecutionSummary["entries"]>[number]>(
    (previous?.entries || []).map((entry) => [publicationSummaryTargetKey(entry), {
      ...entry,
      publicationId: entry.publicationId || previous?.publicationId || previous?.publication_id || null,
    }]),
  );
  const retried = new Set(retriedChannels);
  for (const entry of next.entries || []) {
    const channel = String(entry.channel || "").trim();
    if (!channel || (previous && !retried.has(channel))) continue;
    const targetKey = publicationSummaryTargetKey(entry);
    const prior = entriesByChannel.get(targetKey);
    if (previous && prior && !isRetryablePublicationEntry(prior) && ["published", "warning"].includes(getPublicationDestinationStatus(prior))) continue;
    if (targetKey !== channel && entriesByChannel.has(channel) && isRetryablePublicationEntry(entriesByChannel.get(channel)!)) entriesByChannel.delete(channel);
    const storyCounts = publicationStorySequenceCounts(entry);
    entriesByChannel.set(targetKey, {
      channel,
      targetKey: typeof entry.targetKey === "string" ? entry.targetKey : undefined,
      placement: typeof entry.placement === "string" ? entry.placement : undefined,
      threads_publication_mode: typeof entry.threads_publication_mode === "string" ? entry.threads_publication_mode : undefined,
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
  const detailedKeys = [...entriesByChannel.keys()].filter((key) => key.includes(":"));
  const entries = [...entriesByChannel.values()].filter((entry) => {
    const key = publicationSummaryTargetKey(entry);
    return key.includes(":") || !detailedKeys.some((target) => target.startsWith(`${key}:`));
  });
  const statuses = entries.map(getPublicationDestinationStatus);
  const pendingCount = statuses.filter((status) => status === "pending").length;
  const successCount = statuses.filter((status) => ["published", "warning"].includes(status)).length;
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
    failedChannels: [...new Set(entries.filter((entry) => ["failed", "skipped"].includes(getPublicationDestinationStatus(entry))).map((entry) => entry.channel))],
    allFailed: entries.length > 0 && successCount === 0 && failureCount > 0 && pendingCount === 0,
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

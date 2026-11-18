/** Different channels may run together; each channel publishes its primary first. */
export async function runPublicationJobsInChannelOrder<T>(
  jobs: readonly T[],
  channelKey: (job: T) => string,
  placement: (job: T) => unknown,
  dispatch: (job: T) => Promise<unknown>,
) {
  const groups = new Map<string, T[]>();
  for (const job of jobs) {
    const key = channelKey(job);
    groups.set(key, [...(groups.get(key) || []), job]);
  }
  return Promise.allSettled(Array.from(groups.values(), async (group) => {
    group.sort((a, b) => Number(placement(a) === "story") - Number(placement(b) === "story"));
    const outcomes: PromiseSettledResult<unknown>[] = [];
    for (const job of group) {
      // A failed primary still leaves its additional publication independent.
      outcomes.push(...await Promise.allSettled([Promise.resolve().then(() => dispatch(job))]));
    }
    return outcomes;
  }));
}

export function getPublicationTargetPredecessor(
  target: { key: string; channel: string; placement: unknown },
  targets: readonly { key: string; channel: string; placement: unknown }[],
  eventIds: Record<string, unknown>,
) {
  if (target.placement !== "story") return null;
  const primary = targets.find(candidate => candidate.channel === target.channel && candidate.placement !== "story");
  return primary ? String(eventIds[primary.key] || "").trim() || null : null;
}

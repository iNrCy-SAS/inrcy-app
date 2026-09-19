type PublicationScheduleReference = {
  scheduledFor?: string | null;
};

const PUBLICATION_VISIBILITY_CLOCK_MAX_DELAY_MS = 60_000;
const PUBLICATION_VISIBILITY_CLOCK_MIN_DELAY_MS = 100;

export function publicationScheduledTimestamp(
  action: PublicationScheduleReference,
) {
  const timestamp = Date.parse(String(action.scheduledFor || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function hasPublicationSchedulePassed(
  action: PublicationScheduleReference,
  nowTimestamp: number,
) {
  const scheduledTimestamp = publicationScheduledTimestamp(action);
  return (
    scheduledTimestamp !== null &&
    nowTimestamp > 0 &&
    scheduledTimestamp <= nowTimestamp
  );
}

export function nextPublicationVisibilityRefreshDelay(
  actions: PublicationScheduleReference[],
  nowTimestamp: number,
) {
  const nextScheduledTimestamp = actions.reduce<number | null>(
    (current, action) => {
      const timestamp = publicationScheduledTimestamp(action);
      if (timestamp === null || timestamp <= nowTimestamp) return current;
      return current === null ? timestamp : Math.min(current, timestamp);
    },
    null,
  );

  if (nextScheduledTimestamp === null) return null;
  return Math.min(
    PUBLICATION_VISIBILITY_CLOCK_MAX_DELAY_MS,
    Math.max(
      PUBLICATION_VISIBILITY_CLOCK_MIN_DELAY_MS,
      nextScheduledTimestamp - nowTimestamp +
        PUBLICATION_VISIBILITY_CLOCK_MIN_DELAY_MS,
    ),
  );
}

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

type RefusedPublicationReference = PublicationScheduleReference & {
  status?: string; automationKey?: string | null; actionType?: string; targetTool?: string;
  completedAt?: string | null; validationRequired?: boolean; executionPolicy?: string;
};

/** Reuse the publication visibility clock: undated refusals never remain in the review list. */
export function isHiddenRefusedPublication(action: RefusedPublicationReference, nowTimestamp: number) {
  return action.status === "refused" && (publicationScheduledTimestamp(action) === null || hasPublicationSchedulePassed(action, nowTimestamp));
}

export function canRestoreRefusedPublication(action: RefusedPublicationReference | null | undefined, nowTimestamp: number) {
  return Boolean(action && action.status === "refused" && action.automationKey === "publish"
    && action.actionType === "publication" && action.targetTool === "booster" && !action.completedAt
    && action.validationRequired !== false && action.executionPolicy !== "automatic_after_settings"
    && nowTimestamp > 0 && publicationScheduledTimestamp(action) !== null
    && !hasPublicationSchedulePassed(action, nowTimestamp));
}

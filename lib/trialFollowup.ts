export const ADMIN_TRIAL_FOLLOWUP_OFFSETS = [3, 2] as const;

export type AdminTrialFollowupOffset = (typeof ADMIN_TRIAL_FOLLOWUP_OFFSETS)[number];

function utcDayTimestamp(value: Date) {
  if (!Number.isFinite(value.getTime())) return null;
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function calendarDaysUntil(endAt: string | Date | null | undefined, now = new Date()) {
  if (!endAt) return null;
  const end = endAt instanceof Date ? endAt : new Date(endAt);
  const endDay = utcDayTimestamp(end);
  const currentDay = utcDayTimestamp(now);
  if (endDay === null || currentDay === null) return null;
  return Math.round((endDay - currentDay) / (24 * 60 * 60 * 1000));
}

export function adminTrialFollowupOffset(
  endAt: string | Date | null | undefined,
  now = new Date(),
): AdminTrialFollowupOffset | null {
  const days = calendarDaysUntil(endAt, now);
  return ADMIN_TRIAL_FOLLOWUP_OFFSETS.includes(days as AdminTrialFollowupOffset)
    ? (days as AdminTrialFollowupOffset)
    : null;
}

export function adminTrialFollowupDedupeKey(input: {
  trialUserId: string;
  trialEndAt: string;
  daysBeforeEnd: AdminTrialFollowupOffset;
}) {
  const endDay = new Date(input.trialEndAt).toISOString().slice(0, 10);
  return `admin:trial-followup:${input.trialUserId}:${endDay}:d-${input.daysBeforeEnd}`;
}

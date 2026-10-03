import { createHash } from "node:crypto";

type EditorialMetadata = Record<string, unknown> | null | undefined;

type TerminalEditorialRow = {
  status: string;
  refused_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: EditorialMetadata;
};

const LEGACY_UNACTIVATED_EPOCH = "1970-01-01T00:00:00.000Z";

function record(value: EditorialMetadata): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The legacy saved-at value is frozen into editorialPlanEpoch on the next settings save. */
export function editorialPlanEpoch(metadata: EditorialMetadata): string | null {
  const values = record(metadata);
  for (const candidate of [values.editorialPlanEpoch, values.lastSettingsSavedAt]) {
    if (typeof candidate === "string" && timestamp(candidate) !== null) {
      return candidate;
    }
  }
  return null;
}

export function nextEditorialPlanEpoch(args: {
  previousMetadata: EditorialMetadata;
  calendarChanged: boolean;
  nowIso: string;
  deferredUntil?: string | null;
}): string {
  const previous = editorialPlanEpoch(args.previousMetadata);
  // A legacy row with no saved epoch must stay closed until a real calendar
  // change. Treating the current no-op save as its first activation would
  // reopen decisions that predate this rollout.
  if (!args.calendarChanged) return previous || LEGACY_UNACTIVATED_EPOCH;
  return args.deferredUntil && timestamp(args.deferredUntil) !== null
    ? args.deferredUntil
    : args.nowIso;
}

export function deterministicEditorialActionId(args: {
  version: number;
  userId: string;
  slotKey: string;
  planEpoch?: string | null;
}): string {
  const epochSuffix = args.planEpoch ? `:${args.planEpoch}` : "";
  const hex = createHash("sha256")
    .update(`inrcy:editorial-plan:v${args.version}:${args.userId}:${args.slotKey}${epochSuffix}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A terminal decision remains in history. A later *planning* epoch may create
 * another action for the same calendar slot, but never mutate the old one.
 */
export function shouldReplaceTerminalEditorialRow(
  row: TerminalEditorialRow,
  planEpoch: string | null,
): boolean {
  if (row.status !== "refused" && row.status !== "cancelled") return false;
  const metadata = record(row.metadata);
  if (
    row.status === "cancelled" &&
    metadata.editorialCancelReason === "automation_disabled" &&
    !row.refused_at
  ) {
    // This row can be reactivated by the existing automatic-cancellation path.
    return false;
  }
  const epochAt = timestamp(planEpoch);
  const terminalTimes = [
    timestamp(row.refused_at),
    timestamp(metadata.editorialCancelledAt),
    timestamp(row.updated_at),
    timestamp(row.created_at),
  ].filter((value): value is number => value !== null);
  if (epochAt === null || terminalTimes.length === 0) return false;
  const rowEpoch = timestamp(metadata.editorialPlanEpoch);
  if (rowEpoch !== null && rowEpoch >= epochAt) return false;
  return epochAt > Math.max(...terminalTimes);
}

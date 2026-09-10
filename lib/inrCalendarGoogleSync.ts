import "server-only";

import { optionalEnv } from "@/lib/env";
import { INR_CALENDAR_GOOGLE_SOURCE } from "@/lib/inrCalendarGoogleSyncConstants";
import {
  buildInrCalendarCanonicalEventId,
  buildInrCalendarGoogleEventId,
  buildInrCalendarGoogleRow,
  type InrCalendarGoogleEvent,
  type InrCalendarGoogleRow,
} from "@/lib/inrCalendarGoogleSyncPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canonicalVisioAppointmentIdentity } from "@/lib/visioAppointmentIdentity";
import {
  getVisioPublicCalendarId,
  getVisioBookingIntegrationAccountId,
  getVisioSharedCalendarId,
  getVisioTeamMembers,
  listVisioSharedCalendarEvents,
} from "@/lib/visioBookingGoogle";

const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FUTURE_DAYS = 365;
const DATABASE_BATCH_SIZE = 200;

type ExistingGoogleRow = {
  id: string;
  start_at: string | null;
  end_at: string | null;
  meta: unknown;
};

export type InrCalendarGoogleSyncResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  calendarId: string;
  adminUserId: string;
  range: { timeMin: string; timeMax: string };
  scanned: number;
  upserted: number;
  deleted: number;
  deduplicated: number;
  skipped: number;
  errors: string[];
};

function boundedInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(optionalEnv(name, String(fallback)));
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.floor(parsed)))
    : fallback;
}

async function getInrCalendarAdminAccountId() {
  const configuredAccountId = optionalEnv("INRCY_INRCALENDAR_ACCOUNT_ID").trim();
  const accountId = configuredAccountId || (await getVisioBookingIntegrationAccountId());
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
    throw new Error("inrcalendar_google_admin_account_id_invalid");
  }

  // agenda_events.user_id references inrcy_accounts.id, not the Supabase Auth user id.
  const { data, error } = await supabaseAdmin
    .from("inrcy_accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`inrcalendar_google_admin_account_read_failed:${error.message}`);
  }
  if (!data) throw new Error("inrcalendar_google_admin_account_missing");
  return accountId;
}

function batches<T>(values: T[], size = DATABASE_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function shouldPreferCanonicalGoogleEvent(
  candidate: InrCalendarGoogleEvent,
  current: InrCalendarGoogleEvent,
) {
  const candidatePrivate = candidate.extendedProperties?.private || {};
  const currentPrivate = current.extendedProperties?.private || {};
  const candidateIsBooking = Boolean(candidatePrivate.inrcyBooking);
  const currentIsBooking = Boolean(currentPrivate.inrcyBooking);
  if (candidateIsBooking !== currentIsBooking) return candidateIsBooking;

  const candidateIsOrganizer = candidatePrivate.sourceCalendarIsOrganizer === "true";
  const currentIsOrganizer = currentPrivate.sourceCalendarIsOrganizer === "true";
  if (candidateIsOrganizer !== currentIsOrganizer) return candidateIsOrganizer;

  const candidateHasMeet = Boolean(
    candidate.hangoutLink || candidatePrivate.sourceMeetUrl,
  );
  const currentHasMeet = Boolean(current.hangoutLink || currentPrivate.sourceMeetUrl);
  if (candidateHasMeet !== currentHasMeet) return candidateHasMeet;

  const updatedOrder = String(candidate.updated || "").localeCompare(
    String(current.updated || ""),
  );
  if (updatedOrder !== 0) return updatedOrder > 0;
  return String(candidate.id || "") < String(current.id || "");
}

async function deleteImportedRows(ids: string[], adminUserId: string) {
  let deleted = 0;
  for (const batch of batches([...new Set(ids)])) {
    if (batch.length === 0) continue;
    const { error } = await supabaseAdmin
      .from("agenda_events")
      .delete()
      .in("id", batch)
      .eq("user_id", adminUserId)
      .contains("meta", { source: INR_CALENDAR_GOOGLE_SOURCE });
    if (error) throw new Error(`inrcalendar_google_delete_failed:${error.message}`);
    deleted += batch.length;
  }
  return deleted;
}

async function upsertImportedRows(rows: InrCalendarGoogleRow[]) {
  let upserted = 0;
  for (const batch of batches(rows)) {
    if (batch.length === 0) continue;
    const { error } = await supabaseAdmin
      .from("agenda_events")
      .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
    if (error) throw new Error(`inrcalendar_google_upsert_failed:${error.message}`);
    upserted += batch.length;
  }
  return upserted;
}

export async function syncVisioSharedCalendarToInrCalendar(input?: {
  now?: Date;
  pastDays?: number;
  futureDays?: number;
}): Promise<InrCalendarGoogleSyncResult> {
  const startedAt = new Date();
  const now = input?.now || startedAt;
  const pastDays = Math.min(
    365,
    Math.max(
      1,
      input?.pastDays ??
        boundedInteger("INRCY_INRCALENDAR_GOOGLE_PAST_DAYS", DEFAULT_PAST_DAYS, 1, 365),
    ),
  );
  const futureDays = Math.min(
    730,
    Math.max(
      7,
      input?.futureDays ??
        boundedInteger("INRCY_INRCALENDAR_GOOGLE_FUTURE_DAYS", DEFAULT_FUTURE_DAYS, 7, 730),
    ),
  );
  const timeMin = new Date(now.getTime() - pastDays * 24 * 60 * 60_000);
  const timeMax = new Date(now.getTime() + futureDays * 24 * 60 * 60_000);
  const calendarId = getVisioSharedCalendarId();
  const adminUserId = await getInrCalendarAdminAccountId();
  const result: InrCalendarGoogleSyncResult = {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    calendarId,
    adminUserId,
    range: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() },
    scanned: 0,
    upserted: 0,
    deleted: 0,
    deduplicated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    const googleEvents = await listVisioSharedCalendarEvents(timeMin, timeMax, true);
    result.scanned = googleEvents.length;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("agenda_events")
      .select("id,start_at,end_at,meta")
      .eq("user_id", adminUserId)
      .contains("meta", { source: INR_CALENDAR_GOOGLE_SOURCE })
      .lt("start_at", timeMax.toISOString())
      .gt("end_at", timeMin.toISOString())
      .limit(5000);
    if (existingError) {
      throw new Error(`inrcalendar_google_existing_read_failed:${existingError.message}`);
    }

    const rows: InrCalendarGoogleRow[] = [];
    const existingById = new Map(
      ((existing || []) as ExistingGoogleRow[]).map((row) => [String(row.id), row]),
    );
    const internalEmails = [
      getVisioPublicCalendarId(),
      calendarId,
      ...getVisioTeamMembers().flatMap((member) => [member.email, member.calendarId]),
    ];
    const activeIds = new Set<string>();
    const cancelledIds: string[] = [];
    const canonicalEvents = new Map<string, InrCalendarGoogleEvent>();
    for (const event of googleEvents) {
      const eventId = String(event.id || "").trim();
      if (!eventId) {
        result.skipped += 1;
        continue;
      }
      const importedId = buildInrCalendarGoogleEventId(calendarId, eventId);
      if (String(event.status || "").toLowerCase() === "cancelled") {
        cancelledIds.push(importedId);
        const cancelledIdentity = canonicalVisioAppointmentIdentity(event);
        if (cancelledIdentity) {
          cancelledIds.push(
            buildInrCalendarCanonicalEventId(calendarId, cancelledIdentity),
          );
        }
        continue;
      }
      const canonicalIdentity = canonicalVisioAppointmentIdentity(event);
      const current = canonicalEvents.get(canonicalIdentity);
      if (current) {
        result.deduplicated += 1;
        if (shouldPreferCanonicalGoogleEvent(event, current)) {
          canonicalEvents.set(canonicalIdentity, event);
        }
      } else {
        canonicalEvents.set(canonicalIdentity, event);
      }
    }

    for (const [canonicalIdentity, event] of canonicalEvents) {
      const importedId = buildInrCalendarCanonicalEventId(
        calendarId,
        canonicalIdentity,
      );
      const row = buildInrCalendarGoogleRow({
        event,
        calendarId,
        adminUserId,
        internalEmails,
        canonicalIdentity,
        previous: existingById.get(importedId) || null,
      });
      if (!row) {
        result.skipped += 1;
        continue;
      }
      rows.push(row);
      activeIds.add(row.id);
    }

    result.upserted = await upsertImportedRows(rows);

    const staleIds = ((existing || []) as ExistingGoogleRow[])
      .map((row) => String(row.id || ""))
      .filter((id) => id && !activeIds.has(id));
    result.deleted = await deleteImportedRows(
      [...cancelledIds, ...staleIds].filter((id) => !activeIds.has(id)),
      adminUserId,
    );
  } catch (error) {
    result.ok = false;
    result.errors.push(
      error instanceof Error ? error.message.split(":")[0] : "inrcalendar_google_sync_failed",
    );
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

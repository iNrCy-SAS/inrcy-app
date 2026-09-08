import "server-only";

import { optionalEnv } from "@/lib/env";
import { INR_CALENDAR_GOOGLE_SOURCE } from "@/lib/inrCalendarGoogleSyncConstants";
import {
  buildInrCalendarGoogleEventId,
  buildInrCalendarGoogleRow,
  type InrCalendarGoogleRow,
} from "@/lib/inrCalendarGoogleSyncPolicy";
import { ADMIN_USER_IDS } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getVisioSharedCalendarId,
  listVisioSharedCalendarEvents,
} from "@/lib/visioBookingGoogle";

const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FUTURE_DAYS = 365;
const DATABASE_BATCH_SIZE = 200;

type ExistingGoogleRow = {
  id: string;
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
  skipped: number;
  errors: string[];
};

function boundedInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(optionalEnv(name, String(fallback)));
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.floor(parsed)))
    : fallback;
}

function getInrCalendarAdminUserId() {
  const userId = optionalEnv("INRCY_ADMIN_USER_ID", ADMIN_USER_IDS[0]).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("inrcalendar_google_admin_user_id_invalid");
  }
  return userId;
}

function batches<T>(values: T[], size = DATABASE_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
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
  const adminUserId = getInrCalendarAdminUserId();
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
    skipped: 0,
    errors: [],
  };

  try {
    const googleEvents = await listVisioSharedCalendarEvents(timeMin, timeMax, true);
    result.scanned = googleEvents.length;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("agenda_events")
      .select("id")
      .eq("user_id", adminUserId)
      .contains("meta", { source: INR_CALENDAR_GOOGLE_SOURCE })
      .lt("start_at", timeMax.toISOString())
      .gt("end_at", timeMin.toISOString())
      .limit(5000);
    if (existingError) {
      throw new Error(`inrcalendar_google_existing_read_failed:${existingError.message}`);
    }

    const rows: InrCalendarGoogleRow[] = [];
    const activeIds = new Set<string>();
    const cancelledIds: string[] = [];
    for (const event of googleEvents) {
      const eventId = String(event.id || "").trim();
      if (!eventId) {
        result.skipped += 1;
        continue;
      }
      const importedId = buildInrCalendarGoogleEventId(calendarId, eventId);
      if (String(event.status || "").toLowerCase() === "cancelled") {
        cancelledIds.push(importedId);
        continue;
      }
      const row = buildInrCalendarGoogleRow({ event, calendarId, adminUserId });
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
      [...cancelledIds, ...staleIds],
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

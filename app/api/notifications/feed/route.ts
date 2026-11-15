import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { projectNotificationForEdition } from "@/lib/notificationEditionPolicy";
import { toNotificationPayload, type NotificationRow } from "@/lib/notifications";

export const runtime = "nodejs";

const SOURCE_PAGE_SIZE = 500;
const MAX_SOURCE_ROWS = 10000;
const NOTIFICATION_SELECT = "id, user_id, category, kind, title, body, cta_label, cta_url, read_at, meta, dedupe_key, created_at";

export async function GET(req: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const limit = Math.max(5, Math.min(50, Number(url.searchParams.get("limit") || 12)));
  const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get("offset") || 0)));
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) return NextResponse.json({ error: "Page invalide." }, { status: 400 });

  const { data: pref, error: preferenceError } = await supabaseAdmin
    .from("notification_preferences")
    .select("in_app_enabled")
    .eq("user_id", activeUserId)
    .maybeSingle();
  if (preferenceError) return jsonUserFacingError(preferenceError, { status: 500 });

  if (pref && pref.in_app_enabled === false) {
    return NextResponse.json({ items: [], unreadCount: 0, totalCount: 0, countKnown: true, nextOffset: null }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const edition = await getDashboardEditionForAccountId(activeUserId);
    const eligible: NotificationRow[] = [];
    let countKnown = false;

    // Filter the source catalogue before pagination, so older recommendations
    // from another pack cannot produce empty pages or inflated unread counts.
    for (let sourceOffset = 0; sourceOffset < MAX_SOURCE_ROWS; sourceOffset += SOURCE_PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("notifications")
        .select(NOTIFICATION_SELECT)
        .eq("user_id", activeUserId)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(sourceOffset, sourceOffset + SOURCE_PAGE_SIZE - 1);
      if (error) return jsonUserFacingError(error, { status: 500 });

      const rows = (data ?? []) as NotificationRow[];
      for (const row of rows) {
        const projected = projectNotificationForEdition(row, edition);
        if (projected) eligible.push(projected);
      }
      if (rows.length < SOURCE_PAGE_SIZE) {
        countKnown = true;
        break;
      }
    }

    if (!countKnown) {
      // Probe one row to distinguish an exact 10,000-row catalogue from a
      // truncated count, while keeping the historical scan bounded.
      const { data, error } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("user_id", activeUserId)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(MAX_SOURCE_ROWS, MAX_SOURCE_ROWS);
      if (error) return jsonUserFacingError(error, { status: 500 });
      countKnown = !data?.length;
    }

    const items = eligible.slice(offset, offset + limit).map(toNotificationPayload);
    const totalCount = eligible.length;
    const nextOffset = offset + items.length < totalCount ? offset + items.length : null;
    return NextResponse.json({ items, unreadCount: items.filter(item => item.unread).length, totalCount, countKnown, nextOffset }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    return jsonUserFacingError(error, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { snapshotDayBounds } from "@/lib/stats/snapshotWindow";
import { statsCalendarMonths } from "@/app/dashboard/stats/stats.months";

/** Exact event counts for the active account; no records or visitor identifiers leave the server. */
export async function GET() {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const months = statsCalendarMonths();
  const results = await Promise.all(months.map(async month => {
    if (month.days === 0) return { month: month.key, inrbadge: { visibility: 0, clicks: 0 }, inr_search: { visibility: 0, clicks: 0 } };
    const start = snapshotDayBounds(month.start).start.toISOString();
    const end = snapshotDayBounds(month.end).endExclusive.toISOString();
    const count = async (channel: "inrbadge" | "inr_search", event: string) => {
      let query = channel === "inrbadge"
        ? supabaseAdmin.from("inrbadge_events").select("id", { count: "exact", head: true }).eq("event_type", event)
        : supabaseAdmin.from("app_events").select("id", { count: "exact", head: true }).eq("module", "inr_search").eq("type", event);
      query = query.eq("user_id", activeUserId).gte("created_at", start).lt("created_at", end);
      const result = await query;
      return result.error || result.count === null ? null : result.count;
    };
    const [badgeViews, badgeClicks, searchViews, searchClicks] = await Promise.all([
      count("inrbadge", "view"), count("inrbadge", "action_click"), count("inr_search", "page_view"), count("inr_search", "action_click"),
    ]);
    return { month: month.key, inrbadge: { visibility: badgeViews, clicks: badgeClicks }, inr_search: { visibility: searchViews, clicks: searchClicks } };
  }));
  return NextResponse.json({ months, results }, { headers: { "Cache-Control": "private, no-store" } });
}

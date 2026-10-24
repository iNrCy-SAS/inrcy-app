import { NextResponse } from "next/server";
import { isAuthorizedCronRequest, buildInternalCronHeaders, getAppOriginFromRequest } from "@/lib/cronAuth";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Bounded, leased batches keep capturing even when the professional does not log in. */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claimed = await supabaseAdmin.rpc("claim_inrstats_visibility_accounts", { p_limit: 6 });
  if (claimed.error) return NextResponse.json({ error: "visibility_capture_queue_unavailable" }, { status: 503 });
  const ids = (claimed.data || []).map((row: { user_id: string }) => row.user_id);
  const active = await getActiveSubscriptionAccountIds(ids);
  const queue = [...ids];
  let recorded = 0, failed = 0, skipped = 0;
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let userId = queue.shift(); userId; userId = queue.shift()) {
      try {
        if (!active.has(userId)) {
          skipped++;
          await supabaseAdmin.from("inrstats_visibility_tracking").update({ next_capture_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("user_id", userId);
          continue;
        }
        const response = await fetch(`${getAppOriginFromRequest(req)}/api/stats/dashboard-bulk?days=30`, { headers: buildInternalCronHeaders(userId), cache: "no-store", signal: AbortSignal.timeout(100_000) });
        const payload = response.ok ? await response.json() : null;
        if (payload?.visibilityIndex?.recorded !== true) throw new Error("capture_not_recorded");
        recorded++;
      } catch {
        failed++;
        // Keep the next retry bounded and do not fill a missed day later.
        await supabaseAdmin.from("inrstats_visibility_tracking").update({ next_capture_at: new Date(Date.now() + 3_600_000).toISOString() }).eq("user_id", userId);
      }
    }
  }));
  console.info("[inrstats-visibility] Scheduled captures", { recorded, failed, skipped });
  return NextResponse.json({ ok: failed === 0, recorded, failed, skipped }, { headers: { "Cache-Control": "no-store" } });
}

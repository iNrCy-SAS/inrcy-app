import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDashboardEditionForAuthUser } from "@/lib/dashboardEditionServer";

export const runtime = "nodejs";

const PENDING_AGENT_ACTION_STATUSES = [
  "prepared",
  "pending_validation",
  "pending",
];

function isMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_actions")
  );
}

export async function GET() {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  let countQuery = supabaseAdmin
    .from("inr_agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", activeUserId)
    .eq("validation_required", true)
    .in("status", PENDING_AGENT_ACTION_STATUSES);
  if (standardMode) {
    countQuery = countQuery
      .eq("automation_key", "publish")
      .eq("action_type", "publication")
      .eq("target_tool", "booster");
  }
  const { count, error } = await countQuery;

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ count: 0, tableMissing: true });
    }

    console.warn("[inr-agent-pending-count] read failed", error);
    return NextResponse.json(
      { error: "Lecture du compteur iNr’Agent impossible" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    count: typeof count === "number" && Number.isFinite(count) ? count : 0,
    tableMissing: false,
  });
}

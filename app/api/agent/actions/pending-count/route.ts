import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDashboardEditionForAuthUser } from "@/lib/dashboardEditionServer";
import { publicationReviewStates } from "@/lib/inrAgentPublicationReview";

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
  const { errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  const now = Date.now();
  const { data: publicationCount, error: publicationError } = await countPendingPublications(activeUserId, now);
  const other = standardMode || publicationError ? null : await supabaseAdmin
    .from("inr_agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", activeUserId)
    .eq("validation_required", true)
    .in("status", PENDING_AGENT_ACTION_STATUSES)
    .or("automation_key.is.null,automation_key.neq.publish,action_type.neq.publication,target_tool.neq.booster");
  const error = publicationError || other?.error;

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ count: 0, publicationCount: 0, tableMissing: true });
    }

    console.warn("[inr-agent-pending-count] read failed", error);
    return NextResponse.json(
      { error: "Lecture du compteur iNr’Agent impossible" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    count: publicationCount + (other?.count ?? 0),
    publicationCount,
    tableMissing: false,
  });
}

async function countPendingPublications(accountId: string, now: number) {
  const pageSize = 200;
  let after: string | null = null;
  let count = 0;
  for (;;) {
    // Only select the review fields. Publication text and media never leave the database for this badge.
    let query = supabaseAdmin.from("inr_agent_actions")
      .select("id,status,execution_policy,validation_required,validated_at,completed_at,scheduled_for,target_channels,last_error,planState:payload->editorialPlan->>state,selection:payload->publicationChannelSelection,tiktokReview:payload->tiktokPublicationSettings,selected:payload->selectedChannels,channels:payload->channels,booster:payload->boosterChannels,nested:payload->publishPayload->channels,nestedSelected:payload->publishPayload->selectedChannels")
      .eq("user_id", accountId).eq("automation_key", "publish").eq("action_type", "publication").eq("target_tool", "booster")
      .is("completed_at", null)
      .in("status", [...PENDING_AGENT_ACTION_STATUSES, "draft", "validated", "scheduled"])
      .or(`scheduled_for.is.null,scheduled_for.gt.${new Date(now).toISOString()}`)
      .order("id").limit(pageSize);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) return { data: 0, error };
    const rows = data || [];
    for (const row of rows) {
      const states = publicationReviewStates({
        id: row.id, status: row.status, scheduledFor: row.scheduled_for, validatedAt: row.validated_at, completedAt: row.completed_at,
        validationRequired: row.validation_required, executionPolicy: row.execution_policy, targetChannels: row.target_channels, lastError: row.last_error,
        payload: {
          editorialPlan: row.planState ? { state: row.planState } : null,
          publicationChannelSelection: row.selection, tiktokPublicationSettings: row.tiktokReview, selectedChannels: row.selected, channels: row.channels,
          boosterChannels: row.booster, publishPayload: { channels: row.nested, selectedChannels: row.nestedSelected },
        },
      }, now);
      if (states.includes("pending")) count++;
    }
    if (rows.length < pageSize) return { data: count, error: null };
    after = rows[rows.length - 1].id;
  }
}

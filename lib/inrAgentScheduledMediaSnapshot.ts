import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { applyScheduledPublicationMediaSnapshot, getScheduledPublicationMediaWorkspaceId, hasScheduledPublicationMediaSnapshot, snapshotScheduledPublicationWorkspace } from "@/lib/scheduledPublicationMediaSnapshot";
import { type ScheduledPublicationSnapshotRow, type ScheduledPublicationSnapshotResult } from "@/lib/inrAgentScheduleTypes";
import { SCHEDULED_ACTION_SELECT, asRecord, cleanText } from "@/lib/inrAgentSchedulePolicy";

export async function cleanupScheduledPublicationSnapshotWorkspaces(params: {
  accountId: string;
  workspaceIds: string[];
}) {
  for (const workspaceId of params.workspaceIds) {
    try {
      await supabaseAdmin
        .from("publication_workspaces")
        .delete()
        .eq("id", workspaceId)
        .eq("account_id", params.accountId);
    } catch (cleanupError) {
      console.error("[inr-agent] scheduled media snapshot cleanup failed", {
        workspaceId,
        message:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError || "Erreur inconnue"),
      });
    }
  }
}

export async function snapshotAgentScheduledPublicationRows(params: {
  accountId: string;
  rows: ScheduledPublicationSnapshotRow[];
}): Promise<ScheduledPublicationSnapshotResult> {
  const createdWorkspaceIds: string[] = [];
  const snapshottedRows: ScheduledPublicationSnapshotRow[] = [];

  try {
    for (const row of params.rows) {
      const payload = asRecord(row.payload) || {};
      const sourceWorkspaceId = getScheduledPublicationMediaWorkspaceId(payload);
      if (!sourceWorkspaceId || hasScheduledPublicationMediaSnapshot(payload)) {
        snapshottedRows.push(row);
        continue;
      }

      const scheduledActionId = cleanText(row.id, 120);
      const scheduledAt = cleanText(row.scheduled_at, 80);
      if (!scheduledActionId || !scheduledAt) {
        throw new Error("scheduled_publication_snapshot_identity_missing");
      }

      const selectedChannels = Array.isArray(row.channels)
        ? row.channels.map((channel) => cleanText(channel, 40)).filter(Boolean)
        : [];
      const snapshot = await snapshotScheduledPublicationWorkspace({
        accountId: params.accountId,
        scheduledActionId,
        scheduledAt,
        sourceWorkspaceId,
        selectedChannels,
      });
      if (!snapshot) {
        throw new Error("scheduled_publication_snapshot_unavailable");
      }
      // Register ownership before updating the scheduled payload: if that
      // update fails, the catch below must still remove this private copy.
      if (snapshot.created) createdWorkspaceIds.push(snapshot.workspaceId);

      const updated = await supabaseAdmin
        .from("inr_agent_scheduled_actions")
        .update({
          payload: applyScheduledPublicationMediaSnapshot(
            payload,
            snapshot.workspaceId,
            sourceWorkspaceId,
          ),
        })
        .eq("id", scheduledActionId)
        .eq("user_id", params.accountId)
        .select(SCHEDULED_ACTION_SELECT)
        .single();
      if (updated.error || !updated.data) {
        throw updated.error || new Error("scheduled_publication_snapshot_update_failed");
      }

      snapshottedRows.push(updated.data as ScheduledPublicationSnapshotRow);
    }
    return { rows: snapshottedRows, createdWorkspaceIds };
  } catch (error) {
    // Snapshots created in this attempt belong only to rows that will be
    // cancelled by the caller. Remove them so a retry starts cleanly.
    await cleanupScheduledPublicationSnapshotWorkspaces({
      accountId: params.accountId,
      workspaceIds: createdWorkspaceIds,
    });
    throw error;
  }
}

export async function cancelScheduledPublicationRowsAfterSnapshotFailure(params: {
  accountId: string;
  rows: ScheduledPublicationSnapshotRow[];
  message: string;
}) {
  const ids = params.rows
    .map((row) => cleanText(row.id, 120))
    .filter(Boolean);
  if (!ids.length) return;
  const { error } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .update({
      status: "cancelled",
      last_error: params.message,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", params.accountId)
    .in("id", ids)
    .eq("status", "scheduled");
  if (error) {
    console.error("[inr-agent] scheduled media snapshot cancellation failed", {
      message: error.message,
      scheduledActionIds: ids,
    });
  }
}

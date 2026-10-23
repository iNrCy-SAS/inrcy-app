import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToInrAgentAction, type InrAgentAction } from "@/lib/inrAgentActions";
import { canReviseInrAgentPublication, inrAgentPublicationNeedsRevisionReview } from "@/lib/inrAgentPublicationRevision";
import { preparedInrAgentPublicationChannels, selectedInrAgentPublicationChannels } from "@/lib/inrAgentPublicationChannelSelection";

const ACTION_SELECT = "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export class InrAgentPublicationRevisionConflict extends Error {
  readonly status = 409;
}

type PausedRevision = {
  updatedAt: string;
  rows: Record<string, unknown>[];
  retiredAt: Map<unknown, string>;
};

async function restorePreviousRevision(args: {
  accountId: string; action: InrAgentAction; paused: PausedRevision; selectedChannels: string[];
}) {
  const { action, paused, accountId } = args;
  const current = await supabaseAdmin.from("inr_agent_actions").select("status,updated_at")
    .eq("id", action.id).eq("user_id", accountId).maybeSingle();
  // Never roll back another tab's edit or an execution claim.
  if (current.error || current.data?.updated_at !== paused.updatedAt || current.data?.status !== action.status) return false;
  for (const row of paused.rows) {
    const retiredAt = paused.retiredAt.get(row.id);
    if (!retiredAt) continue;
    const restored = await supabaseAdmin.from("inr_agent_scheduled_actions")
      .update({ payload: row.payload, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("user_id", accountId).eq("status", "cancelled")
      .eq("updated_at", retiredAt).select("id").maybeSingle();
    if (restored.error || !restored.data) return false;
  }
  const resumed = await supabaseAdmin.rpc("inrcy_set_agent_publication_channels", {
    p_user_id: accountId, p_action_id: action.id, p_channels: args.selectedChannels,
    p_expected_updated_at: paused.updatedAt, p_confirm_pending: false,
  });
  return !resumed.error && record(resumed.data).outcome === "saved";
}

/**
 * Reuse the existing channel-selection transaction to lock the source and all
 * its dispatch rows before retiring the old version. Only then save the new
 * version. A crash leaves dispatch paused; an old snapshot is never resumed.
 */
export async function saveInrAgentPublicationRevision(args: {
  accountId: string;
  action: InrAgentAction;
  payload: Record<string, unknown>;
  previewText?: string;
  imageAssets?: unknown[];
}) {
  const { action, accountId } = args;
  if (!canReviseInrAgentPublication(action) || !action.updatedAt) {
    throw new InrAgentPublicationRevisionConflict("La diffusion a commencé ou la publication a changé. Actualisez avant de la modifier.");
  }
  const approved = action.status === "validated" || action.status === "scheduled";
  let expectedUpdatedAt = action.updatedAt;
  const oldReview = record(action.payload.publicationRevisionReview);
  let scheduleSelections = Array.isArray(oldReview.scheduleSelections) ? oldReview.scheduleSelections : [];
  let timezone = typeof oldReview.timezone === "string" ? oldReview.timezone : "Europe/Paris";
  const selectedChannels = selectedInrAgentPublicationChannels(action.payload,
    preparedInrAgentPublicationChannels(action.payload, action.targetChannels));
  let pausedRevision: PausedRevision | null = null;

  try {
  if (approved) {
    // This RPC uses the same row locks as the scheduler. A running, attempted,
    // completed or due dispatch is rejected before any version is changed.
    const paused = await supabaseAdmin.rpc("inrcy_set_agent_publication_channels", {
      p_user_id: accountId, p_action_id: action.id,
      p_channels: [], p_expected_updated_at: expectedUpdatedAt,
      p_confirm_pending: false,
    });
    const result = record(paused.data);
    if (paused.error || result.outcome !== "saved" || !result.action) {
      throw new InrAgentPublicationRevisionConflict("La publication a changé ou sa diffusion a commencé. Aucun contenu n’a été remplacé.");
    }
    expectedUpdatedAt = String(record(result.action).updated_at || "");
    const rows = Array.isArray(result.scheduledActions) ? result.scheduledActions.map(record) : [];
    pausedRevision = { updatedAt: expectedUpdatedAt, rows, retiredAt: new Map() };
    if (rows.length) {
      scheduleSelections = rows.flatMap(row => {
        const rowPayload = record(row.payload);
        const channels = Array.isArray(rowPayload.publicationChannelSelectionRowChannels)
          ? rowPayload.publicationChannelSelectionRowChannels : row.channels;
        return (Array.isArray(channels) ? channels : [])
          .filter((channel): channel is string => typeof channel === "string" && selectedChannels.includes(channel))
          .map(channel => ({ channel, scheduledAt: String(row.scheduled_at) }));
      });
      timezone = String(rows[0].timezone || timezone);
    }
    for (const row of rows) {
      const retiredAt = new Date().toISOString();
      const retired = await supabaseAdmin.from("inr_agent_scheduled_actions")
        .update({ payload: { ...record(row.payload), publicationChannelSelectionPaused: false,
          retiredForPublicationRevision: true }, updated_at: retiredAt })
        .eq("id", row.id).eq("user_id", accountId).eq("status", "cancelled")
        .eq("updated_at", row.updated_at).select("id").maybeSingle();
      if (retired.error || !retired.data) {
        throw new InrAgentPublicationRevisionConflict("La programmation a changé. Actualisez avant de modifier la publication.");
      }
      pausedRevision.retiredAt.set(row.id, retiredAt);
    }
  }

  const now = new Date().toISOString();
  const needsReview = approved || inrAgentPublicationNeedsRevisionReview(action.payload);
  const payload = { ...args.payload };
  if (needsReview) {
    const previousExecution = record(payload.scheduledExecution);
    payload.scheduledExecution = { ...previousExecution, scheduledActionIds: [] };
    payload.publicationRevisionReview = { required: true, editedAt: now,
      scheduledFor: action.scheduledFor, scheduleSelections, timezone };
  }
  const saved = await supabaseAdmin.from("inr_agent_actions").update({
    payload, updated_at: now, last_error: null,
    ...(args.previewText !== undefined ? { preview_text: args.previewText } : {}),
    ...(args.imageAssets !== undefined ? { image_assets: args.imageAssets } : {}),
    ...(needsReview ? { status: "pending_validation", validation_required: true,
      execution_policy: "manual_validation", validated_at: null, refused_at: null } : {}),
    // scheduled_for is deliberately not written: the original instant is kept.
  }).eq("id", action.id).eq("user_id", accountId)
    .eq("status", action.status).eq("updated_at", expectedUpdatedAt)
    .select(ACTION_SELECT).maybeSingle();
  if (saved.error || !saved.data) {
    throw new InrAgentPublicationRevisionConflict("La publication a changé. Actualisez avant de la modifier. Sa diffusion n’a pas été relancée.");
  }
  return rowToInrAgentAction(saved.data);
  } catch (error) {
    if (pausedRevision) {
      let restored = false;
      try {
        restored = await restorePreviousRevision({ accountId, action, paused: pausedRevision, selectedChannels });
      } catch {
        // Fail closed when the database cannot confirm a safe restoration.
      }
      if (!restored) throw new InrAgentPublicationRevisionConflict("L’enregistrement a échoué ou la publication a changé. La programmation peut être suspendue : actualisez et vérifiez son statut avant de réessayer.");
    }
    throw error;
  }
}

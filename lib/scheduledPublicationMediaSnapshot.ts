import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

type JsonRecord = Record<string, unknown>;

type SnapshotParams = {
  accountId: string;
  scheduledActionId: string;
  scheduledAt: string;
  sourceWorkspaceId: string;
  selectedChannels: string[];
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/**
 * Extracts the workspace used by a Booster schedule without coupling callers
 * to the exact scheduled-payload shape.
 */
export function getScheduledPublicationMediaWorkspaceId(payload: unknown) {
  const scheduledPayload = asRecord(payload);
  const publishPayload = asRecord(scheduledPayload.publishPayload);
  return String(
    publishPayload.mediaWorkspaceId || scheduledPayload.mediaWorkspaceId || "",
  ).trim();
}

/** True when a scheduled payload already points to its immutable workspace. */
export function hasScheduledPublicationMediaSnapshot(payload: unknown) {
  const scheduledPayload = asRecord(payload);
  const publishPayload = asRecord(scheduledPayload.publishPayload);
  return (
    scheduledPayload.scheduledMediaSnapshot === true ||
    publishPayload.scheduledMediaSnapshot === true
  );
}

/**
 * Keeps a trace of the editable workspace, while making the scheduled runner
 * consume the immutable copy. This intentionally changes only scheduled
 * payloads; immediate publication keeps the original workspace behaviour.
 */
export function applyScheduledPublicationMediaSnapshot(
  payload: unknown,
  snapshotWorkspaceId: string,
  sourceWorkspaceId: string,
) {
  const scheduledPayload = asRecord(payload);
  const publishPayload = asRecord(scheduledPayload.publishPayload);
  return {
    ...scheduledPayload,
    mediaWorkspaceId: snapshotWorkspaceId,
    sourceMediaWorkspaceId: sourceWorkspaceId,
    scheduledMediaSnapshot: true,
    publishPayload: {
      ...publishPayload,
      mediaWorkspaceId: snapshotWorkspaceId,
      sourceMediaWorkspaceId: sourceWorkspaceId,
      scheduledMediaSnapshot: true,
    },
  };
}

/**
 * Duplicates the workspace-to-media graph at scheduling time. The media rows
 * are deliberately shared: the new associations keep their canonical source
 * and rendered variants alive even if the editable workspace is later reset.
 * The deterministic client key makes retries/idempotent schedule requests safe.
 */
export async function snapshotScheduledPublicationWorkspace(
  params: SnapshotParams,
) {
  const accountId = String(params.accountId || "").trim();
  const sourceWorkspaceId = String(params.sourceWorkspaceId || "").trim();
  const scheduledActionId = String(params.scheduledActionId || "").trim();
  if (!accountId || !sourceWorkspaceId || !scheduledActionId) return null;

  const clientWorkspaceKey = `scheduled-publication:${scheduledActionId}`;
  const existing = await supabaseAdmin
    .from("publication_workspaces")
    .select("id")
    .eq("account_id", accountId)
    .eq("client_workspace_key", clientWorkspaceKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    return {
      workspaceId: String(existing.data.id),
      sourceWorkspaceId,
      created: false,
    };
  }

  const source = await supabaseAdmin
    .from("publication_workspaces")
    .select(
      "id,created_by_auth_user_id,idea,theme,generated_content,selected_channels,generation_options,workspace_metadata,revision",
    )
    .eq("id", sourceWorkspaceId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (source.error) throw source.error;
  if (!source.data) {
    throw new Error("scheduled_publication_workspace_not_found");
  }

  const mediaLinks = await supabaseAdmin
    .from("publication_workspace_media")
    .select(
      "media_id,position,media_role,selected_channels,media_settings,channel_settings,added_by_auth_user_id",
    )
    .eq("workspace_id", sourceWorkspaceId)
    .order("position", { ascending: true });
  if (mediaLinks.error) throw mediaLinks.error;

  const snapshot = await supabaseAdmin
    .from("publication_workspaces")
    .insert({
      account_id: accountId,
      created_by_auth_user_id: source.data.created_by_auth_user_id || null,
      client_workspace_key: clientWorkspaceKey,
      source_module: "booster_scheduled_snapshot",
      status: "scheduled",
      idea: source.data.idea || null,
      theme: source.data.theme || null,
      generated_content: asRecord(source.data.generated_content),
      selected_channels:
        params.selectedChannels.length > 0
          ? params.selectedChannels
          : source.data.selected_channels || [],
      generation_options: asRecord(source.data.generation_options),
      workspace_metadata: {
        ...asRecord(source.data.workspace_metadata),
        scheduled_media_snapshot: true,
        source_workspace_id: sourceWorkspaceId,
        scheduled_action_id: scheduledActionId,
        scheduled_at: params.scheduledAt,
        snapshot_version: 1,
      },
      revision: Math.max(1, Number(source.data.revision || 1)),
      scheduled_for: params.scheduledAt,
    })
    .select("id")
    .single();
  if (snapshot.error) {
    // A concurrent idempotent request can win between the first lookup and
    // the insert. Resolve it instead of making the caller create another job.
    if (snapshot.error.code === "23505") {
      const concurrent = await supabaseAdmin
        .from("publication_workspaces")
        .select("id")
        .eq("account_id", accountId)
        .eq("client_workspace_key", clientWorkspaceKey)
        .maybeSingle();
      if (concurrent.error) throw concurrent.error;
      if (concurrent.data?.id) {
        return {
          workspaceId: String(concurrent.data.id),
          sourceWorkspaceId,
          created: false,
        };
      }
    }
    throw snapshot.error;
  }

  const snapshotWorkspaceId = String(snapshot.data.id || "").trim();
  try {
    const copiedLinks = (mediaLinks.data || []).map((link) => ({
      workspace_id: snapshotWorkspaceId,
      media_id: link.media_id,
      position: link.position,
      media_role: link.media_role,
      selected_channels: link.selected_channels || [],
      media_settings: asRecord(link.media_settings),
      channel_settings: asRecord(link.channel_settings),
      added_by_auth_user_id: link.added_by_auth_user_id || null,
    }));
    if (copiedLinks.length) {
      const insertedLinks = await supabaseAdmin
        .from("publication_workspace_media")
        .insert(copiedLinks);
      if (insertedLinks.error) throw insertedLinks.error;
    }
  } catch (error) {
    // The snapshot is never useful without its complete media graph. Best
    // effort cleanup is safe because it is a just-created, private snapshot.
    await supabaseAdmin
      .from("publication_workspaces")
      .delete()
      .eq("id", snapshotWorkspaceId)
      .eq("account_id", accountId);
    throw error;
  }

  return { workspaceId: snapshotWorkspaceId, sourceWorkspaceId, created: true };
}

import { NextResponse } from "next/server";
import { saveAgentPublicationChannels } from "@/lib/inrAgentPublicationChannelSelectionServer";
import { rowToInrAgentScheduledAction } from "@/lib/inrAgentScheduledActions";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getDashboardEditionForAuthUser,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";
import { isStandardAgentActionDescriptor } from "@/lib/standardAgentPolicy";
import { compactInrAgentScheduledPayload, hasUnauthorizedScheduledStorageReference } from "@/lib/inrAgentScheduledPayload";
import { buildAbsoluteStorageContentUrl } from "@/lib/storageContentUrl";
import { normalizeBoosterSoundtrackByChannel, normalizeBoosterSoundtrackId } from "@/lib/boosterSoundtracks";
import { isInrAgentPublicationSoundtrackLocked, readInrAgentPublicationSoundtrack } from "@/lib/inrAgentPublicationSoundtrack";

export const runtime = "nodejs";

const SCHEDULED_ACTION_SELECT = "id, automation_key, action_type, target_tool, source, title, summary, scheduled_at, timezone, channels, payload, status, attempt_count, last_error, executed_at, created_at, updated_at";

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_scheduled_actions")
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sanitizeFutureDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeStringArray(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function sanitizeText(value: unknown, fallback = "", maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function scheduledActionForResponse(
  row: Parameters<typeof rowToInrAgentScheduledAction>[0],
  requestUrl: string,
  accountId: string,
) {
  const action = rowToInrAgentScheduledAction(row);
  return {
    ...action,
    payload: compactInrAgentScheduledPayload(action.payload, {
      accountId,
      storageUrl: (bucket, storagePath) =>
        buildAbsoluteStorageContentUrl(bucket, storagePath, requestUrl),
    }),
  };
}


export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";
  const { id } = await ctx.params;

  const { data, error } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .select(SCHEDULED_ACTION_SELECT)
    .eq("id", id)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "La table inr_agent_scheduled_actions doit être créée dans Supabase.", tableMissing: true }, { status: 500 });
    }
    console.warn("[inr-agent-scheduled-actions] read failed", error);
    return NextResponse.json({ error: "Lecture de l’action programmée impossible" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: "Action programmée introuvable" }, { status: 404 });
  if (standardMode && !isStandardAgentActionDescriptor(data)) {
    return premiumRequiredApiResponse();
  }
  return NextResponse.json({
    scheduledAction: scheduledActionForResponse(data, request.url, activeUserId),
    tableMissing: false,
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const record = asRecord(body);
  if (record?.editType === "publish_channel_selection") {
    if (standardMode) return premiumRequiredApiResponse();
    return saveAgentPublicationChannels({ userId: activeUserId, scheduledActionId: id, channels: record.channels, expectedUpdatedAt: record.expectedUpdatedAt, tiktokPublicationSettings: record.tiktokPublicationSettings, confirmPending: record.confirmPending === true });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (record?.status === "cancelled") updates.status = "cancelled";
  if (typeof record?.title === "string" && record.title.trim()) {
    updates.title = sanitizeText(record.title, "Action programmée", 180);
  }
  if (typeof record?.summary === "string") {
    updates.summary = sanitizeText(record.summary, "", 500);
  }
  if (typeof record?.automationKey === "string") {
    updates.automation_key = record.automationKey || null;
  }
  if (typeof record?.actionType === "string") {
    updates.action_type = record.actionType || "custom";
  }
  if (typeof record?.targetTool === "string") {
    updates.target_tool = record.targetTool || "agent";
  }
  if (typeof record?.timezone === "string") {
    updates.timezone = sanitizeText(record.timezone, "Europe/Paris", 80);
  }
  if (record && "channels" in record) {
    updates.channels = sanitizeStringArray(record.channels);
  }
  if (record && "payload" in record) {
    const payload = asRecord(record.payload);
    if (!payload) {
      return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
    }
    if (hasUnauthorizedScheduledStorageReference(payload, activeUserId)) {
      return NextResponse.json({ error: "Référence média non autorisée." }, { status: 403 });
    }
    updates.payload = compactInrAgentScheduledPayload(payload, {
      accountId: activeUserId,
      storageUrl: (bucket, storagePath) =>
        buildAbsoluteStorageContentUrl(bucket, storagePath, request.url),
    });
  }
  const contentChanged = Boolean(
    record &&
      ("scheduledAt" in record ||
        "payload" in record ||
        "channels" in record ||
        "title" in record ||
        "summary" in record),
  );
  if (record && "scheduledAt" in record) {
    const scheduledAt = sanitizeFutureDate(record.scheduledAt);
    if (!scheduledAt) return NextResponse.json({ error: "Date de programmation invalide" }, { status: 400 });
    updates.scheduled_at = scheduledAt;
  }
  if (contentChanged && updates.status !== "cancelled") {
    updates.status = "scheduled";
    updates.executed_at = null;
    updates.last_error = null;
  }

  if (standardMode) {
    const { data: currentRow, error: currentError } = await supabaseAdmin
      .from("inr_agent_scheduled_actions")
      .select("automation_key, action_type, target_tool")
      .eq("id", id)
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (currentError) {
      return NextResponse.json(
        { error: "Vérification de l’action programmée impossible." },
        { status: 500 },
      );
    }
    if (!currentRow) {
      return NextResponse.json(
        { error: "Action programmée introuvable" },
        { status: 404 },
      );
    }
    const nextDescriptor = {
      automation_key: updates.automation_key ?? currentRow.automation_key,
      action_type: updates.action_type ?? currentRow.action_type,
      target_tool: updates.target_tool ?? currentRow.target_tool,
    };
    if (
      !isStandardAgentActionDescriptor(currentRow) ||
      !isStandardAgentActionDescriptor(nextDescriptor)
    ) {
      return premiumRequiredApiResponse();
    }
  }

  let soundtrackRevisionRow: Record<string, unknown> | null = null;
  if (record && "payload" in record) {
    const { data: currentRow, error: currentError } = await supabaseAdmin.from("inr_agent_scheduled_actions")
      .select(SCHEDULED_ACTION_SELECT).eq("id", id).eq("user_id", activeUserId).maybeSingle();
    if (currentError) return NextResponse.json({ error: "Vérification de la programmation impossible." }, { status: 500 });
    if (!currentRow) return NextResponse.json({ error: "Action programmée introuvable" }, { status: 404 });
    if (currentRow.action_type === "publication" && currentRow.target_tool === "booster") {
      const nextPayload = asRecord(updates.payload) || {};
      const nextPublishPayload = asRecord(nextPayload.publishPayload) || {};
      try {
        for (const source of [nextPayload, nextPublishPayload]) {
          normalizeBoosterSoundtrackId(source.soundtrackId);
          normalizeBoosterSoundtrackByChannel(source.soundtrackByChannel);
        }
      } catch {
        return NextResponse.json({ error: "Choix de musique invalide.", code: "booster_soundtrack_invalid" }, { status: 400 });
      }
      const oldPayload = asRecord(currentRow.payload) || {};
      const changedChannels = (["facebook", "instagram"] as const).filter(channel =>
        readInrAgentPublicationSoundtrack(oldPayload, channel) !== readInrAgentPublicationSoundtrack(nextPayload, channel));
      if (changedChannels.length) {
        const oldPublishPayload = asRecord(oldPayload.publishPayload) || {};
        if (oldPayload.sourceActionId || oldPublishPayload.inrAgentActionId) {
          return NextResponse.json({ error: "Modifiez la musique depuis la publication iNr’Agent, puis validez sa nouvelle programmation.", code: "INR_AGENT_PUBLICATION_REVIEW_REQUIRED" }, { status: 409 });
        }
        if (currentRow.status !== "scheduled" || Number(currentRow.attempt_count) > 0 || currentRow.executed_at
          || !currentRow.updated_at || new Date(String(currentRow.scheduled_at)).getTime() <= Date.now()
          || changedChannels.some(channel => isInrAgentPublicationSoundtrackLocked(oldPayload, channel))) {
          return NextResponse.json({ error: "La diffusion a commencé. Sa musique est conservée pour la reprise.", code: "INR_AGENT_SOUNDTRACK_LOCKED" }, { status: 409 });
        }
        soundtrackRevisionRow = currentRow;
      }
    }
  }

  let updateQuery = supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .update(updates)
    .eq("id", id)
    .eq("user_id", activeUserId);
  if (soundtrackRevisionRow) {
    updateQuery = updateQuery.eq("status", "scheduled").eq("updated_at", soundtrackRevisionRow.updated_at)
      .is("executed_at", null);
    updateQuery = soundtrackRevisionRow.attempt_count == null
      ? updateQuery.is("attempt_count", null) : updateQuery.eq("attempt_count", soundtrackRevisionRow.attempt_count);
  }
  const { data, error } = await updateQuery.select(SCHEDULED_ACTION_SELECT).maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "La table inr_agent_scheduled_actions doit être créée dans Supabase.", tableMissing: true }, { status: 500 });
    }

    console.warn("[inr-agent-scheduled-actions] update failed", error);
    return NextResponse.json({ error: "Modification de l’action programmée impossible" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: soundtrackRevisionRow ? "La programmation a changé. Actualisez avant de modifier sa musique." : "Action programmée introuvable" }, { status: soundtrackRevisionRow ? 409 : 404 });
  return NextResponse.json({
    scheduledAction: scheduledActionForResponse(data, request.url, activeUserId),
    tableMissing: false,
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";
  const { id } = await ctx.params;

  if (standardMode) {
    const { data: currentRow, error: currentError } = await supabaseAdmin
      .from("inr_agent_scheduled_actions")
      .select("automation_key, action_type, target_tool")
      .eq("id", id)
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (currentError) {
      return NextResponse.json(
        { error: "Vérification de l’action programmée impossible." },
        { status: 500 },
      );
    }
    if (!currentRow) {
      return NextResponse.json(
        { error: "Action programmée introuvable" },
        { status: 404 },
      );
    }
    if (!isStandardAgentActionDescriptor(currentRow)) {
      return premiumRequiredApiResponse();
    }
  }

  const { data, error } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", activeUserId)
    .select(SCHEDULED_ACTION_SELECT)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "La table inr_agent_scheduled_actions doit être créée dans Supabase.", tableMissing: true }, { status: 500 });
    }

    console.warn("[inr-agent-scheduled-actions] cancel failed", error);
    return NextResponse.json({ error: "Annulation de l’action programmée impossible" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: "Action programmée introuvable" }, { status: 404 });
  return NextResponse.json({
    scheduledAction: scheduledActionForResponse(data, request.url, activeUserId),
    cancelled: true,
    tableMissing: false,
  });
}

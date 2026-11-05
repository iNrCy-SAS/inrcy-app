import { NextResponse } from "next/server";
import { saveAgentPublicationChannels } from "@/lib/inrAgentPublicationChannelSelectionServer";
import { rowToInrAgentScheduledAction } from "@/lib/inrAgentScheduledActions";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getDashboardEditionForAuthUser,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";
import { isStandardAgentActionDescriptor, isManualBoosterPublicationSchedule } from "@/lib/standardAgentPolicy";
import { compactInrAgentScheduledPayload, hasUnauthorizedScheduledStorageReference } from "@/lib/inrAgentScheduledPayload";
import { buildAbsoluteStorageContentUrl } from "@/lib/storageContentUrl";
import { normalizeBoosterSoundtrackByChannel, normalizeBoosterSoundtrackId } from "@/lib/boosterSoundtracks";
import { isInrAgentPublicationSoundtrackLocked, readInrAgentPublicationSoundtrack } from "@/lib/inrAgentPublicationSoundtrack";
import { scheduledPublicationFingerprint } from "@/lib/inrAssistantActionPreview";
import { createScheduledPublicationMediaRevision, scheduledPublicationMediaChanged, ScheduledPublicationMediaRevisionError } from "@/lib/scheduledPublicationMediaRevision";

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
  const { errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const edition = await getDashboardEditionForAuthUser(authUserId);
  const standardMode = edition === "standard";
  const basicMode = edition === "basic";
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
  if (basicMode ? !isManualBoosterPublicationSchedule(data) : standardMode && !isStandardAgentActionDescriptor(data)) {
    return premiumRequiredApiResponse();
  }
  return NextResponse.json({
    scheduledAction: scheduledActionForResponse(data, request.url, activeUserId),
    tableMissing: false,
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const edition = await getDashboardEditionForAuthUser(authUserId);
  const standardMode = edition === "standard";
  const basicMode = edition === "basic";
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const record = asRecord(body);
  if (record?.editType === "publish_channel_selection") {
    if (standardMode || basicMode) return premiumRequiredApiResponse();
    return saveAgentPublicationChannels({ userId: activeUserId, scheduledActionId: id, channels: record.channels, expectedUpdatedAt: record.expectedUpdatedAt, tiktokPublicationSettings: record.tiktokPublicationSettings, confirmPending: record.confirmPending === true });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let previewRevisionRow: Record<string, unknown> | null = null;
  if (record && "expectedState" in record) {
    const { data: current, error } = await supabaseAdmin.from("inr_agent_scheduled_actions").select(SCHEDULED_ACTION_SELECT).eq("id", id).eq("user_id", activeUserId).maybeSingle();
    if (error) return NextResponse.json({ error: "Vérification de la programmation impossible." }, { status: 500 });
    if (!current) return NextResponse.json({ error: "Action programmée introuvable." }, { status: 404 });
    if (typeof record.expectedState !== "string" || record.expectedState !== scheduledPublicationFingerprint(current)
      || current.action_type !== "publication" || current.target_tool !== "booster" || current.status !== "scheduled"
      || Number(current.attempt_count || 0) !== 0 || current.executed_at || !current.updated_at
      || Date.parse(String(current.scheduled_at)) <= Date.now()) {
      return NextResponse.json({ error: "La programmation a changé ou son exécution a commencé. Préparez un nouvel aperçu." }, { status: 409 });
    }
    const manualContentEdit = record.editType === "assistant_manual_publication_edit" && isManualBoosterPublicationSchedule(current);
    if (manualContentEdit ? Object.keys(record).some(key => !["expectedState", "editType", "payload"].includes(key)) || !asRecord(record.payload)
      : Object.keys(record).some(key => !["expectedState", "status", "scheduledAt", "timezone"].includes(key))
      || !(record.status === "cancelled" || typeof record.scheduledAt === "string")
      || record.status === "cancelled" && "scheduledAt" in record
      || "scheduledAt" in record && (!Number.isFinite(Date.parse(String(record.scheduledAt))) || Date.parse(String(record.scheduledAt)) <= Date.now() + 30_000)) {
      return NextResponse.json({ error: "Modification de programmation invalide." }, { status: 400 });
    }
    previewRevisionRow = current;
  }

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

  let basicRevisionRow: Record<string, unknown> | null = null;
  if (standardMode || basicMode) {
    const { data: currentRow, error: currentError } = await supabaseAdmin
      .from("inr_agent_scheduled_actions")
      .select(SCHEDULED_ACTION_SELECT)
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
      source: currentRow.source,
      payload: updates.payload ?? currentRow.payload,
    };
    if (
      basicMode
        ? !isManualBoosterPublicationSchedule(currentRow) || !isManualBoosterPublicationSchedule(nextDescriptor)
        : !isStandardAgentActionDescriptor(currentRow) || !isStandardAgentActionDescriptor(nextDescriptor)
    ) {
      return premiumRequiredApiResponse();
    }
    if (basicMode) {
      const cancelling = updates.status === "cancelled";
      if (!((currentRow.status === "scheduled" || cancelling && currentRow.status === "failed")
        && (cancelling || Number(currentRow.attempt_count || 0) === 0 && !currentRow.executed_at))) {
        return NextResponse.json({ error: "La diffusion a commencé ou est terminée. Cette programmation ne peut plus être modifiée." }, { status: 409 });
      }
      if (updates.scheduled_at && Date.parse(String(updates.scheduled_at)) !== Date.parse(String(currentRow.scheduled_at))
        && Date.parse(String(updates.scheduled_at)) <= Date.now() + 30_000) {
        return NextResponse.json({ error: "Choisissez une date de programmation future." }, { status: 400 });
      }
      basicRevisionRow = currentRow;
    }
  }

  let soundtrackRevisionRow: Record<string, unknown> | null = null;
  let mediaRevisionRow: Record<string, unknown> | null = null;
  let discardMediaRevision: (() => Promise<void>) | null = null;
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
      if (isManualBoosterPublicationSchedule(currentRow) && updates.status !== "cancelled"
        && scheduledPublicationMediaChanged(currentRow.payload, nextPayload)) {
        if (currentRow.status !== "scheduled" || Number(currentRow.attempt_count || 0) !== 0 || currentRow.executed_at || !currentRow.updated_at) {
          return NextResponse.json({ error: "La diffusion a commencé. Ses médias sont conservés pour la reprise." }, { status: 409 });
        }
        try {
          const revision = await createScheduledPublicationMediaRevision({ accountId: activeUserId, actorAuthUserId: authUserId, scheduledActionId: id,
            scheduledAt: String(updates.scheduled_at || currentRow.scheduled_at), previousPayload: currentRow.payload, payload: nextPayload,
            channels: sanitizeStringArray(updates.channels || currentRow.channels), requestUrl: request.url });
          updates.payload = revision.payload;
          discardMediaRevision = revision.discard;
          mediaRevisionRow = currentRow;
        } catch (error) {
          console.warn("[scheduled-media-revision] preparation failed", error);
          return NextResponse.json({ error: error instanceof ScheduledPublicationMediaRevisionError ? error.message : "Les médias n’ont pas pu être enregistrés de façon fiable. Réessayez." }, { status: 409 });
        }
      }
    }
  }

  let updateQuery = supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .update(updates)
    .eq("id", id)
    .eq("user_id", activeUserId);
  if (basicRevisionRow) {
    updateQuery = updateQuery.eq("source", "manual").eq("status", basicRevisionRow.status);
    updateQuery = basicRevisionRow.updated_at == null
      ? updateQuery.is("updated_at", null) : updateQuery.eq("updated_at", basicRevisionRow.updated_at);
  }
  if (soundtrackRevisionRow) {
    updateQuery = updateQuery.eq("status", "scheduled").eq("updated_at", soundtrackRevisionRow.updated_at)
      .is("executed_at", null);
    updateQuery = soundtrackRevisionRow.attempt_count == null
      ? updateQuery.is("attempt_count", null) : updateQuery.eq("attempt_count", soundtrackRevisionRow.attempt_count);
  }
  if (mediaRevisionRow) {
    updateQuery = updateQuery.eq("status", "scheduled").eq("updated_at", mediaRevisionRow.updated_at).eq("source", "manual").is("executed_at", null);
    updateQuery = mediaRevisionRow.attempt_count == null ? updateQuery.is("attempt_count", null) : updateQuery.eq("attempt_count", mediaRevisionRow.attempt_count);
  }
  if (previewRevisionRow) {
    updateQuery = updateQuery.eq("status", "scheduled").eq("updated_at", previewRevisionRow.updated_at).eq("scheduled_at", previewRevisionRow.scheduled_at)
      .eq("payload", JSON.stringify(previewRevisionRow.payload)).is("executed_at", null);
    updateQuery = previewRevisionRow.attempt_count == null ? updateQuery.is("attempt_count", null) : updateQuery.eq("attempt_count", previewRevisionRow.attempt_count);
  }
  const { data, error } = await updateQuery.select(SCHEDULED_ACTION_SELECT).maybeSingle();

  if ((error || !data) && discardMediaRevision) await discardMediaRevision();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "La table inr_agent_scheduled_actions doit être créée dans Supabase.", tableMissing: true }, { status: 500 });
    }

    console.warn("[inr-agent-scheduled-actions] update failed", error);
    return NextResponse.json({ error: "Modification de l’action programmée impossible" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: soundtrackRevisionRow || previewRevisionRow || basicRevisionRow || mediaRevisionRow ? "La programmation a changé. Actualisez avant de la modifier." : "Action programmée introuvable" }, { status: soundtrackRevisionRow || previewRevisionRow || basicRevisionRow || mediaRevisionRow ? 409 : 404 });
  return NextResponse.json({
    scheduledAction: scheduledActionForResponse(data, request.url, activeUserId),
    tableMissing: false,
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const edition = await getDashboardEditionForAuthUser(authUserId);
  const standardMode = edition === "standard";
  const basicMode = edition === "basic";
  const { id } = await ctx.params;

  let basicRevisionRow: Record<string, unknown> | null = null;
  if (standardMode || basicMode) {
    const { data: currentRow, error: currentError } = await supabaseAdmin
      .from("inr_agent_scheduled_actions")
      .select(SCHEDULED_ACTION_SELECT)
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
    if (basicMode ? !isManualBoosterPublicationSchedule(currentRow) : !isStandardAgentActionDescriptor(currentRow)) {
      return premiumRequiredApiResponse();
    }
    if (basicMode) {
      if (currentRow.status !== "scheduled" && currentRow.status !== "failed") {
        return NextResponse.json({ error: "La diffusion a commencé ou est terminée. Cette programmation ne peut plus être annulée." }, { status: 409 });
      }
      basicRevisionRow = currentRow;
    }
  }

  let cancelQuery = supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", activeUserId);
  if (basicRevisionRow) {
    cancelQuery = cancelQuery.eq("source", "manual").eq("status", basicRevisionRow.status);
    cancelQuery = basicRevisionRow.updated_at == null
      ? cancelQuery.is("updated_at", null) : cancelQuery.eq("updated_at", basicRevisionRow.updated_at);
  }
  const { data, error } = await cancelQuery.select(SCHEDULED_ACTION_SELECT).maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "La table inr_agent_scheduled_actions doit être créée dans Supabase.", tableMissing: true }, { status: 500 });
    }

    console.warn("[inr-agent-scheduled-actions] cancel failed", error);
    return NextResponse.json({ error: "Annulation de l’action programmée impossible" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: basicRevisionRow ? "La programmation a changé. Actualisez avant de l’annuler." : "Action programmée introuvable" }, { status: basicRevisionRow ? 409 : 404 });
  return NextResponse.json({
    scheduledAction: scheduledActionForResponse(data, request.url, activeUserId),
    cancelled: true,
    tableMissing: false,
  });
}

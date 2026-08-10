import { NextResponse } from "next/server";
import {
  scheduledActionToDbRow,
  rowToInrAgentScheduledAction,
  type InrAgentScheduledActionSource,
} from "@/lib/inrAgentScheduledActions";
import { INR_AGENT_AUTOMATION_KEYS, type InrAgentAutomationKey } from "@/lib/inrAgentSettings";
import { INR_AGENT_ACTION_TYPES, INR_AGENT_TARGET_TOOLS, type InrAgentActionType, type InrAgentTargetTool } from "@/lib/inrAgentActions";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findSimilarScheduledPublication } from "@/lib/scheduledPublicationDedupe";
import { findSimilarScheduledCampaign } from "@/lib/scheduledCampaignDedupe";
import { syncPublicationWorkspaceContext } from "@/lib/mediaWorkspaceConsumption";
import {
  getDashboardEditionForAuthUser,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";
import {
  filterStandardAgentItems,
  isStandardAgentActionDescriptor,
} from "@/lib/standardAgentPolicy";

export const runtime = "nodejs";

const SCHEDULED_ACTION_SELECT = "id, automation_key, action_type, target_tool, source, title, summary, scheduled_at, timezone, channels, payload, status, attempt_count, last_error, executed_at, created_at, updated_at";
const VISIBLE_SCHEDULED_STATUSES = ["scheduled", "running", "failed", "done", "cancelled"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_scheduled_actions")
  );
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === "23505" ||
    String(error?.message || "").toLowerCase().includes("duplicate key")
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function includesValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function sanitizeText(value: unknown, fallback: string, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function sanitizeStringArray(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function sanitizeFutureDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeScheduleRequestId(value: unknown) {
  const requestId = String(value || "").trim();
  return UUID_PATTERN.test(requestId) ? requestId : "";
}

function isCampaignSchedule(row: ReturnType<typeof scheduledActionToDbRow>) {
  const payload = asRecord(row.payload) || {};
  const kind = String(payload.kind || "").trim().toLowerCase();
  return (
    kind === "mail_campaign" ||
    row.action_type === "campaign" ||
    row.action_type === "mailing" ||
    row.action_type === "loyalty" ||
    row.target_tool === "mails" ||
    row.target_tool === "propulser" ||
    row.target_tool === "fideliser"
  );
}

export async function GET(request: Request) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  const url = new URL(request.url);
  const rawRequestId = url.searchParams.get("requestId");
  const requestId = sanitizeScheduleRequestId(rawRequestId);
  if (rawRequestId !== null && !requestId) {
    return NextResponse.json(
      { error: "Reçu de programmation invalide" },
      { status: 400 },
    );
  }

  if (requestId) {
    const exact = await supabaseAdmin
      .from("inr_agent_scheduled_actions")
      .select(SCHEDULED_ACTION_SELECT)
      .eq("id", requestId)
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (exact.error) {
      if (isMissingTableError(exact.error)) {
        return NextResponse.json(
          { scheduledAction: null, tableMissing: true },
          { status: 404 },
        );
      }
      throw exact.error;
    }
    if (!exact.data) {
      return NextResponse.json(
        { scheduledAction: null, tableMissing: false },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (standardMode && !isStandardAgentActionDescriptor(exact.data)) {
      return premiumRequiredApiResponse();
    }
    return NextResponse.json(
      {
        scheduledAction: rowToInrAgentScheduledAction(exact.data),
        tableMissing: false,
        recoveredByRequestId: true,
        scheduleRequestId: requestId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .select(SCHEDULED_ACTION_SELECT)
    .eq("user_id", activeUserId)
    .in("status", VISIBLE_SCHEDULED_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(150);

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ scheduledActions: [], tableMissing: true });
    }

    console.warn("[inr-agent-scheduled-actions] read failed", error);
    return NextResponse.json({ error: "Lecture des actions programmées impossible" }, { status: 500 });
  }

  const visibleRows = Array.isArray(data)
    ? standardMode
      ? filterStandardAgentItems(data)
      : data
    : [];
  const scheduledActions = visibleRows.map(rowToInrAgentScheduledAction);
  return NextResponse.json({ scheduledActions, tableMissing: false });
}

export async function POST(request: Request) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const record = asRecord(body);
  const scheduleRequestId = sanitizeScheduleRequestId(
    record?.scheduleRequestId ?? record?.requestId,
  );
  const scheduledAt = sanitizeFutureDate(record?.scheduledAt ?? record?.scheduled_at);
  if (!scheduledAt) {
    return NextResponse.json({ error: "Date de programmation invalide" }, { status: 400 });
  }

  const automationKey = includesValue(INR_AGENT_AUTOMATION_KEYS, record?.automationKey)
    ? record.automationKey as InrAgentAutomationKey
    : null;
  const actionType = includesValue(INR_AGENT_ACTION_TYPES, record?.actionType)
    ? record.actionType as InrAgentActionType
    : "custom";
  const targetTool = includesValue(INR_AGENT_TARGET_TOOLS, record?.targetTool)
    ? record.targetTool as InrAgentTargetTool
    : "agent";
  const source: InrAgentScheduledActionSource = record?.source === "automatic" ? "automatic" : "manual";

  const scheduledPayload = {
    ...(asRecord(record?.payload) || {}),
    ...(scheduleRequestId ? { scheduleRequestId } : {}),
  };
  const row = scheduledActionToDbRow({
    userId: activeUserId,
    automationKey,
    actionType,
    targetTool,
    source,
    title: sanitizeText(record?.title, "Action programmée"),
    summary: sanitizeText(record?.summary, "", 500),
    scheduledAt,
    timezone: sanitizeText(record?.timezone, "Europe/Paris", 80),
    channels: sanitizeStringArray(record?.channels),
    payload: scheduledPayload,
  });

  if (standardMode && !isStandardAgentActionDescriptor(row)) {
    return premiumRequiredApiResponse();
  }

  if (scheduleRequestId) {
    const existing = await supabaseAdmin
      .from("inr_agent_scheduled_actions")
      .select(SCHEDULED_ACTION_SELECT)
      .eq("id", scheduleRequestId)
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (standardMode && !isStandardAgentActionDescriptor(existing.data)) {
        return premiumRequiredApiResponse();
      }
      return NextResponse.json({
        scheduledAction: rowToInrAgentScheduledAction(existing.data),
        tableMissing: false,
        idempotent: true,
        scheduleRequestId,
      });
    }
  }

  if (row.action_type === "publication" && row.target_tool === "booster") {
    const duplicate = await findSimilarScheduledPublication({
      supabase: supabaseAdmin,
      userId: activeUserId,
      scheduledAt,
      channels: row.channels,
      payload: row.payload,
      excludeId: scheduleRequestId || null,
    });

    if (duplicate.duplicate) {
      return NextResponse.json(
        {
          error:
            "Une publication similaire est déjà programmée sur ce créneau. Vérifiez iNrSend / Brouillons ou modifiez l'heure pour éviter une double publication.",
          duplicate,
        },
        { status: 409 },
      );
    }
  }

  if (isCampaignSchedule(row)) {
    const duplicate = await findSimilarScheduledCampaign({
      supabase: supabaseAdmin,
      userId: activeUserId,
      scheduledAt,
      payload: row.payload,
      excludeId: scheduleRequestId || null,
    });

    if (duplicate.duplicate) {
      return NextResponse.json(
        {
          error:
            "Une campagne similaire est déjà programmée sur ce créneau. Vérifiez iNrSend ou modifiez l’heure pour éviter un double envoi.",
          duplicate,
        },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .insert(scheduleRequestId ? { ...row, id: scheduleRequestId } : row)
    .select(SCHEDULED_ACTION_SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "La table inr_agent_scheduled_actions doit être créée dans Supabase.", tableMissing: true }, { status: 500 });
    }

    if (scheduleRequestId && isUniqueViolation(error)) {
      const existing = await supabaseAdmin
        .from("inr_agent_scheduled_actions")
        .select(SCHEDULED_ACTION_SELECT)
        .eq("id", scheduleRequestId)
        .eq("user_id", activeUserId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        if (standardMode && !isStandardAgentActionDescriptor(existing.data)) {
          return premiumRequiredApiResponse();
        }
        return NextResponse.json({
          scheduledAction: rowToInrAgentScheduledAction(existing.data),
          tableMissing: false,
          idempotent: true,
          scheduleRequestId,
        });
      }
    }

    console.warn("[inr-agent-scheduled-actions] insert failed", error);
    return NextResponse.json({ error: "Programmation de l’action impossible" }, { status: 500 });
  }

  if (row.action_type === "publication" && row.target_tool === "booster") {
    const storedScheduledPayload = asRecord(row.payload) || {};
    const publishPayload = asRecord(storedScheduledPayload.publishPayload) || {};
    const mediaWorkspaceId = String(
      publishPayload.mediaWorkspaceId || storedScheduledPayload.mediaWorkspaceId || "",
    ).trim();

    if (mediaWorkspaceId) {
      await syncPublicationWorkspaceContext({
        accountId: activeUserId,
        workspaceId: mediaWorkspaceId,
        operation: "schedule",
        idea: String(publishPayload.idea || "").trim(),
        theme: String(publishPayload.theme || "").trim(),
        selectedChannels: row.channels,
        generatedContent: {
          postByChannel: asRecord(publishPayload.postByChannel) || {},
        },
        generationOptions: {
          mediaType: String(publishPayload.mediaType || "images"),
          mediaModeByChannel:
            asRecord(publishPayload.mediaModeByChannel) || {},
          videoSettingsByChannel:
            asRecord(publishPayload.videoSettingsByChannel) || {},
          imageSettingsByChannel:
            asRecord(publishPayload.imageSettingsByChannel) || {},
        },
        scheduledFor: scheduledAt,
        status: "scheduled",
        metadata: {
          scheduledActionId: String(data?.id || "").trim() || null,
          scheduleSource: source,
          scheduleTimezone: row.timezone,
        },
      }).catch((workspaceSyncError) => {
        console.warn("[inr-agent-scheduled-actions] workspace schedule sync skipped", {
          workspaceId: mediaWorkspaceId,
          message:
            workspaceSyncError instanceof Error
              ? workspaceSyncError.message
              : String(workspaceSyncError || "Erreur inconnue"),
        });
      });
    }
  }

  return NextResponse.json({
    scheduledAction: rowToInrAgentScheduledAction(data),
    tableMissing: false,
    idempotent: false,
    ...(scheduleRequestId ? { scheduleRequestId } : {}),
  });
}

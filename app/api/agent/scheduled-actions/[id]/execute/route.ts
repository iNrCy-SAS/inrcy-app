import { NextResponse } from "next/server";
import { POST as executeAgentAction } from "@/app/api/agent/actions/execute/route";
import { POST as publishNowBooster } from "@/app/api/booster/publish-now/route";
import { rowToInrAgentScheduledAction } from "@/lib/inrAgentScheduledActions";
import {
  buildScheduledPublicationRequest,
  interpretScheduledPublicationResponse,
} from "@/lib/inrAgentScheduledPublication";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getDashboardEditionForAuthUser,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";
import { isStandardAgentActionDescriptor } from "@/lib/standardAgentPolicy";

export const runtime = "nodejs";
export const maxDuration = 180;

const SCHEDULED_ACTION_SELECT =
  "id, user_id, automation_key, action_type, target_tool, source, title, summary, scheduled_at, timezone, channels, payload, status, attempt_count, last_error, executed_at, created_at, updated_at";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, maxLength = 5000) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function isVideoMedia(record: Record<string, unknown>) {
  const hint = cleanText(
    record.kind ||
      record.mediaType ||
      record.media_type ||
      record.mimeType ||
      record.mime_type ||
      record.type ||
      record.url ||
      record.storagePath ||
      record.storage_path ||
      record.path,
    700,
  ).toLowerCase();
  return hint.includes("video") || /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(hint);
}

function firstMediaFromPosts(postByChannel: Record<string, unknown>) {
  for (const value of Object.values(postByChannel)) {
    const post = asRecord(value);
    for (const key of ["media", "mediaAsset", "video", "videoAsset", "image", "imageAsset"]) {
      const media = asRecord(post[key]);
      if (Object.keys(media).length) return media;
    }
  }
  return null;
}

function isBoosterPublicationSchedule(row: any) {
  const payload = asRecord(row?.payload);
  const kind = cleanText(payload.kind, 120).toLowerCase();
  return (
    cleanText(row?.target_tool, 80).toLowerCase() === "booster" ||
    cleanText(row?.action_type, 80).toLowerCase() === "publication" ||
    kind === "manual_publish_schedule"
  );
}

async function updateClaimedScheduledAction(
  row: any,
  userId: string,
  patch: Record<string, unknown>,
) {
  let builder: any = supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .update(patch)
    .eq("id", row.id)
    .eq("user_id", userId)
    .eq("status", "running");
  if (row.updated_at) builder = builder.eq("updated_at", row.updated_at);
  const { data, error } = await builder
    .select(SCHEDULED_ACTION_SELECT)
    .maybeSingle();
  return { data, error };
}

function mergeScheduledExecution(
  row: any,
  execution: Record<string, unknown>,
) {
  return {
    ...asRecord(row.payload),
    lastExecution: {
      ...execution,
      at: new Date().toISOString(),
      trigger: "manual_execute_now",
    },
  };
}

function buildActionFromScheduled(row: any, userId: string) {
  const payload = asRecord(row.payload);
  const kind = cleanText(payload.kind, 120).toLowerCase();
  const targetTool = cleanText(row.target_tool, 80).toLowerCase();
  const actionType = cleanText(row.action_type, 80).toLowerCase();
  const channels = Array.isArray(row.channels)
    ? row.channels.map((channel: unknown) => cleanText(channel, 80)).filter(Boolean)
    : [];
  const now = new Date().toISOString();

  if (targetTool === "booster" || actionType === "publication" || kind === "manual_publish_schedule") {
    const publishPayload = asRecord(payload.publishPayload);
    const postByChannel = asRecord(publishPayload.postByChannel || payload.postByChannel);
    const images = Array.isArray(publishPayload.images)
      ? publishPayload.images
      : Array.isArray(payload.images)
        ? payload.images
        : [];
    const video = asRecord(publishPayload.video || payload.video);
    const firstMedia = Object.keys(video).length
      ? video
      : images.find((item: unknown) => Object.keys(asRecord(item)).length)
        ? asRecord(images.find((item: unknown) => Object.keys(asRecord(item)).length))
        : firstMediaFromPosts(postByChannel);
    const imageAssets = firstMedia ? [firstMedia] : [];

    return {
      user_id: userId,
      automation_key: "publish",
      action_type: "publication",
      target_tool: "booster",
      title: cleanText(row.title, 180) || "Publication programmée",
      summary:
        cleanText(row.summary, 1000) ||
        cleanText(publishPayload.idea || payload.idea, 1000) ||
        "Publication programmée avec iNr’Agent.",
      preview_text:
        cleanText(row.summary, 1000) ||
        cleanText(publishPayload.idea || payload.idea, 1000),
      target_channels: channels,
      target_themes: [],
      recipients: [],
      image_assets: imageAssets,
      payload: {
        ...payload,
        ...publishPayload,
        postByChannel,
        selectedChannels: channels,
        channels,
        media: firstMedia,
        mediaAsset: firstMedia,
        imageAsset: firstMedia && !isVideoMedia(firstMedia) ? firstMedia : null,
        image: firstMedia && !isVideoMedia(firstMedia) ? firstMedia : null,
        images,
        video: Object.keys(video).length ? video : firstMedia && isVideoMedia(firstMedia) ? firstMedia : null,
        videoAsset: Object.keys(video).length ? video : firstMedia && isVideoMedia(firstMedia) ? firstMedia : null,
        scheduledRunNow: {
          scheduledActionId: row.id,
          previousScheduledAt: row.scheduled_at,
          launchedAt: now,
        },
      },
      validation_required: false,
      execution_policy: "manual_validation",
      status: "pending_validation",
      scheduled_for: null,
      prepared_at: now,
      updated_at: now,
    };
  }

  const campaign = asRecord(payload.campaign);
  const metadata = asRecord(campaign.metadata);
  const recipients = Array.isArray(campaign.recipients)
    ? campaign.recipients
    : Array.isArray(payload.recipients)
      ? payload.recipients
      : [];
  const attachments = Array.isArray(campaign.attachments)
    ? campaign.attachments
    : Array.isArray(payload.attachments)
      ? payload.attachments
      : [];
  const subject = cleanText(campaign.subject || payload.campaignSubject || payload.subject || row.title, 220);
  const text = cleanText(campaign.text || payload.campaignBody || payload.bodyText || row.summary, 6000);

  return {
    user_id: userId,
    automation_key: row.automation_key || (targetTool === "fideliser" ? "loyalty" : "grow"),
    action_type: "campaign",
    target_tool: targetTool === "fideliser" || targetTool === "mails" ? targetTool : "propulser",
    title: subject || cleanText(row.title, 180) || "Campagne programmée",
    summary: text || cleanText(row.summary, 1000) || "Campagne programmée avec iNr’Agent.",
    preview_text: text || cleanText(row.summary, 1000),
    target_channels: ["mails"],
    target_themes: cleanText(campaign.trackType || metadata.trackType || payload.trackType, 120)
      ? [cleanText(campaign.trackType || metadata.trackType || payload.trackType, 120)]
      : [],
    recipients,
    image_assets: [],
    payload: {
      ...payload,
      accountId: cleanText(campaign.accountId || payload.accountId, 140),
      campaignSubject: subject,
      subject,
      campaignBody: text,
      bodyText: text,
      bodyHtml: cleanText(campaign.html || payload.bodyHtml || payload.html, 9000),
      recipients,
      recipientCount: recipients.length,
      folder: cleanText(campaign.folder || payload.folder, 80),
      trackKind: cleanText(campaign.trackKind || metadata.trackKind || payload.trackKind, 80),
      trackType: cleanText(campaign.trackType || metadata.trackType || payload.trackType, 80),
      templateKey: cleanText(campaign.templateKey || metadata.templateKey || payload.templateKey, 180),
      attachments,
      signatureAutomatic: metadata.signatureAutomatic !== false,
      scheduledRunNow: {
        scheduledActionId: row.id,
        previousScheduledAt: row.scheduled_at,
        launchedAt: now,
      },
    },
    validation_required: false,
    execution_policy: "manual_validation",
    status: "pending_validation",
    scheduled_for: null,
    prepared_at: now,
    updated_at: now,
  };
}

async function executeBoosterPublicationNow(row: any, userId: string) {
  const publicationRequest = buildScheduledPublicationRequest(row);
  if (!publicationRequest) {
    const now = new Date().toISOString();
    await updateClaimedScheduledAction(row, userId, {
      status: "failed",
      last_error: "Publication programmée incomplète.",
      payload: mergeScheduledExecution(row, {
        ok: false,
        status: "failed",
        error: "Le payload ne contient pas de bloc publishPayload.",
      }),
      updated_at: now,
    });
    return NextResponse.json(
      { error: "Publication programmée incomplète." },
      { status: 400 },
    );
  }

  let publishResponse: Response;
  let publishPayload: Record<string, unknown> = {};
  let responseText = "";
  try {
    publishResponse = await publishNowBooster(
      new Request("http://inrcy.local/api/booster/publish-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publicationRequest.body),
      }),
    );
    responseText = await publishResponse.text().catch(() => "");
    try {
      publishPayload = asRecord(JSON.parse(responseText));
    } catch {
      publishPayload = {};
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Publication programmée impossible.";
    const now = new Date().toISOString();
    await updateClaimedScheduledAction(row, userId, {
      status: "scheduled",
      scheduled_at: new Date(Date.now() + 60_000).toISOString(),
      last_error: message,
      payload: mergeScheduledExecution(row, {
        ok: false,
        status: "scheduled",
        error: message,
        retriable: true,
        idempotencyKey: publicationRequest.idempotencyKey,
      }),
      updated_at: now,
    });
    return NextResponse.json(
      { error: message, retryScheduled: true },
      { status: 503 },
    );
  }

  const dispatch = interpretScheduledPublicationResponse({
    httpStatus: publishResponse.status,
    httpOk: publishResponse.ok,
    responsePayload: publishPayload,
    responseText,
    retryAfter: publishResponse.headers.get("Retry-After"),
    idempotencyKey: publicationRequest.idempotencyKey,
  });
  const now = new Date().toISOString();
  const retryScheduledAt = dispatch.retriable
    ? new Date(
        Date.now() + Math.max(30, Number(dispatch.retryAfterSeconds || 60)) * 1000,
      ).toISOString()
    : null;
  const persistedStatus = dispatch.ok
    ? "done"
    : retryScheduledAt
      ? "scheduled"
      : "failed";
  const executionStatus = dispatch.ok ? dispatch.status : persistedStatus;
  const { data: updatedScheduledRow, error: updateError } =
    await updateClaimedScheduledAction(row, userId, {
      status: persistedStatus,
      scheduled_at: retryScheduledAt || row.scheduled_at,
      attempt_count: dispatch.preserveAttemptCount
        ? Math.max(0, Number(row.attempt_count || 1) - 1)
        : row.attempt_count,
      executed_at: dispatch.ok ? now : null,
      last_error: dispatch.ok ? null : dispatch.error || "Publication impossible.",
      payload: mergeScheduledExecution(row, {
        ...dispatch,
        status: executionStatus,
        publishResult: publishPayload,
      }),
      updated_at: now,
    });

  if (!dispatch.ok) {
    return NextResponse.json(
      {
        ...publishPayload,
        ok: false,
        error: dispatch.error || "Publication programmée impossible.",
        retryScheduled: Boolean(retryScheduledAt),
        retryAt: retryScheduledAt,
        warning: updateError
          ? "La reprise automatique n’a pas pu être enregistrée."
          : undefined,
      },
      {
        status:
          publishResponse.status >= 400 ? publishResponse.status : 400,
      },
    );
  }

  return NextResponse.json(
    {
      ...publishPayload,
      ok: true,
      accepted: dispatch.status === "processing",
      processing: dispatch.status === "processing",
      publicationId: dispatch.publicationId || null,
      publishResult: publishPayload,
      scheduledAction: updatedScheduledRow
        ? rowToInrAgentScheduledAction(updatedScheduledRow)
        : null,
      launchedNow: true,
      warning:
        updateError || !updatedScheduledRow
          ? "Publication confiée, mais la programmation n’a pas pu être marquée comme exécutée. La reprise idempotente reste active."
          : undefined,
    },
    { status: dispatch.status === "processing" ? 202 : 200 },
  );
}

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";
  const { id } = await ctx.params;

  const { data: scheduledRow, error: readError } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .select(SCHEDULED_ACTION_SELECT)
    .eq("id", id)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json(
      { error: "Lecture de l’action programmée impossible." },
      { status: 500 },
    );
  }
  if (!scheduledRow) {
    return NextResponse.json({ error: "Action programmée introuvable." }, { status: 404 });
  }
  if (standardMode && !isStandardAgentActionDescriptor(scheduledRow)) {
    return premiumRequiredApiResponse();
  }
  const currentStatus = cleanText(scheduledRow.status, 40).toLowerCase();
  if (currentStatus !== "scheduled" && currentStatus !== "failed") {
    return NextResponse.json(
      {
        error:
          currentStatus === "running"
            ? "Cette action programmée est déjà en cours de traitement."
            : "Cette action programmée a déjà été traitée ou annulée.",
        code:
          currentStatus === "running"
            ? "scheduled_action_already_running"
            : "scheduled_action_not_executable",
      },
      { status: 409 },
    );
  }

  const claimAt = new Date().toISOString();
  const { data: claimedRow, error: claimError } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .update({
      status: "running",
      attempt_count: Math.max(0, Number(scheduledRow.attempt_count || 0)) + 1,
      last_error: null,
      updated_at: claimAt,
    })
    .eq("id", id)
    .eq("user_id", activeUserId)
    .in("status", ["scheduled", "failed"])
    .select(SCHEDULED_ACTION_SELECT)
    .maybeSingle();

  if (claimError) {
    return NextResponse.json(
      { error: "Verrouillage de l’action programmée impossible." },
      { status: 500 },
    );
  }
  if (!claimedRow) {
    return NextResponse.json(
      {
        error: "Cette action programmée est déjà en cours de traitement.",
        code: "scheduled_action_already_running",
      },
      { status: 409 },
    );
  }

  if (isBoosterPublicationSchedule(claimedRow)) {
    return executeBoosterPublicationNow(claimedRow, activeUserId);
  }

  const actionRow = buildActionFromScheduled(claimedRow, activeUserId);
  const { data: insertedAction, error: insertError } = await supabaseAdmin
    .from("inr_agent_actions")
    .insert(actionRow)
    .select("id")
    .single();

  if (insertError || !insertedAction?.id) {
    const now = new Date().toISOString();
    await updateClaimedScheduledAction(claimedRow, activeUserId, {
      status: "failed",
      last_error: "Préparation du lancement immédiat impossible.",
      updated_at: now,
    });
    return NextResponse.json(
      { error: "Préparation du lancement immédiat impossible." },
      { status: 500 },
    );
  }

  const executeResponse = await executeAgentAction(
    new Request("http://inrcy.local/api/agent/actions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: insertedAction.id }),
    }),
  );
  const executePayload = (await executeResponse.json().catch(() => null)) as Record<string, unknown> | null;

  if (!executeResponse.ok) {
    const executionError =
      cleanText(executePayload?.error, 800) ||
      "Lancement immédiat de l’action programmée impossible.";
    const now = new Date().toISOString();
    await updateClaimedScheduledAction(claimedRow, activeUserId, {
      status: "failed",
      last_error: executionError,
      payload: mergeScheduledExecution(claimedRow, {
        ok: false,
        status: "failed",
        error: executionError,
        temporaryActionId: insertedAction.id,
        campaignResult: executePayload?.campaignResult || null,
      }),
      updated_at: now,
    });
    return NextResponse.json(
      {
        ...(executePayload || {}),
        error: executionError,
      },
      { status: executeResponse.status || 500 },
    );
  }

  const now = new Date().toISOString();
  const { data: updatedScheduledRow, error: updateError } =
    await updateClaimedScheduledAction(claimedRow, activeUserId, {
      status: "done",
      executed_at: now,
      last_error: null,
      payload: {
        ...asRecord(claimedRow.payload),
        launchedNow: {
          launchedAt: now,
          temporaryActionId: insertedAction.id,
          publishResult: executePayload?.publishResult || null,
          campaignResult: executePayload?.campaignResult || null,
        },
      },
      updated_at: now,
    });

  if (updateError || !updatedScheduledRow) {
    return NextResponse.json(
      {
        ...(executePayload || {}),
        warning: "Action lancée, mais la programmation n’a pas pu être marquée comme exécutée.",
        detail: updateError?.message || null,
      },
    );
  }

  return NextResponse.json({
    ...(executePayload || {}),
    scheduledAction: rowToInrAgentScheduledAction(updatedScheduledRow),
    launchedNow: true,
  });
}

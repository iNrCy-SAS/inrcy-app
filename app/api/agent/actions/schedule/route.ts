import { filterInrAgentPublicationChannels, pendingInrAgentPublicationChannels, unvalidatedInrAgentPublicationChannels } from "@/lib/inrAgentPublicationChannelSelection";
import { isMetaChannelPilotEnabledForAccount, isMetaChannelPilotEnabledForActorAndAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { NextResponse } from "next/server";
import { resolveInrAgentActionRequest } from "@/lib/inrAgentRequest";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { rowToInrAgentScheduledAction } from "@/lib/inrAgentScheduledActions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import { getDashboardEditionForAccountId, premiumRequiredApiResponse } from "@/lib/dashboardEditionServer";
import { isStandardAgentActionDescriptor } from "@/lib/standardAgentPolicy";
import { inrAgentPublicationNeedsRevisionReview, inrAgentPublicationRevisionSchedule } from "@/lib/inrAgentPublicationRevision";
import { ACTION_SELECT, SCHEDULED_ACTION_SELECT, EDITORIAL_VALIDATION_EXPIRED_MESSAGE, schedulableStatuses, asRecord, cleanText, sanitizeFutureDate, sanitizeAutomaticScheduledDate, normalizeScheduleSelections, isMissingTableError, normalizeBoosterChannels, isManualEditorialPublicationAction } from "@/lib/inrAgentSchedulePolicy";
import { scheduleValidatedInrAgentAction } from "@/lib/inrAgentScheduleService";

export const runtime = "nodejs";
export const maxDuration = 90;

async function scheduleAgentActionHandler(request: Request) {
  const context = await resolveInrAgentActionRequest(request);
  if (context.errorResponse) return context.errorResponse;
  const { userId: activeUserId, isCron, body } = context;
  const standardMode =
    (await getDashboardEditionForAccountId(activeUserId)) === "standard";
  const automaticExecution = body?.executionSource === "automatic";
  const confirmExistingPlan = body?.confirmExistingPlan === true;
  if (automaticExecution && !isCron) {
    return NextResponse.json(
      { error: "La publication automatique est réservée au moteur iNr’Agent." },
      { status: 403 },
    );
  }
  if (automaticExecution) {
    return NextResponse.json(
      {
        error:
          "Cette publication attend la validation du professionnel avant toute programmation.",
        code: "INR_AGENT_MANUAL_VALIDATION_REQUIRED",
      },
      { status: 409 },
    );
  }

  const actionId = cleanText(body?.actionId, 120);
  let scheduledAt = automaticExecution
    ? sanitizeAutomaticScheduledDate(body?.scheduledAt)
    : sanitizeFutureDate(body?.scheduledAt);
  let scheduleSelections = normalizeScheduleSelections(body?.scheduleSelections);
  if (!actionId)
    return NextResponse.json(
      { error: "Action iNr’Agent introuvable." },
      { status: 400 },
    );
  if (
    !automaticExecution &&
    !confirmExistingPlan &&
    !scheduledAt &&
    !scheduleSelections.length
  )
    return NextResponse.json(
      { error: "Choisissez une date et une heure dans le futur." },
      { status: 400 },
    );

  const { data: actionRow, error: readError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("id", actionId)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json(
      {
        error: "Lecture de l’action iNr’Agent impossible.",
      },
      { status: 500 },
    );
  }
  if (!actionRow)
    return NextResponse.json(
      { error: "Action iNr’Agent introuvable." },
      { status: 404 },
    );

  const action = rowToInrAgentAction(actionRow as any);
  if (action.automationKey === "publish" && (pendingInrAgentPublicationChannels(action.payload).length || unvalidatedInrAgentPublicationChannels(action.payload).length)) return NextResponse.json({ error: "Un canal sélectionné est vide ou attend sa validation.", code: "INR_AGENT_CHANNEL_REVIEW_REQUIRED" }, { status: 409 });
  if (filterInrAgentPublicationChannels(action.payload, normalizeBoosterChannels(action.payload?.selectedChannels || action.payload?.channels || action.targetChannels)).includes("threads") && !(await (isCron ? isMetaChannelPilotEnabledForAccount(supabaseAdmin, activeUserId) : isMetaChannelPilotEnabledForActorAndAccount(supabaseAdmin, activeUserId)))) return metaChannelPilotDeniedResponse();
  if (standardMode && !isStandardAgentActionDescriptor(action)) {
    return premiumRequiredApiResponse();
  }
  const confirmingRevisionPlan = Boolean(action.scheduledFor) && inrAgentPublicationNeedsRevisionReview(action.payload)
    && action.automationKey === "publish" && action.actionType === "publication" && action.targetTool === "booster";
  const confirmingEditorialPlan =
    confirmExistingPlan && isManualEditorialPublicationAction(action) && !confirmingRevisionPlan;
  if (confirmExistingPlan && !confirmingEditorialPlan && !confirmingRevisionPlan) {
    return NextResponse.json(
      {
        error:
          "Seule une publication datée par le planning iNr’Agent peut être validée ainsi.",
        code: "INR_AGENT_EDITORIAL_CONFIRMATION_NOT_ALLOWED",
      },
      { status: 400 },
    );
  }

  if (confirmingEditorialPlan) {
    if (action.status === "scheduled") {
      const { data: existingScheduledRows, error: existingScheduledError } =
        await supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .select(SCHEDULED_ACTION_SELECT)
          .eq("user_id", activeUserId)
          .contains("payload", { sourceActionId: action.id })
          .order("scheduled_at", { ascending: true });
      if (existingScheduledError && !isMissingTableError(existingScheduledError)) {
        throw existingScheduledError;
      }
      const existingRows = Array.isArray(existingScheduledRows)
        ? existingScheduledRows
        : [];
      if (existingRows.length) {
        const scheduledActions = existingRows.map(rowToInrAgentScheduledAction);
        return NextResponse.json({
          action,
          scheduledActions,
          scheduledAction: scheduledActions[0] || null,
          scheduled: true,
          alreadyScheduled: true,
          tableMissing: false,
        });
      }
    }

    const plannedDate = new Date(String(action.scheduledFor || ""));
    if (!Number.isFinite(plannedDate.getTime())) {
      return NextResponse.json(
        {
          error: "La date prévue par iNr’Agent est introuvable.",
          code: "INR_AGENT_EDITORIAL_DATE_MISSING",
        },
        { status: 409 },
      );
    }

    // La validation confirme le plan existant : la date et les canaux envoyés
    // par le navigateur sont volontairement ignorés.
    scheduledAt = plannedDate.toISOString();
    scheduleSelections = [];
  }
  if (confirmingRevisionPlan) {
    const retainedSelections = inrAgentPublicationRevisionSchedule(action.payload);
    const retainedDate = String(action.scheduledFor || "");
    if (action.status !== "pending_validation" || !retainedDate || !Number.isFinite(Date.parse(retainedDate))
      || Date.parse(retainedDate) <= Date.now()
      || retainedSelections.some(selection => !Number.isFinite(Date.parse(selection.scheduledAt)) || Date.parse(selection.scheduledAt) <= Date.now())) {
      return NextResponse.json({ error: "La date prévue est dépassée ou la publication n’attend plus de validation.", code: "INR_AGENT_REVISION_DATE_EXPIRED" }, { status: 409 });
    }
    // A revision confirms the server's original per-channel dates. Browser
    // dates cannot silently move the publication while approving its content.
    scheduledAt = retainedDate;
    scheduleSelections = normalizeScheduleSelections(retainedSelections);
    if (retainedSelections.length && scheduleSelections.length !== retainedSelections.length) {
      return NextResponse.json({ error: "Vérifiez les dates de la publication avant de la valider." }, { status: 409 });
    }
    const selectedChannels = filterInrAgentPublicationChannels(action.payload,
      normalizeBoosterChannels(action.payload.selectedChannels || action.payload.channels || action.targetChannels));
    for (const channel of selectedChannels) {
      if (!scheduleSelections.some(selection => selection.channel === channel)) {
        scheduleSelections.push({ channel, scheduledAt: retainedDate });
      }
    }
  }
  if (automaticExecution) {
    const isAutomaticEditorialPublication =
      action.automationKey === "publish" &&
      action.actionType === "publication" &&
      action.targetTool === "booster" &&
      action.executionPolicy === "automatic_after_settings" &&
      action.validationRequired === false &&
      asRecord(action.payload?.editorialPlan) !== null;

    if (!isAutomaticEditorialPublication) {
      return NextResponse.json(
        { error: "Cette action n’est pas autorisée en publication automatique." },
        { status: 400 },
      );
    }

    if (action.status === "scheduled") {
      const { data: existingScheduled } = await supabaseAdmin
        .from("inr_agent_scheduled_actions")
        .select(SCHEDULED_ACTION_SELECT)
        .eq("id", action.id)
        .eq("user_id", activeUserId)
        .maybeSingle();
      if (existingScheduled) {
        const scheduledAction = rowToInrAgentScheduledAction(existingScheduled);
        return NextResponse.json({
          action,
          scheduledActions: [scheduledAction],
          scheduledAction,
          scheduled: true,
          alreadyScheduled: true,
          tableMissing: false,
        });
      }
    }

    if (action.status !== "prepared") {
      return NextResponse.json(
        { error: "Cette publication automatique n’est plus prête à programmer." },
        { status: 409 },
      );
    }
    scheduledAt = sanitizeAutomaticScheduledDate(action.scheduledFor);
  }
  if (confirmingEditorialPlan && action.status === "refused") {
    return NextResponse.json(
      {
        error: EDITORIAL_VALIDATION_EXPIRED_MESSAGE,
        code: "INR_AGENT_VALIDATION_EXPIRED",
        action,
      },
      { status: 409 },
    );
  }
  if (!schedulableStatuses.has(action.status)) {
    return NextResponse.json(
      {
        error: "Cette action ne peut pas être programmée dans son état actuel.",
      },
      { status: 400 },
    );
  }

  const result = await scheduleValidatedInrAgentAction({
    context: Object.freeze({ accountId: activeUserId, actorAuthUserId: context.authUserId, isCron }),
    action, scheduledAt, scheduleSelections, automaticExecution, confirmingEditorialPlan, confirmingRevisionPlan,
    preferences: { tiktokPublicationSettings: body?.tiktokPublicationSettings, timezone: body?.timezone },
    onError: (error) => captureApiException(request, error, {
      area: "inragent",
      operation: "POST /api/agent/actions/schedule",
      statusCode: 500,
    }),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export const POST = withApi(scheduleAgentActionHandler, { route: "/api/agent/actions/schedule" });

import "server-only";

import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { rowToInrAgentScheduledAction, scheduledActionToDbRow } from "@/lib/inrAgentScheduledActions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findSimilarScheduledPublication } from "@/lib/scheduledPublicationDedupe";
import { findSimilarScheduledCampaign } from "@/lib/scheduledCampaignDedupe";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { normalizeTiktokPublicationSettings } from "@/app/api/booster/publish-now/publishNow.foundations";
import { inrAgentPublicationNeedsRevisionReview } from "@/lib/inrAgentPublicationRevision";
import { type JsonRecord, type BoosterChannel, type NormalizedScheduleSelection, type ScheduledPublicationSnapshotRow, type InrAgentScheduleContext, type InrAgentScheduleResult } from "@/lib/inrAgentScheduleTypes";
import { ACTION_SELECT, SCHEDULED_ACTION_SELECT, EDITORIAL_VALIDATION_EXPIRED_MESSAGE, asRecord, cleanText, publicationPayloadForChannels, isMissingTableError, isMissingEditorialConfirmationRpc } from "@/lib/inrAgentSchedulePolicy";
import { cleanupScheduledPublicationSnapshotWorkspaces, snapshotAgentScheduledPublicationRows, cancelScheduledPublicationRowsAfterSnapshotFailure } from "@/lib/inrAgentScheduledMediaSnapshot";
import { buildScheduledPayload } from "@/lib/inrAgentSchedulePayloadBuilder";

function scheduleResult(body: unknown, init: { status?: number } = {}): InrAgentScheduleResult {
  return { body, status: init.status ?? 200 };
}

/** Owns each claim together with its persistence and compensation, for both RPC and guarded fallback. */
export async function scheduleValidatedInrAgentAction(args: {
  context: InrAgentScheduleContext;
  action: ReturnType<typeof rowToInrAgentAction>;
  scheduledAt: string | null;
  scheduleSelections: NormalizedScheduleSelection[];
  automaticExecution: boolean;
  confirmingEditorialPlan: boolean;
  confirmingRevisionPlan: boolean;
  preferences: { tiktokPublicationSettings?: unknown; timezone?: unknown };
  onError: (error: unknown) => void;
}): Promise<InrAgentScheduleResult> {
  const { context, scheduledAt, scheduleSelections, automaticExecution, confirmingEditorialPlan, confirmingRevisionPlan } = args;
  const activeUserId = context.accountId;
  const body = args.preferences;
  let action = args.action;
  let automaticClaimed = false;
  let editorialValidationClaimed = false;
  let editorialValidationClaimedAt: string | null = null;
  let publicationSelectionClaimedAt: string | null = null;
  const originalPublicationStatus = action.status;
  const releaseAutomaticClaim = async () => {
    if (!automaticClaimed) return;
    const { data: currentAction } = await supabaseAdmin
      .from("inr_agent_actions")
      .select("status,execution_policy")
      .eq("id", action.id)
      .eq("user_id", activeUserId)
      .maybeSingle();
    const restoredStatus =
      currentAction?.execution_policy === "draft_only"
        ? "draft"
        : currentAction?.execution_policy === "manual_validation"
          ? "pending_validation"
          : "prepared";
    await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        status: restoredStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.id)
      .eq("user_id", activeUserId)
      .eq("status", "executing");
    automaticClaimed = false;
  };

  const releaseEditorialValidationClaim = async () => {
    if (!editorialValidationClaimed || !editorialValidationClaimedAt) return;
    const releasedAt = new Date().toISOString();
    const deadline = new Date(String(action.scheduledFor || "")).getTime();
    const expired =
      !Number.isFinite(deadline) || deadline <= new Date(releasedAt).getTime();
    const { error: releaseError } = await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        status: expired ? "refused" : "pending_validation",
        validated_at: null,
        refused_at: expired ? releasedAt : null,
        last_error: expired ? EDITORIAL_VALIDATION_EXPIRED_MESSAGE : null,
        updated_at: releasedAt,
      })
      .eq("id", action.id)
      .eq("user_id", activeUserId)
      .eq("status", "executing")
      .eq("execution_policy", "manual_validation")
      .eq("validation_required", true)
      .eq("validated_at", editorialValidationClaimedAt)
      .contains("metadata", { editorialPlan: true });
    if (releaseError) {
      console.error(
        "[inr-agent] editorial validation claim release failed",
        releaseError,
      );
    }
    editorialValidationClaimed = false;
    editorialValidationClaimedAt = null;
  };

  const releaseScheduleClaims = async () => {
    if (publicationSelectionClaimedAt) {
      await supabaseAdmin.from("inr_agent_actions").update({ status: originalPublicationStatus, updated_at: new Date().toISOString() })
        .eq("id", action.id).eq("user_id", activeUserId).eq("status", "executing").eq("updated_at", publicationSelectionClaimedAt);
      publicationSelectionClaimedAt = null;
    }
    await releaseAutomaticClaim();
    await releaseEditorialValidationClaim();
  };

  try {
    const scheduledPayload = await buildScheduledPayload(
      action,
      activeUserId,
      body?.tiktokPublicationSettings,
      context.actorAuthUserId,
    );
    const revisionReview = asRecord(action.payload.publicationRevisionReview);
    const timezone = cleanText(confirmingRevisionPlan ? revisionReview?.timezone : body?.timezone, 80) || "Europe/Paris";
    if (scheduledPayload.actionType !== "publication" && !scheduledAt) {
      return scheduleResult(
        { error: "Choisissez une date et une heure dans le futur." },
        { status: 400 },
      );
    }

    const baseScheduleArgs = {
      userId: activeUserId,
      automationKey: action.automationKey,
      actionType: scheduledPayload.actionType,
      targetTool: scheduledPayload.targetTool,
      source: automaticExecution ? ("automatic" as const) : ("manual" as const),
      title: action.title || "Action iNr’Agent programmée",
      summary:
        action.summary ||
        (automaticExecution
          ? "Action programmée automatiquement par iNr’Agent."
          : "Action validée et programmée depuis iNr’Agent."),
      timezone,
    };

    const rows: ReturnType<typeof scheduledActionToDbRow>[] = [];
    const normalizedScheduleSelections: NormalizedScheduleSelection[] = [];

    if (scheduledPayload.actionType === "publication") {
      const allowedChannels = new Set(scheduledPayload.channels);
      const requestedSelections = scheduleSelections.length
        ? scheduleSelections.filter((selection) => allowedChannels.has(selection.channel))
        : (scheduledAt
            ? scheduledPayload.channels.map((channel) => ({ channel, scheduledAt }))
            : []);

      if (!requestedSelections.length) {
        return scheduleResult(
          {
            error:
              "Aucun canal prêt à programmer. Vérifiez les canaux sélectionnés et leurs médias.",
          },
          { status: 400 },
        );
      }

      const scheduledPublishPayload = asRecord(
        scheduledPayload.payload.publishPayload,
      ) || {};
      const scheduledTiktokSettings = normalizeTiktokPublicationSettings(
        scheduledPublishPayload.tiktokPublicationSettings,
      );
      if (
        requestedSelections.some(
          (selection) => selection.channel === "tiktok",
        ) &&
        (!scheduledTiktokSettings ||
          scheduledTiktokSettings.musicUsageConfirmed !== true)
      ) {
        return scheduleResult(
          {
            error: "Validez les paramètres TikTok avant programmation.",
            code: "INR_AGENT_TIKTOK_SETTINGS_REQUIRED",
          },
          { status: 400 },
        );
      }

      const groupedSelections = Array.from(
        requestedSelections.reduce((groups, selection) => {
          const existing = groups.get(selection.scheduledAt) || [];
          if (!existing.includes(selection.channel)) existing.push(selection.channel);
          groups.set(selection.scheduledAt, existing);
          return groups;
        }, new Map<string, BoosterChannel[]>()),
      );

      const scheduledMediaModes = asRecord(
        scheduledPublishPayload.mediaModeByChannel,
      ) || {};
      const scheduledVideoByChannel = asRecord(
        scheduledPublishPayload.videoByChannel,
      ) || {};

      for (const [groupScheduledAt, groupChannels] of groupedSelections) {
        // Booster prépare une vidéo source par exécution. Une vidéo régénérée
        // pour un seul canal doit donc devenir une ligne autonome : les autres
        // canaux gardent exactement leur média, à la même date, sans mélange.
        const channelGroups: BoosterChannel[][] = [];
        const sharedChannels: BoosterChannel[] = [];
        groupChannels.forEach((channel) => {
          const hasDedicatedVideo =
            cleanText(scheduledMediaModes[channel], 20).toLowerCase() ===
              "video" &&
            Object.keys(asRecord(scheduledVideoByChannel[channel]) || {}).length > 0;
          if (hasDedicatedVideo) channelGroups.push([channel]);
          else sharedChannels.push(channel);
        });
        if (sharedChannels.length) channelGroups.push(sharedChannels);

        for (const channelsForRow of channelGroups) {
          normalizedScheduleSelections.push(
            ...channelsForRow.map((channel) => ({
              channel,
              scheduledAt: groupScheduledAt,
            })),
          );
          rows.push(
            scheduledActionToDbRow({
              ...baseScheduleArgs,
              ...(automaticExecution && channelGroups.length === 1
                ? { id: action.id }
                : {}),
              scheduledAt: groupScheduledAt,
              title:
                channelsForRow.length > 1
                  ? `${baseScheduleArgs.title} · multicanal`
                  : baseScheduleArgs.title,
              summary:
                channelsForRow.length > 1
                  ? `${baseScheduleArgs.summary} (${channelsForRow.length} canaux).`
                  : baseScheduleArgs.summary,
              channels: channelsForRow,
              payload: publicationPayloadForChannels(
                scheduledPayload.payload,
                channelsForRow,
              ),
            }),
          );
        }
      }
    } else {
      rows.push(
        scheduledActionToDbRow({
          ...baseScheduleArgs,
          scheduledAt: scheduledAt as string,
          channels: scheduledPayload.channels,
          payload: scheduledPayload.payload,
        }),
      );
    }

    for (const row of rows) {
      if (scheduledPayload.actionType === "publication") {
        const duplicate = await findSimilarScheduledPublication({
          supabase: supabaseAdmin,
          userId: activeUserId,
          scheduledAt: row.scheduled_at,
          channels: row.channels || [],
          payload: row.payload || {},
        });

        if (duplicate.duplicate) {
          return scheduleResult(
            {
              error:
                "Une publication similaire est déjà programmée sur ce créneau. Vérifiez la programmation existante avant d’en créer une nouvelle.",
              duplicate,
            },
            { status: 409 },
          );
        }
      }

      if (scheduledPayload.actionType === "campaign") {
        const duplicate = await findSimilarScheduledCampaign({
          supabase: supabaseAdmin,
          userId: activeUserId,
          scheduledAt: row.scheduled_at,
          payload: row.payload || {},
        });

        if (duplicate.duplicate) {
          return scheduleResult(
            {
              error:
                "Une campagne similaire est déjà programmée sur ce créneau. Vérifiez la programmation existante avant d’en créer une nouvelle.",
              duplicate,
            },
            { status: 409 },
          );
        }
      }
    }

    if (confirmingEditorialPlan) {
      const { data: atomicData, error: atomicError } = await supabaseAdmin.rpc(
        "inrcy_confirm_editorial_publication_schedule",
        {
          p_action_id: action.id,
          p_user_id: activeUserId,
          p_rows: rows,
          p_schedule_selections: normalizedScheduleSelections,
        },
      );

      if (!atomicError) {
        const atomicResult = asRecord(atomicData) || {};
        const outcome = cleanText(atomicResult.outcome, 80);
        const atomicActionRow = asRecord(atomicResult.action);
        const atomicScheduledRows = Array.isArray(atomicResult.scheduledActions)
          ? atomicResult.scheduledActions
              .map((row) => asRecord(row))
              .filter((row): row is JsonRecord => Boolean(row))
          : [];

        if (
          (outcome === "scheduled" || outcome === "already_scheduled") &&
          atomicActionRow &&
          atomicScheduledRows.length
        ) {
          let snapshottedRows = atomicScheduledRows;
          const snapshotFailureMessage =
            "Programmation annulée : les médias n’ont pas pu être figés de façon fiable.";
          try {
            const snapshotResult = await snapshotAgentScheduledPublicationRows({
              accountId: activeUserId,
              rows: atomicScheduledRows,
            });
            snapshottedRows = snapshotResult.rows as JsonRecord[];
          } catch (snapshotError) {
            console.error(
              "[inr-agent] editorial scheduled publication media snapshot failed",
              {
                actionId: action.id,
                scheduledActionIds: atomicScheduledRows.map((row) => row.id),
                message:
                  snapshotError instanceof Error
                    ? snapshotError.message
                    : String(snapshotError || "Erreur inconnue"),
              },
            );
            await cancelScheduledPublicationRowsAfterSnapshotFailure({
              accountId: activeUserId,
              rows: atomicScheduledRows,
              message: snapshotFailureMessage,
            });
            // The RPC has already moved the editorial action to `scheduled`.
            // Compensate that transition so the professional can validate it
            // again after the infrastructure issue is resolved.
            const { error: releaseError } = await supabaseAdmin
              .from("inr_agent_actions")
              .update({
                status: "pending_validation",
                validated_at: null,
                last_error: snapshotFailureMessage,
                updated_at: new Date().toISOString(),
              })
              .eq("id", action.id)
              .eq("user_id", activeUserId)
              .eq("status", "scheduled")
              .contains("metadata", { editorialPlan: true });
            if (releaseError) {
              console.error(
                "[inr-agent] editorial snapshot failure release failed",
                releaseError,
              );
            }
            return scheduleResult({ error: snapshotFailureMessage }, { status: 500 });
          }

          const scheduledActions = snapshottedRows.map((row) =>
            rowToInrAgentScheduledAction(row as any),
          );
          return scheduleResult({
            action: rowToInrAgentAction(atomicActionRow as any),
            scheduledActions,
            scheduledAction: scheduledActions[0] || null,
            scheduled: true,
            alreadyScheduled: outcome === "already_scheduled",
            tableMissing: false,
          });
        }

        if (outcome === "expired") {
          return scheduleResult(
            {
              error: EDITORIAL_VALIDATION_EXPIRED_MESSAGE,
              code: "INR_AGENT_VALIDATION_EXPIRED",
              action: atomicActionRow
                ? rowToInrAgentAction(atomicActionRow as any)
                : action,
            },
            { status: 409 },
          );
        }

        return scheduleResult(
          {
            error:
              outcome === "not_found"
                ? "Action iNr’Agent introuvable."
                : "Cette publication a déjà été traitée ou n’attend plus de validation.",
            code: "INR_AGENT_VALIDATION_ALREADY_HANDLED",
          },
          { status: outcome === "not_found" ? 404 : 409 },
        );
      }

      if (!isMissingEditorialConfirmationRpc(atomicError)) {
        throw atomicError;
      }

      // Compatibilité transitoire tant que la migration atomique n'est pas
      // encore appliquée. Le compare-and-set garde les deux issues exclusives.
      console.warn(
        "[inr-agent] atomic editorial confirmation RPC missing; using guarded fallback",
      );
      const claimNow = new Date().toISOString();
      const { data: claimedRow, error: claimError } = await supabaseAdmin
        .from("inr_agent_actions")
        .update({
          status: "executing",
          validated_at: claimNow,
          refused_at: null,
          last_error: null,
          updated_at: claimNow,
        })
        .eq("id", action.id)
        .eq("user_id", activeUserId)
        .eq("automation_key", "publish")
        .eq("action_type", "publication")
        .eq("target_tool", "booster")
        .eq("status", "pending_validation")
        .eq("updated_at", action.updatedAt)
        .eq("execution_policy", "manual_validation")
        .eq("validation_required", true)
        .gt("scheduled_for", claimNow)
        .contains("metadata", { editorialPlan: true })
        .select(ACTION_SELECT)
        .maybeSingle();
      if (claimError) throw claimError;

      if (!claimedRow) {
        const refusedAt = new Date().toISOString();
        const { data: expiredRow, error: expireError } = await supabaseAdmin
          .from("inr_agent_actions")
          .update({
            status: "refused",
            validated_at: null,
            refused_at: refusedAt,
            last_error: EDITORIAL_VALIDATION_EXPIRED_MESSAGE,
            updated_at: refusedAt,
          })
          .eq("id", action.id)
          .eq("user_id", activeUserId)
          .eq("automation_key", "publish")
          .eq("action_type", "publication")
          .eq("target_tool", "booster")
          .eq("status", "pending_validation")
          .eq("execution_policy", "manual_validation")
          .eq("validation_required", true)
          .lte("scheduled_for", refusedAt)
          .contains("metadata", { editorialPlan: true })
          .select(ACTION_SELECT)
          .maybeSingle();
        if (expireError) throw expireError;
        if (expiredRow) {
          return scheduleResult(
            {
              error: EDITORIAL_VALIDATION_EXPIRED_MESSAGE,
              code: "INR_AGENT_VALIDATION_EXPIRED",
              action: rowToInrAgentAction(expiredRow as any),
            },
            { status: 409 },
          );
        }
        return scheduleResult(
          {
            error:
              "Cette publication a déjà été traitée ou n’attend plus de validation.",
            code: "INR_AGENT_VALIDATION_ALREADY_HANDLED",
          },
          { status: 409 },
        );
      }

      action = rowToInrAgentAction(claimedRow as any);
      editorialValidationClaimed = true;
      editorialValidationClaimedAt = claimNow;
    }

    if (automaticExecution) {
      const claimNow = new Date().toISOString();
      const { data: claimedRow, error: claimError } = await supabaseAdmin
        .from("inr_agent_actions")
        .update({
          status: "executing",
          last_error: null,
          updated_at: claimNow,
        })
        .eq("id", action.id)
        .eq("user_id", activeUserId)
        .eq("status", "prepared")
        .eq("execution_policy", "automatic_after_settings")
        .eq("validation_required", false)
        .select(ACTION_SELECT)
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimedRow) {
        const { data: existingScheduled } = await supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .select(SCHEDULED_ACTION_SELECT)
          .eq("id", action.id)
          .eq("user_id", activeUserId)
          .maybeSingle();
        if (existingScheduled) {
          const scheduledAction = rowToInrAgentScheduledAction(existingScheduled);
          return scheduleResult({
            action,
            scheduledActions: [scheduledAction],
            scheduledAction,
            scheduled: true,
            alreadyScheduled: true,
            tableMissing: false,
          });
        }
        return scheduleResult(
          { error: "La programmation automatique a déjà été prise en charge." },
          { status: 409 },
        );
      }
      action = rowToInrAgentAction(claimedRow as any);
      automaticClaimed = true;
    }

    if (!automaticExecution && !confirmingEditorialPlan && scheduledPayload.actionType === "publication") {
      const claimAt = new Date().toISOString();
      const claim = await supabaseAdmin.from("inr_agent_actions").update({ status: "executing", updated_at: claimAt })
        .eq("id", action.id).eq("user_id", activeUserId).eq("status", action.status).eq("updated_at", action.updatedAt).select("id").maybeSingle();
      if (claim.error || !claim.data) return scheduleResult({ error: "La publication a changé. Actualisez puis vérifiez les canaux avant de valider." }, { status: 409 });
      publicationSelectionClaimedAt = claimAt;
    }

    const scheduledInsert = automaticExecution
      ? supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .upsert(rows, { onConflict: "id" })
      : supabaseAdmin.from("inr_agent_scheduled_actions").insert(rows);
    const { data: scheduledRows, error: insertError } = await scheduledInsert.select(
      SCHEDULED_ACTION_SELECT,
    );

    if (insertError) {
      await releaseScheduleClaims();
      if (isMissingTableError(insertError)) {
        return scheduleResult(
          {
            error: "La base de programmation iNr’Agent doit être initialisée.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      return scheduleResult(
        {
          error: "Programmation de l’action impossible.",
        },
        { status: 500 },
      );
    }

    let createdScheduledRows = Array.isArray(scheduledRows)
      ? scheduledRows
      : [];
    if (!createdScheduledRows.length) {
      await releaseScheduleClaims();
      return scheduleResult(
        { error: "Aucune action programmée n’a été créée." },
        { status: 500 },
      );
    }

    let createdSnapshotWorkspaceIds: string[] = [];
    if (scheduledPayload.actionType === "publication") {
      const snapshotFailureMessage =
        "Programmation annulée : les médias n’ont pas pu être figés de façon fiable.";
      try {
        const snapshotResult = await snapshotAgentScheduledPublicationRows({
          accountId: activeUserId,
          rows: createdScheduledRows as ScheduledPublicationSnapshotRow[],
        });
        createdScheduledRows = snapshotResult.rows as typeof createdScheduledRows;
        createdSnapshotWorkspaceIds = snapshotResult.createdWorkspaceIds;
      } catch (snapshotError) {
        console.error("[inr-agent] scheduled publication media snapshot failed", {
          actionId: action.id,
          scheduledActionIds: createdScheduledRows.map((row) => row.id),
          message:
            snapshotError instanceof Error
              ? snapshotError.message
              : String(snapshotError || "Erreur inconnue"),
        });
        await cancelScheduledPublicationRowsAfterSnapshotFailure({
          accountId: activeUserId,
          rows: createdScheduledRows as ScheduledPublicationSnapshotRow[],
          message: snapshotFailureMessage,
        });
        await releaseScheduleClaims();
        return scheduleResult({ error: snapshotFailureMessage }, { status: 500 });
      }
    }

    const now = new Date().toISOString();
    const scheduledFor = [...createdScheduledRows]
      .map((row) => String(row.scheduled_at || ""))
      .filter(Boolean)
      .sort()[0] || scheduledAt || now;
    let actionUpdate = supabaseAdmin
      .from("inr_agent_actions")
      .update({
        status: "scheduled",
        scheduled_for: scheduledFor,
        validated_at: automaticExecution
          ? null
          : editorialValidationClaimedAt || now,
        refused_at: null,
        last_error: null,
        payload: {
          ...(action.payload || {}),
          ...(inrAgentPublicationNeedsRevisionReview(action.payload) ? { publicationRevisionReview: { ...revisionReview, required: false, validatedAt: now } } : {}),
          scheduledExecution: {
            scheduledActionIds: createdScheduledRows.map((row) => row.id),
            scheduledAt: scheduledFor,
            scheduleSelections:
              scheduledPayload.actionType === "publication"
                ? normalizedScheduleSelections
                : undefined,
            source: automaticExecution ? "automatic" : "manual",
            createdAt: now,
          },
        },
        updated_at: now,
      })
      .eq("id", action.id)
      .eq("user_id", activeUserId);
    if (automaticExecution) {
      actionUpdate = actionUpdate
        .eq("status", "executing")
        .eq("execution_policy", "automatic_after_settings")
        .eq("validation_required", false);
    }
    if (publicationSelectionClaimedAt) actionUpdate = actionUpdate.eq("status", "executing").eq("updated_at", publicationSelectionClaimedAt);
    if (editorialValidationClaimed && editorialValidationClaimedAt) {
      actionUpdate = actionUpdate
        .eq("status", "executing")
        .eq("execution_policy", "manual_validation")
        .eq("validation_required", true)
        .eq("validated_at", editorialValidationClaimedAt)
        .contains("metadata", { editorialPlan: true });
    }
    const { data: updatedActionRow, error: updateError } = await actionUpdate
      .select(ACTION_SELECT)
      .single();

    if (updateError) {
      const scheduledActionIds = createdScheduledRows
        .map((row) => String(row.id || ""))
        .filter(Boolean);
      if (scheduledActionIds.length) {
        const { error: cancelError } = await supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .update({
            status: "cancelled",
            last_error:
              "Programmation annulée : la validation iNr’Agent n’a pas pu être finalisée.",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", activeUserId)
          .in("id", scheduledActionIds)
          .eq("status", "scheduled");
        if (cancelError) {
          console.error(
            "[inr-agent] orphan scheduled action cancellation failed",
            cancelError,
          );
        }
      }
      await cleanupScheduledPublicationSnapshotWorkspaces({
        accountId: activeUserId,
        workspaceIds: createdSnapshotWorkspaceIds,
      });
      await releaseScheduleClaims();
      return scheduleResult(
        {
          error:
            "Action programmée créée, mais mise à jour iNr’Agent impossible.",
        },
        { status: 500 },
      );
    }

    automaticClaimed = false;
    publicationSelectionClaimedAt = null;
    editorialValidationClaimed = false;
    editorialValidationClaimedAt = null;

    return scheduleResult({
      action: rowToInrAgentAction(updatedActionRow as any),
      scheduledActions: createdScheduledRows.map(rowToInrAgentScheduledAction),
      scheduledAction: createdScheduledRows[0]
        ? rowToInrAgentScheduledAction(createdScheduledRows[0])
        : null,
      scheduled: true,
      tableMissing: false,
    });
  } catch (error) {
    await releaseScheduleClaims();
    args.onError(error);
    return scheduleResult(
      {
        error: getSimpleFrenchErrorMessage(error, "Programmation de l’action impossible."),
      },
      { status: 400 },
    );
  }
}

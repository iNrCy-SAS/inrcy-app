import "server-only";

import { createHash } from "node:crypto";

import { buildInternalCronHeaders } from "@/lib/cronAuth";
import {
  buildInrAgentEditorialPlan,
  getInrAgentEditorialPlanSignatures,
  INR_AGENT_EDITORIAL_PLAN_VERSION,
  type InrAgentEditorialSlot,
} from "@/lib/inrAgentEditorialPlanning";
import {
  automationSettingsToDbRow,
  sanitizeInrAgentAutomationSettings,
  type InrAgentAutomationSettings,
  type InrAgentTone,
} from "@/lib/inrAgentSettings";
import { insertNotificationOnce } from "@/lib/notificationWriter";

type SupabaseLike = any;
type JsonRecord = Record<string, unknown>;

export type InrAgentEditorialAutomationRow = {
  enabled?: boolean | null;
  frequency?: string | null;
  day_of_week?: number | null;
  time?: string | null;
  validation_mode?: string | null;
  allowed_channels?: string[] | null;
  allowed_themes?: string[] | null;
  use_image_bank?: boolean | null;
  image_required?: boolean | null;
  recipient_scope?: string | null;
  source_strategy?: string | null;
  last_prepared_at?: string | null;
  last_executed_at?: string | null;
  next_run_at?: string | null;
  metadata?: JsonRecord | null;
};

type EditorialActionRow = {
  id: string;
  status: string;
  scheduled_for: string | null;
  validation_required?: boolean | null;
  execution_policy?: string | null;
  image_assets?: unknown[] | null;
  payload: JsonRecord | null;
  metadata: JsonRecord | null;
  updated_at?: string | null;
};

const EDITORIAL_ACTION_SELECT =
  "id,status,scheduled_for,validation_required,execution_policy,image_assets,payload,metadata,created_at,updated_at";
const EDITORIAL_MUTABLE_STATUSES = new Set([
  "draft",
  "executing",
  "failed",
  "prepared",
  "pending_validation",
  "pending",
]);
const MAX_EDITORIAL_RETRIES = 4;
const RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_QUOTA_RETRIES = 12;
const QUOTA_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const EDITORIAL_GENERATION_LEASE_MS = 20 * 60 * 1000;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  return cleanText(value, 1_000) || "Préparation éditoriale impossible.";
}

export function inrAgentAutomationFromEditorialRow(
  row: InrAgentEditorialAutomationRow | null | undefined,
): InrAgentAutomationSettings {
  return sanitizeInrAgentAutomationSettings("publish", {
    enabled: row?.enabled ?? undefined,
    frequency: row?.frequency as InrAgentAutomationSettings["frequency"],
    dayOfWeek: row?.day_of_week ?? undefined,
    time: row?.time ?? undefined,
    validationMode:
      row?.validation_mode as InrAgentAutomationSettings["validationMode"],
    allowedChannels:
      row?.allowed_channels as InrAgentAutomationSettings["allowedChannels"],
    allowedThemes:
      row?.allowed_themes as InrAgentAutomationSettings["allowedThemes"],
    useImageBank: row?.use_image_bank ?? undefined,
    imageRequired: row?.image_required ?? undefined,
    recipientScope:
      row?.recipient_scope as InrAgentAutomationSettings["recipientScope"],
    sourceStrategy:
      row?.source_strategy as InrAgentAutomationSettings["sourceStrategy"],
    lastPreparedAt: row?.last_prepared_at ?? null,
    lastExecutedAt: row?.last_executed_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    metadata: row?.metadata ?? {},
  });
}

export function inrAgentEditorialActionId(userId: string, slotKey: string) {
  const hex = createHash("sha256")
    .update(`inrcy:editorial-plan:v${INR_AGENT_EDITORIAL_PLAN_VERSION}:${userId}:${slotKey}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function editorialPlanPayload(
  slot: InrAgentEditorialSlot,
  timezone: string,
  state: "queued" | "generating" | "ready" | "failed" = "queued",
) {
  return {
    version: INR_AGENT_EDITORIAL_PLAN_VERSION,
    slotKey: slot.slotKey,
    scheduledFor: slot.scheduledFor,
    sequence: slot.sequence,
    totalSlots: slot.totalSlots,
    theme: slot.theme,
    tone: slot.tone,
    mediaKind: slot.mediaKind,
    imageCount: slot.imageCount,
    channels: slot.channels,
    timezone,
    scheduleSignature: slot.scheduleSignature,
    criteriaSignature: slot.criteriaSignature,
    state,
  };
}

function rowEditorialPlan(row: EditorialActionRow) {
  return asRecord(asRecord(row.payload).editorialPlan);
}

function validationRequiredForMode(
  validationMode: InrAgentAutomationSettings["validationMode"],
) {
  void validationMode;
  return true;
}

function executionPolicyForMode(
  validationMode: InrAgentAutomationSettings["validationMode"],
) {
  void validationMode;
  return "manual_validation";
}

function readyStatusForMode(
  validationMode: InrAgentAutomationSettings["validationMode"],
) {
  void validationMode;
  return "pending_validation";
}

function isGeneratedEditorialRow(row: EditorialActionRow) {
  const plan = rowEditorialPlan(row);
  const metadata = asRecord(row.metadata);
  return (
    cleanText(plan.state, 40) === "ready" ||
    cleanText(metadata.editorialState, 40) === "ready" ||
    Boolean(cleanText(plan.generatedAt, 80)) ||
    (Array.isArray(row.image_assets) && row.image_assets.length > 0)
  );
}

function isMutableEditorialRow(row: EditorialActionRow) {
  const metadata = asRecord(row.metadata);
  return (
    EDITORIAL_MUTABLE_STATUSES.has(row.status) ||
    (row.status === "cancelled" &&
      cleanText(metadata.editorialCancelReason, 80) ===
        "automation_disabled") ||
    (row.status === "scheduled" &&
      cleanText(row.execution_policy, 80) === "automatic_after_settings")
  );
}

function scheduledExecutionIds(row: EditorialActionRow) {
  const scheduledExecution = asRecord(asRecord(row.payload).scheduledExecution);
  const ids = Array.isArray(scheduledExecution.scheduledActionIds)
    ? scheduledExecution.scheduledActionIds
        .map((value) => cleanText(value, 120))
        .filter(Boolean)
    : [];
  return Array.from(new Set([...ids, row.id]));
}

function payloadWithoutScheduledExecution(row: EditorialActionRow) {
  const payload = { ...asRecord(row.payload) };
  delete payload.scheduledExecution;
  return payload;
}

async function cancelAutomaticScheduledExecution(args: {
  supabase: SupabaseLike;
  userId: string;
  row: EditorialActionRow;
  nowIso: string;
  reason: string;
}) {
  if (
    args.row.status !== "scheduled" ||
    cleanText(args.row.execution_policy, 80) !== "automatic_after_settings"
  ) {
    return 0;
  }
  const { data, error } = await args.supabase
    .from("inr_agent_scheduled_actions")
    .update({
      status: "cancelled",
      last_error: args.reason,
      updated_at: args.nowIso,
    })
    .eq("user_id", args.userId)
    .eq("source", "automatic")
    .eq("status", "scheduled")
    .in("id", scheduledExecutionIds(args.row))
    .select("id");
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

function pendingEditorialSettings(
  automation: InrAgentAutomationSettings,
) {
  const pending = asRecord(automation.metadata).pendingEditorialSettings;
  return pending && typeof pending === "object" && !Array.isArray(pending)
    ? asRecord(pending)
    : null;
}

function futureEditorialCutoverAt(
  automation: InrAgentAutomationSettings,
  now: Date,
) {
  if (!pendingEditorialSettings(automation)) return null;
  const parsed = Date.parse(
    cleanText(asRecord(automation.metadata).editorialSettingsEffectiveAt, 80),
  );
  return Number.isFinite(parsed) && parsed > now.getTime() ? parsed : null;
}

export type InrAgentEditorialPlanImpact = {
  requiresConfirmation: boolean;
  affectedPublications: number;
  generatedPublications: number;
  lostImages: number;
  lostVideos: number;
  requiredImages: number;
  requiredVideos: number;
  protectedUntil: string | null;
  horizonDays: 7 | 15 | 30;
};

function emptyEditorialPlanImpact(
  horizonDays: 7 | 15 | 30,
): InrAgentEditorialPlanImpact {
  return {
    requiresConfirmation: false,
    affectedPublications: 0,
    generatedPublications: 0,
    lostImages: 0,
    lostVideos: 0,
    requiredImages: 0,
    requiredVideos: 0,
    protectedUntil: null,
    horizonDays,
  };
}

export async function analyzeInrAgentEditorialPlanChange(args: {
  supabase: SupabaseLike;
  userId: string;
  currentAutomation: InrAgentAutomationSettings;
  nextAutomation: InrAgentAutomationSettings;
  currentTimezone: string;
  nextTimezone: string;
  currentTone?: InrAgentTone | string;
  nextTone?: InrAgentTone | string;
  now?: Date;
}): Promise<InrAgentEditorialPlanImpact> {
  const now = args.now ?? new Date();
  const horizonDays = args.nextAutomation.planningHorizonDays;
  const currentSignatures = getInrAgentEditorialPlanSignatures({
    automation: args.currentAutomation,
    timezone: args.currentTimezone,
    tone: args.currentTone,
  });
  const nextSignatures = getInrAgentEditorialPlanSignatures({
    automation: args.nextAutomation,
    timezone: args.nextTimezone,
    tone: args.nextTone,
  });
  const configurationChanged =
    args.currentAutomation.enabled !== args.nextAutomation.enabled ||
    currentSignatures.scheduleSignature !== nextSignatures.scheduleSignature ||
    currentSignatures.criteriaSignature !== nextSignatures.criteriaSignature;
  if (!configurationChanged) return emptyEditorialPlanImpact(horizonDays);

  const { data, error } = await args.supabase
    .from("inr_agent_actions")
    .select(EDITORIAL_ACTION_SELECT)
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .gte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);
  if (error) throw error;

  const rows = ((Array.isArray(data) ? data : []) as EditorialActionRow[])
    .filter((row) => asRecord(row.metadata).editorialPlan === true)
    .filter((row) => row.status !== "cancelled");
  if (!rows.length) return emptyEditorialPlanImpact(horizonDays);

  const nextPlan = buildInrAgentEditorialPlan({
    automation: args.nextAutomation,
    timezone: args.nextTimezone,
    tone: args.nextTone,
    now,
    horizonDays,
  });
  const nextBySlot = new Map(nextPlan.map((slot) => [slot.slotKey, slot]));
  const existingBySlot = new Map(
    rows
      .map((row) => [cleanText(rowEditorialPlan(row).slotKey, 240), row] as const)
      .filter(([slotKey]) => Boolean(slotKey)),
  );
  const affectedRows = rows.filter((row) => {
    if (!isMutableEditorialRow(row)) return false;
    const currentPlan = rowEditorialPlan(row);
    const desired = nextBySlot.get(cleanText(currentPlan.slotKey, 240));
    return (
      !desired ||
      cleanText(currentPlan.scheduleSignature, 2_000) !==
        desired.scheduleSignature ||
      cleanText(currentPlan.criteriaSignature, 2_000) !==
        desired.criteriaSignature
    );
  });

  // Seuls les créneaux absents ou dont les critères changent consommeront de
  // nouveaux quotas. Un créneau déjà conforme est conservé tel quel.
  const slotsToGenerate = nextPlan.filter((slot) => {
    const existing = existingBySlot.get(slot.slotKey);
    if (!existing) return true;
    if (!isMutableEditorialRow(existing)) return false;
    const currentPlan = rowEditorialPlan(existing);
    return (
      cleanText(currentPlan.scheduleSignature, 2_000) !==
        slot.scheduleSignature ||
      cleanText(currentPlan.criteriaSignature, 2_000) !==
        slot.criteriaSignature
    );
  });
  if (!affectedRows.length && !slotsToGenerate.length) {
    return emptyEditorialPlanImpact(horizonDays);
  }

  let generatedPublications = 0;
  let lostImages = 0;
  let lostVideos = 0;
  for (const row of affectedRows) {
    const plan = rowEditorialPlan(row);
    if (!isGeneratedEditorialRow(row)) continue;
    generatedPublications += 1;
    if (plan.mediaKind === "video") lostVideos += 1;
    if (plan.mediaKind === "image") {
      lostImages += Math.max(1, Math.min(2, Number(plan.imageCount) || 1));
    }
  }

  let requiredImages = 0;
  let requiredVideos = 0;
  for (const slot of slotsToGenerate) {
    if (slot.mediaKind === "video") requiredVideos += 1;
    if (slot.mediaKind === "image") requiredImages += slot.imageCount;
  }

  const lastScheduledAt = rows.reduce(
    (latest, row) => Math.max(latest, Date.parse(row.scheduled_for || "") || 0),
    0,
  );
  return {
    // Une première activation sans planning existant démarre normalement. Dès
    // qu'un planning existe, tout ajout/remplacement repasse par le choix du pro.
    requiresConfirmation: rows.length > 0,
    affectedPublications: affectedRows.length,
    generatedPublications,
    lostImages,
    lostVideos,
    requiredImages,
    requiredVideos,
    protectedUntil: lastScheduledAt
      ? new Date(lastScheduledAt + 1_000).toISOString()
      : null,
    horizonDays,
  };
}

export async function activatePendingInrAgentEditorialSettings(args: {
  supabase: SupabaseLike;
  userId: string;
  row: InrAgentEditorialAutomationRow;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const current = inrAgentAutomationFromEditorialRow(args.row);
  const pending = pendingEditorialSettings(current);
  const effectiveAt = Date.parse(
    cleanText(asRecord(current.metadata).editorialSettingsEffectiveAt, 80),
  );
  if (!pending || !Number.isFinite(effectiveAt) || effectiveAt > now.getTime()) {
    return { automation: current, activated: false };
  }

  const pendingMetadata = { ...asRecord(pending.metadata) };
  delete pendingMetadata.pendingEditorialSettings;
  delete pendingMetadata.editorialSettingsEffectiveAt;
  delete pendingMetadata.editorialSettingsDeferredAt;
  delete pendingMetadata.editorialSettingsActiveTone;
  delete pendingMetadata.editorialSettingsActiveTimezone;
  const automation = sanitizeInrAgentAutomationSettings("publish", {
    ...pending,
    metadata: {
      ...pendingMetadata,
      editorialSettingsActivatedAt: now.toISOString(),
    },
  });
  const dbRow = automationSettingsToDbRow(args.userId, "publish", automation);
  const { error } = await args.supabase
    .from("inr_agent_automation_settings")
    .update(dbRow)
    .eq("user_id", args.userId)
    .eq("automation_key", "publish");
  if (error) throw error;
  return { automation, activated: true };
}

export async function reconcileInrAgentEditorialPlan(args: {
  supabase: SupabaseLike;
  userId: string;
  automation: InrAgentAutomationSettings;
  timezone: string;
  tone?: InrAgentTone | string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const cutoverAt = futureEditorialCutoverAt(args.automation, now);
  const plan = buildInrAgentEditorialPlan({
    automation: args.automation,
    timezone: args.timezone,
    tone: args.tone,
    now,
  }).filter(
    (slot) => !cutoverAt || Date.parse(slot.scheduledFor) < cutoverAt,
  );
  const desiredSlotKeys = new Set(plan.map((slot) => slot.slotKey));
  const lookupSince = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  const { data: existingData, error: existingError } = await args.supabase
    .from("inr_agent_actions")
    .select(EDITORIAL_ACTION_SELECT)
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .gte("scheduled_for", lookupSince)
    .order("scheduled_for", { ascending: true })
    .limit(200);
  if (existingError) throw existingError;

  const existing = (Array.isArray(existingData)
    ? existingData
    : []) as EditorialActionRow[];
  const editorialRows = existing.filter(
    (row) => asRecord(row.metadata).editorialPlan === true,
  );
  const existingBySlot = new Map(
    editorialRows
      .map((row) => [cleanText(rowEditorialPlan(row).slotKey, 240), row] as const)
      .filter(([slotKey]) => Boolean(slotKey)),
  );

  const rowsToInsert = plan
    .filter((slot) => !existingBySlot.has(slot.slotKey))
    .map((slot) => {
      const editorialPlan = editorialPlanPayload(slot, args.timezone);
      return {
        id: inrAgentEditorialActionId(args.userId, slot.slotKey),
        user_id: args.userId,
        automation_key: "publish",
        action_type: "publication",
        target_tool: "booster",
        title: "Publication iNr’Agent en préparation",
        summary: `Contenu prévu le ${new Intl.DateTimeFormat("fr-FR", {
          timeZone: args.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(slot.scheduledFor))}.`,
        preview_text: "iNr’Agent prépare ce contenu à l’avance selon vos critères.",
        target_channels: slot.channels,
        target_themes: [slot.theme],
        recipients: [],
        image_assets: [],
        payload: {
          version: 1,
          source: "inr_agent_editorial_plan",
          editorialPlan,
        },
        validation_required: validationRequiredForMode(
          args.automation.validationMode,
        ),
        execution_policy: executionPolicyForMode(
          args.automation.validationMode,
        ),
        status: "draft",
        scheduled_for: slot.scheduledFor,
        prepared_at: nowIso,
        metadata: {
          editorialPlan: true,
          editorialPlanVersion: INR_AGENT_EDITORIAL_PLAN_VERSION,
          editorialState: "queued",
          editorialAttempts: 0,
          editorialNextRetryAt: null,
          editorialLastError: null,
          automationFrequency: args.automation.frequency,
        },
        created_at: nowIso,
        updated_at: nowIso,
      };
    });

  if (rowsToInsert.length) {
    const { error } = await args.supabase
      .from("inr_agent_actions")
      .upsert(rowsToInsert, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }

  const desiredValidationRequired = validationRequiredForMode(
    args.automation.validationMode,
  );
  const desiredExecutionPolicy = executionPolicyForMode(
    args.automation.validationMode,
  );
  const desiredReadyStatus = readyStatusForMode(
    args.automation.validationMode,
  );
  let requeued = 0;
  let validationWorkflowUpdated = 0;
  let reactivated = 0;
  let recoveredStaleGenerations = 0;
  let automaticSchedulesCancelled = 0;
  for (const slot of plan) {
    const row = existingBySlot.get(slot.slotKey);
    if (!row || !isMutableEditorialRow(row)) {
      continue;
    }
    const currentPlan = rowEditorialPlan(row);
    const criteriaChanged =
      cleanText(currentPlan.criteriaSignature, 2_000) !==
        slot.criteriaSignature ||
      cleanText(currentPlan.scheduleSignature, 2_000) !==
        slot.scheduleSignature;
    if (!criteriaChanged) {
      const rowMetadata = asRecord(row.metadata);
      const reactivating =
        row.status === "cancelled" &&
        cleanText(rowMetadata.editorialCancelReason, 80) ===
          "automation_disabled";
      if (reactivating) {
        const generated = isGeneratedEditorialRow(row);
        const { error } = await args.supabase
          .from("inr_agent_actions")
          .update({
            status: generated ? desiredReadyStatus : "draft",
            validation_required: desiredValidationRequired,
            execution_policy: desiredExecutionPolicy,
            validated_at: null,
            refused_at: null,
            last_error: null,
            metadata: {
              ...rowMetadata,
              editorialState: generated ? "ready" : "queued",
              editorialCancelledAt: null,
              editorialCancelReason: null,
              editorialReactivatedAt: nowIso,
              editorialNextRetryAt: null,
              editorialLastError: null,
            },
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .eq("user_id", args.userId)
          .eq("status", "cancelled");
        if (!error) reactivated += 1;
        continue;
      }
      const generationStartedAt = Date.parse(
        cleanText(
          rowMetadata.editorialLastAttemptAt || row.updated_at,
          80,
        ),
      );
      const staleGeneration =
        row.status === "executing" &&
        Number.isFinite(generationStartedAt) &&
        now.getTime() - generationStartedAt >= EDITORIAL_GENERATION_LEASE_MS;
      if (staleGeneration) {
        const contentWasAlreadyGenerated = isGeneratedEditorialRow(row);
        const { error } = await args.supabase
          .from("inr_agent_actions")
          .update({
            status: contentWasAlreadyGenerated ? desiredReadyStatus : "draft",
            validation_required: desiredValidationRequired,
            execution_policy: desiredExecutionPolicy,
            metadata: {
              ...rowMetadata,
              editorialState: contentWasAlreadyGenerated ? "ready" : "retry",
              editorialNextRetryAt: contentWasAlreadyGenerated ? null : nowIso,
              editorialRecoveredAt: nowIso,
              editorialRetryReason: contentWasAlreadyGenerated
                ? "interrupted_scheduling"
                : "interrupted_generation",
            },
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .eq("user_id", args.userId)
          .eq("status", "executing");
        if (!error) recoveredStaleGenerations += 1;
        continue;
      }

      const validationWorkflowChanged =
        row.validation_required !== desiredValidationRequired ||
        cleanText(row.execution_policy, 80) !== desiredExecutionPolicy;
      if (!validationWorkflowChanged) continue;

      automaticSchedulesCancelled +=
        await cancelAutomaticScheduledExecution({
          supabase: args.supabase,
          userId: args.userId,
          row,
          nowIso,
          reason:
            "Le professionnel a modifié le mode de validation iNr’Agent avant publication.",
        });
      const generated = isGeneratedEditorialRow(row);
      const nextStatus = generated ? desiredReadyStatus : row.status;
      const nextPayload =
        row.status === "scheduled"
          ? payloadWithoutScheduledExecution(row)
          : asRecord(row.payload);

      const { error } = await args.supabase
        .from("inr_agent_actions")
        .update({
          status: nextStatus,
          validation_required: desiredValidationRequired,
          execution_policy: desiredExecutionPolicy,
          validated_at: null,
          payload: nextPayload,
          metadata: {
            ...asRecord(row.metadata),
            editorialValidationModeUpdatedAt: nowIso,
          },
          updated_at: nowIso,
        })
        .eq("id", row.id)
        .eq("user_id", args.userId);
      if (!error) validationWorkflowUpdated += 1;
      continue;
    }
    automaticSchedulesCancelled +=
      await cancelAutomaticScheduledExecution({
        supabase: args.supabase,
        userId: args.userId,
        row,
        nowIso,
        reason:
          "La date ou les critères de cette publication iNr’Agent ont été modifiés.",
      });
    const editorialPlan = editorialPlanPayload(slot, args.timezone);
    const { error } = await args.supabase
      .from("inr_agent_actions")
      .update({
        title: "Publication iNr’Agent en préparation",
        summary: `Contenu replanifié selon vos nouveaux critères.`,
        preview_text:
          "iNr’Agent régénère ce contenu à partir des critères mis à jour.",
        target_channels: slot.channels,
        target_themes: [slot.theme],
        image_assets: [],
        payload: {
          version: 1,
          source: "inr_agent_editorial_plan",
          editorialPlan,
        },
        validation_required: desiredValidationRequired,
        execution_policy: desiredExecutionPolicy,
        status: "draft",
        scheduled_for: slot.scheduledFor,
        prepared_at: nowIso,
        last_error: null,
        metadata: {
          ...asRecord(row.metadata),
          editorialPlan: true,
          editorialState: "queued",
          editorialAttempts: 0,
          editorialNextRetryAt: null,
          editorialLastError: null,
          editorialReplannedAt: nowIso,
          automationFrequency: args.automation.frequency,
        },
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("user_id", args.userId);
    if (!error) requeued += 1;
  }

  let cancelled = 0;
  for (const row of editorialRows) {
    const slotKey = cleanText(rowEditorialPlan(row).slotKey, 240);
    if (
      desiredSlotKeys.has(slotKey) ||
      !isMutableEditorialRow(row)
    ) {
      continue;
    }
    automaticSchedulesCancelled +=
      await cancelAutomaticScheduledExecution({
        supabase: args.supabase,
        userId: args.userId,
        row,
        nowIso,
        reason: args.automation.enabled
          ? "Ce créneau iNr’Agent a été retiré du planning."
          : "L’automatisation iNr’Agent a été désactivée.",
      });
    const { error } = await args.supabase
      .from("inr_agent_actions")
      .update({
        status: "cancelled",
        last_error: null,
        metadata: {
          ...asRecord(row.metadata),
          editorialState: "cancelled",
          editorialCancelledAt: nowIso,
          editorialCancelReason: args.automation.enabled
            ? "schedule_or_criteria_changed"
            : "automation_disabled",
        },
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("user_id", args.userId);
    if (!error) cancelled += 1;
  }

  return {
    planned: plan.length,
    inserted: rowsToInsert.length,
    kept: Math.max(0, plan.length - rowsToInsert.length),
    requeued,
    reactivated,
    validationWorkflowUpdated,
    recoveredStaleGenerations,
    automaticSchedulesCancelled,
    cancelled,
    horizonDays: args.automation.planningHorizonDays,
    deferredUntil: cutoverAt ? new Date(cutoverAt).toISOString() : null,
  };
}

export async function notifyReadyInrAgentEditorialBatch(args: {
  supabase: SupabaseLike;
  userId: string;
  horizonDays: number;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const horizonDays = [7, 15, 30].includes(Number(args.horizonDays))
    ? Number(args.horizonDays)
    : 15;
  const horizonEnd = new Date(
    now.getTime() + horizonDays * 86_400_000,
  ).toISOString();
  const { data, error } = await args.supabase
    .from("inr_agent_actions")
    .select("id,status,scheduled_for,metadata")
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .gte("scheduled_for", now.toISOString())
    .lte("scheduled_for", horizonEnd)
    .order("scheduled_for", { ascending: true })
    .limit(200);
  if (error) throw error;

  const rows = (Array.isArray(data) ? data : []).filter(
    (row) => asRecord(row.metadata).editorialPlan === true,
  );
  const activeRows = rows.filter((row) => row.status !== "cancelled");
  const awaitingValidation = activeRows.filter(
    (row) => row.status === "pending_validation",
  );
  const stillPreparing = activeRows.some((row) =>
    ["draft", "executing", "failed", "prepared", "pending"].includes(
      cleanText(row.status, 40),
    ),
  );
  if (!awaitingValidation.length || stillPreparing) {
    return {
      status: "not_ready" as const,
      awaitingValidation: awaitingValidation.length,
      remaining: activeRows.length - awaitingValidation.length,
    };
  }

  const batchSignature = createHash("sha256")
    .update(
      awaitingValidation
        .map((row) => `${row.id}:${row.scheduled_for || ""}`)
        .join("|"),
    )
    .digest("hex")
    .slice(0, 20);
  const count = awaitingValidation.length;
  const result = await insertNotificationOnce({
    user_id: args.userId,
    category: "action",
    kind: "inr_agent_editorial_batch_ready",
    title: "Vos publications iNr’Agent sont prêtes",
    body: `iNr’Agent a préparé ${count} publication${count > 1 ? "s" : ""} pour les ${horizonDays} prochains jours. Contrôlez-les puis validez-les avant leur diffusion.`,
    cta_label: "Contrôler mes publications",
    cta_url: "/dashboard/agent",
    dedupe_key: `inr-agent-editorial-ready:${args.userId}:${batchSignature}`,
    meta: {
      source: "inr_agent_editorial_plan",
      horizonDays,
      publicationCount: count,
      actionIds: awaitingValidation.map((row) => row.id),
    },
  });
  return {
    status: result.inserted ? ("notified" as const) : ("already_notified" as const),
    awaitingValidation: count,
    remaining: 0,
  };
}

export async function prepareNextInrAgentEditorialSlot(args: {
  supabase: SupabaseLike;
  userId: string;
  origin: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const { data, error } = await args.supabase
    .from("inr_agent_actions")
    .select(EDITORIAL_ACTION_SELECT)
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .eq("status", "draft")
    .order("scheduled_for", { ascending: true })
    .limit(40);
  if (error) throw error;

  const candidate = ((Array.isArray(data) ? data : []) as EditorialActionRow[])
    .filter((row) => {
      const metadata = asRecord(row.metadata);
      if (metadata.editorialPlan !== true) return false;
      const state = cleanText(metadata.editorialState, 40) || "queued";
      if (!['queued', 'retry'].includes(state)) return false;
      const retryAt = Date.parse(cleanText(metadata.editorialNextRetryAt, 80));
      return !Number.isFinite(retryAt) || retryAt <= now.getTime();
    })[0];
  if (!candidate) return { status: "idle" as const, actionId: null };

  const metadata = asRecord(candidate.metadata);
  const attempts = Math.max(0, Number(metadata.editorialAttempts) || 0) + 1;
  const claimedAt = now.toISOString();
  const claimedMetadata = {
    ...metadata,
    editorialState: "generating",
    editorialAttempts: attempts,
    editorialLastAttemptAt: claimedAt,
    editorialNextRetryAt: null,
  };
  const { data: claimed, error: claimError } = await args.supabase
    .from("inr_agent_actions")
    .update({
      status: "executing",
      metadata: claimedMetadata,
      last_error: null,
      updated_at: claimedAt,
    })
    .eq("id", candidate.id)
    .eq("user_id", args.userId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { status: "contended" as const, actionId: candidate.id };

  try {
    const endpoint = `${args.origin.replace(/\/$/, "")}/api/agent/actions/prepare-publish`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildInternalCronHeaders(args.userId),
      body: JSON.stringify({
        cronUserId: args.userId,
        triggeredBy: "inr_agent_editorial_plan",
        targetActionId: candidate.id,
        editorialPlan: rowEditorialPlan(candidate),
      }),
      cache: "no-store",
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      let parsed: JsonRecord = {};
      try {
        parsed = asRecord(JSON.parse(responseText));
      } catch {
        parsed = {};
      }
      throw new Error(
        cleanText(parsed.error || parsed.message || responseText, 1_000) ||
          `Préparation éditoriale refusée (${response.status}).`,
      );
    }
    return { status: "prepared" as const, actionId: candidate.id };
  } catch (cause) {
    const message = errorMessage(cause);
    const isQuotaLimited = /quota|rate.?limit|too many requests|\b429\b/i.test(
      message,
    );
    const retry =
      attempts < (isQuotaLimited ? MAX_QUOTA_RETRIES : MAX_EDITORIAL_RETRIES);
    const retryAt = retry
      ? new Date(
          now.getTime() +
            (isQuotaLimited ? QUOTA_RETRY_DELAY_MS : RETRY_DELAY_MS),
        ).toISOString()
      : null;
    await args.supabase
      .from("inr_agent_actions")
      .update({
        status: retry ? "draft" : "failed",
        last_error: message,
        metadata: {
          ...claimedMetadata,
          editorialState: retry ? "retry" : "failed",
          editorialNextRetryAt: retryAt,
          editorialLastError: message,
          editorialLastErrorAt: new Date().toISOString(),
          editorialRetryReason: isQuotaLimited ? "quota" : "transient_error",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("user_id", args.userId);
    return {
      status: retry ? ("retry" as const) : ("failed" as const),
      actionId: candidate.id,
      error: message,
      retryAt,
    };
  }
}

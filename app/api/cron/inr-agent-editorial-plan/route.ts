import { NextResponse } from "next/server";

import { getAppOriginFromRequest, isAuthorizedCronRequest } from "@/lib/cronAuth";
import {
  activatePendingInrAgentEditorialSettings,
  notifyReadyInrAgentEditorialBatch,
  prepareNextInrAgentEditorialSlot,
  reconcileInrAgentEditorialPlan,
  scheduleReadyInrAgentAdminPublications,
  type InrAgentEditorialAutomationRow,
} from "@/lib/inrAgentEditorialPlanServer";
import type { InrAgentAutomationSettings } from "@/lib/inrAgentSettings";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { getDashboardEditionsForAccountIds } from "@/lib/dashboardEditionServer";
import { inrAgentEditorialGenerationRotationOffset, orderInrAgentEditorialGenerationAccounts } from "@/lib/inrAgentEditorialGenerationOrder";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 800;

const AUTOMATION_SELECT =
  "user_id,enabled,frequency,day_of_week,time,validation_mode,allowed_channels,allowed_themes,use_image_bank,image_required,recipient_scope,source_strategy,last_prepared_at,last_executed_at,next_run_at,metadata";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMissingSchemaError(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_")
  );
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const maxAccounts = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("maxAccounts") || 40)),
  );
  const maxGenerations = Math.min(
    3,
    Math.max(0, Number(url.searchParams.get("maxGenerations") || 3)),
  );
  const origin = getAppOriginFromRequest(request);
  const now = new Date();

  const { count: totalAccounts, error: countError } = await supabaseAdmin
    .from("inr_agent_settings")
    .select("user_id", { count: "exact", head: true })
    .eq("global_enabled", true);
  if (countError) {
    return NextResponse.json(
      {
        success: false,
        tableMissing: isMissingSchemaError(countError),
        error: countError.message,
      },
      { status: 500 },
    );
  }
  const accountCount = Math.max(0, Number(totalAccounts || 0));
  if (accountCount === 0) {
    return NextResponse.json({
      success: true,
      dryRun,
      planned: 0,
      generated: 0,
      accountCount: 0,
      pageIndex: 0,
      pageCount: 0,
    });
  }
  const pageCount = Math.max(1, Math.ceil(accountCount / maxAccounts));
  const pageIndex = Math.floor(now.getTime() / (60 * 1000)) % pageCount;
  const pageStart = pageIndex * maxAccounts;
  const pageEnd = Math.min(accountCount, pageStart + maxAccounts) - 1;

  const { data: settingsRows, error: settingsError } = await supabaseAdmin
    .from("inr_agent_settings")
    .select("user_id,timezone,tone")
    .eq("global_enabled", true)
    .order("user_id", { ascending: true })
    .range(pageStart, Math.max(pageStart, pageEnd));
  if (settingsError) {
    return NextResponse.json(
      {
        success: false,
        tableMissing: isMissingSchemaError(settingsError),
        error: settingsError.message,
      },
      { status: 500 },
    );
  }

  const timezoneByUser = new Map<string, string>();
  const toneByUser = new Map<string, string>();
  for (const row of Array.isArray(settingsRows) ? settingsRows : []) {
    const userId = String(row.user_id || "").trim();
    if (userId) {
      timezoneByUser.set(userId, String(row.timezone || "Europe/Paris"));
      toneByUser.set(userId, String(row.tone || "professional"));
    }
  }
  const userIds = [...timezoneByUser.keys()];
  if (!userIds.length) {
    return NextResponse.json({
      success: true,
      planned: 0,
      generated: 0,
      accountCount,
      pageIndex,
      pageCount,
    });
  }

  const { data: automationRows, error: automationError } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(AUTOMATION_SELECT)
    .in("user_id", userIds)
    .eq("automation_key", "publish");
  if (automationError) {
    return NextResponse.json(
      {
        success: false,
        tableMissing: isMissingSchemaError(automationError),
        error: automationError.message,
      },
      { status: 500 },
    );
  }

  const rows = (Array.isArray(automationRows) ? automationRows : []) as Array<
    InrAgentEditorialAutomationRow & { user_id: string }
  >;
  const activeAccountIds = await getActiveSubscriptionAccountIds(
    rows.map((row) => row.user_id),
    now.getTime(),
  );
  const editionsByAccount = await getDashboardEditionsForAccountIds(rows.map((row) => row.user_id));
  const reconciliations: Array<Record<string, unknown>> = [];
  const enabledRows: Array<{
    userId: string;
    automation: InrAgentAutomationSettings;
    lastAttemptAt?: string;
  }> = [];
  if (!dryRun) {
    for (const row of rows) {
      if (editionsByAccount.get(row.user_id) === "basic") {
        reconciliations.push({ userId: row.user_id, success: true, planned: 0, reason: "standard_required" });
        continue;
      }
      if (!activeAccountIds.has(row.user_id)) {
        reconciliations.push({
          userId: row.user_id,
          success: true,
          planned: 0,
          reason: "subscription_inactive",
        });
        continue;
      }
      try {
        const activation = await activatePendingInrAgentEditorialSettings({
          supabase: supabaseAdmin,
          userId: row.user_id,
          row,
          now,
        });
        if (activation.activated) {
          const { data: enabledAutomationRows, error: enabledLookupError } =
            await supabaseAdmin
              .from("inr_agent_automation_settings")
              .select("automation_key")
              .eq("user_id", row.user_id)
              .eq("enabled", true)
              .limit(1);
          if (enabledLookupError) throw enabledLookupError;
          const hasEnabledAutomation =
            Array.isArray(enabledAutomationRows) &&
            enabledAutomationRows.length > 0;
          const { error: globalSyncError } = await supabaseAdmin
            .from("inr_agent_settings")
            .update({
              global_enabled: hasEnabledAutomation,
              updated_at: now.toISOString(),
            })
            .eq("user_id", row.user_id);
          if (globalSyncError) throw globalSyncError;
        }
        if (!activation.automation.enabled) {
          reconciliations.push({
            userId: row.user_id,
            success: true,
            planned: 0,
            activated: activation.activated,
            reason: "automation_disabled",
          });
          continue;
        }
        enabledRows.push({
          userId: row.user_id,
          automation: activation.automation,
        });
        const activeMetadata = asRecord(activation.automation.metadata);
        const activeTimezone = activation.activated
          ? timezoneByUser.get(row.user_id) || "Europe/Paris"
          : String(
              activeMetadata.editorialSettingsActiveTimezone ||
                timezoneByUser.get(row.user_id) ||
                "Europe/Paris",
            );
        const activeTone = activation.activated
          ? toneByUser.get(row.user_id) || "professional"
          : String(
              activeMetadata.editorialSettingsActiveTone ||
                toneByUser.get(row.user_id) ||
                "professional",
            );
        const result = await reconcileInrAgentEditorialPlan({
          supabase: supabaseAdmin,
          userId: row.user_id,
          automation: activation.automation,
          timezone: activeTimezone,
          tone: activeTone,
          now,
        });
        reconciliations.push({
          userId: row.user_id,
          success: true,
          activated: activation.activated,
          ...result,
        });
      } catch (error) {
        reconciliations.push({
          userId: row.user_id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const generated: Array<Record<string, unknown>> = [];
  if (!dryRun && maxGenerations > 0 && enabledRows.length > 0) {
    const { data: attemptRows, error: attemptError } = await supabaseAdmin
      .from("inr_agent_actions")
      .select("user_id,editorialLastAttemptAt:metadata->>editorialLastAttemptAt")
      .in("user_id", enabledRows.map((entry) => entry.userId))
      .eq("automation_key", "publish")
      .eq("metadata->>editorialPlan", "true")
      .not("metadata->>editorialLastAttemptAt", "is", null)
      .order("metadata->>editorialLastAttemptAt", { ascending: false, nullsFirst: false })
      .limit(4000);
    if (attemptError) {
      console.warn("[inr-agent-editorial] generation attempt history unavailable", attemptError);
      return NextResponse.json({ success: false, code: "editorial_generation_attempt_history_unavailable", error: attemptError.message }, { status: 500 });
    }
    const lastAttemptByAccount = new Map<string, string>();
    for (const row of Array.isArray(attemptRows) ? attemptRows : []) {
      const timestamp = Date.parse(String(row.editorialLastAttemptAt || ""));
      const previous = Date.parse(lastAttemptByAccount.get(row.user_id) || "");
      if (Number.isFinite(timestamp) && (!Number.isFinite(previous) || timestamp > previous)) {
        lastAttemptByAccount.set(row.user_id, row.editorialLastAttemptAt);
      }
    }
    for (const entry of enabledRows) entry.lastAttemptAt = lastAttemptByAccount.get(entry.userId);
    const rotationOffset = inrAgentEditorialGenerationRotationOffset({
      tick: Math.floor(now.getTime() / (60 * 1000)),
      pageCount,
      accountCount: enabledRows.length,
      maxGenerations,
    });
    const generationUsers = orderInrAgentEditorialGenerationAccounts(enabledRows, rotationOffset);
    let generationAttempts = 0;

    for (const entry of generationUsers) {
      if (generationAttempts >= maxGenerations) break;
      try {
        const result = await prepareNextInrAgentEditorialSlot({
          supabase: supabaseAdmin,
          userId: entry.userId,
          origin,
          now: new Date(),
        });
        if (result.status !== "idle" && result.generationStarted !== false) generationAttempts += 1;
        if (result.status !== "idle") {
          generated.push({
            userId: entry.userId,
            ...result,
          });
        }
      } catch (error) {
        generationAttempts += 1;
        generated.push({
          userId: entry.userId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Every enabled account must be checked for validation deadlines, even when
  // the generation budget was spent on other accounts during this cron run.
  const notificationResults: Array<Record<string, unknown>> = [];
  const automaticScheduleResults: Array<Record<string, unknown>> = [];
  if (!dryRun) {
    for (let index = 0; index < enabledRows.length; index += 5) {
      const group = enabledRows.slice(index, index + 5);
      const results = await Promise.all(
        group.map(async (entry) => {
          try {
            if (entry.automation.validationMode === "admin_automatic_publish") {
              const scheduled = await scheduleReadyInrAgentAdminPublications({ supabase: supabaseAdmin, userId: entry.userId, origin });
              automaticScheduleResults.push(...scheduled.map((result) => ({ userId: entry.userId, ...result })));
            }
            const result = await notifyReadyInrAgentEditorialBatch({
              supabase: supabaseAdmin,
              userId: entry.userId,
              horizonDays: entry.automation.planningHorizonDays,
              now,
            });
            if (
              result.status === "notified" ||
              Number(result.reminderCount || 0) > 0 ||
              result.emailStatus === "sent" ||
              result.emailStatus === "failed"
            ) {
              return { userId: entry.userId, ...result };
            }
            return null;
          } catch (error) {
            return {
              userId: entry.userId,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
      for (const result of results) if (result) notificationResults.push(result);
    }
  }

  console.info("[inr-agent-editorial] batch", {
    dryRun,
    pageIndex,
    pageCount,
    accounts: rows.length,
    eligibleAccounts: enabledRows.length,
    prepared: generated.filter((row) => row.status === "prepared").length,
    retrying: generated.filter((row) => row.status === "retry").length,
    failed: generated.filter((row) => row.status === "failed").length,
    automaticScheduled: automaticScheduleResults.filter((row) => row.status === "scheduled").length,
    automaticDeferred: automaticScheduleResults.filter((row) => row.status === "retry").length,
    durationMs: Date.now() - now.getTime(),
  });

  return NextResponse.json({
    success: true,
    dryRun,
    accounts: rows.length,
    accountCount,
    pageIndex,
    pageCount,
    planned: reconciliations.reduce(
      (total, row) => total + Number(row.planned || 0),
      0,
    ),
    generated: generated.length,
    notified: notificationResults.length,
    reconciliations,
    generationResults: generated,
    notificationResults,
    automaticScheduleResults,
  });
}

export async function GET(request: Request) {
  return POST(request);
}

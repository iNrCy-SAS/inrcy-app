import "server-only";

import {
  DASHBOARD_ONBOARDING_SELECT,
  DASHBOARD_ONBOARDING_STATUSES,
  DASHBOARD_ONBOARDING_STEPS,
  DASHBOARD_ONBOARDING_VERSION,
  isDashboardOnboardingFirstOpening,
  normalizeDashboardOnboardingRow,
  type DashboardOnboardingInitialState,
  type DashboardOnboardingStatus,
  type DashboardOnboardingStep,
} from "@/lib/dashboardOnboarding";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getDashboardOnboardingStateForAccount(accountId: string) {
  const { data, error } = await supabaseAdmin
    .from("inrcy_onboarding_states")
    .select(DASHBOARD_ONBOARDING_SELECT)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) throw error;
  return normalizeDashboardOnboardingRow(data);
}

export async function saveDashboardOnboardingStateForAccount(params: {
  accountId: string;
  status: DashboardOnboardingStatus;
  currentStep: DashboardOnboardingStep;
}) {
  if (!DASHBOARD_ONBOARDING_STATUSES.includes(params.status)) {
    throw new Error("INRCY_ONBOARDING_STATUS_INVALID");
  }
  if (!DASHBOARD_ONBOARDING_STEPS.includes(params.currentStep)) {
    throw new Error("INRCY_ONBOARDING_STEP_INVALID");
  }
  if ((params.status === "completed") !== (params.currentStep === "completed")) {
    throw new Error("INRCY_ONBOARDING_STATE_INCONSISTENT");
  }

  const current = await getDashboardOnboardingStateForAccount(params.accountId);
  if (!current) throw new Error("INRCY_ONBOARDING_STATE_NOT_FOUND");
  if (current.status === "completed" && params.status !== "completed") {
    throw new Error("INRCY_ONBOARDING_ALREADY_COMPLETED");
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("inrcy_onboarding_states")
    .update({
      version: DASHBOARD_ONBOARDING_VERSION,
      status: params.status,
      current_step: params.currentStep,
      started_at:
        params.status === "in_progress" ||
        params.status === "deferred" ||
        params.status === "completed"
          ? current.startedAt || nowIso
          : current.startedAt,
      deferred_at:
        params.status === "deferred"
          ? nowIso
          : params.status === "in_progress" || params.status === "completed"
            ? null
            : current.deferredAt,
      completed_at:
        params.status === "completed" ? current.completedAt || nowIso : null,
    })
    .eq("account_id", params.accountId)
    .eq("version", current.version)
    .select(DASHBOARD_ONBOARDING_SELECT)
    .maybeSingle();

  if (error) throw error;
  const saved = normalizeDashboardOnboardingRow(data);
  if (!saved) throw new Error("INRCY_ONBOARDING_CONCURRENT_UPDATE");
  return saved;
}

export async function getDashboardInitialOnboardingStateServer(): Promise<DashboardOnboardingInitialState | null> {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse || !activeUserId) return null;

  try {
    let row = await getDashboardOnboardingStateForAccount(activeUserId);
    const firstOpeningDetected = isDashboardOnboardingFirstOpening(row);

    if (row && firstOpeningDetected) {
      row = await saveDashboardOnboardingStateForAccount({
        accountId: activeUserId,
        status: "in_progress",
        currentStep: row.currentStep,
      });
    }

    return {
      accountId: activeUserId,
      row,
      onboardingAvailable: Boolean(row),
      onboardingError: false,
      firstOpeningDetected,
    };
  } catch {
    return null;
  }
}

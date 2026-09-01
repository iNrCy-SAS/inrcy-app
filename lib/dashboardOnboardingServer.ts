import "server-only";

import { cookies } from "next/headers";

import {
  DASHBOARD_ONBOARDING_SELECT,
  DASHBOARD_ONBOARDING_STATUSES,
  DASHBOARD_ONBOARDING_STEPS,
  DASHBOARD_ONBOARDING_VERSION,
  isDashboardOnboardingFirstOpening,
  normalizeDashboardOnboardingRow,
  shouldRunDashboardOnboarding,
  type DashboardOnboardingInitialState,
  type DashboardOnboardingRow,
  type DashboardOnboardingStatus,
  type DashboardOnboardingStep,
} from "@/lib/dashboardOnboarding";
import {
  DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE,
  matchesDashboardOnboardingLaunchProof,
} from "@/lib/dashboardOnboardingLaunchProof";
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
  if (current.status === "deferred" && params.status !== "deferred") {
    throw new Error("INRCY_ONBOARDING_ALREADY_ABANDONED");
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
    // Comparaison atomique avec l'état lu. Une réponse de transition arrivée
    // après « Passer » ou après la fin du parcours ne peut ainsi jamais
    // réécrire un état terminal en in_progress.
    .eq("status", current.status)
    .eq("current_step", current.currentStep)
    .select(DASHBOARD_ONBOARDING_SELECT)
    .maybeSingle();

  if (error) throw error;
  const saved = normalizeDashboardOnboardingRow(data);
  if (saved) return saved;

  const latest = await getDashboardOnboardingStateForAccount(params.accountId);
  if (!latest) throw new Error("INRCY_ONBOARDING_STATE_NOT_FOUND");
  if (
    latest.status === params.status &&
    latest.currentStep === params.currentStep
  ) {
    // Deux requêtes identiques peuvent terminer dans un ordre différent : le
    // résultat déjà persisté est alors idempotent et reste valide.
    return latest;
  }
  if (latest.status === "completed") {
    throw new Error("INRCY_ONBOARDING_ALREADY_COMPLETED");
  }
  if (latest.status === "deferred") {
    throw new Error("INRCY_ONBOARDING_ALREADY_ABANDONED");
  }
  throw new Error("INRCY_ONBOARDING_CONCURRENT_UPDATE");
}

async function terminalizeDashboardOnboardingRow(
  accountId: string,
  current: DashboardOnboardingRow | null,
): Promise<DashboardOnboardingRow> {
  if (current && current.accountId !== accountId) {
    throw new Error("INRCY_ONBOARDING_ACCOUNT_SCOPE_MISMATCH");
  }
  if (current?.status === "completed" || current?.status === "deferred") {
    return current;
  }

  const nowIso = new Date().toISOString();
  if (!current) {
    const { data, error } = await supabaseAdmin
      .from("inrcy_onboarding_states")
      .insert({
        account_id: accountId,
        version: DASHBOARD_ONBOARDING_VERSION,
        status: "deferred",
        current_step: "profile",
        started_at: nowIso,
        deferred_at: nowIso,
        completed_at: null,
      })
      .select(DASHBOARD_ONBOARDING_SELECT)
      .maybeSingle();

    const inserted = normalizeDashboardOnboardingRow(data);
    if (inserted) return inserted;

    // Un insert concurrent peut avoir gagné. Sa ligne est relue puis, si elle
    // est non terminale, immédiatement classée en fail-open ci-dessous.
    const latest = await getDashboardOnboardingStateForAccount(accountId);
    if (latest) return terminalizeDashboardOnboardingRow(accountId, latest);
    if (error) throw error;
    throw new Error("INRCY_ONBOARDING_TERMINAL_STATE_NOT_CREATED");
  }

  const { data, error } = await supabaseAdmin
    .from("inrcy_onboarding_states")
    .update({
      status: "deferred",
      started_at: current.startedAt || nowIso,
      deferred_at: current.deferredAt || nowIso,
      completed_at: null,
    })
    .eq("account_id", accountId)
    .eq("version", current.version)
    .in("status", ["pending", "in_progress"])
    .select(DASHBOARD_ONBOARDING_SELECT)
    .maybeSingle();

  if (error) throw error;
  const saved = normalizeDashboardOnboardingRow(data);
  if (saved) return saved;

  const latest = await getDashboardOnboardingStateForAccount(accountId);
  if (latest?.status === "completed" || latest?.status === "deferred") {
    return latest;
  }
  throw new Error("INRCY_ONBOARDING_TERMINAL_CONCURRENT_UPDATE");
}

export async function resolveDashboardOnboardingForDashboardAccess(
  accountId: string,
  launchProofCookieValue?: string | null,
) {
  const row = await getDashboardOnboardingStateForAccount(accountId);

  // Une ligne absente sur une ouverture dashboard n'est jamais une preuve de
  // création. La recréer en pending ferait réapparaître le parcours chez un
  // compte historique : elle est donc enregistrée directement en fail-open.
  if (!row) return terminalizeDashboardOnboardingRow(accountId, null);

  const hasMatchingCreationProof = matchesDashboardOnboardingLaunchProof(
    launchProofCookieValue,
    accountId,
  );
  if (hasMatchingCreationProof && shouldRunDashboardOnboarding(row)) {
    return row;
  }

  // Completed/deferred restent terminaux. Toute ligne non terminale rencontrée
  // sans preuve de la création en cours appartient à un parcours historique et
  // ne doit jamais rouvrir de modale.
  return terminalizeDashboardOnboardingRow(accountId, row);
}

export async function abandonDashboardOnboardingForAccount(accountId: string) {
  const current = await getDashboardOnboardingStateForAccount(accountId);
  return terminalizeDashboardOnboardingRow(accountId, current);
}

export async function getDashboardInitialOnboardingStateServer(): Promise<DashboardOnboardingInitialState | null> {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse || !activeUserId) {
    console.warn("[dashboard-onboarding] initial user scope unavailable", {
      status: errorResponse?.status ?? null,
      hasActiveAccount: Boolean(activeUserId),
    });
    return null;
  }

  try {
    const cookieStore = await cookies();
    let row = await resolveDashboardOnboardingForDashboardAccess(
      activeUserId,
      cookieStore.get(DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE)?.value,
    );
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
      onboardingAvailable: true,
      onboardingError: false,
      firstOpeningDetected,
    };
  } catch (error) {
    console.error("[dashboard-onboarding] initial server state failed", error);
    return {
      accountId: activeUserId,
      row: null,
      onboardingAvailable: false,
      onboardingError: true,
      firstOpeningDetected: false,
    };
  }
}

import { NextResponse } from "next/server";

import {
  DASHBOARD_ONBOARDING_STATUSES,
  DASHBOARD_ONBOARDING_STEPS,
  isDashboardOnboardingFirstOpening,
  type DashboardOnboardingStatus,
  type DashboardOnboardingStep,
} from "@/lib/dashboardOnboarding";
import {
  getDashboardOnboardingStateForAccount,
  saveDashboardOnboardingStateForAccount,
} from "@/lib/dashboardOnboardingServer";
import { requireUser } from "@/lib/requireUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET() {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  if (!activeUserId) {
    return json({ ok: false, code: "onboarding_account_missing" }, 401);
  }

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
    return json({
      ok: true,
      accountId: activeUserId,
      row,
      onboardingAvailable: Boolean(row),
      onboardingError: false,
      firstOpeningDetected,
    });
  } catch {
    return json(
      {
        ok: false,
        code: "onboarding_state_unavailable",
        error: "Le parcours de démarrage est temporairement indisponible.",
      },
      503,
    );
  }
}

export async function POST(request: Request) {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  if (!activeUserId) {
    return json({ ok: false, code: "onboarding_account_missing" }, 401);
  }

  const body = await request.json().catch(() => null);
  const expectedAccountId = String(body?.accountId || "").trim();
  const status = String(body?.status || "") as DashboardOnboardingStatus;
  const currentStep = String(body?.currentStep || "") as DashboardOnboardingStep;

  if (expectedAccountId !== activeUserId) {
    return json(
      {
        ok: false,
        code: "onboarding_account_changed",
        error: "L’établissement actif a changé. Rechargez le parcours.",
      },
      409,
    );
  }
  if (
    !DASHBOARD_ONBOARDING_STATUSES.includes(status) ||
    !DASHBOARD_ONBOARDING_STEPS.includes(currentStep)
  ) {
    return json(
      {
        ok: false,
        code: "onboarding_state_invalid",
        error: "L’étape du parcours est invalide.",
      },
      400,
    );
  }

  try {
    const row = await saveDashboardOnboardingStateForAccount({
      accountId: activeUserId,
      status,
      currentStep,
    });
    return json({ ok: true, accountId: activeUserId, row });
  } catch {
    return json(
      {
        ok: false,
        code: "onboarding_state_save_failed",
        error: "L’étape n’a pas pu être enregistrée.",
      },
      409,
    );
  }
}

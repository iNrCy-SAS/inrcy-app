export const DASHBOARD_ONBOARDING_VERSION = 1 as const;

export const DASHBOARD_ONBOARDING_SELECT =
  "account_id, version, status, current_step, started_at, completed_at, deferred_at, created_at, updated_at";

export const DASHBOARD_ONBOARDING_STATUSES = [
  "pending",
  "in_progress",
  "deferred",
  "completed",
] as const;

export const DASHBOARD_ONBOARDING_STEPS = [
  "profile",
  "activity",
  "ai",
  "completed",
] as const;

export type DashboardOnboardingStatus =
  (typeof DASHBOARD_ONBOARDING_STATUSES)[number];
export type DashboardOnboardingStep =
  (typeof DASHBOARD_ONBOARDING_STEPS)[number];


export type DashboardOnboardingPanel = "profil" | "activite" | "ia";

export function getDashboardOnboardingPanel(
  step: DashboardOnboardingStep | null,
): DashboardOnboardingPanel | null {
  if (step === "profile") return "profil";
  if (step === "activity") return "activite";
  if (step === "ai") return "ia";
  return null;
}

export function getDashboardOnboardingProgress(
  step: DashboardOnboardingStep | null,
) {
  if (step === "profile") return { current: 1, total: 3 } as const;
  if (step === "activity") return { current: 2, total: 3 } as const;
  if (step === "ai") return { current: 3, total: 3 } as const;
  return null;
}

export type DashboardOnboardingRow = {
  accountId: string;
  version: number;
  status: DashboardOnboardingStatus;
  currentStep: DashboardOnboardingStep;
  startedAt: string | null;
  completedAt: string | null;
  deferredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DashboardOnboardingInitialState = {
  accountId: string | null;
  row: DashboardOnboardingRow | null;
  onboardingAvailable: boolean;
  onboardingError: boolean;
  firstOpeningDetected: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOnboardingStatus(value: unknown): value is DashboardOnboardingStatus {
  return DASHBOARD_ONBOARDING_STATUSES.includes(
    value as DashboardOnboardingStatus,
  );
}

function isOnboardingStep(value: unknown): value is DashboardOnboardingStep {
  return DASHBOARD_ONBOARDING_STEPS.includes(value as DashboardOnboardingStep);
}

function normalizeNullableDate(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export function normalizeDashboardOnboardingRow(
  input: unknown,
): DashboardOnboardingRow | null {
  const source = Array.isArray(input) ? input[0] : input;
  if (!isRecord(source)) return null;

  const accountId = typeof source.account_id === "string" ? source.account_id : "";
  const version = Number(source.version);
  const status = source.status;
  const currentStep = source.current_step;

  if (
    !accountId ||
    !Number.isInteger(version) ||
    version < 1 ||
    !isOnboardingStatus(status) ||
    !isOnboardingStep(currentStep)
  ) {
    return null;
  }

  const completedStateIsConsistent =
    (status === "completed" && currentStep === "completed") ||
    (status !== "completed" && currentStep !== "completed");
  if (!completedStateIsConsistent) return null;

  return {
    accountId,
    version,
    status,
    currentStep,
    startedAt: normalizeNullableDate(source.started_at),
    completedAt: normalizeNullableDate(source.completed_at),
    deferredAt: normalizeNullableDate(source.deferred_at),
    createdAt: normalizeNullableDate(source.created_at),
    updatedAt: normalizeNullableDate(source.updated_at),
  };
}

export function shouldRunDashboardOnboarding(
  row: DashboardOnboardingRow | null,
) {
  return Boolean(
    row &&
      row.version === DASHBOARD_ONBOARDING_VERSION &&
      (row.status === "pending" || row.status === "in_progress"),
  );
}

export function isDashboardOnboardingFirstOpening(
  row: DashboardOnboardingRow | null,
) {
  return Boolean(
    row &&
      row.version === DASHBOARD_ONBOARDING_VERSION &&
      row.status === "pending" &&
      row.currentStep === "profile" &&
      !row.startedAt,
  );
}

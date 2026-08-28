"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import {
  DASHBOARD_ONBOARDING_VERSION,
  isDashboardOnboardingFirstOpening,
  normalizeDashboardOnboardingRow,
  shouldRunDashboardOnboarding,
  type DashboardOnboardingInitialState,
  type DashboardOnboardingRow,
  type DashboardOnboardingStatus,
  type DashboardOnboardingStep,
} from "@/lib/dashboardOnboarding";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

type OnboardingState = {
  accountId: string | null;
  row: DashboardOnboardingRow | null;
  onboardingReady: boolean;
  onboardingAvailable: boolean;
  onboardingError: boolean;
  firstOpeningDetected: boolean;
};

const INITIAL_ONBOARDING_STATE: OnboardingState = {
  accountId: null,
  row: null,
  onboardingReady: false,
  onboardingAvailable: false,
  onboardingError: false,
  firstOpeningDetected: false,
};

const ONBOARDING_CACHE_KEY = "inrcy_dashboard_onboarding_state_v1";

function readCachedOnboardingState(): OnboardingState | null {
  try {
    const raw = readAccountCacheValue(ONBOARDING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const row = normalizeDashboardOnboardingRow(parsed.row);
    if (!row) return null;

    return {
      accountId: row.accountId,
      row,
      onboardingReady: true,
      onboardingAvailable: true,
      onboardingError: false,
      firstOpeningDetected: Boolean(parsed.firstOpeningDetected),
    };
  } catch {
    return null;
  }
}

function cacheOnboardingState(state: OnboardingState) {
  if (!state.accountId || !state.row) return;
  try {
    writeAccountCacheValue(
      ONBOARDING_CACHE_KEY,
      JSON.stringify({
        row: {
          account_id: state.row.accountId,
          version: state.row.version,
          status: state.row.status,
          current_step: state.row.currentStep,
          started_at: state.row.startedAt,
          completed_at: state.row.completedAt,
          deferred_at: state.row.deferredAt,
          created_at: state.row.createdAt,
          updated_at: state.row.updatedAt,
        },
        firstOpeningDetected: state.firstOpeningDetected,
      }),
      state.accountId,
    );
  } catch {
    // Le cache est seulement une optimisation d'affichage.
  }
}

const ONBOARDING_API_URL = "/api/dashboard/onboarding-state";
const inFlightOnboardingLoads = new Map<
  string,
  Promise<DashboardOnboardingInitialState>
>();

async function loadOnboardingState(options?: { force?: boolean }) {
  const requestKey = "active-account";
  if (options?.force) inFlightOnboardingLoads.delete(requestKey);

  const existingRequest = inFlightOnboardingLoads.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const response = await fetch(ONBOARDING_API_URL, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error("ONBOARDING_LOAD_FAILED");
    const row = normalizeDashboardOnboardingRow(payload.row);
    return {
      accountId: String(payload.accountId || row?.accountId || "") || null,
      row,
      onboardingAvailable: Boolean(payload.onboardingAvailable && row),
      onboardingError: false,
      firstOpeningDetected: Boolean(payload.firstOpeningDetected),
    };
  })();

  inFlightOnboardingLoads.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (inFlightOnboardingLoads.get(requestKey) === request) {
      inFlightOnboardingLoads.delete(requestKey);
    }
  }
}

async function persistOnboardingRow(
  accountId: string,
  status: DashboardOnboardingStatus,
  currentStep: DashboardOnboardingStep,
) {
  const response = await fetch(ONBOARDING_API_URL, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId,
      status,
      currentStep,
      version: DASHBOARD_ONBOARDING_VERSION,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error("ONBOARDING_SAVE_FAILED");
  const row = normalizeDashboardOnboardingRow(payload.row);
  if (!row) throw new Error("INRCY_ONBOARDING_STATE_INVALID_RESPONSE");
  return row;
}

export function useDashboardOnboardingState(
  initialState?: DashboardOnboardingInitialState,
) {
  const [state, setState] = useState<OnboardingState>(() =>
    initialState
      ? {
          ...initialState,
          onboardingReady: true,
        }
      : readCachedOnboardingState() ?? INITIAL_ONBOARDING_STATE,
  );
  const requestSequenceRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const activeAccountIdRef = useRef<string | null>(initialState?.accountId ?? null);
  const hasServerInitialStateRef = useRef(Boolean(initialState));

  const refreshOnboarding = useCallback(
    async (options?: { force?: boolean }) => {
      const requestSequence = ++requestSequenceRef.current;
      try {
        const loaded = await loadOnboardingState(options);
        if (requestSequence !== requestSequenceRef.current) return null;
        const accountId = loaded.accountId;
        if (!accountId) throw new Error("ONBOARDING_ACCOUNT_MISSING");
        activeAccountIdRef.current = accountId;

        const row = loaded.row;
        const firstOpeningDetected =
          loaded.firstOpeningDetected || isDashboardOnboardingFirstOpening(row);

        if (requestSequence !== requestSequenceRef.current) return null;
        const nextState: OnboardingState = {
          accountId,
          row,
          onboardingReady: true,
          onboardingAvailable: Boolean(row),
          onboardingError: false,
          firstOpeningDetected,
        };
        setState(nextState);
        cacheOnboardingState(nextState);
        return row;
      } catch {
        if (requestSequence !== requestSequenceRef.current) return null;
        activeAccountIdRef.current = null;
        setState({
          accountId: null,
          row: null,
          onboardingReady: true,
          onboardingAvailable: false,
          onboardingError: true,
          firstOpeningDetected: false,
        });
        return null;
      }
    },
    [],
  );

  const saveOnboardingState = useCallback(
    async (
      status: DashboardOnboardingStatus,
      currentStep: DashboardOnboardingStep,
    ) => {
      const mutationSequence = ++mutationSequenceRef.current;
      const accountId = state.accountId ?? activeAccountIdRef.current;
      if (!accountId) return null;
      activeAccountIdRef.current = accountId;

      try {
        const row = await persistOnboardingRow(accountId, status, currentStep);
        if (mutationSequence !== mutationSequenceRef.current) return null;
        if (activeAccountIdRef.current !== accountId) return null;

        const nextState: OnboardingState = {
          accountId,
          row,
          onboardingReady: true,
          onboardingAvailable: true,
          onboardingError: false,
          firstOpeningDetected: state.firstOpeningDetected,
        };
        setState(nextState);
        cacheOnboardingState(nextState);
        return row;
      } catch {
        if (mutationSequence !== mutationSequenceRef.current) return null;
        if (activeAccountIdRef.current !== accountId) return null;
        setState((current) => ({ ...current, onboardingError: true }));
        return null;
      }
    },
    [state.accountId, state.firstOpeningDetected],
  );

  const setCurrentOnboardingStep = useCallback(
    (currentStep: Exclude<DashboardOnboardingStep, "completed">) =>
      saveOnboardingState("in_progress", currentStep),
    [saveOnboardingState],
  );

  const deferOnboarding = useCallback(() => {
    const currentStep = state.row?.currentStep;
    if (!currentStep || currentStep === "completed") return Promise.resolve(null);
    return saveOnboardingState("deferred", currentStep);
  }, [saveOnboardingState, state.row?.currentStep]);

  const resumeOnboarding = useCallback(() => {
    const currentStep = state.row?.currentStep;
    if (!currentStep || currentStep === "completed") return Promise.resolve(null);
    return saveOnboardingState("in_progress", currentStep);
  }, [saveOnboardingState, state.row?.currentStep]);

  const completeOnboarding = useCallback(
    () => saveOnboardingState("completed", "completed"),
    [saveOnboardingState],
  );

  useEffect(() => {
    if (hasServerInitialStateRef.current) {
      hasServerInitialStateRef.current = false;
    } else {
      void refreshOnboarding();
    }

    const handleActiveAccountChange = () => {
      requestSequenceRef.current += 1;
      mutationSequenceRef.current += 1;
      activeAccountIdRef.current = null;
      setState(readCachedOnboardingState() ?? INITIAL_ONBOARDING_STATE);
      void refreshOnboarding({ force: true });
    };

    window.addEventListener(
      ACTIVE_INRCY_ACCOUNT_EVENT,
      handleActiveAccountChange,
    );
    return () => {
      window.removeEventListener(
        ACTIVE_INRCY_ACCOUNT_EVENT,
        handleActiveAccountChange,
      );
    };
  }, [refreshOnboarding]);

  return {
    ...state,
    onboardingStatus: state.row?.status ?? null,
    onboardingCurrentStep: state.row?.currentStep ?? null,
    onboardingVersion: state.row?.version ?? null,
    shouldRunOnboarding: shouldRunDashboardOnboarding(state.row),
    isFirstOnboardingOpening:
      state.firstOpeningDetected || isDashboardOnboardingFirstOpening(state.row),
    refreshOnboarding,
    setCurrentOnboardingStep,
    deferOnboarding,
    resumeOnboarding,
    completeOnboarding,
  };
}

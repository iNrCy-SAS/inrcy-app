"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getActiveBrowserUserId,
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
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
  onboardingAbandoned: boolean;
  firstOpeningDetected: boolean;
};

const INITIAL_ONBOARDING_STATE: OnboardingState = {
  accountId: null,
  row: null,
  // La vérification de l'onboarding ne doit jamais verrouiller le dashboard.
  onboardingReady: true,
  onboardingAvailable: false,
  onboardingError: false,
  onboardingAbandoned: false,
  firstOpeningDetected: false,
};

const ONBOARDING_CACHE_KEY = "inrcy_dashboard_onboarding_state_v1";
const ONBOARDING_ABANDONED_KEY = "inrcy_dashboard_onboarding_abandoned_v1";

function hasAbandonedOnboarding(accountId = getActiveBrowserUserId()) {
  if (!accountId) return false;
  return readAccountCacheValue(ONBOARDING_ABANDONED_KEY, accountId) === "1";
}

function rememberAbandonedOnboarding(accountId: string | null) {
  if (!accountId) return;
  writeAccountCacheValue(ONBOARDING_ABANDONED_KEY, "1", accountId);
}

function stateFromServer(
  source: DashboardOnboardingInitialState,
): OnboardingState {
  const accountId = source.accountId ?? source.row?.accountId ?? null;
  const onboardingAbandoned = Boolean(
    source.row?.status !== "completed" &&
      ((source.onboardingError && !source.row) ||
        hasAbandonedOnboarding(accountId)),
  );

  return {
    ...source,
    accountId,
    onboardingReady: true,
    onboardingAbandoned,
    firstOpeningDetected: onboardingAbandoned
      ? false
      : source.firstOpeningDetected,
  };
}

function readCachedOnboardingState(): OnboardingState | null {
  try {
    const raw = readAccountCacheValue(ONBOARDING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const row = normalizeDashboardOnboardingRow(parsed.row);
    if (!row) return null;

    const onboardingAbandoned =
      row.status !== "completed" && hasAbandonedOnboarding(row.accountId);

    return {
      accountId: row.accountId,
      row,
      onboardingReady: true,
      onboardingAvailable: true,
      onboardingError: false,
      onboardingAbandoned,
      firstOpeningDetected: onboardingAbandoned
        ? false
        : Boolean(parsed.firstOpeningDetected),
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

// Garder une URL volontairement neutre : des extensions de confidentialité
// bloquent les routes contenant `onboarding` et, chez certains utilisateurs,
// même `setup-state` avec ERR_BLOCKED_BY_CLIENT.
const ONBOARDING_API_URL = "/api/dashboard/runtime-snapshot";
const ONBOARDING_RETRY_DELAYS_MS = [0, 350, 900] as const;
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
    let lastError: unknown = null;

    for (const delayMs of ONBOARDING_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }

      try {
        const response = await fetch(ONBOARDING_API_URL, {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error(`ONBOARDING_LOAD_FAILED_${response.status}`);
        }

        const row = normalizeDashboardOnboardingRow(payload.row);
        if (!row || !payload.onboardingAvailable) {
          throw new Error("ONBOARDING_LOAD_RETURNED_NO_STATE");
        }

        return {
          accountId: String(payload.accountId || row.accountId || "") || null,
          row,
          onboardingAvailable: true,
          onboardingError: false,
          firstOpeningDetected: Boolean(payload.firstOpeningDetected),
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("ONBOARDING_LOAD_FAILED");
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

async function persistAbandonedOnboarding(accountId: string) {
  const response = await fetch(ONBOARDING_API_URL, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "abandon_after_fail_open",
      accountId,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error("ONBOARDING_ABANDON_SAVE_FAILED");
  }
  const row = normalizeDashboardOnboardingRow(payload.row);
  if (!row) throw new Error("INRCY_ONBOARDING_STATE_INVALID_RESPONSE");
  return row;
}

export function useDashboardOnboardingState(
  initialState?: DashboardOnboardingInitialState,
) {
  const [state, setState] = useState<OnboardingState>(() =>
    initialState
      ? stateFromServer(initialState)
      : readCachedOnboardingState() ?? {
          ...INITIAL_ONBOARDING_STATE,
          accountId: getActiveBrowserUserId(),
          onboardingAbandoned: hasAbandonedOnboarding(),
        },
  );
  const requestSequenceRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const activeAccountIdRef = useRef<string | null>(
    initialState?.accountId ?? state.accountId ?? getActiveBrowserUserId(),
  );
  const abandonmentPendingAccountRef = useRef(
    Boolean(initialState?.onboardingError && !initialState.accountId),
  );

  const refreshOnboarding = useCallback(
    async (options?: { force?: boolean; abandonOnFailure?: boolean }) => {
      const requestSequence = ++requestSequenceRef.current;
      if (options?.force) {
        setState((current) => ({
          ...current,
          onboardingError: false,
        }));
      }
      try {
        const loaded = await loadOnboardingState(options);
        if (requestSequence !== requestSequenceRef.current) return null;
        const accountId = loaded.accountId;
        if (!accountId) throw new Error("ONBOARDING_ACCOUNT_MISSING");
        activeAccountIdRef.current = accountId;

        let row = loaded.row;
        if (!row) throw new Error("ONBOARDING_STATE_MISSING");
        const onboardingAbandoned =
          row.status !== "completed" && hasAbandonedOnboarding(accountId);
        if (onboardingAbandoned && row.status !== "deferred") {
          try {
            row = await persistAbandonedOnboarding(accountId);
          } catch {
            // Le marqueur local empêche toute réouverture du parcours même
            // si la réconciliation serveur doit attendre la prochaine visite.
          }
        }
        const firstOpeningDetected =
          !onboardingAbandoned &&
          (loaded.firstOpeningDetected || isDashboardOnboardingFirstOpening(row));

        if (requestSequence !== requestSequenceRef.current) return null;
        const nextState: OnboardingState = {
          accountId,
          row,
          onboardingReady: true,
          onboardingAvailable: Boolean(row),
          onboardingError: false,
          onboardingAbandoned,
          firstOpeningDetected,
        };
        setState(nextState);
        cacheOnboardingState(nextState);
        return row;
      } catch {
        if (requestSequence !== requestSequenceRef.current) return null;
        setState((current) => {
          if (!options?.abandonOnFailure && current.accountId && current.row) {
            activeAccountIdRef.current = current.accountId;
            return {
              ...current,
              onboardingReady: true,
              onboardingAvailable: true,
              onboardingError: true,
            };
          }

          const accountId =
            current.accountId ??
            activeAccountIdRef.current ??
            getActiveBrowserUserId();
          if (accountId) {
            rememberAbandonedOnboarding(accountId);
            abandonmentPendingAccountRef.current = false;
          } else {
            abandonmentPendingAccountRef.current = true;
          }
          activeAccountIdRef.current = accountId;
          return {
            ...current,
            accountId,
            onboardingReady: true,
            onboardingAvailable: Boolean(current.row),
            onboardingError: true,
            onboardingAbandoned: true,
            firstOpeningDetected: false,
          };
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
          onboardingAbandoned:
            status === "deferred"
              ? true
              : status === "completed"
                ? false
                : state.onboardingAbandoned,
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
    [
      state.accountId,
      state.firstOpeningDetected,
      state.onboardingAbandoned,
    ],
  );

  const setCurrentOnboardingStep = useCallback(
    (currentStep: Exclude<DashboardOnboardingStep, "completed">) =>
      saveOnboardingState("in_progress", currentStep),
    [saveOnboardingState],
  );

  const completeOnboarding = useCallback(
    () => saveOnboardingState("completed", "completed"),
    [saveOnboardingState],
  );

  const reconcileAbandonedOnboarding = useCallback(async (accountId: string) => {
    try {
      const row = await persistAbandonedOnboarding(accountId);
      if (activeAccountIdRef.current !== accountId) return;

      setState((current) => {
        if (current.accountId && current.accountId !== accountId) return current;
        const onboardingAbandoned = row.status !== "completed";
        const nextState: OnboardingState = {
          ...current,
          accountId,
          row,
          onboardingReady: true,
          onboardingAvailable: true,
          onboardingError: false,
          onboardingAbandoned,
          firstOpeningDetected: false,
        };
        cacheOnboardingState(nextState);
        return nextState;
      });
    } catch {
      // Le marqueur local est permanent et sera réconcilié lors d'une
      // prochaine ouverture, sans jamais réafficher le parcours.
    }
  }, []);

  useEffect(() => {
    // En React Strict Mode l'effet peut être monté deux fois. Tant que le
    // serveur a fourni un état canonique, on le garde comme source de vérité
    // et on ne lance pas un fetch client concurrent au second montage.
    if (initialState) {
      const preparedState = stateFromServer(initialState);
      cacheOnboardingState(preparedState);
      if (preparedState.onboardingAbandoned && preparedState.accountId) {
        rememberAbandonedOnboarding(preparedState.accountId);
        void reconcileAbandonedOnboarding(preparedState.accountId);
      }
    } else {
      const activeAccountId = getActiveBrowserUserId();
      if (activeAccountId && hasAbandonedOnboarding(activeAccountId)) {
        activeAccountIdRef.current = activeAccountId;
        void reconcileAbandonedOnboarding(activeAccountId);
      } else {
        void refreshOnboarding({ abandonOnFailure: true });
      }
    }

    const handleActiveAccountChange = (event: Event) => {
      const nextAccountId =
        event instanceof CustomEvent &&
        typeof event.detail?.activeUserId === "string"
          ? event.detail.activeUserId
          : null;

      if (nextAccountId && abandonmentPendingAccountRef.current) {
        rememberAbandonedOnboarding(nextAccountId);
        abandonmentPendingAccountRef.current = false;
      }

      // La synchronisation multicompte réémet parfois le compte que le serveur
      // a déjà résolu. Ce n'est pas un changement et l'état SSR ne doit pas
      // être détruit.
      if (nextAccountId && nextAccountId === activeAccountIdRef.current) return;

      requestSequenceRef.current += 1;
      mutationSequenceRef.current += 1;
      activeAccountIdRef.current = nextAccountId;
      const cachedState = readCachedOnboardingState();
      const onboardingAbandoned = hasAbandonedOnboarding(nextAccountId);
      setState(
        cachedState ?? {
          ...INITIAL_ONBOARDING_STATE,
          accountId: nextAccountId,
          onboardingAbandoned,
        },
      );

      if (nextAccountId && onboardingAbandoned) {
        void reconcileAbandonedOnboarding(nextAccountId);
      } else if (nextAccountId) {
        void refreshOnboarding({ force: true, abandonOnFailure: true });
      }
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
  }, [initialState, reconcileAbandonedOnboarding, refreshOnboarding]);

  return {
    ...state,
    onboardingStatus: state.row?.status ?? null,
    onboardingCurrentStep: state.row?.currentStep ?? null,
    onboardingVersion: state.row?.version ?? null,
    shouldRunOnboarding:
      !state.onboardingAbandoned && shouldRunDashboardOnboarding(state.row),
    isFirstOnboardingOpening:
      !state.onboardingAbandoned &&
      (state.firstOpeningDetected || isDashboardOnboardingFirstOpening(state.row)),
    setCurrentOnboardingStep,
    completeOnboarding,
  };
}

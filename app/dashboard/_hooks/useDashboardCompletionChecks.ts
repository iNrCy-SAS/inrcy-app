"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readAccountCacheValue, resolveActiveBrowserUserId, writeAccountCacheValue } from "@/lib/browserAccountCache";
import {
  DASHBOARD_ACTIVITY_COMPLETION_SELECT,
  DASHBOARD_PROFILE_COMPLETION_SELECT,
  evaluateDashboardRequiredSetupCompletion,
  type DashboardActivityCompletionField,
  type DashboardCompletionSection,
  type DashboardProfileCompletionField,
} from "@/lib/dashboardCompletion";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { createClient } from "@/lib/supabaseClient";
import { useDashboardRequiredSetupBypass } from "../_components/DashboardRequiredSetupBypassProvider";

type CompletionSnapshot = {
  accountId: string;
  profile: Record<string, unknown> | null;
  business: Record<string, unknown> | null;
};

export const DASHBOARD_COMPLETION_STATE_EVENT = "inrcy:dashboard-completion-state";

export type DashboardCompletionState = {
  accountId: string | null;
  profileIncomplete: boolean;
  activityIncomplete: boolean;
  profileCompleted: boolean;
  activityCompleted: boolean;
  requiredSetupCompleted: boolean;
  requiredSetupIncomplete: boolean;
  missingSections: DashboardCompletionSection[];
  profileMissingFields: DashboardProfileCompletionField[];
  activityMissingFields: DashboardActivityCompletionField[];
  profileCheckReady: boolean;
  activityCheckReady: boolean;
  completionCheckReady: boolean;
};

const INITIAL_COMPLETION_STATE: DashboardCompletionState = {
  accountId: null,
  profileIncomplete: false,
  activityIncomplete: false,
  profileCompleted: false,
  activityCompleted: false,
  requiredSetupCompleted: false,
  requiredSetupIncomplete: false,
  missingSections: [],
  profileMissingFields: [],
  activityMissingFields: [],
  profileCheckReady: false,
  activityCheckReady: false,
  completionCheckReady: false,
};

const BYPASSED_COMPLETION_STATE: DashboardCompletionState = {
  accountId: "e2e-required-setup-bypass",
  profileIncomplete: false,
  activityIncomplete: false,
  profileCompleted: true,
  activityCompleted: true,
  requiredSetupCompleted: true,
  requiredSetupIncomplete: false,
  missingSections: [],
  profileMissingFields: [],
  activityMissingFields: [],
  profileCheckReady: true,
  activityCheckReady: true,
  completionCheckReady: true,
};


// Bump this key whenever the required-field contract changes. Reusing an
// older ready state can redirect a newly valid account before revalidation.
const COMPLETION_CACHE_KEY = "inrcy_dashboard_completion_state_v2";

function readCachedCompletionState(): DashboardCompletionState | null {
  try {
    const raw = readAccountCacheValue(COMPLETION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardCompletionState;
    if (!parsed || typeof parsed !== "object" || !parsed.accountId) return null;
    if (!parsed.completionCheckReady || !parsed.profileCheckReady || !parsed.activityCheckReady) return null;
    return {
      ...INITIAL_COMPLETION_STATE,
      ...parsed,
      missingSections: Array.isArray(parsed.missingSections) ? parsed.missingSections : [],
      profileMissingFields: Array.isArray(parsed.profileMissingFields) ? parsed.profileMissingFields : [],
      activityMissingFields: Array.isArray(parsed.activityMissingFields) ? parsed.activityMissingFields : [],
      completionCheckReady: true,
      profileCheckReady: true,
      activityCheckReady: true,
    };
  } catch {
    return null;
  }
}

function writeCachedCompletionState(state: DashboardCompletionState) {
  if (!state.accountId || !state.completionCheckReady) return;
  try {
    writeAccountCacheValue(COMPLETION_CACHE_KEY, JSON.stringify(state), state.accountId);
  } catch {
    // Cache UX uniquement.
  }
}

// DashboardClient et ResponsiveBottomNav utilisent tous deux ce hook.
// Les requêtes sont mutualisées par établissement pour éviter les doublons,
// sans jamais partager le résultat d'un établissement avec un autre.
const inFlightCompletionChecks = new Map<string, Promise<CompletionSnapshot>>();
const completionRefreshGenerationByAccount = new Map<string, number>();

function beginCompletionRefresh(accountId: string, force: boolean) {
  const currentGeneration = completionRefreshGenerationByAccount.get(accountId) ?? 0;
  const generation = force || currentGeneration === 0
    ? currentGeneration + 1
    : currentGeneration;
  completionRefreshGenerationByAccount.set(accountId, generation);
  return generation;
}

function broadcastCompletionState(state: DashboardCompletionState) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DashboardCompletionState>(DASHBOARD_COMPLETION_STATE_EVENT, { detail: state }));
}

async function resolveCompletionAccountId() {
  const supabase = createClient();
  const { data: authData, error } = await supabase.auth.getUser();
  const user = authData?.user;
  if (error || !user) return null;

  return resolveActiveBrowserUserId(user.id);
}

async function loadCompletionSnapshot(
  accountId: string,
  options?: { force?: boolean },
): Promise<CompletionSnapshot> {
  if (options?.force) inFlightCompletionChecks.delete(accountId);

  const existingRequest = inFlightCompletionChecks.get(accountId);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const supabase = createClient();
    const [profileRes, businessRes] = await Promise.all([
      supabase
        .from("profiles")
        .select(DASHBOARD_PROFILE_COMPLETION_SELECT)
        .eq("user_id", accountId)
        .maybeSingle(),
      supabase
        .from("business_profiles")
        .select(DASHBOARD_ACTIVITY_COMPLETION_SELECT)
        .eq("user_id", accountId)
        .maybeSingle(),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (businessRes.error) throw businessRes.error;

    return {
      accountId,
      profile: (profileRes.data as Record<string, unknown> | null) ?? null,
      business: (businessRes.data as Record<string, unknown> | null) ?? null,
    };
  })();

  inFlightCompletionChecks.set(accountId, request);
  try {
    return await request;
  } finally {
    if (inFlightCompletionChecks.get(accountId) === request) {
      inFlightCompletionChecks.delete(accountId);
    }
  }
}

function buildReadyState(snapshot: CompletionSnapshot): DashboardCompletionState {
  const completion = evaluateDashboardRequiredSetupCompletion(
    snapshot.profile,
    snapshot.business,
  );

  return {
    accountId: snapshot.accountId,
    profileIncomplete: completion.profile.incomplete,
    activityIncomplete: completion.activity.incomplete,
    profileCompleted: completion.profile.completed,
    activityCompleted: completion.activity.completed,
    requiredSetupCompleted: completion.completed,
    requiredSetupIncomplete: completion.incomplete,
    missingSections: completion.missingSections,
    profileMissingFields: completion.profile.missingFields,
    activityMissingFields: completion.activity.missingFields,
    profileCheckReady: true,
    activityCheckReady: true,
    completionCheckReady: true,
  };
}

function buildFailedState(accountId: string | null): DashboardCompletionState {
  return {
    accountId,
    profileIncomplete: true,
    activityIncomplete: true,
    profileCompleted: false,
    activityCompleted: false,
    requiredSetupCompleted: false,
    requiredSetupIncomplete: true,
    missingSections: ["profile", "activity"],
    profileMissingFields: [],
    activityMissingFields: [],
    profileCheckReady: true,
    activityCheckReady: true,
    completionCheckReady: true,
  };
}

function markSectionCompleted(
  current: DashboardCompletionState,
  accountId: string,
  section: DashboardCompletionSection,
): DashboardCompletionState {
  const profileCompleted = section === "profile" ? true : current.profileCompleted;
  const activityCompleted = section === "activity" ? true : current.activityCompleted;
  const profileCheckReady = section === "profile" ? true : current.profileCheckReady;
  const activityCheckReady = section === "activity" ? true : current.activityCheckReady;
  const completionCheckReady = profileCheckReady && activityCheckReady;
  const missingSections: DashboardCompletionSection[] = [];
  if (!profileCompleted) missingSections.push("profile");
  if (!activityCompleted) missingSections.push("activity");

  return {
    ...current,
    accountId,
    profileIncomplete: !profileCompleted,
    activityIncomplete: !activityCompleted,
    profileCompleted,
    activityCompleted,
    requiredSetupCompleted:
      completionCheckReady && profileCompleted && activityCompleted,
    requiredSetupIncomplete:
      completionCheckReady && (!profileCompleted || !activityCompleted),
    missingSections,
    profileMissingFields:
      section === "profile" ? [] : current.profileMissingFields,
    activityMissingFields:
      section === "activity" ? [] : current.activityMissingFields,
    profileCheckReady,
    activityCheckReady,
    completionCheckReady,
  };
}

export function useDashboardCompletionChecks() {
  const bypassRequiredSetup = useDashboardRequiredSetupBypass();
  const [completionState, setCompletionState] = useState<DashboardCompletionState>(
    () => readCachedCompletionState() ?? INITIAL_COMPLETION_STATE,
  );
  const refreshSequenceRef = useRef(0);
  const activeAccountIdRef = useRef<string | null>(null);

  const refreshCompletion = useCallback(async (options?: { force?: boolean }) => {
    if (bypassRequiredSetup) return BYPASSED_COMPLETION_STATE;

    const refreshSequence = ++refreshSequenceRef.current;
    const accountId = await resolveCompletionAccountId();
    if (refreshSequence !== refreshSequenceRef.current) return null;
    activeAccountIdRef.current = accountId;

    if (!accountId) {
      const failedState = buildFailedState(null);
      setCompletionState(failedState);
      broadcastCompletionState(failedState);
      return failedState;
    }

    const accountRefreshGeneration = beginCompletionRefresh(accountId, Boolean(options?.force));

    try {
      const snapshot = await loadCompletionSnapshot(accountId, options);
      if (refreshSequence !== refreshSequenceRef.current) return null;
      if (completionRefreshGenerationByAccount.get(accountId) !== accountRefreshGeneration) return null;
      const readyState = buildReadyState(snapshot);
      setCompletionState(readyState);
      writeCachedCompletionState(readyState);
      broadcastCompletionState(readyState);
      return readyState;
    } catch {
      if (refreshSequence !== refreshSequenceRef.current) return null;
      if (completionRefreshGenerationByAccount.get(accountId) !== accountRefreshGeneration) return null;
      const cachedState = readCachedCompletionState();
      const failedState = cachedState?.accountId === accountId ? cachedState : buildFailedState(accountId);
      setCompletionState(failedState);
      broadcastCompletionState(failedState);
      return failedState;
    }
  }, [bypassRequiredSetup]);

  // Conservés pour les formulaires existants : les deux callbacks rafraîchissent
  // désormais le même état atomique du profil unifié.
  const checkProfile = useCallback(
    () => refreshCompletion({ force: true }),
    [refreshCompletion],
  );
  const checkActivity = useCallback(
    () => refreshCompletion({ force: true }),
    [refreshCompletion],
  );

  const markProfileCompleted = useCallback(() => {
    const accountId = completionState.accountId ?? activeAccountIdRef.current;
    if (!accountId) return;
    const nextState = markSectionCompleted(completionState, accountId, "profile");
    setCompletionState(nextState);
    writeCachedCompletionState(nextState);
    broadcastCompletionState(nextState);
  }, [completionState]);

  const markActivityCompleted = useCallback(() => {
    const accountId = completionState.accountId ?? activeAccountIdRef.current;
    if (!accountId) return;
    const nextState = markSectionCompleted(completionState, accountId, "activity");
    setCompletionState(nextState);
    writeCachedCompletionState(nextState);
    broadcastCompletionState(nextState);
  }, [completionState]);

  useEffect(() => {
    if (bypassRequiredSetup) return;

    void refreshCompletion();

    const handleCompletionState = (event: Event) => {
      const nextState = (event as CustomEvent<DashboardCompletionState>).detail;
      if (!nextState?.accountId || nextState.accountId !== activeAccountIdRef.current) return;
      setCompletionState(nextState);
    };

    const handleActiveAccountChange = () => {
      activeAccountIdRef.current = null;
      setCompletionState(readCachedCompletionState() ?? INITIAL_COMPLETION_STATE);
      void refreshCompletion({ force: true });
    };

    window.addEventListener(DASHBOARD_COMPLETION_STATE_EVENT, handleCompletionState);
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange);
    return () => {
      window.removeEventListener(DASHBOARD_COMPLETION_STATE_EVENT, handleCompletionState);
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange);
    };
  }, [bypassRequiredSetup, refreshCompletion]);

  const effectiveCompletionState = bypassRequiredSetup
    ? BYPASSED_COMPLETION_STATE
    : completionState;

  return {
    ...effectiveCompletionState,
    refreshCompletion,
    checkProfile,
    checkActivity,
    markProfileCompleted,
    markActivityCompleted,
  };
}

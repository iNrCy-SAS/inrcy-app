"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import {
  getCompanyCompletion,
  getCtaCompletion,
  getPersonalizationScore,
  getStrategyCompletion,
  type PersonalizationCompanyContext,
} from "@/lib/personalizationCompletion";
import type { AiChannelCtaDestinations } from "@/lib/aiChannelCtaPreferences";
import {
  getActiveBrowserUserId,
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import type { DashboardEdition } from "@/lib/dashboardEdition";

export const DASHBOARD_PREPARATION_SCORES_CACHE_KEY =
  "inrcy_dashboard_preparation_scores_v2";

type CachedPreparationScores = {
  companyPercent?: number;
  ctaPercent?: number;
  strategyPercent?: number;
  metaPilotEnabled?: boolean;
};

type PreparationScoreState = {
  accountId: string | null;
  companyPercent: number;
  ctaPercent: number;
  strategyPercent: number;
  companyKnown: boolean;
  ctaKnown: boolean;
  strategyKnown: boolean;
  metaPilotEnabled: boolean;
};

type MemoryCompletionPayload = {
  ok: boolean;
  accountId: string;
  memory: unknown;
  businessKnowledge: unknown;
  completionContext: PersonalizationCompanyContext;
};

function boundedPercent(value: unknown) {
  const numeric = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
}

function readCachedPreparationScores(accountId: string | null): CachedPreparationScores | null {
  if (!accountId) return null;
  try {
    const raw = readAccountCacheValue(DASHBOARD_PREPARATION_SCORES_CACHE_KEY, accountId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const source = parsed as Record<string, unknown>;
    const result: CachedPreparationScores = {};
    for (const key of ["companyPercent", "ctaPercent", "strategyPercent"] as const) {
      if (typeof source[key] === "number" && Number.isFinite(source[key])) {
        result[key] = boundedPercent(source[key]);
      }
    }
    if (typeof source.metaPilotEnabled === "boolean") result.metaPilotEnabled = source.metaPilotEnabled;
    return result;
  } catch {
    return null;
  }
}

function createPreparationScoreState(accountId: string | null, metaPilotEnabled: boolean): PreparationScoreState {
  const cached = readCachedPreparationScores(accountId);
  const ctaKnown = cached?.ctaPercent !== undefined && cached.metaPilotEnabled === metaPilotEnabled;
  return {
    accountId,
    companyPercent: cached?.companyPercent ?? 0,
    ctaPercent: ctaKnown ? cached.ctaPercent! : 0,
    strategyPercent: cached?.strategyPercent ?? 0,
    companyKnown: cached?.companyPercent !== undefined,
    ctaKnown,
    strategyKnown: cached?.strategyPercent !== undefined,
    metaPilotEnabled,
  };
}

function writeCachedPreparationScores(state: PreparationScoreState) {
  if (!state.accountId || (!state.companyKnown && !state.ctaKnown && !state.strategyKnown)) return;
  const cached: CachedPreparationScores = { metaPilotEnabled: state.metaPilotEnabled };
  if (state.companyKnown) cached.companyPercent = state.companyPercent;
  if (state.ctaKnown) cached.ctaPercent = state.ctaPercent;
  if (state.strategyKnown) cached.strategyPercent = state.strategyPercent;
  writeAccountCacheValue(DASHBOARD_PREPARATION_SCORES_CACHE_KEY, JSON.stringify(cached), state.accountId);
}

export function useDashboardPreparationScores({
  accountId,
}: {
  accountId: string | null;
  edition: DashboardEdition;
}) {
  const { metaPilotEnabled } = useDashboardViewerAccess();
  const currentAccountId = getActiveBrowserUserId() ?? accountId;
  const [scoreState, setScoreState] = useState<PreparationScoreState>(() =>
    createPreparationScoreState(currentAccountId, metaPilotEnabled),
  );
  const scoreStateRef = useRef(scoreState);
  const currentAccountIdRef = useRef(currentAccountId);
  const refreshSequenceRef = useRef(0);

  useEffect(() => {
    currentAccountIdRef.current = currentAccountId;
    refreshSequenceRef.current += 1;
    if (scoreStateRef.current.accountId === currentAccountId
      && scoreStateRef.current.metaPilotEnabled === metaPilotEnabled) return;
    const nextState = createPreparationScoreState(currentAccountId, metaPilotEnabled);
    scoreStateRef.current = nextState;
    setScoreState(nextState);
  }, [currentAccountId, metaPilotEnabled]);

  const refresh = useCallback(async () => {
    const refreshAccountId = getActiveBrowserUserId() ?? currentAccountId;
    const refreshSequence = ++refreshSequenceRef.current;
    if (!refreshAccountId) return;

    const [memoryResult, businessResult, destinationsResult] = await Promise.allSettled([
      fetch("/api/ai-memory", { cache: "no-store", credentials: "include" }).then(async response => {
        if (!response.ok) throw new Error("dna_score_unavailable");
        const payload = await response.json() as MemoryCompletionPayload;
        if (payload?.ok !== true || payload.accountId !== refreshAccountId
          || !payload.memory || !payload.businessKnowledge || !payload.completionContext) {
          throw new Error("dna_score_scope_unavailable");
        }
        return payload;
      }),
      createClient().from("business_profiles").select("user_id,ai_channel_ctas")
        .eq("user_id", refreshAccountId).maybeSingle(),
      fetch("/api/booster/cta-defaults", { cache: "no-store", credentials: "include" }).then(async response => {
        if (!response.ok) throw new Error("cta_destinations_unavailable");
        const payload = await response.json() as AiChannelCtaDestinations & { accountId?: string };
        if (!payload || payload.accountId !== refreshAccountId) throw new Error("cta_destinations_scope_unavailable");
        return payload;
      }),
    ]);

    if (refreshSequence !== refreshSequenceRef.current
      || currentAccountIdRef.current !== refreshAccountId
      || (getActiveBrowserUserId() ?? currentAccountId) !== refreshAccountId) return;

    const memorySucceeded = memoryResult.status === "fulfilled";
    const ctaSucceeded = businessResult.status === "fulfilled" && !businessResult.value.error
      && (!businessResult.value.data || businessResult.value.data.user_id === refreshAccountId)
      && destinationsResult.status === "fulfilled";
    if (!memorySucceeded && !ctaSucceeded) return;

    const baseline = scoreStateRef.current.accountId === refreshAccountId
      && scoreStateRef.current.metaPilotEnabled === metaPilotEnabled
      ? scoreStateRef.current : createPreparationScoreState(refreshAccountId, metaPilotEnabled);
    const nextState: PreparationScoreState = { ...baseline, accountId: refreshAccountId, metaPilotEnabled };
    if (memorySucceeded) {
      const payload = memoryResult.value;
      nextState.companyPercent = getCompanyCompletion(payload.memory, payload.businessKnowledge, payload.completionContext).percent;
      nextState.strategyPercent = getStrategyCompletion(payload.memory).percent;
      nextState.companyKnown = true;
      nextState.strategyKnown = true;
    }
    if (ctaSucceeded) {
      nextState.ctaPercent = getCtaCompletion(
        businessResult.value.data?.ai_channel_ctas, destinationsResult.value, metaPilotEnabled,
      ).percent;
      nextState.ctaKnown = true;
    }
    scoreStateRef.current = nextState;
    setScoreState(nextState);
    writeCachedPreparationScores(nextState);
  }, [currentAccountId, metaPilotEnabled]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const handleRefresh = () => void refresh();
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("inrcy:ai-configuration-updated", handleRefresh);
    window.addEventListener("inrcy:public-profile-data-saved", handleRefresh);
    return () => {
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("inrcy:ai-configuration-updated", handleRefresh);
      window.removeEventListener("inrcy:public-profile-data-saved", handleRefresh);
    };
  }, [refresh]);

  const visible = scoreState.accountId === currentAccountId && scoreState.metaPilotEnabled === metaPilotEnabled
    ? scoreState : createPreparationScoreState(currentAccountId, metaPilotEnabled);
  const companyScore = Math.round(visible.companyPercent);
  const ctaScore = Math.round(visible.ctaPercent);
  const strategyScore = Math.round(visible.strategyPercent);
  const communicationScore = Math.round(visible.ctaPercent * 0.6 + visible.strategyPercent * 0.4);
  const personalizationScore = getPersonalizationScore(visible.companyPercent, visible.ctaPercent, visible.strategyPercent);
  return {
    companyScore, ctaScore, strategyScore, communicationScore, personalizationScore,
    scoresKnown: visible.companyKnown && visible.ctaKnown && visible.strategyKnown,
    companyKnown: visible.companyKnown,
    ctaKnown: visible.ctaKnown,
    strategyKnown: visible.strategyKnown,
    // Compatibility for older callers: only the approved groups contribute.
    dnaScore: companyScore, aiScore: communicationScore,
    refreshPreparationScores: refresh,
  };
}

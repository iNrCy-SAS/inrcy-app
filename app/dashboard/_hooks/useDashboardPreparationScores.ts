"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { migrateBusinessProfileAiConfiguration } from "@/lib/aiConfigurationCompatibility";
import {
  getActiveBrowserUserId,
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import type { DashboardEdition } from "@/lib/dashboardEdition";

export const DASHBOARD_PREPARATION_SCORES_CACHE_KEY =
  "inrcy_dashboard_preparation_scores_v1";

type CachedPreparationScores = {
  dnaScore?: number;
  aiScore?: number;
};

type PreparationScoreState = {
  accountId: string | null;
  dnaScore: number;
  aiScore: number;
  dnaKnown: boolean;
  aiKnown: boolean;
};

const CORE_AI_FIELDS = [
  "preferredEngine",
  "tone",
  "textStyle",
  "originality",
  "webLength",
  "socialLength",
  "emojiLevel",
  "pronoun",
  "addressMode",
  "commercialLevel",
  "technicalityLevel",
  "humorLevel",
  "mainGoal",
  "preferredAngle",
  "preferredCta",
  "language",
] as const;

const ENRICHMENT_AI_FIELDS = [
  "likedExample",
  "likedExample2",
  "instructions",
  "forbiddenStyle",
] as const;

function clampScore(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function readCachedScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? clampScore(value)
    : undefined;
}

function readCachedPreparationScores(accountId: string | null): CachedPreparationScores | null {
  if (!accountId) return null;

  try {
    const raw = readAccountCacheValue(DASHBOARD_PREPARATION_SCORES_CACHE_KEY, accountId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;

    const dnaScore = readCachedScore(parsed.dnaScore);
    const aiScore = readCachedScore(parsed.aiScore);
    return dnaScore === undefined && aiScore === undefined
      ? null
      : { dnaScore, aiScore };
  } catch {
    return null;
  }
}

function createPreparationScoreState(accountId: string | null): PreparationScoreState {
  const cached = readCachedPreparationScores(accountId);
  return {
    accountId,
    dnaScore: cached?.dnaScore ?? 0,
    aiScore: cached?.aiScore ?? 0,
    dnaKnown: cached?.dnaScore !== undefined,
    aiKnown: cached?.aiScore !== undefined,
  };
}

function writeCachedPreparationScores(state: PreparationScoreState) {
  if (!state.accountId || (!state.dnaKnown && !state.aiKnown)) return;

  const cached: CachedPreparationScores = {};
  if (state.dnaKnown) cached.dnaScore = clampScore(state.dnaScore);
  if (state.aiKnown) cached.aiScore = clampScore(state.aiScore);
  writeAccountCacheValue(
    DASHBOARD_PREPARATION_SCORES_CACHE_KEY,
    JSON.stringify(cached),
    state.accountId,
  );
}

function getAiConfigurationScore(row: unknown, edition: DashboardEdition) {
  const migrated = migrateBusinessProfileAiConfiguration(row, edition, { useDbLanguage: true });
  const coreScore = CORE_AI_FIELDS.reduce((score, field) => (
    migrated[field] === undefined ? score : score + 5
  ), 0);
  const enrichmentScore = ENRICHMENT_AI_FIELDS.reduce((score, field) => (
    String(migrated[field] ?? "").trim() ? score + 5 : score
  ), 0);
  return clampScore(coreScore + enrichmentScore);
}

export function useDashboardPreparationScores({
  accountId,
  edition,
}: {
  accountId: string | null;
  edition: DashboardEdition;
}) {
  const currentAccountId = getActiveBrowserUserId() ?? accountId;
  const [scoreState, setScoreState] = useState<PreparationScoreState>(() => (
    createPreparationScoreState(currentAccountId)
  ));
  const scoreStateRef = useRef(scoreState);
  const currentAccountIdRef = useRef(currentAccountId);
  const refreshSequenceRef = useRef(0);

  useEffect(() => {
    currentAccountIdRef.current = currentAccountId;
    refreshSequenceRef.current += 1;
    if (scoreStateRef.current.accountId === currentAccountId) return;
    const nextState = createPreparationScoreState(currentAccountId);
    scoreStateRef.current = nextState;
    setScoreState(nextState);
  }, [currentAccountId]);

  const refresh = useCallback(async () => {
    const refreshAccountId = getActiveBrowserUserId() ?? accountId;
    const refreshSequence = ++refreshSequenceRef.current;
    if (!refreshAccountId) return;

    const [dnaResult, aiResult] = await Promise.allSettled([
      fetch("/api/ai-memory", { cache: "no-store", credentials: "include" }).then(async (response) => {
        if (!response.ok) throw new Error("dna_score_unavailable");
        return response.json() as Promise<{ completionScore?: number }>;
      }),
      createClient()
        .from("business_profiles")
        .select("*")
        .eq("user_id", refreshAccountId)
        .maybeSingle(),
    ]);

    if (
      refreshSequence !== refreshSequenceRef.current ||
      currentAccountIdRef.current !== refreshAccountId
    ) return;

    const dnaSucceeded = dnaResult.status === "fulfilled";
    const aiSucceeded = aiResult.status === "fulfilled" && !aiResult.value.error;
    if (!dnaSucceeded && !aiSucceeded) return;

    const baseline = scoreStateRef.current.accountId === refreshAccountId
      ? scoreStateRef.current
      : createPreparationScoreState(refreshAccountId);
    const nextState: PreparationScoreState = {
      accountId: refreshAccountId,
      dnaScore: dnaSucceeded
        ? clampScore(dnaResult.value.completionScore)
        : baseline.dnaScore,
      aiScore: aiSucceeded
        ? getAiConfigurationScore(aiResult.value.data, edition)
        : baseline.aiScore,
      dnaKnown: dnaSucceeded || baseline.dnaKnown,
      aiKnown: aiSucceeded || baseline.aiKnown,
    };

    scoreStateRef.current = nextState;
    setScoreState(nextState);
    writeCachedPreparationScores(nextState);
  }, [accountId, edition]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleRefresh = () => void refresh();
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("inrcy:ai-configuration-updated", handleRefresh);
    return () => {
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("inrcy:ai-configuration-updated", handleRefresh);
    };
  }, [refresh]);

  const visibleScoreState = scoreState.accountId === currentAccountId
    ? scoreState
    : createPreparationScoreState(currentAccountId);

  return {
    dnaScore: visibleScoreState.dnaScore,
    aiScore: visibleScoreState.aiScore,
    refreshPreparationScores: refresh,
  };
}

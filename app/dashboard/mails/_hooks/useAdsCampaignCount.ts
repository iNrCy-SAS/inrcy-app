"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

type CountState = { accountId: string; count: number | null; error: string };

export function useAdsCampaignCount(enabled: boolean, accountId: string) {
  const i18nT = useTranslations("mails");
  const [state, setState] = useState<CountState>({ accountId: "", count: null, error: "" });
  const requestRef = useRef<AbortController | null>(null);
  const fetchedAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch("/api/ads/campaigns?countsOnly=1", {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null) as { total?: unknown } | null;
      if (!response.ok || typeof result?.total !== "number" || !Number.isInteger(result.total) || result.total < 0) {
        throw new Error(i18nT("compteur_ads_indisponible_ouvrez_ads_pour_25e3cda6"));
      }
      if (controller.signal.aborted) return;
      fetchedAtRef.current = Date.now();
      setState({ accountId, count: result.total, error: "" });
    } catch {
      if (!controller.signal.aborted) {
        setState({ accountId, count: null, error: i18nT("compteur_ads_indisponible_ouvrez_ads_pour_25e3cda6") });
      }
    }
  }, [enabled, accountId, i18nT]);

  useEffect(() => {
    fetchedAtRef.current = 0;
    void refresh();
    const onFocus = () => {
      if (Date.now() - fetchedAtRef.current >= 30_000) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      requestRef.current?.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const current = enabled && state.accountId === accountId;
  return {
    count: current ? state.count : null,
    error: current ? state.error : "",
    refresh,
  };
}

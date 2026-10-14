"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CountState = { accountId: string; count: number | null; error: string };

export function useAdsCampaignCount(enabled: boolean, accountId: string) {
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
        throw new Error("Compteur ADS indisponible. Ouvrez ADS pour réessayer.");
      }
      if (controller.signal.aborted) return;
      fetchedAtRef.current = Date.now();
      setState({ accountId, count: result.total, error: "" });
    } catch {
      if (!controller.signal.aborted) {
        setState({ accountId, count: null, error: "Compteur ADS indisponible. Ouvrez ADS pour réessayer." });
      }
    }
  }, [enabled, accountId]);

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

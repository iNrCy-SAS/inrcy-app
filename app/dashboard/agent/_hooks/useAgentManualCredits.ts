"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InrAgentManualCreditAvailability } from "@/lib/inrAgentManualCreditPolicy";

/** Refresh on return, after an action/settings change, and while the tab is visible. */
export function useAgentManualCredits(refreshKey: string) {
  const [availability,setAvailability] = useState<InrAgentManualCreditAvailability | null>(null);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    let value: InrAgentManualCreditAvailability = {ready:false,allowed:false,unlimited:false,remaining:null,required:0};
    try {
      const response = await fetch("/api/agent/settings",{cache:"no-store"});
      const payload = await response.json();
      const candidate = payload?.manualPublishCredits;
      if (response.ok && typeof candidate?.allowed === "boolean" && typeof candidate?.ready === "boolean") value = candidate;
    } catch { /* Keep the manual button unavailable until the balance is verified. */ }
    if (version === requestVersion.current) setAvailability(value);
    return value;
  },[]);
  useEffect(() => {
    setAvailability(null);
    void refresh();
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onFocus);
    const interval = window.setInterval(onFocus,60_000);
    return () => {
      requestVersion.current++;
      window.removeEventListener("focus",onFocus);
      document.removeEventListener("visibilitychange",onFocus);
      window.clearInterval(interval);
    };
  },[refresh,refreshKey]);
  return {availability,refresh};
}

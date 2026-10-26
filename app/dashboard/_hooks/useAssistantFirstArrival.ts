"use client";

import { useEffect, useRef } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { BROWSER_SIGN_OUT_START_EVENT, isBrowserSignOutInProgress } from "@/lib/browserSignOutState";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

type WelcomeClaim = { accountId: string; show: boolean };
// Strict Mode mounts subscribe to the same atomic server claim. Cancelling an
// effect must not discard the only successful first-arrival response.
const inFlight = new Map<string, Promise<WelcomeClaim | null>>();

function claimFirstArrival(actorUserId: string, accountId: string): Promise<WelcomeClaim | null> {
  const key = `${actorUserId}:${accountId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const request = fetch("/api/dashboard/setup-intro", {
    method: "POST", credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }),
    signal: AbortSignal.timeout(15_000),
  }).then(async response => {
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return null;
    const claim = value as Partial<WelcomeClaim>;
    return claim.accountId === accountId && typeof claim.show === "boolean" ? { accountId, show: claim.show } : null;
  }).catch(() => null).finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}

/** Reuse the account's durable onboarding flag; no local first-visit guess or AI request. */
export function useAssistantFirstArrival({ actorUserId, accountId, enabled, onWelcome }: {
  actorUserId: string; accountId: string; enabled: boolean; onWelcome: () => void;
}) {
  const welcomedScope = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !actorUserId || !accountId) return;
    let cancelled = false;
    let sequence = 0;
    const scope = `${actorUserId}:${accountId}`;
    const check = async () => {
      if (cancelled || welcomedScope.current === scope || isBrowserSignOutInProgress() || getActiveBrowserUserId() !== accountId) return;
      const current = ++sequence;
      const claim = await claimFirstArrival(actorUserId, accountId);
      if (cancelled || sequence !== current || welcomedScope.current === scope || !claim?.show || isBrowserSignOutInProgress() || getActiveBrowserUserId() !== accountId) return;
      welcomedScope.current = scope;
      onWelcome();
    };
    const cancel = () => { sequence++; };
    const accountChanged = () => { cancel(); void check(); };
    window.addEventListener(BROWSER_SIGN_OUT_START_EVENT, cancel);
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, accountChanged);
    void check();
    return () => {
      cancelled = true; cancel();
      window.removeEventListener(BROWSER_SIGN_OUT_START_EVENT, cancel);
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, accountChanged);
    };
  }, [actorUserId, accountId, enabled, onWelcome]);
}

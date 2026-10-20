"use client";

import { useEffect, useRef, useState } from "react";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { quoteAiMediaCredits } from "@/lib/aiMediaCreditsPricing";
import type { MediaGenerationQuota, MediaGenerationRequest } from "./useMediaGeneration";

export type MediaCreditQuoteInput = Pick<MediaGenerationRequest,
  "kind" | "operation" | "creationMode" | "spokenScript" | "withSubtitles" | "videoEngine" | "imageEngine" | "format" | "durationSeconds" | "sceneMode" | "videoResolution" | "withNarration" | "teamVideoSpeechMode" | "identityMode" | "inputMode"
> & { inspirationImagesCount: number; hasProvidedCharacterVoice?: boolean };
export type ConfirmedMediaCreditQuote = {
  totalCredits: number;
  tariffVersion: string;
  quoteId: string;
  modelLabel: string;
  engine: string;
  durationSeconds?: number | null;
  resolution?: string | null;
  breakdown: readonly { key: string; label: string; credits: number }[];
};

/** A changed parameter or account immediately makes the previous quote unusable. */
export default function useMediaCreditQuote(input: MediaCreditQuoteInput, quota: MediaGenerationQuota | null, eligible = true) {
  const [accountEpoch, setAccountEpoch] = useState(0);
  const [scopeInvalidated, setScopeInvalidated] = useState(false);
  const key = JSON.stringify({ accountId: quota?.accountId, accountEpoch, eligible, availableCredits: quota?.credits.remaining, reservedCredits: quota?.credits.reserved, ...input });
  const [state, setState] = useState<{ key: string; quote: ConfirmedMediaCreditQuote | null; error: string; loading: boolean; remaining?: number | null }>({ key: "", quote: null, error: "", loading: false });
  const [retryEpoch, setRetryEpoch] = useState(0);
  const previousQuota = useRef(quota);
  useEffect(() => {
    if (previousQuota.current !== quota) {
      previousQuota.current = quota;
      setScopeInvalidated(false);
    }
  }, [quota]);
  useEffect(() => {
    const changed = () => { setScopeInvalidated(true); setAccountEpoch((value) => value + 1); };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed);
    return () => window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, changed);
  }, [quota?.accountId]);
  useEffect(() => {
    if (!eligible) { setState({ key, quote: null, error: "", loading: false }); return; }
    if (!quota?.accountId || !quota.creditsReady || scopeInvalidated) return;
    const controller = new AbortController();
    setState({ key, quote: null, error: "", loading: true });
    const timer = window.setTimeout(() => {
      void fetch("/api/media-generation/quote", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(input),
      }).then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.quote || typeof data.quote.totalCredits !== "number" || !data.quote.quoteId) {
          throw new Error(data?.userMessage || data?.message || data?.error || "");
        }
        if (!controller.signal.aborted) setState({ key, quote: data.quote, error: "", loading: false, remaining: typeof data.credits?.remaining === "number" ? data.credits.remaining : undefined });
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, quote: null, error: error instanceof Error ? error.message : "", loading: false });
      });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  // input is represented by its serialized key, so referential changes do not refetch.
  }, [key, quota?.creditsReady, scopeInvalidated, retryEpoch, eligible]);
  let estimate: ReturnType<typeof quoteAiMediaCredits> | null = null;
  try { if (eligible) estimate = quoteAiMediaCredits(input); } catch { /* The confirmed quote reports unsupported settings. */ }
  const matching = eligible && state.key === key && !scopeInvalidated && quota?.creditsReady === true;
  const quote = matching ? state.quote : null;
  const remaining = quota?.unlimited ? null : matching && state.remaining !== undefined ? state.remaining : quota?.credits.remaining ?? null;
  const insufficient = remaining !== null && remaining < (quote?.totalCredits ?? estimate?.totalCredits ?? 0);
  return {
    quote, estimate,
    loading: eligible && Boolean(quota?.creditsReady) && (!matching || state.loading),
    error: matching ? state.error : "",
    ready: Boolean(quota?.creditsReady && quote), insufficient,
    remainingAfter: remaining === null ? null : Math.max(0, remaining - (quote?.totalCredits ?? estimate?.totalCredits ?? 0)),
    retry: () => setRetryEpoch((value) => value + 1),
    authorization: quote ? { expectedCredits: quote.totalCredits, creditTariffVersion: quote.tariffVersion, creditQuoteId: quote.quoteId } : {},
  };
}

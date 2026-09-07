"use client";

import { useEffect } from "react";

const VISITOR_STORAGE_KEY = "inrcy.inrsearch.visitor";

type Props = {
  slug: string;
};

function getVisitorId() {
  try {
    const existing = window.sessionStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing) return existing;
    const next = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    window.sessionStorage.setItem(VISITOR_STORAGE_KEY, next);
    return next;
  } catch {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function privacySafeUrl(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (!/^https?:$/.test(url.protocol)) return null;
    return `${url.origin}${url.pathname}`.slice(0, 700);
  } catch {
    return null;
  }
}

function detectSource() {
  const params = new URLSearchParams(window.location.search);
  const explicit = String(params.get("utm_source") || params.get("source") || "").toLowerCase();
  const referrer = document.referrer.toLowerCase();
  const haystack = `${explicit} ${referrer}`;

  if (/chatgpt|openai/.test(haystack)) return "chatgpt";
  if (/perplexity/.test(haystack)) return "perplexity";
  if (/gemini|bard\.google/.test(haystack)) return "gemini";
  if (/copilot|bing\.com\/chat/.test(haystack)) return "copilot";
  if (/google\./.test(haystack)) return "google";
  if (/bing\./.test(haystack)) return "bing";
  if (/facebook|instagram|linkedin|x\.com|twitter\.com|tiktok|youtube|pinterest/.test(haystack)) return "social";
  if (!document.referrer && !explicit) return "direct";
  return "other";
}

function sendEvent(slug: string, payload: Record<string, unknown>) {
  const body = JSON.stringify({
    slug,
    visitorId: getVisitorId(),
    source: detectSource(),
    referrer: privacySafeUrl(document.referrer),
    pathname: window.location.pathname,
    ...payload,
  });

  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon("/api/inr-search/track", new Blob([body], { type: "application/json" }));
    if (sent) return;
  }

  void fetch("/api/inr-search/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
}

export default function InrSearchAnalyticsClient({ slug }: Props) {
  useEffect(() => {
    sendEvent(slug, { eventType: "page_view" });

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-inrsearch-action]")
        : null;
      if (!target) return;
      const rawTarget = target.dataset.inrsearchTarget || (target instanceof HTMLAnchorElement ? target.href : null);
      sendEvent(slug, {
        eventType: "action_click",
        actionKey: target.dataset.inrsearchAction || "other",
        targetUrl: privacySafeUrl(rawTarget),
      });
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [slug]);

  return null;
}

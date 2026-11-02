"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { subscribeInrAssistantRefresh, type InrAssistantRefreshContext, type InrAssistantRefreshTopic } from "@/lib/inrAssistantRefresh";

export function useInrAssistantRefresh(options: { topics: readonly InrAssistantRefreshTopic[]; accountId?: string | null; scopeKey?: string; blocked: boolean; refresh: (context: InrAssistantRefreshContext) => Promise<boolean> }) {
  const latest = useRef(options);
  const revision = useRef(0);
  useLayoutEffect(() => {
    if (latest.current.blocked !== options.blocked || latest.current.accountId !== options.accountId || latest.current.scopeKey !== options.scopeKey) revision.current++;
    latest.current = options;
  }, [options]);
  const subscription = useRef<ReturnType<typeof subscribeInrAssistantRefresh> | null>(null);
  const topicsKey = options.topics.join(",");
  useEffect(() => {
    const current = subscribeInrAssistantRefresh({ topics: topicsKey.split(",") as InrAssistantRefreshTopic[], getAccountId: () => latest.current.accountId ?? getActiveBrowserUserId(), getRevision: () => revision.current, isBlocked: () => latest.current.blocked, refresh: context => latest.current.refresh(context) });
    subscription.current = current;
    return () => { current.dispose(); if (subscription.current === current) subscription.current = null; };
  }, [topicsKey]);
  useEffect(() => { void subscription.current?.flush(); }, [options.blocked, options.accountId, options.scopeKey]);
}

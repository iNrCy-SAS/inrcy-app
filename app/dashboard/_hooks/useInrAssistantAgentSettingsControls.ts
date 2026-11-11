"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";
import type { InrAssistantSettingsAgent } from "@/lib/inrAssistantAgentSettingsUi";

export function useInrAssistantAgentSettingsControls(options: {
  enabled: boolean; agent: InrAssistantSettingsAgent | null; open: boolean; busy: boolean; stateKey: string;
  request(open: boolean, stillCurrent: () => boolean): Promise<void>;
}) {
  const pathname = usePathname(), { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const expectedPath = options.agent === "publish" ? "/dashboard/agent/publications" : "/dashboard/agent/stats";
  const enabled = options.enabled && options.agent !== null && pathname === expectedPath;
  const key = JSON.stringify([actorUserId, activeAccountId, pathname, enabled, options.agent, options.open, options.busy, options.stateKey]);
  const token = useMemo(() => ({ key, revision: crypto.randomUUID() }), [key]);
  const current = useRef(token), alive = useRef(false);
  useLayoutEffect(() => { current.current = token; }, [token]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ready = (valid: () => boolean) => {
    const canContinue = () => valid() && alive.current && current.current === token;
    if (!enabled || options.busy || !canContinue()) throw new Error("agent_settings_stale");
    return canContinue;
  };
  const state = { agent: options.agent, open: options.open };
  const matches = (value: unknown, open: boolean) => value !== null && typeof value === "object"
    && "agent" in value && value.agent === options.agent && "open" in value && value.open === open;
  useInrAssistantLocalInterface("agent_settings", state, options.open
    ? { close: { invoke: async (_value, valid) => options.request(false, ready(valid)), matches: value => matches(value, false) } }
    : { open: { invoke: async (_value, valid) => options.request(true, ready(valid)), matches: value => matches(value, true) } }, enabled, options.busy, options.open ? 1 : 0);
  useInrAssistantScreen(enabled && options.open && options.agent ? {
    selection: { kind: options.agent === "publish" ? "publication" : "stats", id: `agent_${options.agent}` },
    revision: token.revision, agentSettings: options.agent,
  } : null);
}

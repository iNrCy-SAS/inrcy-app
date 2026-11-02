"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantUiCommand } from "@/lib/inrAssistantUiCommands";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";

type Command = Extract<InrAssistantUiCommand, { command: "configure_ads_draft" | "save_ads_draft" }>;
type Options = { snapshot: unknown; mounted: boolean; enabled: boolean; channel: string; step: string; pendingChanges: boolean;
  apply: (command: Command, isCurrent: () => boolean) => Promise<boolean> | boolean;
  isApplied: (command: Command) => boolean;
};
/** An editor identity survives first save and an explicitly confirmed channel
 * reset. Business IDs remain in the native persistence result, not in UI ACKs. */
export function useInrAssistantAdsCommands(options: Options) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_"), pathname = usePathname();
  const register = useContext(DashboardAssistantCommandContext);
  const signature = JSON.stringify(options.snapshot), [version, setVersion] = useState({ signature, value: 0 });
  if (signature !== version.signature) setVersion({ signature, value: version.value + 1 });
  const revision = `ads_${instance}_${version.value}`, id = `ads_${instance}`;
  const current = useRef({ options, revision, pathname });
  const pending = useRef<{ ready: boolean; command: Command; scopeCurrent: () => boolean; finish: (ok: boolean) => void } | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    current.current = { options, revision, pathname };
    const waiting = pending.current;
    if (waiting?.ready && (!waiting.scopeCurrent() || options.isApplied(waiting.command))) waiting.finish(waiting.scopeCurrent());
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.finish(false); }; }, []);
  const active = options.mounted && pathname === "/dashboard/ads";
  useInrAssistantScreen(active ? { selection: { kind: "campaign", id }, revision, channel: options.channel, step: options.step,
    pendingChanges: options.pendingChanges, availableCommands: options.enabled ? ["configure_ads_draft", "save_ads_draft"] : [] } : null);
  useEffect(() => {
    if (!active) return;
    const run = async (stillCurrent: () => boolean, incoming: InrAssistantUiCommand, scopeCurrent: () => boolean) => {
      if (incoming.command !== "configure_ads_draft" && incoming.command !== "save_ads_draft") return false;
      const state = current.current;
      if (pending.current || !stillCurrent() || !state.options.enabled || state.revision !== incoming.revision) return false;
      return new Promise<boolean>(resolve => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let finished = false;
        const finish = (ok: boolean) => { if (finished) return; finished = true; clearTimeout(timer); if (pending.current === waiting) pending.current = null; resolve(ok); };
        const waiting = { ready: false, command: incoming, scopeCurrent, finish };
        pending.current = waiting;
        const isCurrent = () => mounted.current && scopeCurrent() && current.current.revision === state.revision
          && (incoming.command === "save_ads_draft" || current.current.options.enabled);
        void Promise.resolve().then(() => isCurrent() && state.options.apply(incoming, isCurrent)).then(ok => {
          if (!ok || !mounted.current || !scopeCurrent()) { finish(false); return; }
          if (current.current.options.isApplied(incoming)) { finish(true); return; }
          waiting.ready = true;
          timer = setTimeout(() => finish(false), 5_000);
        }).catch(() => finish(false));
      });
    };
    const getCommittedScreen = () => ({ pathname: current.current.pathname, selection: { kind: "campaign" as const, id }, revision: current.current.revision });
    register(`${instance}_configure`, { command: "configure_ads_draft", selection: { kind: "campaign", id }, revision, patch: {}, pathname, run, ...{ getCommittedScreen } });
    register(`${instance}_save`, { command: "save_ads_draft", selection: { kind: "campaign", id }, revision, pathname, run, ...{ getCommittedScreen } });
    return () => { register(`${instance}_configure`, null); register(`${instance}_save`, null); };
  }, [active, id, instance, pathname, register, revision]);
}

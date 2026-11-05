"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { parseInrAssistantStatsUiCommand, type InrAssistantStatsViewPatch } from "@/lib/inrAssistantStatsUiCommands";
import type { InrAssistantUiCommand } from "@/lib/inrAssistantUiCommands";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";

export function useInrAssistantStatsCommands(options: { accountId: string; snapshot: unknown; apply: (patch: InrAssistantStatsViewPatch) => boolean; isApplied: (patch: InrAssistantStatsViewPatch) => boolean }) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_"), pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const signature = JSON.stringify([options.accountId, options.snapshot]);
  const [version, setVersion] = useState({ signature, revision: 0 });
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const revision = `stats_${instance}_${version.revision}`, enabled = pathname === "/dashboard/stats" && !!options.accountId;
  const current = useRef({ options, revision });
  const pending = useRef<{ patch: InrAssistantStatsViewPatch; scopeCurrent: () => boolean; finish: (ok: boolean) => void } | null>(null);
  useLayoutEffect(() => {
    current.current = { options, revision };
    const waiting = pending.current;
    if (waiting) waiting.finish(waiting.scopeCurrent() && options.isApplied(waiting.patch));
  });
  useInrAssistantScreen(enabled ? { selection: { kind: "stats", id: "stats" }, revision, availableCommands: ["configure_stats_view"] } : null);
  useEffect(() => () => { pending.current?.finish(false); }, []);
  useEffect(() => {
    if (!enabled) return;
    register(instance, { command: "configure_stats_view", selection: { kind: "stats", id: "stats" }, revision, patch: {}, pathname,
      getCommittedScreen: () => ({ pathname, selection: { kind: "stats", id: "stats" }, revision: current.current.revision }),
      run: async (stillCurrent: () => boolean, incoming: InrAssistantUiCommand, scopeCurrent: () => boolean) => {
        const command = parseInrAssistantStatsUiCommand(incoming), state = current.current;
        if (!command || pending.current || !stillCurrent() || !scopeCurrent() || state.revision !== command.revision) return false;
        if (state.options.isApplied(command.patch)) return true;
        return new Promise<boolean>(resolve => {
          const finish = (ok: boolean) => { clearTimeout(timer); pending.current = null; resolve(ok); };
          const timer = setTimeout(() => finish(false), 5_000);
          pending.current = { patch: command.patch, scopeCurrent, finish };
          try { if (!state.options.apply(command.patch)) finish(false); } catch { finish(false); }
        });
      } });
    return () => register(instance, null);
  }, [enabled, instance, pathname, register, revision]);
}

"use client";

import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantNativeCommand } from "@/lib/inrAssistantUiCommands";
import type { InrAssistantClientScreen } from "@/lib/inrAssistantClientContext";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";

type NativeDraftOptions = {
  command: InrAssistantNativeCommand["command"];
  kind: "campaign" | "media";
  id?: string | null;
  snapshot: unknown;
  enabled: boolean;
  channel?: string;
  step?: string;
  pendingChanges: boolean;
  apply: (command: InrAssistantNativeCommand) => boolean;
  isApplied: (command: InrAssistantNativeCommand) => boolean;
};

/** Free, local form changes only. The server binds the command to the committed
 * form revision; acknowledgement waits for the native state to commit. */
export function useInrAssistantNativeDraft(options: NativeDraftOptions) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const pathname = usePathname();
  const register = useContext(DashboardAssistantCommandContext);
  const enabled = options.enabled && pathname === (options.command === "configure_ads_draft" ? "/dashboard/ads" : "/dashboard/generer-media");
  const signature = JSON.stringify(options.snapshot);
  const [version, setVersion] = useState({ signature, revision: 0 });
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const id = options.id || `draft_${instance}`;
  const revision = `draft_${instance}_${version.revision}`;
  const current = useRef({ options, revision });
  const pending = useRef<{ command: InrAssistantNativeCommand; scopeCurrent: () => boolean; finish: (ok: boolean) => void } | null>(null);
  useLayoutEffect(() => {
    current.current = { options, revision };
    const waiting = pending.current;
    if (waiting) waiting.finish(waiting.scopeCurrent() && options.isApplied(waiting.command));
  });
  useInrAssistantScreen(enabled ? {
    selection: { kind: options.kind, id }, revision, channel: options.channel, step: options.step,
    pendingChanges: options.pendingChanges, availableCommands: [options.command],
  } satisfies Omit<InrAssistantClientScreen, "pathname" | "tool"> : null);

  useEffect(() => () => { pending.current?.finish(false); }, []);
  useEffect(() => {
    if (!enabled) return;
    const run = async (stillCurrent: () => boolean, incoming: InrAssistantNativeCommand, scopeCurrent: () => boolean) => {
      const state = current.current;
      if (pending.current || !stillCurrent() || !state.options.enabled || state.revision !== incoming.revision || incoming.command !== state.options.command) return false;
      if (state.options.isApplied(incoming)) return true;
      return new Promise<boolean>(resolve => {
        const finish = (ok: boolean) => { clearTimeout(timer); pending.current = null; resolve(ok); };
        const timer = setTimeout(() => finish(false), 5_000);
        pending.current = { command: incoming, scopeCurrent, finish };
        try { if (!state.options.apply(incoming)) finish(false); } catch { finish(false); }
      });
    };
    // The placeholder patch is never executed: Provider passes the signed incoming command.
    const handler = options.command === "configure_ads_draft"
      ? { command: options.command, selection: { kind: "campaign" as const, id }, revision, patch: {} }
      : { command: options.command, selection: { kind: "media" as const, id }, revision, patch: {} };
    register(instance, { ...handler, pathname, run: (stillCurrent, incoming, scopeCurrent) =>
      incoming.command === "configure_ads_draft" || incoming.command === "configure_video_retouch" ? run(stillCurrent, incoming, scopeCurrent) : Promise.resolve(false) });
    return () => register(instance, null);
  }, [id, instance, options.command, enabled, pathname, register, revision]);
}

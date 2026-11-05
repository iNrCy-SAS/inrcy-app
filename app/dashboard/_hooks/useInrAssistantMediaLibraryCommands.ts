"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantStudioUiCommand } from "@/lib/inrAssistantStudioUiCommands";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";

type Command = Extract<InrAssistantStudioUiCommand, { command: "configure_media_library" }>;
type Options = {
  snapshot: unknown; enabled: boolean; pendingChanges: boolean; workspace?: { id: string; revision: string }; selectedIds?: string[]; optimizationAvailable?: boolean;
  apply: (command: Command, stillCurrent: () => boolean, scopeCurrent: () => boolean) => Promise<boolean> | boolean;
  isApplied: (command: Command) => boolean;
};

/** The target is the editor instance, not its changing source. Every operation
 * still binds the exact committed source/settings through an opaque revision. */
export function useInrAssistantMediaLibraryCommands(options: Options) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const signature = JSON.stringify(options.snapshot), id = options.workspace?.id ?? `library_${instance}`;
  const [version, setVersion] = useState({ signature, revision: 0 });
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const revision = options.workspace?.revision ?? `library_${instance}_${version.revision}`;
  const current = useRef({ options, revision });
  const pending = useRef<{ command: Command; ready: boolean; scopeCurrent: () => boolean; finish: (ok: boolean) => void } | null>(null);
  useLayoutEffect(() => {
    current.current = { options, revision };
    const waiting = pending.current;
    if (waiting?.ready) { if (!waiting.scopeCurrent()) waiting.finish(false); else if (options.isApplied(waiting.command)) waiting.finish(true); }
  });
  const enabled = options.enabled && pathname === "/dashboard/mediatheque";
  const names: Command["command"][] = enabled ? ["configure_media_library"] : [];
  const commands = JSON.stringify(names);
  // Keep the editor identity mounted while its native save is busy. Disable new
  // commands, but do not invalidate the scope of that same pending operation.
  useInrAssistantScreen(pathname === "/dashboard/mediatheque" ? { selection: { kind: "media", id }, revision,
    step: "media", pendingChanges: options.pendingChanges, availableCommands: [...names, ...(options.optimizationAvailable ? ["optimize_media" as const] : [])], ...(options.selectedIds?.length ? { selectedMediaIds: options.selectedIds } : {}) } : null);
  useEffect(() => () => { pending.current?.finish(false); }, []);
  useEffect(() => {
    const names = JSON.parse(commands) as Command["command"][];
    for (const name of names) {
      const target = { selection: { kind: "media" as const, id }, revision };
      const placeholder: Command = { ...target, command: name, patch: {} };
      register(`${instance}:${name}`, { ...placeholder, pathname, getCommittedScreen: () => ({ pathname, selection: { kind: "media", id }, revision: current.current.revision }), run: async (stillCurrent, incoming, scopeCurrent) => {
        if (incoming.command !== name || pending.current || !stillCurrent() || !current.current.options.enabled || current.current.revision !== incoming.revision) return false;
        const command = incoming as Command;
        const state = current.current;
        return new Promise<boolean>(resolve => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const waiting = { command, ready: false, scopeCurrent, finish: (ok: boolean) => {
            if (pending.current !== waiting) return;
            clearTimeout(timer); pending.current = null; resolve(ok);
          } };
          pending.current = waiting;
          Promise.resolve().then(() => stillCurrent() ? state.options.apply(command, stillCurrent, scopeCurrent) : false).then(ok => {
            if (pending.current !== waiting) return;
            if (!ok || !scopeCurrent()) { waiting.finish(false); return; }
            waiting.ready = true;
            if (current.current.options.isApplied(command)) { waiting.finish(true); return; }
            timer = setTimeout(() => waiting.finish(false), 5_000);
          }).catch(() => waiting.finish(false));
        });
      } });
    }
    return () => { for (const name of names) register(`${instance}:${name}`, null); };
  }, [commands, id, instance, pathname, register, revision]);
}

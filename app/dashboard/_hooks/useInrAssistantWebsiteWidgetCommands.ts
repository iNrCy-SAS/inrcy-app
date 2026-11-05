"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantWebsiteUiCommand } from "@/lib/inrAssistantWebsiteUiCommands";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";
type Command = InrAssistantWebsiteUiCommand;
type Options = { snapshot: unknown; canGenerate: boolean; codeReady: boolean; busy: boolean; apply: (command: Command, stillCurrent: () => boolean, scopeCurrent: () => boolean) => Promise<boolean>; isApplied: (command: Command) => boolean };
export function useInrAssistantWebsiteWidgetCommands(options: Options) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_"), pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const signature = JSON.stringify(options.snapshot), [version, setVersion] = useState({ signature, revision: 0 });
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const revision = `widget_${instance}_${version.revision}`, current = useRef({ options, revision }), pending = useRef<{ command: Command; ready: boolean; scopeCurrent: () => boolean; finish: (ok: boolean) => void } | null>(null);
  useLayoutEffect(() => { current.current = { options, revision }; const waiting = pending.current; if (waiting?.ready) waiting.finish(waiting.scopeCurrent() && options.isApplied(waiting.command)); });
  const names: Command["command"][] = pathname === "/dashboard" ? [...(options.canGenerate ? ["generate_website_widget_code" as const] : []), ...(options.codeReady ? ["show_website_widget_code", "copy_website_widget_code"] as const : [])] : [];
  const commands = JSON.stringify(names);
  useInrAssistantScreen(pathname === "/dashboard" ? { selection: { kind: "channel", id: "site_web" }, revision, channel: "site_web", panel: "site_web", pendingChanges: options.busy, availableCommands: options.busy ? [] : names } : null);
  useEffect(() => () => pending.current?.finish(false), []);
  useEffect(() => {
    const names = JSON.parse(commands) as Command["command"][];
    for (const name of names) register(`${instance}:${name}`, { command: name, selection: { kind: "channel", id: "site_web" }, revision, format: null, pathname, getCommittedScreen: () => ({ pathname, selection: { kind: "channel", id: "site_web" }, revision: current.current.revision }), run: async (stillCurrent, incoming, scopeCurrent) => {
      if (incoming.command !== name || pending.current || !stillCurrent() || incoming.revision !== current.current.revision || current.current.options.busy) return false;
      const command = incoming as Command, state = current.current;
      return new Promise<boolean>(resolve => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const waiting = { command, ready: false, scopeCurrent, finish: (ok: boolean) => { if (pending.current !== waiting) return; clearTimeout(timer); pending.current = null; resolve(ok); } }; pending.current = waiting;
        Promise.resolve().then(() => stillCurrent() ? state.options.apply(command, stillCurrent, scopeCurrent) : false).then(ok => {
          if (pending.current !== waiting) return;
          if (!ok || !scopeCurrent()) { waiting.finish(false); return; }
          waiting.ready = true; if (current.current.options.isApplied(command)) { waiting.finish(true); return; } timer = setTimeout(() => waiting.finish(false), 5_000);
        }).catch(() => waiting.finish(false));
      });
    } });
    return () => { for (const name of names) register(`${instance}:${name}`, null); };
  }, [commands, instance, pathname, register, revision]);
}

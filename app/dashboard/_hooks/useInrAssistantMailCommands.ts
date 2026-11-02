"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantMailCommand } from "@/lib/inrAssistantMailCompose";
import { INR_ASSISTANT_MAIL_LIFECYCLE, type InrAssistantMailExecution, type InrAssistantMailLifecycleCommand } from "@/lib/inrAssistantMailLifecycle";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";
type Command = InrAssistantMailCommand | InrAssistantMailLifecycleCommand;
type Options = {
  open: boolean; enabled: boolean; snapshot: unknown; pendingChanges: boolean; canSchedule: boolean; consumed: boolean;
  apply: (command: InrAssistantMailCommand) => boolean; isApplied: (command: InrAssistantMailCommand) => boolean;
  save: (execution: InrAssistantMailExecution) => Promise<void>;
  send: (execution: InrAssistantMailExecution) => Promise<void>;
  openSchedule: () => void; scheduleOpen: boolean;
};
/** Native compose actions bind all fields/PJs to one committed opaque revision.
 * A dispatched save/send is never automatically replayed after uncertainty. */
export function useInrAssistantMailCommands(options: Options) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_"), id = `mail_${instance}`;
  const pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const signature = JSON.stringify(options.snapshot);
  const [version, setVersion] = useState({ signature, revision: 0 });
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const revision = `mail_${instance}_${version.revision}`;
  const current = useRef({ options, revision });
  const pending = useRef<{ ready: boolean; finish: (ok: boolean) => void; check: () => boolean } | null>(null);
  const attempts = useRef(new Set<string>());
  useLayoutEffect(() => {
    current.current = { options, revision };
    const waiting = pending.current; if (waiting?.ready && waiting.check()) waiting.finish(true);
  });
  const names: Command["command"][] = options.enabled ? ["configure_mail_draft", "save_mail_draft", "send_mail_draft", ...(options.canSchedule ? ["open_mail_schedule" as const] : [])] : [];
  const serialized = JSON.stringify(names);
  useInrAssistantScreen(options.open && pathname === "/dashboard/mails" ? { selection: { kind: "mail", id }, revision, pendingChanges: options.pendingChanges, availableCommands: names } : null);
  useEffect(() => () => { pending.current?.finish(false); }, []);
  useEffect(() => {
    for (const name of JSON.parse(serialized) as Command["command"][]) {
      const target = { selection: { kind: "mail" as const, id }, revision };
      const placeholder: Command = name === "configure_mail_draft" ? { ...target, command: name, patch: {} } : { ...target, command: name };
      register(`${instance}:${name}`, { ...placeholder, pathname,
        getCommittedScreen: () => ({ pathname, selection: { kind: "mail", id }, revision: current.current.revision }),
        run: async (stillCurrent, incoming, scopeCurrent) => {
        if (incoming.command !== name || !stillCurrent() || pending.current || current.current.revision !== revision || !current.current.options.enabled) return false;
        const command = incoming as Command, state = current.current;
        const guard = () => scopeCurrent() && current.current.revision === revision && current.current.options.open;
        const key = `${name}:${revision}`;
        if (INR_ASSISTANT_MAIL_LIFECYCLE.includes(name as InrAssistantMailLifecycleCommand["command"]) && attempts.current.has(key)) return false;
        return new Promise<boolean>(resolve => {
          let accepted = false; let timer: ReturnType<typeof setTimeout> | undefined;
          const waiting = { ready: false, check: () => scopeCurrent() && (name === "configure_mail_draft" ? current.current.options.isApplied(command as InrAssistantMailCommand) : name === "open_mail_schedule" ? current.current.options.scheduleOpen : accepted && (name === "save_mail_draft" ? !current.current.options.pendingChanges : current.current.options.consumed)), finish: (ok: boolean) => {
            if (pending.current !== waiting) return; clearTimeout(timer); pending.current = null; resolve(ok);
          } };
          pending.current = waiting;
          const execution: InrAssistantMailExecution = { isCurrent: guard, started: () => { attempts.current.add(key); }, accepted: () => { accepted = true; } };
          Promise.resolve().then(async () => {
            if (!guard()) return false;
            if (command.command === "configure_mail_draft") return state.options.apply(command);
            if (command.command === "open_mail_schedule") { state.options.openSchedule(); return true; }
            if (command.command === "save_mail_draft") await state.options.save(execution); else await state.options.send(execution);
            return accepted;
          }).then(ok => {
            if (pending.current !== waiting) return;
            if (!ok || !scopeCurrent()) { waiting.finish(false); return; }
            waiting.ready = true; if (waiting.check()) { waiting.finish(true); return; }
            timer = setTimeout(() => waiting.finish(false), 5_000);
          }).catch(() => waiting.finish(false));
        });
      } });
    }
    return () => { for (const name of JSON.parse(serialized) as string[]) register(`${instance}:${name}`, null); };
  }, [id, instance, pathname, register, revision, serialized]);
}

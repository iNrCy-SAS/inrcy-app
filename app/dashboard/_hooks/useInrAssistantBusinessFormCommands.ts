"use client";
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { isInrAssistantBusinessFormUiCommandAvailable, parseInrAssistantBusinessFormUiCommand, type InrAssistantBusinessFormId, type InrAssistantBusinessFormPatch, type InrAssistantBusinessFormTab } from "@/lib/inrAssistantBusinessFormUiCommands";
import type { InrAssistantUiCommand } from "@/lib/inrAssistantUiCommands";

export type BusinessFormActionScope = () => boolean;
type NativeResult = boolean | { committed: boolean };
type Options = {
  id: InrAssistantBusinessFormId; view?: InrAssistantBusinessFormTab; enabled?: boolean; publish?: boolean; snapshot: unknown;
  busy: boolean; pendingChanges?: boolean;
  apply: (patch: InrAssistantBusinessFormPatch, scopeCurrent: BusinessFormActionScope) => NativeResult | Promise<NativeResult>;
  isApplied: (patch: InrAssistantBusinessFormPatch) => boolean;
};

/** A hidden child can reuse the commit protocol through its parent's ref,
 * without publishing a second competing selection or an unmounted handler. */
export function useInrAssistantBusinessFormCommands(options: Options) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_"), pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const scopeKey = `${actorUserId || ""}:${activeAccountId || ""}`;
  const signature = JSON.stringify([scopeKey, options.snapshot, options.id]);
  const [version, setVersion] = useState({ signature, value: 0 });
  if (version.signature !== signature) setVersion({ signature, value: version.value + 1 });
  const revision = `business_form_${instance}_${version.value}`;
  const current = useRef({ options, revision, scopeKey, commits: 0 });
  const pending = useRef<{ patch: InrAssistantBusinessFormPatch; beforeCommit: number; accepted: boolean; scopeCurrent: BusinessFormActionScope; finish: (ok: boolean) => void } | null>(null);
  useLayoutEffect(() => {
    current.current = { options, revision, scopeKey, commits: current.current.commits + 1 };
    const waiting = pending.current;
    if (waiting && (!waiting.scopeCurrent() || options.enabled === false)) waiting.finish(false);
    else if (waiting?.accepted && current.current.commits > waiting.beforeCommit && options.isApplied(waiting.patch)) waiting.finish(true);
  });
  useEffect(() => () => { pending.current?.finish(false); }, []);
  const perform = useCallback(async (patch: InrAssistantBusinessFormPatch, scopeCurrent: BusinessFormActionScope): Promise<boolean> => {
    const state = current.current, boundScope = state.scopeKey;
    const live = () => scopeCurrent() && current.current.scopeKey === boundScope && current.current.options.enabled !== false;
    if (!actorUserId || !activeAccountId || state.options.busy || pending.current || !live()) return false;
    if (state.options.isApplied(patch)) return true;
    return new Promise<boolean>(resolve => {
      const finish = (ok: boolean) => { if (pending.current?.finish !== finish) return; clearTimeout(timer); pending.current = null; resolve(ok); };
      const timer = setTimeout(() => finish(false), 30_000);
      const waiting = { patch, beforeCommit: state.commits, accepted: false, scopeCurrent: live, finish };
      pending.current = waiting;
      void Promise.resolve().then(() => current.current.revision === state.revision && live() ? state.options.apply(patch, live) : false).then(result => {
        if (pending.current !== waiting) return;
        if (!live() || result === false || typeof result === "object" && !result.committed) return finish(false);
        // Delegation is allowed only to a child's native commit protocol, never
        // to a model/client assertion that a form became clean or saved.
        if (typeof result === "object" && result.committed) return finish(true);
        waiting.accepted = true;
        if (current.current.commits > waiting.beforeCommit && current.current.options.isApplied(patch)) finish(true);
      }).catch(() => finish(false));
    });
  }, [actorUserId, activeAccountId]);
  const enabled = options.enabled !== false && options.publish !== false && !!actorUserId && !!activeAccountId
    && isInrAssistantBusinessFormUiCommandAvailable("configure_business_form", pathname, "business_form");
  useInrAssistantScreen(enabled ? { selection: { kind: "business_form", id: options.id }, revision, step: options.view, pendingChanges: options.pendingChanges, availableCommands: ["configure_business_form"] } : null);
  useEffect(() => {
    if (!enabled) return;
    register(instance, { command: "configure_business_form", selection: { kind: "business_form", id: options.id }, revision, patch: { businessFormAction: "discard" }, pathname,
      getCommittedScreen: () => ({ pathname, selection: { kind: "business_form", id: current.current.options.id }, revision: current.current.revision }),
      run: async (stillCurrent: BusinessFormActionScope, incoming: InrAssistantUiCommand, scopeCurrent: BusinessFormActionScope) => {
        const command = parseInrAssistantBusinessFormUiCommand(incoming), state = current.current;
        if (!command || command.selection.id !== state.options.id || command.revision !== state.revision || !stillCurrent() || !scopeCurrent()) return false;
        return perform(command.patch, scopeCurrent);
      } });
    return () => register(instance, null);
  }, [enabled, instance, options.id, pathname, perform, register, revision]);
  return perform;
}

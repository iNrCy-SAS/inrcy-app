"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";

type Guard = () => boolean;
type Options = {
  enabled: boolean; open: boolean; itemId: string | null; channel: string | null; visibleChannels: readonly string[];
  navigationBusy: boolean; busy: boolean; canNavigatePrevious: boolean; canNavigateNext: boolean;
  previewOpen: boolean; previewAllowed: boolean;
  close(canContinue: Guard): Promise<void>;
  navigate(direction: -1 | 1, canContinue: Guard): Promise<void>;
  changeChannel(channel: string, canContinue: Guard): Promise<void>;
  setPreview(open: boolean): void;
};
type Snapshot = { open: boolean; id: string | null; channel: string | null; previewOpen: boolean; navigationBusy: boolean };
const snapshot = (value: unknown) => value && typeof value === "object" ? value as Snapshot : null;

/** Native callbacks own dirty-form confirmation. The injected guard also runs
 * after that confirmation and page reads, so a late decision cannot affect a
 * different record, channel, account or actor. */
export function useInrAssistantSendDetailsControls(options: Options) {
  const { actorUserId, activeAccountId } = useDashboardViewerAccess(), pathname = usePathname();
  const scope = `${actorUserId}:${activeAccountId}:${pathname}:${options.itemId}:${options.channel}:${options.open}:${options.enabled}`;
  const token = useMemo(() => ({ scope }), [scope]);
  const currentScope = useRef(token), alive = useRef(false);
  useLayoutEffect(() => { currentScope.current = token; }, [token]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canContinue = () => alive.current && currentScope.current === token;
  const guarded = (stillCurrent: Guard) => () => stillCurrent() && canContinue();
  const state: Snapshot = { open: options.open, id: options.itemId, channel: options.channel, previewOpen: options.previewOpen, navigationBusy: options.navigationBusy };
  const navigated = (value: unknown) => { const current = snapshot(value); return !!current?.open && !current.navigationBusy && !!current.id && current.id !== options.itemId; };
  useInrAssistantLocalInterface("send_details", state, {
    ...(options.canNavigatePrevious ? { previous: { invoke: (_value, stillCurrent) => options.navigate(-1, guarded(stillCurrent)), matches: navigated } } : {}),
    ...(options.canNavigateNext ? { next: { invoke: (_value, stillCurrent) => options.navigate(1, guarded(stillCurrent)), matches: navigated } } : {}),
    close: { invoke: (_value, stillCurrent) => options.close(guarded(stillCurrent)), matches: value => snapshot(value)?.open === false, allowUnmount: true },
    ...(options.visibleChannels.length ? { select: {
      async invoke(value: string | null, stillCurrent: Guard) {
        if (typeof value !== "string" || !options.visibleChannels.includes(value)) throw new Error("Unavailable visible publication channel");
        await options.changeChannel(value, guarded(stillCurrent));
      },
      matches(value: unknown, channel: string | null) { const current = snapshot(value); return current?.id === options.itemId && current.channel === channel; },
    } } : {}),
  }, options.enabled && options.open, options.busy || options.navigationBusy);
  useInrAssistantLocalInterface("send_preview", state, {
    open: { invoke: () => options.setPreview(true), matches: value => snapshot(value)?.id === options.itemId && snapshot(value)?.previewOpen === true },
    close: { invoke: () => options.setPreview(false), matches: value => snapshot(value)?.id === options.itemId && snapshot(value)?.previewOpen === false },
  }, options.open && options.previewAllowed, options.busy || options.navigationBusy);
}

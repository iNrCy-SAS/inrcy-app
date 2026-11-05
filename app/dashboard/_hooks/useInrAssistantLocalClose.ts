"use client";
import type { InrAssistantLocalInterface, InrAssistantLocalHandler, InrAssistantLocalOperation } from "@/lib/inrAssistantLocalInterface";
import { useLayoutEffect, useRef } from "react";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";

/** Close through the native callback and acknowledge the committed closed state
 * or actual unmount. A cancelled native unsaved-changes dialog never succeeds. */
export function useInrAssistantLocalClose(id: InrAssistantLocalInterface, open: boolean, close: (stillCurrent: () => boolean) => void | Promise<unknown>, busy = false, stateKey?: unknown, controls?: { snapshot: Record<string, unknown>; handlers: Partial<Record<InrAssistantLocalOperation, InrAssistantLocalHandler>>; enabledWhenClosed?: boolean }) {
  const signature = JSON.stringify({ open, busy, stateKey }), current = useRef(signature);
  useLayoutEffect(() => { current.current = signature; }, [signature]);
  useInrAssistantLocalInterface(id, { ...controls?.snapshot, open, stateKey }, { ...((open || !controls) ? { close: {
    invoke: async (_value, stillCurrent) => {
      const start = current.current, valid = () => stillCurrent() && current.current === start;
      if (!valid()) throw new Error("local_close_stale");
      await close(valid);
      if (!stillCurrent()) throw new Error("local_close_stale");
    },
    matches: snapshot => !!snapshot && typeof snapshot === "object" && (snapshot as { open?: boolean }).open === false,
    allowUnmount: true,
  } } : {}), ...controls?.handlers }, open || controls?.enabledWhenClosed === true, busy);
}

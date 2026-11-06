"use client";
import { useLayoutEffect, useState, type RefObject } from "react";
import type { InrAssistantLocalInterface } from "@/lib/inrAssistantLocalInterface";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";
import { isBrowserPopoverOpen } from "@/lib/browserPopover";

/** An explicitly supplied native popover, never a model selector or arbitrary
 * element. Native toggle events and the rendered state both precede its ACK. */
export function useInrAssistantNativePopover(id: InrAssistantLocalInterface, ref: RefObject<HTMLElement | null>, enabled = true, busy = false) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setOpen(isBrowserPopoverOpen(element));
    element.addEventListener("toggle", update); update();
    return () => element.removeEventListener("toggle", update);
  });
  useInrAssistantLocalInterface(id, { open }, {
    open: { invoke: () => { if (!ref.current) throw new Error("Popover unavailable"); ref.current.showPopover(); }, matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "open" in snapshot && snapshot.open === true && isBrowserPopoverOpen(ref.current)) },
    close: { invoke: () => { if (!ref.current) throw new Error("Popover unavailable"); ref.current.hidePopover(); }, matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "open" in snapshot && snapshot.open === false && !isBrowserPopoverOpen(ref.current)) },
  }, enabled, busy);
}

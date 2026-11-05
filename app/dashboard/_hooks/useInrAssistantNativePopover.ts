"use client";
import { useLayoutEffect, useState, type RefObject } from "react";
import type { InrAssistantLocalInterface } from "@/lib/inrAssistantLocalInterface";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";

/** An explicitly supplied native popover, never a model selector or arbitrary
 * element. Native toggle events and the rendered state both precede its ACK. */
export function useInrAssistantNativePopover(id: InrAssistantLocalInterface, ref: RefObject<HTMLElement | null>, enabled = true, busy = false) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setOpen(element.matches(":popover-open"));
    element.addEventListener("toggle", update); update();
    return () => element.removeEventListener("toggle", update);
  });
  useInrAssistantLocalInterface(id, { open }, {
    open: { invoke: () => { if (!ref.current) throw new Error("Popover unavailable"); ref.current.showPopover(); }, matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "open" in snapshot && snapshot.open === true && ref.current?.matches(":popover-open")) },
    close: { invoke: () => { if (!ref.current) throw new Error("Popover unavailable"); ref.current.hidePopover(); }, matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "open" in snapshot && snapshot.open === false && !ref.current?.matches(":popover-open")) },
  }, enabled, busy);
}

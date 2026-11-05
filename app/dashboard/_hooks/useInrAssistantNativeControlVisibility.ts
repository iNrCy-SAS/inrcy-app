"use client";
import { useEffect, useState, type RefObject } from "react";

/** Observe only the explicitly declared native control. No DOM discovery or
 * selector can choose a different launcher hidden by the responsive layout. */
export function useInrAssistantNativeControlVisibility(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const control = ref.current;
    if (!control) return;
    const update = () => setVisible(control.isConnected && control.getClientRects().length > 0);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(control);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [ref]);
  return visible;
}

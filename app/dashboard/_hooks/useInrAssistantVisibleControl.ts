"use client";
import { useLayoutEffect, useState, type RefObject } from "react";

/** Register only the actually visible responsive variant of a native control.
 * The caller supplies its own ref; there is no selector or model DOM access. */
export function useInrAssistantVisibleControl(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined") return;
    const update = () => setVisible(element.isConnected && (typeof element.checkVisibility === "function"
      ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden"));
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(element); window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [ref]);
  return visible;
}

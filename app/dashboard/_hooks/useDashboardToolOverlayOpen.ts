"use client";

import { useSyncExternalStore } from "react";

const TOOL_OVERLAY = "[data-inrcy-tool-overlay]";

function containsToolOverlay(node: Node) {
  return node instanceof Element && (node.matches(TOOL_OVERLAY) || Boolean(node.querySelector(TOOL_OVERLAY)));
}

function getSnapshot() {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll<HTMLElement>(TOOL_OVERLAY)].some(overlay =>
    !overlay.closest("[hidden]") && overlay.getClientRects().length > 0 && getComputedStyle(overlay).visibility !== "hidden",
  );
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => record.type === "attributes"
      ? record.attributeName === "data-inrcy-tool-overlay" || containsToolOverlay(record.target)
      : [...record.addedNodes, ...record.removedNodes].some(containsToolOverlay));
    if (relevant) onChange();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-inrcy-tool-overlay", "hidden", "style", "open"],
  });
  return () => observer.disconnect();
}

/** Full tool workspaces own their header; dashboard controls stay out of their UI and tab order. */
export default function useDashboardToolOverlayOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

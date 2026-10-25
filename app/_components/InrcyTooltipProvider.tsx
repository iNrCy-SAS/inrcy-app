"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { connectInrcyTooltip, createInrcyTooltipController, getInrcyTooltipPosition, type InrcyTooltipState } from "@/lib/inrcyTooltip";
import styles from "./InrcyTooltipProvider.module.css";

export default function InrcyTooltipProvider() {
  const id = useId();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<InrcyTooltipState | null>(null);

  useEffect(() => {
    const controller = createInrcyTooltipController({ document, onChange: setTooltip, getBubble: () => bubbleRef.current });
    return controller.destroy;
  }, []);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!tooltip || !bubble) return;
    const viewport = window.visualViewport;
    bubble.style.maxWidth = `${Math.max(1, Math.min(340, (viewport?.width ?? window.innerWidth) - 24))}px`;
    const position = getInrcyTooltipPosition(tooltip.anchor.getBoundingClientRect(), bubble.getBoundingClientRect(), {
      width: viewport?.width ?? window.innerWidth,
      height: viewport?.height ?? window.innerHeight,
      left: viewport?.offsetLeft ?? 0,
      top: viewport?.offsetTop ?? 0,
    });
    bubble.style.left = `${position.left}px`;
    bubble.style.top = `${position.top}px`;
    bubble.dataset.placement = position.placement;
    bubble.dataset.positioned = "true";
    return connectInrcyTooltip(tooltip.anchor, id);
  }, [tooltip, id]);

  return tooltip ? createPortal(
    <div id={id} ref={bubbleRef} className={styles.bubble} role="tooltip" data-inrcy-tooltip-bubble>
      <span className={styles.accent} aria-hidden="true" />
      <strong className={styles.label}>{tooltip.label}</strong>
      {tooltip.description ? <span className={styles.description}>{tooltip.description}</span> : null}
    </div>,
    tooltip.host,
  ) : null;
}

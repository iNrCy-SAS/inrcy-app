"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import CompatiblePopover from "../../_components/CompatiblePopover";
import styles from "./AgentSettingsPopover.module.css";

type Props = {
  label: string;
  labelledBy?: string;
  disabled?: boolean;
  triggerClassName: string;
  panelClassName: string;
  triggerContent: ReactNode | ((open: boolean) => ReactNode);
  preferredWidth?: number;
  children: ReactNode | ((close: () => void) => ReactNode);
};

// The top layer escapes the cards' stacking contexts. Keep its geometry inside
// the visible settings dialog, including when the mobile dock reduces its height.
function place(trigger: HTMLElement, panel: HTMLElement, preferredWidth?: number) {
  const rect = trigger.getBoundingClientRect();
  const frame = trigger.closest("[data-inrcy-tool-dialog]")?.getBoundingClientRect();
  const viewport = window.visualViewport;
  const x = viewport?.offsetLeft ?? 0;
  const y = viewport?.offsetTop ?? 0;
  const margin = 8;
  const left = Math.max(x, frame?.left ?? x) + margin;
  const top = Math.max(y, frame?.top ?? y) + margin;
  const right = Math.min(x + (viewport?.width ?? window.innerWidth), frame?.right ?? Infinity) - margin;
  const bottom = Math.min(y + (viewport?.height ?? window.innerHeight), frame?.bottom ?? Infinity) - margin;
  const width = Math.min(preferredWidth ?? Math.max(rect.width, 300), Math.max(0, right - left));
  const below = bottom - rect.bottom - 7;
  const above = rect.top - 7 - top;
  const placeBelow = below >= 220 || below >= above;
  const space = placeBelow ? below : above;
  // In short landscape views an anchored sliver would make even one option unusable.
  const overTrigger = space < 112;
  Object.assign(panel.style, {
    width: `${width}px`,
    left: `${Math.max(left, Math.min(rect.left, right - width))}px`,
    maxHeight: `${Math.min(420, Math.max(0, overTrigger ? bottom - top : space))}px`,
    top: `${overTrigger ? top : placeBelow ? rect.bottom + 7 : rect.top - 7}px`,
    transform: !overTrigger && !placeBelow ? "translateY(-100%)" : "none",
  });
}

export default function AgentSettingsPopover(props: Props) {
  const id = useId();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const menu = panel.current;
    if (!open || !trigger || !menu) return;
    const update = () => place(trigger, menu, props.preferredWidth);
    update();
    const firstControl = menu.querySelector<HTMLElement>("[data-popover-initial-focus]")
      ?? menu.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), button:not(:disabled)");
    (firstControl || menu).focus({ preventScroll: true });
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      const rect = trigger.getBoundingClientRect();
      if (event.target instanceof HTMLElement && event.target.contains(trigger)) {
        const visible = event.target.getBoundingClientRect();
        if (rect.bottom <= visible.top || rect.top >= visible.bottom) {
          menu.hidePopover();
          return;
        }
      }
      update();
    };
    const viewport = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("scroll", onScroll, true);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [open, trigger, props.preferredWidth]);

  const close = () => {
    trigger?.ownerDocument.getElementById(id)?.hidePopover();
    setOpen(false);
    trigger?.focus({ preventScroll: true });
  };

  return <>
    <button type="button" ref={setTrigger} className={props.triggerClassName} disabled={props.disabled}
      aria-label={props.labelledBy ? undefined : props.label} aria-labelledby={props.labelledBy}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={id} popoverTarget={id}>
      {typeof props.triggerContent === "function" ? props.triggerContent(open) : props.triggerContent}
    </button>
    {trigger && createPortal(
      <CompatiblePopover id={id} ref={panel} role="dialog" aria-label={props.label} tabIndex={-1}
        className={`${styles.panel} ${props.panelClassName}`}
        onBeforeToggle={event => {
          if (event.newState === "open" && panel.current) place(trigger, panel.current, props.preferredWidth);
        }}
        onToggle={event => setOpen(event.newState === "open")}
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        onBlur={event => {
          const next = event.relatedTarget;
          if (next instanceof Node && next !== trigger && !event.currentTarget.contains(next)) {
            event.currentTarget.hidePopover();
          }
        }}>
        {typeof props.children === "function" ? props.children(close) : props.children}
      </CompatiblePopover>, trigger.closest("[data-inrcy-tool-dialog]") ?? trigger.ownerDocument.body)}
  </>;
}

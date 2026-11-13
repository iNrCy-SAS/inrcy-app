"use client";

import { useEffect, type RefObject } from "react";
import { acquireElementStyleLock } from "@/lib/elementStyleLock";

/** Owns only the open dialog's viewport, focus and mobile scroll lifecycle. */
export function useAssistantDialogViewport({ open, portalTarget, dialogRef, composerRef }: {
  open: boolean;
  portalTarget: HTMLElement | null;
  dialogRef: RefObject<HTMLDialogElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.show();
    const ownsScrollLock = window.matchMedia("(max-width: 1100px)").matches;
    const releaseBodyLock = ownsScrollLock ? acquireElementStyleLock(document.body, { overflow: "hidden" }) : undefined;
    const viewport = window.visualViewport;
    const syncViewport = () => {
      dialog.style.setProperty("--assistant-viewport-height", `${viewport?.height || window.innerHeight}px`);
      dialog.style.setProperty("--assistant-viewport-width", `${viewport?.width || window.innerWidth}px`);
      dialog.style.setProperty("--assistant-viewport-top", `${Math.max(0, viewport?.offsetTop || 0)}px`);
      dialog.style.setProperty("--assistant-viewport-left", `${Math.max(0, viewport?.offsetLeft || 0)}px`);
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    const frame = requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      dialog.close();
      releaseBodyLock?.();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, portalTarget, dialogRef, composerRef]);
}

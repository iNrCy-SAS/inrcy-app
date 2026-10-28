"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import styles from "./MediaResultViewer.module.css";

/** A local preview only: zooming never edits or regenerates the saved media. */
export default function MediaResultViewer({ accountId, title, video, children, onClose }: {
  accountId?: string | null;
  title: string;
  video: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations("media");
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const account = accountId || getActiveBrowserUserId();
    if (account !== getActiveBrowserUserId()) { onClose(); return; }
    const closeForAccountChange = () => { if (getActiveBrowserUserId() !== account) onClose(); };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, closeForAccountChange);
    dialog.showModal();
    return () => {
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, closeForAccountChange);
      dialog.close();
      if (account === getActiveBrowserUserId() && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [accountId, onClose]);

  return createPortal(<dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      // Native video controls retarget focus to <video>. Let the browser move
      // through Play, timeline and volume before the boundary returns to Close.
      if (document.activeElement instanceof HTMLVideoElement) return;
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), video[controls]'))
        .filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    }} onClick={event => event.stopPropagation()}>
    <header className={styles.header}>
      <h2 id={titleId}>{title}</h2>
      <button type="button" onClick={onClose} aria-label={t("fermer_5ab4ec64")}>{t("fermer_5ab4ec64")} <span aria-hidden="true">×</span></button>
    </header>
    <div ref={viewportRef} className={styles.viewport} data-media-expanded-viewport>
      <div className={styles.canvas} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} data-media-expanded-canvas>
        {children}
      </div>
    </div>
    {video ? <span className={styles.focusBoundary} tabIndex={0} aria-hidden="true"
      onFocus={() => dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus()} /> : null}
    {!video ? <div className={styles.controls}>
      <button type="button" aria-label="Zoom −" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}>−</button>
      <button type="button" aria-label="Zoom 100 %" onClick={() => { setZoom(1); viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" }); }}><output aria-live="polite">{Math.round(zoom * 100)} %</output></button>
      <button type="button" aria-label="Zoom +" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.5))}>+</button>
    </div> : null}
  </dialog>, document.body);
}

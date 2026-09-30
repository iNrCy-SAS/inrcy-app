"use client";

import { useTranslations } from "next-intl";


import { useEffect, useRef } from "react";
import nativeStyles from "./HelpModalNativeLayer.module.css";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  nativeLayer?: boolean;
};

const MOBILE_DOCK_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + var(--inrcy-safe-area-bottom)))";

export default function HelpModal({ open, title, onClose, children, nativeLayer = false }: Props) {
  const i18nT = useTranslations("shell");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || nativeLayer) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, nativeLayer]);

  useEffect(() => {
    if (!open || !nativeLayer) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    // A parent dialog may already own the scroll lock. Do not release or reclaim its lock.
    const ownsScrollLock = previousOverflow !== "hidden";
    if (!dialog.open) dialog.showModal();
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, nativeLayer]);

  if (!open) return null;

  const content = (
    <div
      role={nativeLayer ? undefined : "dialog"}
      aria-modal={nativeLayer ? undefined : true}
      aria-label={nativeLayer ? undefined : title}
      style={{
        position: "fixed",
        inset: 0,
        bottom: nativeLayer ? 0 : MOBILE_DOCK_HEIGHT,
        height: nativeLayer ? "100dvh" : `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`,
        maxHeight: nativeLayer ? "100dvh" : `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`,
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {/* overlay */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      />

      {/* modal */}
      <div
        style={{
          position: "relative",
          width: "min(980px, 100%)",
          maxHeight: nativeLayer ? "min(calc(100dvh - 32px), 980px)" : `min(calc(100dvh - ${MOBILE_DOCK_HEIGHT} - 32px), 980px)`,
          overflowY: "auto",
          overflowX: "hidden",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(7,12,24,0.92)",
          color: "rgba(255,255,255,0.92)",
          boxShadow: "0 25px 80px rgba(0,0,0,0.55)",
        }}
      >
        {/* header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(7,12,24,0.88)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(15,23,42,0.55)",
              color: "rgba(255,255,255,0.9)",
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            {i18nT("fermer_5ab4ec64")}{" "}</button>
        </div>

        {/* body */}
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );

  if (!nativeLayer) return content;

  return (
    <dialog
      ref={dialogRef}
      className={nativeStyles.nativeLayer}
      data-dashboard-help-dialog="true"
      aria-label={title}
      aria-modal="true"
      onKeyDown={(event) => {
        // Let the browser cancel this topmost dialog, without reaching global Escape handlers.
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {content}
    </dialog>
  );
}

"use client";

import { useTranslations } from "next-intl";


import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

const MOBILE_DOCK_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + env(safe-area-inset-bottom, 0px)))";

export default function HelpModal({ open, title, onClose, children }: Props) {
  const i18nT = useTranslations("shell");
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        bottom: MOBILE_DOCK_HEIGHT,
        height: `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`,
        maxHeight: `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`,
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
          maxHeight: `min(calc(100dvh - ${MOBILE_DOCK_HEIGHT} - 32px), 980px)`,
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
}

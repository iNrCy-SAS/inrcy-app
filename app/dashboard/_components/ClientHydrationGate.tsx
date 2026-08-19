"use client";

import { useTranslations } from "next-intl";


import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type ClientHydrationGateProps = {
  children: ReactNode;
  label?: string;
};

export function StableBootScreen({ label }: { label?: string }) {
  const i18nT = useTranslations("shell");
  const displayLabel = label ?? i18nT("loading_workspace");
  return (
    <main
      aria-busy="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        width: "100%",
        height: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "clamp(16px, 4vw, 24px)",
        boxSizing: "border-box",
        overflow: "hidden",
        color: "white",
        background:
          "radial-gradient(circle at 20% 15%, rgba(56,189,248,.20), transparent 28%), radial-gradient(circle at 78% 20%, rgba(244,114,182,.18), transparent 26%), linear-gradient(135deg, #0f172a, #1e1b4b 55%, #111827)",
      }}
    >
      <div
        style={{
          width: "min(420px, calc(100vw - 32px))",
          maxWidth: "100%",
          boxSizing: "border-box",
          borderRadius: "24px",
          padding: "22px",
          textAlign: "center",
          border: "1px solid rgba(255,255,255,.14)",
          background: "rgba(15,23,42,.58)",
          boxShadow: "0 24px 80px rgba(0,0,0,.35)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ fontSize: "28px", fontWeight: 900, marginBottom: "8px" }}>{i18nT("inrcy_ef95fe0e")}</div>
        <div style={{ fontSize: "14px", lineHeight: 1.45, color: "rgba(255,255,255,.78)", fontWeight: 700 }}>{displayLabel}</div>
      </div>
    </main>
  );
}

export default function ClientHydrationGate({ children, label }: ClientHydrationGateProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <StableBootScreen label={label} />;
  return <>{children}</>;
}

"use client";

import { useTranslations } from "next-intl";


import { useEffect } from "react";
import {
  AI_ENGINE_OPTIONS,
  getAiEngineOption,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";

type Props = {
  open: boolean;
  activeEngine: AiPreferredEngine;
  onClose: () => void;
};

const MOBILE_DOCK_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + env(safe-area-inset-bottom, 0px)))";

export default function AiEngineInfoModal({ open, activeEngine, onClose }: Props) {
  const i18nT = useTranslations("booster");
  const activeOption = getAiEngineOption(activeEngine);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        bottom: MOBILE_DOCK_HEIGHT,
        height: `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`,
        maxHeight: `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`,
        zIndex: 10000,
        display: "grid",
        placeItems: "center",
        padding: 16,
        boxSizing: "border-box",
        overflowX: "hidden",
        overflowY: "auto",
        overscrollBehavior: "contain",
        background: "rgba(2,6,23,0.64)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-engine-info-title"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(620px, 100%)",
          maxHeight: `calc(100dvh - ${MOBILE_DOCK_HEIGHT} - 32px)`,
          margin: "auto",
          overflowX: "hidden",
          overflowY: "auto",
          overscrollBehavior: "contain",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.16)",
          background:
            "linear-gradient(145deg, rgba(16,24,39,0.98), rgba(12,18,31,0.98))",
          boxShadow: "0 28px 90px rgba(0,0,0,0.46)",
          color: "white",
          padding: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "rgba(125,211,252,0.9)",
                marginBottom: 5,
              }}
            >
              {i18nT("couleur_d_ecriture_14c6e5b9")}{" "}</div>
            <h2
              id="ai-engine-info-title"
              style={{
                margin: 0,
                fontSize: 21,
                lineHeight: 1.15,
                letterSpacing: "-.02em",
              }}
            >
              {i18nT("quel_moteur_ia_choisir_b77594d2")}{" "}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={i18nT("fermer_les_informations_sur_les_moteurs_a6165e55")}
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.08)",
              color: "white",
              cursor: "pointer",
              fontSize: 18,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <p
          style={{
            margin: "0 0 14px",
            color: "rgba(255,255,255,0.72)",
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {i18nT("inrcy_respecte_toujours_votre_configuration_ia_0429a566")}{" "}</p>

        <div style={{ display: "grid", gap: 8 }}>
          {AI_ENGINE_OPTIONS.map((option) => {
            const active = option.value === activeOption.value;
            return (
              <div
                key={option.value}
                style={{
                  display: "grid",
                  gap: 4,
                  padding: "10px 11px",
                  borderRadius: 12,
                  border: active
                    ? "1px solid rgba(76,195,255,0.52)"
                    : "1px solid rgba(255,255,255,0.10)",
                  background: active
                    ? "rgba(76,195,255,0.13)"
                    : "rgba(255,255,255,0.045)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    fontSize: 14,
                    fontWeight: 950,
                  }}
                >
                  <span>{option.label}</span>
                  {active ? (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#7dd3fc",
                        whiteSpace: "nowrap",
                      }}
                    >
                      actif
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.82)",
                    fontSize: 12.5,
                    lineHeight: 1.35,
                  }}
                >
                  {option.naturalTendency}
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.58)",
                    fontSize: 12,
                    lineHeight: 1.35,
                  }}
                >
                  {i18nT("ideal_pour_value_048201f3", { value0: option.bestFor })}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

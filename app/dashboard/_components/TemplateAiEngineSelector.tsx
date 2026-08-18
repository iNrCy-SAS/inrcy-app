"use client";

import { useTranslations } from "next-intl";


import { useState } from "react";
import {
  AI_ENGINE_OPTIONS,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import AiEngineInfoModal from "./AiEngineInfoModal";

export default function TemplateAiEngineSelector({
  value,
  defaultValue,
  onChange,
  disabled = false,
  isMobile = false,
}: {
  value: AiPreferredEngine;
  defaultValue: AiPreferredEngine;
  onChange: (value: AiPreferredEngine) => void;
  disabled?: boolean;
  isMobile?: boolean;
}) {
  const i18nT = useTranslations("shell");
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <>
      <div style={{ display: "grid", gap: 5, minWidth: 0, width: isMobile ? "100%" : 280 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.84)", fontSize: 12, fontWeight: 850 }}>
          <span>{i18nT("moteur_ia_a7f9dad3")}</span>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label={i18nT("informations_sur_les_moteurs_ia_499c34b6")}
            title={i18nT("informations_sur_les_moteurs_ia_499c34b6")}
            style={{ width: 16, height: 16, borderRadius: 999, border: "1px solid rgba(125,211,252,0.44)", background: "rgba(125,211,252,0.12)", color: "#bae6fd", display: "inline-grid", placeItems: "center", padding: 0, cursor: "pointer", fontSize: 10, fontWeight: 950, lineHeight: 1 }}
          >i</button>
        </div>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as AiPreferredEngine)}
          disabled={disabled}
          style={{ width: "100%", minHeight: 46, borderRadius: 16, border: "1px solid rgba(255,255,255,0.16)", background: "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.06) 100%)", color: "white", padding: "10px 14px", fontSize: 13, fontWeight: 760, outline: "none", opacity: disabled ? 0.68 : 1 }}
        >
          {AI_ENGINE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} style={{ color: "#111" }}>
              {option.label}{option.value === defaultValue ? i18nT("defaut_9e21a00d") : ""}
            </option>
          ))}
        </select>
      </div>
      <AiEngineInfoModal open={infoOpen} activeEngine={value} onClose={() => setInfoOpen(false)} />
    </>
  );
}

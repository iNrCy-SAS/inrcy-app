"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  applyAppAppearanceTheme,
  readStoredAppAppearanceTheme,
  saveAppAppearanceTheme,
  type AppAppearanceTheme,
} from "@/lib/appAppearanceTheme";

const THEMES: readonly AppAppearanceTheme[] = [
  "original",
  "midnight",
  "graphite",
  "soft-violet",
  "pearl-light",
  "azure-light",
] as const;

const PREVIEW_BACKGROUNDS: Record<AppAppearanceTheme, string> = {
  original: "radial-gradient(circle at 18% 15%, rgba(56,189,248,.42), transparent 38%), radial-gradient(circle at 82% 18%, rgba(167,139,250,.42), transparent 40%), linear-gradient(145deg, #0b1026, #160d2d)",
  midnight: "radial-gradient(circle at 18% 15%, rgba(45,212,191,.58), transparent 40%), radial-gradient(circle at 82% 18%, rgba(16,185,129,.42), transparent 42%), linear-gradient(145deg, #0b5962, #03262d)",
  graphite: "radial-gradient(circle at 18% 15%, rgba(251,146,60,.62), transparent 40%), radial-gradient(circle at 82% 18%, rgba(239,68,68,.46), transparent 42%), linear-gradient(145deg, #7a321d, #280b0a)",
  "soft-violet": "radial-gradient(circle at 18% 15%, rgba(236,72,153,.58), transparent 40%), radial-gradient(circle at 82% 18%, rgba(168,85,247,.61), transparent 42%), linear-gradient(145deg, #672178, #250b35)",
  "pearl-light": "radial-gradient(circle at 18% 15%, rgba(244,114,182,.32), transparent 40%), radial-gradient(circle at 82% 18%, rgba(251,146,60,.26), transparent 42%), linear-gradient(145deg, #f7eee9, #e6d8d2)",
  "azure-light": "radial-gradient(circle at 18% 15%, rgba(34,211,238,.34), transparent 40%), radial-gradient(circle at 82% 18%, rgba(59,130,246,.27), transparent 42%), linear-gradient(145deg, #eef9fc, #d5e8ef)",
};

function translationSuffix(theme: AppAppearanceTheme) {
  return theme.replace("-", "_");
}

export default function AppAppearancePicker() {
  const t = useTranslations("settings");
  const [theme, setTheme] = useState<AppAppearanceTheme>("original");
  const activeSuffix = translationSuffix(theme);

  useEffect(() => {
    const storedTheme = readStoredAppAppearanceTheme();
    setTheme(storedTheme);
    applyAppAppearanceTheme(storedTheme);
  }, []);

  const selectTheme = (nextTheme: AppAppearanceTheme) => {
    setTheme(saveAppAppearanceTheme(nextTheme));
  };

  return (
    <section
      data-local-appearance-preview
      style={{ display: "grid", gap: 12 }}
      aria-labelledby="inrcy-appearance-title"
    >
      <div>
        <div
          id="inrcy-appearance-title"
          style={{
            color: "var(--inrcy-theme-text-primary, rgba(255,255,255,0.94))",
            fontSize: 13,
            fontWeight: 950,
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          {t("appearance_title")}
        </div>
        <div style={{ marginTop: 6, color: "var(--inrcy-theme-text-secondary, rgba(255,255,255,0.70))", fontSize: 12.5, lineHeight: 1.5 }}>
          {t("appearance_description")}
        </div>
      </div>

      <div
        style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "58px minmax(0, 1fr)",
          alignItems: "center",
          gap: 12,
          padding: 10,
          borderRadius: 15,
          border: "1px solid var(--inrcy-theme-accent-border, rgba(103,232,249,0.42))",
          background: "var(--inrcy-theme-selected-background, rgba(56,189,248,0.09))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "relative",
            width: 58,
            height: 48,
            overflow: "hidden",
            borderRadius: 11,
            border: "1px solid var(--inrcy-theme-border, rgba(255,255,255,0.16))",
            background: PREVIEW_BACKGROUNDS[theme],
            boxShadow: "0 8px 18px rgba(15,23,42,0.16)",
          }}
        >
          <span style={{ position: "absolute", left: 7, right: 7, top: 8, height: 5, borderRadius: 999, background: "linear-gradient(90deg, #38bdf8, #a78bfa, #f472b6)" }} />
          <span style={{ position: "absolute", left: 7, width: 18, bottom: 7, height: 18, borderRadius: 6, border: "1px solid rgba(125,211,252,.24)", background: "rgba(8,15,35,.88)" }} />
          <span style={{ position: "absolute", left: 29, right: 7, bottom: 7, height: 18, borderRadius: 6, border: "1px solid rgba(167,139,250,.22)", background: "rgba(13,16,39,.84)" }} />
        </span>

        <span style={{ minWidth: 0, display: "grid", gap: 6 }}>
          <select
            aria-label={t("appearance_title")}
            value={theme}
            onChange={(event) => selectTheme(event.target.value as AppAppearanceTheme)}
            style={{
              width: "100%",
              minWidth: 0,
              height: 40,
              borderRadius: 11,
              border: "1px solid var(--inrcy-theme-border-strong, rgba(255,255,255,0.18))",
              background: "var(--inrcy-theme-field-background, rgba(8,15,32,0.76))",
              color: "var(--inrcy-theme-text-primary, white)",
              padding: "0 36px 0 11px",
              fontSize: 12.5,
              fontWeight: 850,
              outline: "none",
              cursor: "pointer",
            }}
          >
            {THEMES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {t(`appearance_theme_${translationSuffix(candidate)}_name`)}
              </option>
            ))}
          </select>
          <span style={{ color: "var(--inrcy-theme-text-muted, rgba(255,255,255,0.62))", fontSize: 10.5, lineHeight: 1.35 }}>
            {t(`appearance_theme_${activeSuffix}_description`)}
          </span>
        </span>
      </div>

      <div style={{ color: "var(--inrcy-theme-text-muted, rgba(255,255,255,0.52))", fontSize: 10.5, lineHeight: 1.45 }}>
        {t("appearance_local_preview_note")}
      </div>
    </section>
  );
}

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
  midnight: "radial-gradient(circle at 12% 3%, rgba(45,212,191,.40), transparent 43%), radial-gradient(circle at 94% 10%, rgba(16,185,129,.27), transparent 45%), radial-gradient(circle at 54% 110%, rgba(56,189,248,.19), transparent 48%), linear-gradient(145deg, #0a343a, #03171d)",
  graphite: "radial-gradient(circle at 12% 3%, rgba(245,158,11,.43), transparent 43%), radial-gradient(circle at 94% 10%, rgba(194,65,12,.31), transparent 45%), radial-gradient(circle at 54% 110%, rgba(251,191,36,.18), transparent 48%), linear-gradient(145deg, #3b241b, #130b09)",
  "soft-violet": "radial-gradient(circle at 12% 3%, rgba(192,132,252,.38), transparent 43%), radial-gradient(circle at 94% 10%, rgba(236,72,153,.28), transparent 45%), radial-gradient(circle at 54% 110%, rgba(139,92,246,.20), transparent 48%), linear-gradient(145deg, #392047, #130b1d)",
  "pearl-light": "radial-gradient(circle at 10% 0%, rgba(255,255,255,.94), transparent 45%), radial-gradient(circle at 94% 10%, rgba(244,114,182,.28), transparent 47%), radial-gradient(circle at 52% 110%, rgba(167,139,250,.20), transparent 50%), linear-gradient(145deg, #f4efec, #ddd2cd)",
  "azure-light": "radial-gradient(circle at 10% 0%, rgba(255,255,255,.93), transparent 45%), radial-gradient(circle at 94% 10%, rgba(56,189,248,.31), transparent 47%), radial-gradient(circle at 52% 110%, rgba(99,102,241,.18), transparent 50%), linear-gradient(145deg, #eef6f8, #ccdee7)",
};

const PREVIEW_ACCENTS: Record<AppAppearanceTheme, string> = {
  original: "linear-gradient(90deg, #38bdf8, #a78bfa, #f472b6)",
  midnight: "linear-gradient(90deg, #2dd4bf, #67e8f9, #34d399)",
  graphite: "linear-gradient(90deg, #f0cb86, #c78349, #a96337)",
  "soft-violet": "linear-gradient(90deg, #c084fc, #a78bfa, #ec4899)",
  "pearl-light": "linear-gradient(90deg, #cf86a6, #9885be, #cfa975)",
  "azure-light": "linear-gradient(90deg, #258ba8, #466db8, #83d9e2)",
};

const PREVIEW_GLOWS: Record<AppAppearanceTheme, string> = {
  original: "rgba(139,92,246,.24)",
  midnight: "rgba(45,212,191,.18)",
  graphite: "rgba(199,131,73,.18)",
  "soft-violet": "rgba(192,132,252,.19)",
  "pearl-light": "rgba(139,92,246,.14)",
  "azure-light": "rgba(14,165,233,.15)",
};

type PreviewSurfaces = {
  cardA: string;
  cardB: string;
  borderA: string;
  borderB: string;
  frameHighlight: string;
};

const PREVIEW_SURFACES: Record<AppAppearanceTheme, PreviewSurfaces> = {
  original: {
    cardA: "linear-gradient(145deg, rgba(8,20,43,.96), rgba(16,13,38,.94))",
    cardB: "linear-gradient(145deg, rgba(13,25,52,.95), rgba(29,14,49,.93))",
    borderA: "rgba(125,211,252,.26)",
    borderB: "rgba(167,139,250,.25)",
    frameHighlight: "rgba(255,255,255,.42)",
  },
  midnight: {
    cardA: "linear-gradient(145deg, rgba(8,55,59,.98), rgba(8,39,45,.97))",
    cardB: "linear-gradient(145deg, rgba(8,39,45,.98), rgba(10,32,42,.97))",
    borderA: "rgba(45,212,191,.42)",
    borderB: "rgba(42,147,164,.38)",
    frameHighlight: "rgba(255,255,255,.12)",
  },
  graphite: {
    cardA: "linear-gradient(145deg, rgba(57,45,31,.98), rgba(42,33,24,.97))",
    cardB: "linear-gradient(145deg, rgba(42,33,24,.98), rgba(35,25,21,.97))",
    borderA: "rgba(240,203,134,.42)",
    borderB: "rgba(199,131,73,.40)",
    frameHighlight: "rgba(255,255,255,.12)",
  },
  "soft-violet": {
    cardA: "linear-gradient(145deg, rgba(58,29,68,.98), rgba(43,24,55,.97))",
    cardB: "linear-gradient(145deg, rgba(43,24,55,.98), rgba(48,23,55,.97))",
    borderA: "rgba(169,108,196,.43)",
    borderB: "rgba(193,94,139,.40)",
    frameHighlight: "rgba(255,255,255,.12)",
  },
  "pearl-light": {
    cardA: "linear-gradient(145deg, rgba(54,42,60,.99), rgba(40,33,51,.98))",
    cardB: "linear-gradient(145deg, rgba(40,33,51,.99), rgba(56,36,54,.98))",
    borderA: "rgba(207,134,166,.48)",
    borderB: "rgba(152,133,190,.45)",
    frameHighlight: "rgba(255,255,255,.42)",
  },
  "azure-light": {
    cardA: "linear-gradient(145deg, rgba(19,54,72,.99), rgba(20,43,61,.98))",
    cardB: "linear-gradient(145deg, rgba(20,43,61,.99), rgba(21,38,62,.98))",
    borderA: "rgba(37,139,168,.48)",
    borderB: "rgba(70,109,184,.45)",
    frameHighlight: "rgba(255,255,255,.42)",
  },
};

function translationSuffix(theme: AppAppearanceTheme) {
  return theme.replace("-", "_");
}

export default function AppAppearancePicker() {
  const t = useTranslations("settings");
  const [theme, setTheme] = useState<AppAppearanceTheme>("original");
  const activeSuffix = translationSuffix(theme);
  const previewSurfaces = PREVIEW_SURFACES[theme];

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
            boxShadow: `0 10px 24px ${PREVIEW_GLOWS[theme]}, inset 0 1px 0 ${previewSurfaces.frameHighlight}`,
          }}
        >
          <span style={{ position: "absolute", left: 7, right: 7, top: 8, height: 5, borderRadius: 999, background: PREVIEW_ACCENTS[theme], boxShadow: `0 0 11px ${PREVIEW_GLOWS[theme]}` }} />
          <span style={{ position: "absolute", left: 7, width: 18, bottom: 7, height: 18, borderRadius: 6, border: `1px solid ${previewSurfaces.borderA}`, background: previewSurfaces.cardA, boxShadow: "inset 0 1px 0 rgba(255,255,255,.12)" }} />
          <span style={{ position: "absolute", left: 29, right: 7, bottom: 7, height: 18, borderRadius: 6, border: `1px solid ${previewSurfaces.borderB}`, background: previewSurfaces.cardB, boxShadow: "inset 0 1px 0 rgba(255,255,255,.10)" }} />
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

"use client";

import { useTranslations } from "next-intl";


import type { CSSProperties } from "react";
import type { ActusDesign, ActusLayout, ActusTheme } from "../dashboard.types";
import { ACTUS_DESIGN_OPTIONS, ACTUS_THEME_OPTIONS, normalizeActusAccent } from "../dashboard.types";

type Props = {
  layout: ActusLayout;
  setLayout: (value: ActusLayout) => void;
  limit: number;
  setLimit: (value: number) => void;
  design: ActusDesign;
  setDesign: (value: ActusDesign) => void;
  theme: ActusTheme;
  setTheme: (value: ActusTheme) => void;
  accent: string;
  setAccent: (value: string) => void;
};

const fieldStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(15,23,42,0.65)",
  colorScheme: "dark",
  padding: "10px 12px",
  color: "rgba(255,255,255,0.92)",
  outline: "none",
  minWidth: 0,
};

const labelStyle: CSSProperties = { display: "grid", gap: 6, minWidth: 0 };
const labelTextStyle: CSSProperties = { color: "rgba(255,255,255,0.72)", fontSize: 12 };

export default function ActusWidgetControls({
  layout,
  setLayout,
  limit,
  setLimit,
  design,
  setDesign,
  theme,
  setTheme,
  accent,
  setAccent,
}: Props) {
  const i18nT = useTranslations("shell");
  const pickerValue = normalizeActusAccent(accent) || "#6BD05F";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 10 }}>
      <label style={labelStyle}>
        <span style={labelTextStyle}><strong>{i18nT("affichage_bc8f3ed6")}</strong></span>
        <select value={layout} onChange={(event) => setLayout(event.target.value as ActusLayout)} style={fieldStyle}>
          <option value="list">{i18nT("liste_4231be17")}</option>
          <option value="carousel">{i18nT("carrousel_ef862f23")}</option>
          <option value="grid">{i18nT("grille_25ee2ce6")}</option>
          <option value="compact">{i18nT("compact_1df39aa5")}</option>
        </select>
      </label>

      <label style={labelStyle}>
        <span style={labelTextStyle}><strong>{i18nT("nombre_d_apos_actus_20760d1f")}</strong></span>
        <select value={String(limit)} onChange={(event) => setLimit(Math.min(10, Math.max(3, Number(event.target.value) || 5)))} style={fieldStyle}>
          {[3, 5, 10].map((value) => <option key={value} value={value}>{i18nT("value_derni_egrave_res_actus_50184f28", { value0: value })}</option>)}
        </select>
      </label>

      <label style={labelStyle}>
        <span style={labelTextStyle}><strong>{i18nT("design_59b03536")}</strong></span>
        <select value={design} onChange={(event) => setDesign(event.target.value as ActusDesign)} style={fieldStyle}>
          {ACTUS_DESIGN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>

      <label style={labelStyle}>
        <span style={labelTextStyle}><strong>{i18nT("couleurs_430c961a")}</strong></span>
        <select value={theme} onChange={(event) => setTheme(event.target.value as ActusTheme)} style={fieldStyle}>
          {ACTUS_THEME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>

      {theme === "custom" ? <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
        <span style={labelTextStyle}><strong>{i18nT("couleur_de_l_apos_iframe_3e03b36a")}</strong></span>
        <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0, 1fr)", gap: 8, minWidth: 0 }}>
          <input
            type="color"
            value={pickerValue}
            onChange={(event) => setAccent(event.target.value.toUpperCase())}
            aria-label={i18nT("choisir_la_couleur_de_l_iframe_88c997a7")}
            style={{ width: 52, height: 42, padding: 3, borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(15,23,42,0.65)", cursor: "pointer" }}
          />
          <input
            type="text"
            value={accent}
            onChange={(event) => setAccent(event.target.value.toUpperCase())}
            placeholder={i18nT("choisissez_une_couleur_ex_d97706_643f037a")}
            inputMode="text"
            aria-label={i18nT("code_hexadecimal_de_la_couleur_de_7bd2fad5")}
            style={fieldStyle}
          />
        </div>
        <span style={{ ...labelTextStyle, opacity: 0.72 }}>{i18nT("choisissez_la_couleur_principale_de_votre_16137564")}</span>
      </label> : null}
    </div>
  );
}

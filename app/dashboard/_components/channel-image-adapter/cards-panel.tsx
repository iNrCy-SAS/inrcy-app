import { useTranslations } from "next-intl";
import React from "react";

import type { CardsPanelProps, ChannelTab } from "./types";

import { useViewportWidth } from "./hooks";

import { FinalImageFrame } from "./frames";

import { ChannelPublicationPreview } from "./publication-preview";


export function ChannelImageAdapterCardsPanel({
  tabs,
  activeChannel,
  onActiveChannelChange,
  channelTitle,
  formatLabel,
  aspectRatio,
  items,
  buttonClassName,
  pillButtonStyle,
  pillButtonActiveStyle,
  showTabs = true,
  emptyMessage,
  publicationPreview,
}: CardsPanelProps) {
  const i18nT = useTranslations("shell");
  const viewportWidth = useViewportWidth();

  const isNarrow = viewportWidth <= 560;
  const cardColumnCount = isNarrow
    ? 1
    : viewportWidth <= 920
      ? 2
      : viewportWidth <= 1180
        ? 3
        : viewportWidth <= 1420
          ? 4
          : 5;
  const cardGridTemplate = `repeat(${cardColumnCount}, minmax(0, 1fr))`;
  const statusStyles: Record<NonNullable<ChannelTab["tone"]>, React.CSSProperties> = {
    ready: { border: "1px solid rgba(34,197,94,0.34)", color: "#bbf7d0", background: "rgba(34,197,94,0.10)" },
    warning: { border: "1px solid rgba(251,191,36,0.36)", color: "#fde68a", background: "rgba(251,191,36,0.10)" },
    blocked: { border: "1px solid rgba(248,113,113,0.38)", color: "#fecaca", background: "rgba(248,113,113,0.10)" },
    empty: { border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.72)", background: "rgba(255,255,255,0.045)" },
  };

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {showTabs ? (
        <div
          style={{
            display: isNarrow ? "grid" : "flex",
            gridTemplateColumns: isNarrow
              ? "repeat(2, minmax(0, 1fr))"
              : undefined,
            gap: 8,
            flexWrap: isNarrow ? undefined : "wrap",
            overflowX: "hidden",
          }}
        >
          {tabs.map((tab) => {
            const statusStyle = tab.tone ? statusStyles[tab.tone] : undefined;
            const isActive = activeChannel === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onActiveChannelChange(tab.key)}
                title={tab.tone === "blocked" ? "Correction requise" : tab.tone === "warning" ? "À vérifier" : tab.tone === "ready" ? "Prêt" : undefined}
                style={{
                  ...pillButtonStyle,
                  ...(statusStyle || {}),
                  ...(isActive
                    ? statusStyle
                      ? {
                          boxShadow:
                            "0 0 0 1px rgba(76,195,255,0.25) inset, 0 0 14px rgba(76,195,255,0.16)",
                        }
                      : pillButtonActiveStyle
                    : {}),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: isNarrow ? 4 : 7,
                  whiteSpace: "nowrap",
                  width: isNarrow ? "100%" : undefined,
                  minWidth: 0,
                  maxWidth: "100%",
                  minHeight: isNarrow ? 34 : undefined,
                  padding: isNarrow ? "0 6px" : pillButtonStyle?.padding,
                  fontSize: isNarrow ? 12 : pillButtonStyle?.fontSize,
                  lineHeight: isNarrow ? 1 : pillButtonStyle?.lineHeight,
                  boxSizing: "border-box",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "clip",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab.label}
                </span>
                {typeof tab.count === "number" ? (
                  <span
                    style={{
                      flex: "0 0 auto",
                      minWidth: isNarrow ? 18 : 20,
                      height: isNarrow ? 18 : 20,
                      padding: isNarrow ? "0 4px" : "0 6px",
                      borderRadius: 999,
                      display: "inline-grid",
                      placeItems: "center",
                      fontSize: isNarrow ? 10 : 11,
                      fontWeight: 900,
                      background: "rgba(255,255,255,0.12)",
                      color: "inherit",
                    }}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 18, padding: isNarrow ? 10 : 14, background: "rgba(255,255,255,0.03)", display: "grid", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontWeight: 900 }}>{i18nT("images_de_la_publication_85bb3522")}</div>
            <div style={{ fontSize: 12, opacity: 0.66 }}>{i18nT("canal_value_selectionnez_les_images_changez_33a9c68c", { value0: channelTitle })}</div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.78 }}>{formatLabel}</div>
        </div>

        {items.length ? (
          <div style={{ display: "grid", gridTemplateColumns: cardGridTemplate, gap: 12, alignItems: "stretch", justifyContent: "start", minWidth: 0 }}>
            {items.map((item) => {
              const isDisabled = !!item.disabled && !item.included;
              return (
              <div
                key={item.key}
                style={{
                  width: "100%",
                  maxWidth: "none",
                  minWidth: 0,
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 18,
                  padding: 10,
                  background: item.included ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.025)",
                  display: "grid",
                  gridTemplateRows: "auto auto auto 1fr",
                  gap: 8,
                  opacity: isDisabled ? 0.48 : 1,
                }}
              >
                <div style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}>
                  <FinalImageFrame
                    image={{ previewUrl: item.previewUrl, transform: item.transform, preset: item.preset, imageMeta: item.imageMeta }}
                    aspectRatio={item.previewAspectRatio || aspectRatio}
                    fallbackMode={item.backgroundMode}
                    fitLabel={item.fitLabel}
                  />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, cursor: isDisabled ? "not-allowed" : "pointer", minWidth: 0 }}>
                  <input type="checkbox" checked={item.included} disabled={isDisabled} onChange={isDisabled ? undefined : item.onToggle} style={{ width: 16, height: 16, accentColor: "#4cc3ff", flex: "0 0 auto" }} />
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: viewportWidth > 920 ? 11 : 13,
                      flexShrink: viewportWidth > 920 ? 0 : 1,
                    }}
                  >
                    {item.title}
                  </span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: 10,
                      fontWeight: 900,
                      padding: "4px 7px",
                      borderRadius: 999,
                      background:
                        item.fitLabel === "Adaptée"
                          ? "rgba(76,195,255,0.14)"
                          : item.fitLabel === "Personnalisée"
                            ? "rgba(192,132,252,0.14)"
                            : item.fitLabel === "Plein cadre"
                              ? "rgba(76,195,255,0.14)"
                              : "rgba(255,255,255,0.08)",
                      color:
                        item.fitLabel === "Adaptée"
                          ? "#bae6fd"
                          : item.fitLabel === "Personnalisée"
                            ? "#e9d5ff"
                            : item.fitLabel === "Plein cadre"
                              ? "#bae6fd"
                              : "rgba(255,255,255,0.76)",
                      border:
                        item.fitLabel === "Adaptée"
                          ? "1px solid rgba(76,195,255,0.24)"
                          : item.fitLabel === "Personnalisée"
                            ? "1px solid rgba(192,132,252,0.26)"
                            : item.fitLabel === "Plein cadre"
                              ? "1px solid rgba(76,195,255,0.24)"
                              : "1px solid rgba(255,255,255,0.10)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.fitLabel}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, padding: "4px 7px", borderRadius: 999, background: item.included ? "rgba(34,197,94,0.13)" : "rgba(255,255,255,0.06)", color: item.included ? "#bbf7d0" : "rgba(255,255,255,0.62)", border: item.included ? "1px solid rgba(34,197,94,0.22)" : "1px solid rgba(255,255,255,0.08)" }}>
                    {item.included ? i18nT("incluse_8c79d3a2") : i18nT("ignoree_2b9acddb")}
                  </span>
                </label>

                <div style={{ fontSize: 11, opacity: 0.68, minHeight: 28, lineHeight: 1.35 }}>{item.subtitle}</div>

                <div style={{ display: "grid", gap: 7, alignSelf: "end" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "34px 1fr 34px 34px", gap: 6 }}>
                    <button type="button" className={buttonClassName} onClick={item.onMovePrevious} disabled={!item.onMovePrevious} title={i18nT("image_precedente_635f9e95")} style={{ justifyContent: "center", opacity: item.onMovePrevious ? 1 : 0.45, padding: "0 8px" }}>←</button>
                    <button type="button" className={buttonClassName} onClick={item.onAdapt} style={{ justifyContent: "center", padding: "0 10px" }}>{i18nT("adapter_e6b4616c")}</button>
                    {item.onReset ? <button type="button" className={buttonClassName} onClick={item.onReset} aria-label={i18nT("reinitialiser_value_cecceaa0", { value0: item.title })} style={{ justifyContent: "center", padding: "0 8px" }}>↺</button> : <span />}
                    <button type="button" className={buttonClassName} onClick={item.onMoveNext} disabled={!item.onMoveNext} title={i18nT("image_suivante_656228da")} style={{ justifyContent: "center", opacity: item.onMoveNext ? 1 : 0.45, padding: "0 8px" }}>→</button>
                  </div>
                  {(item.onRemove || item.onRemoveEverywhere) ? (
                    <div style={{ display: "grid", gridTemplateColumns: item.onRemove && item.onRemoveEverywhere ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 6, minWidth: 0 }}>
                      {item.onRemove ? (
                        <button type="button" className={buttonClassName} onClick={item.onRemove} title={item.removeLabel || "Retirer"} aria-label={`${item.removeLabel || "Retirer"} : ${item.title}`} style={{ minWidth: 0, maxWidth: "100%", justifyContent: "center", fontSize: 11, padding: "0 7px" }}>{item.removeLabel || i18nT("retirer_54ec24a1")}</button>
                      ) : null}
                      {item.onRemoveEverywhere ? (
                        <button type="button" className={buttonClassName} onClick={item.onRemoveEverywhere} title={item.removeEverywhereLabel || "Supprimer partout"} aria-label={`${item.removeEverywhereLabel || "Supprimer partout"} : ${item.title}`} style={{ minWidth: 0, maxWidth: "100%", justifyContent: "center", fontSize: 10.5, padding: "0 7px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.24)", color: "#fecaca" }}>{item.removeEverywhereLabel || i18nT("supprimer_partout_dfb790c4")}</button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.75 }}>{emptyMessage || i18nT("aucune_image_768c8a5c")}</div>
        )}
      </div>

      {publicationPreview ? (
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <ChannelPublicationPreview preview={publicationPreview} />
        </div>
      ) : null}
    </div>
  );
}

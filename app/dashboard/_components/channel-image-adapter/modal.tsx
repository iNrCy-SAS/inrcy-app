import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";

import { useUnsavedExitGuard } from "../../_hooks/useUnsavedExitGuard";

import type { BackgroundMode, ModalProps } from "./types";

import { legacyColorFromMode, MOBILE_DOCK_HEIGHT, normalizedMode, previewBackgroundStyle } from "./utils";


export function ChannelImageAdapterModal({
  open,
  title,
  subtitle,
  aspectRatio,
  backgroundMode,
  backgroundColor,
  fitLabel,
  zoomLabel,
  previewSrc,
  previewImageStyle,
  previewLayout,
  isDragging,
  onClose,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  previewRef,
  onImageMouseDown,
  buttonClassName,
  primaryButtonClassName,
  onZoomOut,
  onZoomIn,
  onContain,
  onCover,
  onReset,
  onSave,
  saving = false,
  onApplyToSelectedChannels,
  onApplyToChannelImages,
  onResetChannel,
  isolationNote,
  onBackgroundModeChange,
  onBackgroundColorChange,
  pillButtonStyle,
  pillButtonActiveStyle,
  sidebarItems,
}: ModalProps) {
  const i18nT = useTranslations("shell");
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window === "undefined" ? 1440 : window.innerWidth);
  const [showBefore, setShowBefore] = useState(false);
  const [adapterBaseline, setAdapterBaseline] = useState("");
  const adapterSnapshot = JSON.stringify({ backgroundMode, backgroundColor, fitLabel, zoomLabel });

  useEffect(() => {
    setAdapterBaseline(open ? adapterSnapshot : "");
  }, [open]);

  const { confirmExit } = useUnsavedExitGuard({
    active: open,
    shouldBlock: Boolean(adapterBaseline) && adapterSnapshot !== adapterBaseline,
    onConfirmExit: onClose,
    eyebrow: i18nT("adaptation_d_image_686ac537"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message: i18nT("cette_adaptation_contient_des_modifications_non_266cfa72"),
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  useEffect(() => {
    if (!open) return;
    setShowBefore(false);
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  if (!open) return null;

  const hasLayout = !!previewLayout;
  const normalizedBgMode = normalizedMode(backgroundMode);
  const bgMode = normalizedBgMode;
  const bgFill = legacyColorFromMode(backgroundMode, backgroundColor);
  const previewBg = previewBackgroundStyle(backgroundMode, backgroundColor);

  const isMobile = viewportWidth <= 768;
  const isTinyMobile = viewportWidth <= 390;
  const isCompact = viewportWidth <= 1180;
  const mobileOuterPadding = isTinyMobile ? 8 : 10;
  const mobileViewportWidth = `calc(100dvw - ${mobileOuterPadding * 2}px)`;
  const mobileViewportHeight = `calc(100dvh - ${MOBILE_DOCK_HEIGHT} - ${mobileOuterPadding * 2}px)`;
  const modalWidth = isMobile ? mobileViewportWidth : "min(1580px, calc(100vw - 28px))";
  const modalHeight = isMobile ? mobileViewportHeight : "min(940px, calc(100dvh - 28px))";
  const modalPadding = isTinyMobile ? 10 : isMobile ? 12 : 18;
  const previewMinHeight = isMobile ? (isTinyMobile ? 150 : 180) : isCompact ? 320 : 0;
  const previewHeight = isMobile ? "clamp(150px, 42dvh, 260px)" : undefined;
  const controlsGridColumns = isMobile ? "repeat(2, minmax(0, 1fr))" : "48px 48px 1fr 1fr";
  const contentGridTemplateColumns = isMobile ? undefined : isCompact ? "minmax(0, 1fr)" : "minmax(0, 1fr) 300px 320px";
  const contentGridTemplateRows = isMobile ? undefined : isCompact ? "auto auto auto" : undefined;
  const isFullFrame = fitLabel === "Plein cadre";
  const fitModeButtonStyle = (active: boolean): React.CSSProperties => ({
    justifyContent: "center",
    minWidth: 0,
    whiteSpace: "normal",
    lineHeight: 1.1,
    textAlign: "center",
    ...(active
      ? {
          borderColor: "rgba(76,195,255,0.48)",
          background: "rgba(76,195,255,0.14)",
          boxShadow: "0 0 0 1px rgba(76,195,255,0.16) inset",
        }
      : {}),
  });
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, bottom: isMobile ? MOBILE_DOCK_HEIGHT : undefined, height: isMobile ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})` : undefined, maxHeight: isMobile ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})` : undefined, zIndex: 10020, background: "rgba(4, 8, 18, 0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "grid", placeItems: isMobile ? "stretch" : "center", padding: isMobile ? mobileOuterPadding : 16, overflow: "hidden", boxSizing: "border-box" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: modalWidth, maxWidth: isMobile ? mobileViewportWidth : "100%", height: modalHeight, maxHeight: isMobile ? mobileViewportHeight : "100%", minWidth: 0, minHeight: 0, alignSelf: isMobile ? "stretch" : undefined, justifySelf: isMobile ? "stretch" : undefined, borderRadius: isMobile ? 20 : 28, border: "1px solid rgba(255,255,255,0.12)", background: "linear-gradient(180deg, rgba(24,28,42,0.985), rgba(14,17,28,0.985))", boxShadow: "0 28px 100px rgba(0,0,0,0.5)", padding: modalPadding, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: isMobile ? 10 : 16, overflow: "hidden", boxSizing: "border-box" }}>
        <div style={{ display: isMobile ? "grid" : "flex", alignItems: isMobile ? "start" : "center", justifyContent: "space-between", gap: isMobile ? 8 : 12, minHeight: isMobile ? "auto" : 52, flexWrap: "wrap", minWidth: 0 }}>
          <div style={{ minWidth: 0, flex: "1 1 280px", paddingLeft: isMobile ? "max(6px, env(safe-area-inset-left))" : 0, paddingRight: isMobile ? 4 : 0, boxSizing: "border-box" }}>
            <div style={{ fontWeight: 900, fontSize: isMobile ? 16 : 18, whiteSpace: isMobile ? "normal" : "nowrap", overflow: "visible", textOverflow: "ellipsis", lineHeight: 1.2, overflowWrap: "anywhere", wordBreak: "break-word", paddingLeft: isMobile ? 2 : 0 }}>
              {title}
            </div>
            <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4, overflowWrap: "anywhere", paddingLeft: isMobile ? 2 : 0 }}>{subtitle}</div>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", gap: isMobile ? 6 : 8, flexShrink: 1, flexWrap: "wrap", justifyContent: isMobile ? "stretch" : "flex-end", width: isMobile ? "100%" : undefined, minWidth: 0, overflow: "visible", boxSizing: "border-box" }}>
            <button type="button" className={buttonClassName} onClick={onApplyToChannelImages} disabled={!onApplyToChannelImages} title={onApplyToChannelImages ? "Appliquer ce cadrage à toutes les images de ce canal" : "Disponible avec au moins 2 images sur ce canal"} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "1 1 0" : undefined, maxWidth: isMobile ? "none" : undefined, justifyContent: "center", alignItems: "center", fontSize: isMobile ? 11 : undefined, lineHeight: 1.1, padding: isMobile ? "0 6px" : "0 16px", whiteSpace: "normal", textAlign: "center", boxSizing: "border-box", opacity: onApplyToChannelImages ? 1 : 0.48, cursor: onApplyToChannelImages ? "pointer" : "not-allowed" }}>{i18nT("appliquer_partout_1c738082")}</button>
            {onApplyToSelectedChannels ? <button type="button" className={buttonClassName} onClick={onApplyToSelectedChannels} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "1 1 0" : undefined, justifyContent: "center", alignItems: "center", fontSize: isMobile ? 11 : undefined, lineHeight: 1.1, padding: isMobile ? "0 6px" : "0 16px", whiteSpace: "normal", textAlign: "center", boxSizing: "border-box" }}>{i18nT("appliquer_aux_canaux_03aeae7e")}</button> : null}
            {onResetChannel ? <button type="button" className={buttonClassName} onClick={onResetChannel} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "1 1 0" : undefined, justifyContent: "center", alignItems: "center", fontSize: isMobile ? 11 : undefined, lineHeight: 1.1, padding: isMobile ? "0 6px" : "0 16px", whiteSpace: "nowrap", textAlign: "center", boxSizing: "border-box" }}>{i18nT("reinit_canal_bae403c5")}</button> : null}
            <button type="button" className={primaryButtonClassName || buttonClassName} onClick={onSave} disabled={saving} aria-busy={saving} aria-label={saving ? "Enregistrement en cours" : "Enregistrer"} title={saving ? "Enregistrement en cours" : "Enregistrer"} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "0 0 42px" : undefined, width: isMobile ? 42 : undefined, padding: isMobile ? 0 : "0 16px", justifyContent: "center", alignItems: "center", fontSize: isMobile ? 18 : undefined, boxSizing: "border-box", cursor: saving ? "wait" : undefined, opacity: saving ? 0.68 : 1 }}>{saving ? (isMobile ? "…" : i18nT("enregistrement_e7d5f232")) : isMobile ? "💾" : i18nT("enregistrer_f7c8bcd8")}</button>
            <button type="button" className={buttonClassName} onClick={() => void confirmExit()} aria-label={i18nT("fermer_5ab4ec64")} title={i18nT("fermer_5ab4ec64")} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "0 0 42px" : undefined, width: isMobile ? 42 : undefined, padding: isMobile ? 0 : "0 16px", justifyContent: "center", alignItems: "center", fontSize: isMobile ? 20 : undefined, boxSizing: "border-box" }}>{isMobile ? "×" : i18nT("fermer_5ab4ec64")}</button>
          </div>
        </div>

        <div style={{ minHeight: 0, minWidth: 0, width: "100%", maxWidth: "100%", display: isMobile ? "flex" : "grid",
    flexDirection: isMobile ? "column" : undefined, gridTemplateColumns: contentGridTemplateColumns, gridTemplateRows: contentGridTemplateRows, gap: isMobile ? 18 : 18, alignItems: "stretch", overflowY: "auto", overflowX: "hidden", paddingRight: isMobile ? 0 : 0, paddingBottom: isMobile ? "max(72px, env(safe-area-inset-bottom))" : 0, WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", boxSizing: "border-box" }}>
          <div style={{ minWidth: 0, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateRows: isMobile ? undefined : "minmax(0, 1fr) auto", gap: isMobile ? 10 : undefined, order: isMobile ? 2 : 1, flex: isMobile ? "0 0 auto" : undefined }}>
            <div style={{ minWidth: 0, width: "100%", minHeight: previewMinHeight, height: previewHeight, maxHeight: isMobile ? "42dvh" : undefined, display: "grid", placeItems: "center", borderRadius: isMobile ? 18 : 24, border: "1px solid rgba(255,255,255,0.10)", background: "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.02))", padding: isMobile ? 6 : 14, overflow: "hidden", flex: isMobile ? "0 0 auto" : undefined, boxSizing: "border-box" }}>
              <div
                ref={previewRef}
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onDoubleClick={onDoubleClick}
                style={{ position: "relative", width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", aspectRatio, borderRadius: isMobile ? 16 : 22, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", ...previewBg, cursor: isDragging ? "grabbing" : "grab", touchAction: "none", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03)" }}
              >
                {showBefore ? (
                  <img src={previewSrc} alt={i18nT("apercu_avant_eb65d0c1")} draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", background: "rgba(255,255,255,0.04)" }} />
                ) : hasLayout && previewLayout ? (
                  <img src={previewSrc} alt="preview" draggable={false} style={{ position: "absolute", left: previewLayout.dx, top: previewLayout.dy, width: previewLayout.drawW, height: previewLayout.drawH, maxWidth: "none", pointerEvents: "none", userSelect: "none" }} />
                ) : (
                  <img src={previewSrc} alt="preview" draggable={false} style={previewImageStyle} onMouseDown={onImageMouseDown} />
                )}
                <div style={{ position: "absolute", inset: 12, borderRadius: 16, border: "1px solid rgba(255,255,255,0.14)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.14)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", pointerEvents: "none", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}>{showBefore ? i18nT("image_source_bbdaeab9") : `${fitLabel} • ${zoomLabel}`}</div>
                  {!isMobile ? <div style={{ fontSize: 11, padding: "6px 10px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}>{i18nT("glisser_molette_double_clic_292d179a")}</div> : null}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.72, padding: isMobile ? "12px 10px 0" : "10px 2px 0", lineHeight: 1.55, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "break-word", wordBreak: "normal" }}>{i18nT("deplacez_l_image_ajustez_le_zoom_b7f704f4")}{" "}{isolationNote || i18nT("ces_reglages_concernent_uniquement_ce_canal_c0d2ebf2")}</div>
          </div>

          <div style={{ minWidth: 0, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, alignContent: "start", gap: 12, order: isMobile ? 2 : 1, flex: isMobile ? "0 0 auto" : undefined }}>
            <div style={{ display: "grid", gap: 8, padding: isMobile ? 12 : 14, borderRadius: 20, minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><div style={{ fontSize: 12, opacity: 0.82 }}>{i18nT("cadrage_4e72389f")}</div><div style={{ fontSize: 11, opacity: 0.55 }}>{fitLabel} • {zoomLabel}</div></div>
              <div style={{ display: "grid", gridTemplateColumns: controlsGridColumns, gap: 8 }}>
                <button type="button" className={buttonClassName} onClick={onZoomOut} style={{ justifyContent: "center" }}>−</button>
                <button type="button" className={buttonClassName} onClick={onZoomIn} style={{ justifyContent: "center" }}>+</button>
                <button type="button" className={buttonClassName} onClick={onContain} style={fitModeButtonStyle(!isFullFrame)}>{i18nT("image_entiere_76cd8175")}</button>
                <button type="button" className={buttonClassName} onClick={onCover} style={fitModeButtonStyle(isFullFrame)}>{i18nT("plein_cadre_96d0dd78")}</button>
              </div>
              <button type="button" className={buttonClassName} onClick={() => setShowBefore((value) => !value)} style={{ width: "100%", justifyContent: "center" }}>{showBefore ? i18nT("voir_le_rendu_final_4a4bf480") : i18nT("comparer_avant_rendu_1c1bbf82")}</button>
              <button type="button" className={buttonClassName} onClick={onReset} style={{ width: "100%", justifyContent: "center" }}>{i18nT("reinitialiser_cette_image_b1b8c601")}</button>
            </div>

            <div style={{ display: "grid", gap: 6, padding: 12, borderRadius: 18, minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid rgba(76,195,255,0.18)", background: "rgba(76,195,255,0.06)", fontSize: 12, lineHeight: 1.35 }}>
              <b>{i18nT("reglage_isole_0d378f04")}</b>
              <span style={{ opacity: 0.78 }}>{isolationNote || i18nT("ce_cadrage_ne_modifie_pas_les_4f51ff0e")}</span>
            </div>

            <div style={{ display: "grid", gap: 10, padding: isMobile ? 12 : 14, borderRadius: 20, minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              <div style={{ fontSize: 12, opacity: 0.82 }}>{i18nT("arriere_plan_d45252c1")}</div>
              <select value={bgMode} onChange={(e) => onBackgroundModeChange(e.target.value as BackgroundMode)} style={{ width: "100%", minHeight: 42, borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "#ffffff", color: "#111827", padding: "0 12px" }}>
                <option value="transparent" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("transparent_0491f7bd")}</option>
                <option value="white" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("blanc_f03e5122")}</option>
                <option value="black" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("noir_c34fc172")}</option>
                <option value="color" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("couleur_personnalisee_a2881bf3")}</option>
              </select>
              {bgMode === "color" ? (
                <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.82 }}>
                  <span>{i18nT("couleur_de_fond_84c3e127")}</span>
                  <input type="color" value={bgFill} onChange={(e) => onBackgroundColorChange?.(e.target.value)} style={{ width: "100%", height: 48, borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "transparent" }} />
                </label>
              ) : null}
            </div>
          </div>

          <div style={{ minWidth: 0, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateRows: isMobile ? undefined : "minmax(0, 1fr)", gap: 12, order: isMobile ? 3 : 2, flex: isMobile ? "0 0 auto" : undefined }}>
            {sidebarItems?.length ? (
              <div style={{ minHeight: 0, height: isMobile ? "auto" : "100%",
                marginTop: isMobile ? 8 : 0, display: "grid", gridTemplateRows: isMobile ? undefined : isCompact ? "auto auto" : "auto minmax(0, 1fr)", gap: 8, padding: 14, borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                <div style={{ fontSize: 12, opacity: 0.82 }}>{i18nT("images_du_canal_5ed27490")}</div>
                <div
                  style={{
                    minHeight: 0,
                    display: "grid",
                    gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : isCompact ? "repeat(auto-fit, minmax(min(180px, 100%), 1fr))" : undefined,
                    alignContent: "start",
                    gap: 8,
                    overflowX: "hidden",
                    overflowY: isMobile ? "visible" : "auto",
                    paddingRight: 2,
                    paddingBottom: isMobile ? 2 : 0,
                  }}
                >
                  {sidebarItems.map((item) => (
                    <button key={item.key} type="button" onClick={item.onClick} style={{ width: "100%", display: "grid", gridTemplateColumns: "60px minmax(0, 1fr)", gap: 10, alignItems: "center", textAlign: "left", borderRadius: 16, padding: 8, border: item.active ? "1px solid rgba(76,195,255,0.45)" : "1px solid rgba(255,255,255,0.08)", background: item.active ? "rgba(76,195,255,0.08)" : "rgba(255,255,255,0.03)", color: "inherit", cursor: "pointer", minWidth: 0, flex: undefined }}>
                      <img src={item.previewUrl} alt={item.title} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 12, display: "block" }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                          {item.fitLabel ? (
                            <span style={{ flex: "0 0 auto", fontSize: 9.5, fontWeight: 900, padding: "3px 6px", borderRadius: 999, background: item.fitLabel === "Plein cadre" ? "rgba(76,195,255,0.14)" : "rgba(255,255,255,0.08)", color: item.fitLabel === "Plein cadre" ? "#bae6fd" : "rgba(255,255,255,0.72)", border: item.fitLabel === "Plein cadre" ? "1px solid rgba(76,195,255,0.24)" : "1px solid rgba(255,255,255,0.10)", whiteSpace: "nowrap" }}>
                              {item.fitLabel}
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.68, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.subtitle}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

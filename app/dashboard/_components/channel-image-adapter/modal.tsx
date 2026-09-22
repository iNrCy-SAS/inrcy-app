import { useTranslations } from "next-intl";
import React, { useEffect, useId, useRef, useState } from "react";

import { useUnsavedExitGuard } from "../../_hooks/useUnsavedExitGuard";
import {
  getImageOverlayItems,
  MAX_IMAGE_OVERLAY_ITEMS,
  normalizeImageOverlay,
  resolveImageOverlayCoordinates,
  type ImageOverlay,
  type ImageOverlayFontFamily,
  type ImageOverlayItem,
} from "@/lib/imageOverlay";

import type { BackgroundMode, ModalProps } from "./types";

import { legacyColorFromMode, MOBILE_DOCK_HEIGHT, normalizedMode, previewBackgroundStyle } from "./utils";

type OverlayGesture = {
  pointerId: number;
  overlayIndex: number;
  mode: "move" | "resize";
  captureTarget: HTMLElement;
  stageWidth: number;
  stageHeight: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startLeft: number;
  startTop: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampOverlayCenter(value: number, size: number) {
  const half = size / 2;
  return clamp(value, half, 100 - half);
}

function createOverlayId() {
  return globalThis.crypto?.randomUUID?.() ||
    `overlay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function overlayFontFamily(value: ImageOverlayFontFamily | undefined) {
  if (value === "arial") return "Arial, sans-serif";
  if (value === "georgia") return "Georgia, serif";
  if (value === "verdana") return "Verdana, sans-serif";
  return "Inter, ui-sans-serif, system-ui, sans-serif";
}


export function ChannelImageAdapterModal({
  open,
  embedded = false,
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
  overlay,
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
  onOverlayChange,
  pillButtonStyle,
  pillButtonActiveStyle,
  sidebarItems,
}: ModalProps) {
  const i18nT = useTranslations("shell");
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window === "undefined" ? 1440 : window.innerWidth);
  const [containerWidth, setContainerWidth] = useState(0);
  const [showBefore, setShowBefore] = useState(false);
  const [activeOverlayIndex, setActiveOverlayIndex] = useState(0);
  const [adapterBaseline, setAdapterBaseline] = useState("");
  const overlayKeyboardInstructionsId = useId();
  const overlayGestureRef = useRef<OverlayGesture | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adapterSnapshot = JSON.stringify({ backgroundMode, backgroundColor, fitLabel, zoomLabel, overlay });

  useEffect(() => {
    setAdapterBaseline(open ? adapterSnapshot : "");
  }, [open]);

  const { confirmExit } = useUnsavedExitGuard({
    active: open && !embedded,
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

  useEffect(() => {
    if (!open || !embedded) return;
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      if (nextWidth > 0) setContainerWidth(nextWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [embedded, open]);

  const overlayItemCount = getImageOverlayItems(overlay).length;
  useEffect(() => {
    setActiveOverlayIndex((current) =>
      Math.max(0, Math.min(current, overlayItemCount - 1)),
    );
  }, [overlayItemCount]);

  if (!open) return null;

  const hasLayout = !!previewLayout;
  const normalizedBgMode = normalizedMode(backgroundMode);
  const bgMode = normalizedBgMode;
  const bgFill = legacyColorFromMode(backgroundMode, backgroundColor);
  const previewBg = previewBackgroundStyle(backgroundMode, backgroundColor);
  const normalizedOverlay = normalizeImageOverlay(overlay);
  const overlayItems = getImageOverlayItems(normalizedOverlay);
  const activeOverlay = overlayItems[activeOverlayIndex];
  const updateOverlay = (
    patch: Partial<ImageOverlayItem>,
    index = activeOverlayIndex,
  ) => {
    const current = overlayItems[index] || {
      id: createOverlayId(),
      text: "Nouveau texte",
      x: 50,
      y: 50,
      width: 68,
      height: 16,
      style: "solid" as const,
      fontFamily: "inter" as const,
      fontSize: 4.6,
      bold: true,
      color: "#ffffff",
      borderWidth: 0,
      borderColor: "#38bdf8",
    };
    const nextItems = overlayItems.length
      ? overlayItems.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item,
        )
      : [{ ...current, ...patch }];
    onOverlayChange?.(normalizeImageOverlay({ items: nextItems }));
  };
  const addOverlay = () => {
    if (overlayItems.length >= MAX_IMAGE_OVERLAY_ITEMS) return;
    const nextIndex = overlayItems.length;
    const nextItems = [
      ...overlayItems,
      {
        id: createOverlayId(),
        text: `Texte ${nextIndex + 1}`,
        x: 50,
        y: clamp(28 + nextIndex * 11, 18, 82),
        width: 68,
        height: 16,
        style: "solid" as const,
        fontFamily: "inter" as const,
        fontSize: 4.6,
        bold: true,
        color: "#ffffff",
        borderWidth: 0,
        borderColor: "#38bdf8",
      },
    ];
    onOverlayChange?.(normalizeImageOverlay({ items: nextItems }));
    setActiveOverlayIndex(nextIndex);
  };
  const removeOverlay = (index = activeOverlayIndex) => {
    const nextItems = overlayItems.filter((_, itemIndex) => itemIndex !== index);
    onOverlayChange?.(
      nextItems.length ? normalizeImageOverlay({ items: nextItems }) : undefined,
    );
    setActiveOverlayIndex((current) =>
      Math.max(0, Math.min(current, nextItems.length - 1)),
    );
  };
  const handleOverlayKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    overlayIndex: number,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    ) {
      return;
    }
    const current = overlayItems[overlayIndex];
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveOverlayIndex(overlayIndex);

    const coordinates = resolveImageOverlayCoordinates(current);
    const width = clamp(current.width ?? 68, 16, 96);
    const height = clamp(current.height ?? 16, 8, 92);
    const step = event.altKey ? 0.25 : 1;

    if (event.shiftKey) {
      const nextWidth = clamp(
        width +
          (event.key === "ArrowRight"
            ? step
            : event.key === "ArrowLeft"
              ? -step
              : 0),
        16,
        96,
      );
      const nextHeight = clamp(
        height +
          (event.key === "ArrowDown"
            ? step
            : event.key === "ArrowUp"
              ? -step
              : 0),
        8,
        92,
      );
      updateOverlay(
        {
          width: nextWidth,
          height: nextHeight,
          x: clampOverlayCenter(coordinates.x, nextWidth),
          y: clampOverlayCenter(coordinates.y, nextHeight),
        },
        overlayIndex,
      );
      return;
    }

    updateOverlay(
      {
        x: clampOverlayCenter(
          coordinates.x +
            (event.key === "ArrowRight"
              ? step
              : event.key === "ArrowLeft"
                ? -step
                : 0),
          width,
        ),
        y: clampOverlayCenter(
          coordinates.y +
            (event.key === "ArrowDown"
              ? step
              : event.key === "ArrowUp"
                ? -step
                : 0),
          height,
        ),
      },
      overlayIndex,
    );
  };
  const beginOverlayGesture = (
    event: React.PointerEvent<HTMLElement>,
    mode: OverlayGesture["mode"],
    overlayIndex: number,
  ) => {
    const gestureOverlay = overlayItems[overlayIndex];
    if (!gestureOverlay?.text) return;
    const stage = event.currentTarget.closest<HTMLElement>(
      '[data-adapter-preview-stage="true"]',
    );
    const overlayElement = event.currentTarget.closest<HTMLElement>(
      '[data-image-overlay="true"]',
    );
    if (!stage || !overlayElement) return;
    event.preventDefault();
    event.stopPropagation();
    const stageRect = stage.getBoundingClientRect();
    const overlayRect = overlayElement.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return;
    const coordinates = resolveImageOverlayCoordinates(gestureOverlay);
    const width = clamp(
      gestureOverlay.width ?? (overlayRect.width / stageRect.width) * 100,
      16,
      96,
    );
    const height = clamp(
      gestureOverlay.height ?? (overlayRect.height / stageRect.height) * 100,
      8,
      92,
    );
    event.currentTarget.setPointerCapture?.(event.pointerId);
    overlayGestureRef.current = {
      pointerId: event.pointerId,
      overlayIndex,
      mode,
      captureTarget: event.currentTarget,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: coordinates.x,
      startY: coordinates.y,
      startWidth: width,
      startHeight: height,
      startLeft: coordinates.x - width / 2,
      startTop: coordinates.y - height / 2,
    };
  };
  const moveOverlayGesture = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX =
      ((event.clientX - gesture.startClientX) / gesture.stageWidth) * 100;
    const deltaY =
      ((event.clientY - gesture.startClientY) / gesture.stageHeight) * 100;
    if (gesture.mode === "move") {
      updateOverlay({
        x: clampOverlayCenter(
          gesture.startX + deltaX,
          gesture.startWidth,
        ),
        y: clampOverlayCenter(
          gesture.startY + deltaY,
          gesture.startHeight,
        ),
      }, gesture.overlayIndex);
      return;
    }
    const width = clamp(
      gesture.startWidth + deltaX,
      16,
      Math.max(
        16,
        Math.min(96, 100 - Math.max(0, gesture.startLeft)),
      ),
    );
    const height = clamp(
      gesture.startHeight + deltaY,
      8,
      Math.max(
        8,
        Math.min(92, 100 - Math.max(0, gesture.startTop)),
      ),
    );
    updateOverlay({
      width,
      height,
      x: clampOverlayCenter(gesture.startLeft + width / 2, width),
      y: clampOverlayCenter(gesture.startTop + height / 2, height),
    }, gesture.overlayIndex);
  };
  const finishOverlayGesture = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (gesture.captureTarget.hasPointerCapture?.(event.pointerId)) {
      gesture.captureTarget.releasePointerCapture?.(event.pointerId);
    }
    overlayGestureRef.current = null;
  };

  const responsiveWidth = embedded && containerWidth > 0
    ? containerWidth
    : viewportWidth;
  const isMobile = responsiveWidth <= 768;
  const isTinyMobile = responsiveWidth <= 390;
  const isCompact = responsiveWidth <= 1180;
  const embeddedStacked = embedded && isCompact;
  const mobileOuterPadding = isTinyMobile ? 8 : 10;
  const mobileViewportWidth = `calc(100dvw - ${mobileOuterPadding * 2}px)`;
  const mobileViewportHeight = `calc(100dvh - ${MOBILE_DOCK_HEIGHT} - ${mobileOuterPadding * 2}px)`;
  const modalWidth = embedded
    ? "100%"
    : isMobile
      ? mobileViewportWidth
      : "min(1580px, calc(100vw - 28px))";
  const modalHeight = embedded
    ? embeddedStacked
      ? "auto"
      : "100%"
    : isMobile
      ? mobileViewportHeight
      : "min(940px, calc(100dvh - 28px))";
  const modalPadding = isTinyMobile ? 10 : isMobile ? 12 : 18;
  const previewMinHeight = isMobile
    ? isTinyMobile
      ? 150
      : 180
    : isCompact
      ? 220
      : 0;
  const previewHeight = isMobile
    ? "clamp(150px, 42dvh, 260px)"
    : embeddedStacked
      ? "clamp(220px, 34dvh, 280px)"
      : undefined;
  const controlsGridColumns = isMobile ? "repeat(2, minmax(0, 1fr))" : "48px 48px 1fr 1fr";
  const hasSidebar = Boolean(sidebarItems?.length);
  const contentGridTemplateColumns = isMobile
    ? undefined
    : isCompact
      ? "minmax(0, 1fr)"
      : hasSidebar
        ? "minmax(0, 1fr) 300px 320px"
        : "minmax(0, 0.92fr) minmax(520px, 1.08fr)";
  const contentGridTemplateRows = isMobile
    ? undefined
    : isCompact
      ? hasSidebar
        ? "auto auto auto"
        : "auto auto"
      : undefined;
  const settingsGridColumns =
    !isMobile && !isCompact && !hasSidebar
      ? "repeat(2, minmax(0, 1fr))"
      : undefined;
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
  const studioSelectStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 36,
    appearance: "none",
    WebkitAppearance: "none",
    border: "1px solid rgba(125, 211, 252, 0.2)",
    borderRadius: 11,
    color: "#f8fbff",
    backgroundColor: "#11182d",
    backgroundImage:
      "linear-gradient(45deg, transparent 50%, #67e8f9 50%), linear-gradient(135deg, #67e8f9 50%, transparent 50%), linear-gradient(135deg, rgba(76,195,255,0.10), rgba(192,132,252,0.10))",
    backgroundPosition:
      "calc(100% - 15px) 50%, calc(100% - 10px) 50%, 0 0",
    backgroundSize: "5px 5px, 5px 5px, 100% 100%",
    backgroundRepeat: "no-repeat",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
    padding: "0 34px 0 10px",
    colorScheme: "dark",
    cursor: "pointer",
  };
  const studioOptionStyle: React.CSSProperties = {
    color: "#f8fbff",
    background: "#11182d",
  };
  return (
    <div
      ref={containerRef}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label={embedded ? title : undefined}
      style={
        embedded
          ? {
              position: "relative",
              width: "100%",
              height: embeddedStacked ? "auto" : "100%",
              minWidth: 0,
              minHeight: 0,
              overflow: embeddedStacked ? "visible" : "hidden",
              boxSizing: "border-box",
            }
          : {
              position: "fixed",
              inset: 0,
              bottom: isMobile ? MOBILE_DOCK_HEIGHT : undefined,
              height: isMobile
                ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`
                : undefined,
              maxHeight: isMobile
                ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`
                : undefined,
              zIndex: 10020,
              background: "rgba(4, 8, 18, 0.78)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              display: "grid",
              placeItems: isMobile ? "stretch" : "center",
              padding: isMobile ? mobileOuterPadding : 16,
              overflow: "hidden",
              boxSizing: "border-box",
            }
      }
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: modalWidth,
          maxWidth: embedded ? "100%" : isMobile ? mobileViewportWidth : "100%",
          height: modalHeight,
          maxHeight: embedded
            ? embeddedStacked
              ? undefined
              : "100%"
            : isMobile
              ? mobileViewportHeight
              : "100%",
          minWidth: 0,
          minHeight: 0,
          alignSelf: isMobile && !embedded ? "stretch" : undefined,
          justifySelf: isMobile && !embedded ? "stretch" : undefined,
          borderRadius: embedded ? 0 : isMobile ? 20 : 28,
          border: embedded ? 0 : "1px solid rgba(255,255,255,0.12)",
          background: embedded
            ? "transparent"
            : "linear-gradient(180deg, rgba(24,28,42,0.985), rgba(14,17,28,0.985))",
          boxShadow: embedded ? "none" : "0 28px 100px rgba(0,0,0,0.5)",
          padding: embedded ? 0 : modalPadding,
          display: "grid",
          gridTemplateRows: embedded
            ? embeddedStacked
              ? "auto"
              : "minmax(0, 1fr)"
            : "auto minmax(0, 1fr)",
          gap: embedded ? 0 : isMobile ? 10 : 16,
          overflow: embeddedStacked ? "visible" : "hidden",
          boxSizing: "border-box",
        }}
      >
        {!embedded ? (
        <div style={{ display: isMobile ? "grid" : "flex", alignItems: isMobile ? "start" : "center", justifyContent: "space-between", gap: isMobile ? 8 : 12, minHeight: isMobile ? "auto" : 52, flexWrap: "wrap", minWidth: 0 }}>
          <div style={{ minWidth: 0, flex: "1 1 280px", paddingLeft: isMobile ? "max(6px, var(--inrcy-safe-area-left))" : 0, paddingRight: isMobile ? 4 : 0, boxSizing: "border-box" }}>
            <div style={{ fontWeight: 900, fontSize: isMobile ? 16 : 18, whiteSpace: isMobile ? "normal" : "nowrap", overflow: "visible", textOverflow: "ellipsis", lineHeight: 1.2, overflowWrap: "anywhere", wordBreak: "break-word", paddingLeft: isMobile ? 2 : 0 }}>
              {title}
            </div>
            <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4, overflowWrap: "anywhere", paddingLeft: isMobile ? 2 : 0 }}>{subtitle}</div>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", gap: isMobile ? 6 : 8, flexShrink: 1, flexWrap: "wrap", justifyContent: isMobile ? "stretch" : "flex-end", width: isMobile ? "100%" : undefined, minWidth: 0, overflow: "visible", boxSizing: "border-box" }}>
            <button type="button" className={buttonClassName} onClick={onApplyToChannelImages} disabled={!onApplyToChannelImages} title={onApplyToChannelImages ? "Appliquer ce cadrage à toutes les images de ce canal" : "Disponible avec au moins 2 images sur ce canal"} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "1 1 0" : undefined, maxWidth: isMobile ? "none" : undefined, justifyContent: "center", alignItems: "center", fontSize: isMobile ? 11 : undefined, lineHeight: 1.1, padding: isMobile ? "0 6px" : "0 16px", whiteSpace: "normal", textAlign: "center", boxSizing: "border-box", opacity: onApplyToChannelImages ? 1 : 0.48, cursor: onApplyToChannelImages ? "pointer" : "not-allowed" }}>{i18nT("appliquer_partout_1c738082")}</button>
            {onApplyToSelectedChannels ? <button type="button" className={buttonClassName} onClick={onApplyToSelectedChannels} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "1 1 0" : undefined, justifyContent: "center", alignItems: "center", fontSize: isMobile ? 11 : undefined, lineHeight: 1.1, padding: isMobile ? "0 6px" : "0 16px", whiteSpace: "normal", textAlign: "center", boxSizing: "border-box" }}>{i18nT("appliquer_aux_canaux_03aeae7e")}</button> : null}
            {onResetChannel ? <button type="button" className={buttonClassName} onClick={onResetChannel} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "1 1 0" : undefined, justifyContent: "center", alignItems: "center", fontSize: isMobile ? 11 : undefined, lineHeight: 1.1, padding: isMobile ? "0 6px" : "0 16px", whiteSpace: "nowrap", textAlign: "center", boxSizing: "border-box" }}>{i18nT("reinit_canal_bae403c5")}</button> : null}
            <button type="button" className={primaryButtonClassName || buttonClassName} onClick={onSave} disabled={saving} aria-busy={saving} aria-label={saving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")} title={saving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "0 0 42px" : undefined, width: isMobile ? 42 : undefined, padding: isMobile ? 0 : "0 16px", justifyContent: "center", alignItems: "center", fontSize: isMobile ? 18 : undefined, boxSizing: "border-box", cursor: saving ? "wait" : undefined, opacity: saving ? 0.68 : 1 }}>{saving ? (isMobile ? "…" : i18nT("enregistrement_e7d5f232")) : isMobile ? "💾" : i18nT("enregistrer_f7c8bcd8")}</button>
            <button type="button" className={buttonClassName} onClick={() => void confirmExit()} aria-label={i18nT("fermer_5ab4ec64")} title={i18nT("fermer_5ab4ec64")} style={{ minWidth: 0, minHeight: isMobile ? 42 : 44, height: isMobile ? 42 : 44, flex: isMobile ? "0 0 42px" : undefined, width: isMobile ? 42 : undefined, padding: isMobile ? 0 : "0 16px", justifyContent: "center", alignItems: "center", fontSize: isMobile ? 20 : undefined, boxSizing: "border-box" }}>{isMobile ? "×" : i18nT("fermer_5ab4ec64")}</button>
          </div>
        </div>
        ) : null}

        <div style={{ minHeight: 0, minWidth: 0, width: "100%", maxWidth: "100%", display: isMobile ? "flex" : "grid",
    flexDirection: isMobile ? "column" : undefined, gridTemplateColumns: contentGridTemplateColumns, gridTemplateRows: contentGridTemplateRows, gap: isMobile ? 18 : 18, alignItems: "stretch", overflowY: embedded ? (isCompact ? "visible" : "hidden") : "auto", overflowX: "hidden", paddingRight: 0, paddingBottom: isMobile && !embedded ? "max(72px, var(--inrcy-safe-area-bottom))" : 0, WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", boxSizing: "border-box" }}>
          <div style={{ minWidth: 0, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateRows: isMobile || isCompact ? undefined : "minmax(0, 1fr) auto", gap: isMobile ? 10 : undefined, order: isMobile ? 2 : 1, flex: isMobile ? "0 0 auto" : undefined }}>
            <div style={{ minWidth: 0, width: "100%", minHeight: previewMinHeight, height: previewHeight, maxHeight: isMobile ? "42dvh" : undefined, display: "grid", placeItems: "center", borderRadius: isMobile ? 18 : 24, border: "1px solid rgba(255,255,255,0.10)", background: "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.02))", padding: isMobile ? 6 : 14, overflow: "hidden", flex: isMobile ? "0 0 auto" : undefined, boxSizing: "border-box" }}>
              <div
                ref={previewRef}
                data-adapter-preview-stage="true"
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onDoubleClick={onDoubleClick}
                style={{ position: "relative", width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", aspectRatio, containerType: "inline-size", borderRadius: isMobile ? 16 : 22, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", ...previewBg, cursor: isDragging ? "grabbing" : "grab", touchAction: "none", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03)" }}
              >
                {showBefore ? (
                  <img src={previewSrc} alt={i18nT("apercu_avant_eb65d0c1")} draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", background: "rgba(255,255,255,0.04)" }} />
                ) : hasLayout && previewLayout ? (
                  <img src={previewSrc} alt="preview" draggable={false} style={{ position: "absolute", left: previewLayout.dx, top: previewLayout.dy, width: previewLayout.drawW, height: previewLayout.drawH, maxWidth: "none", pointerEvents: "none", userSelect: "none" }} />
                ) : (
                  <img src={previewSrc} alt="preview" draggable={false} style={previewImageStyle} onMouseDown={onImageMouseDown} />
                )}
                {overlayItems.map((overlayItem, overlayIndex) => {
                  if (!overlayItem.text) return null;
                  const coordinates =
                    resolveImageOverlayCoordinates(overlayItem);
                  const isActive = overlayIndex === activeOverlayIndex;
                  return (
                    <div
                      key={overlayItem.id || `overlay-${overlayIndex}`}
                      data-image-overlay="true"
                      data-active={isActive ? "true" : "false"}
                      role="group"
                      tabIndex={0}
                      aria-label={`Bloc texte ${overlayIndex + 1}`}
                      aria-describedby={overlayKeyboardInstructionsId}
                      onKeyDown={(event) =>
                        handleOverlayKeyDown(event, overlayIndex)
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveOverlayIndex(overlayIndex);
                      }}
                      onPointerDown={(event) => {
                        setActiveOverlayIndex(overlayIndex);
                        beginOverlayGesture(event, "move", overlayIndex);
                      }}
                      onPointerMove={moveOverlayGesture}
                      onPointerUp={finishOverlayGesture}
                      onPointerCancel={finishOverlayGesture}
                      onLostPointerCapture={() => {
                        overlayGestureRef.current = null;
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                      style={{
                        position: "absolute",
                        left: `${coordinates.x}%`,
                        top: `${coordinates.y}%`,
                        width: `${overlayItem.width ?? 68}%`,
                        height: overlayItem.height
                          ? `${overlayItem.height}%`
                          : undefined,
                        minHeight: overlayItem.height ? undefined : "12%",
                        transform: "translate(-50%, -50%)",
                        boxSizing: "border-box",
                        display: "grid",
                        placeItems: "center",
                        padding:
                          "clamp(6px, 1.8%, 16px) clamp(10px, 3%, 24px)",
                        borderRadius: 14,
                        background:
                          overlayItem.style === "glass"
                            ? "rgba(255,255,255,0.2)"
                            : "rgba(6,10,20,0.78)",
                        border: `${overlayItem.borderWidth ?? 0}px solid ${overlayItem.borderColor || "transparent"}`,
                        outline: isActive
                          ? "1px dashed rgba(255,255,255,0.88)"
                          : undefined,
                        outlineOffset: isActive ? 3 : undefined,
                        color: overlayItem.color || "#ffffff",
                        fontFamily: overlayFontFamily(overlayItem.fontFamily),
                        fontWeight: overlayItem.bold === false ? 400 : 800,
                        fontStyle: overlayItem.italic ? "italic" : "normal",
                        textDecoration: overlayItem.underline
                          ? "underline"
                          : "none",
                        fontSize: `clamp(10px, ${overlayItem.fontSize ?? 4.6}cqw, 64px)`,
                        lineHeight: 1.2,
                        textAlign: "center",
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        overflow: "visible",
                        userSelect: "none",
                        touchAction: "none",
                        cursor: "move",
                        zIndex: isActive ? 4 : 2,
                      }}
                    >
                      <span style={{ maxWidth: "100%", maxHeight: "100%", overflow: "hidden" }}>{overlayItem.text}</span>
                      {isActive ? (
                        <button
                          type="button"
                          aria-label="Redimensionner ce texte"
                          title="Redimensionner ce texte"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) =>
                            beginOverlayGesture(event, "resize", overlayIndex)
                          }
                          style={{
                            position: "absolute",
                            right: -14,
                            bottom: -14,
                            width: 28,
                            height: 28,
                            display: "grid",
                            placeItems: "center",
                            padding: 0,
                            border: 0,
                            borderRadius: 999,
                            color: "transparent",
                            background: "transparent",
                            boxShadow: "none",
                            font: "inherit",
                            fontSize: 0,
                            lineHeight: 1,
                            cursor: "nwse-resize",
                            touchAction: "none",
                          }}
                        >
                          <span aria-hidden="true" style={{ width: 15, height: 15, display: "block", border: "3px solid #dff7ff", borderRadius: 999, background: "#38bdf8", boxShadow: "0 0 0 3px rgba(6,10,20,0.78), 0 4px 14px rgba(0,0,0,0.34)" }} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <span
                  id={overlayKeyboardInstructionsId}
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clip: "rect(0, 0, 0, 0)",
                    whiteSpace: "nowrap",
                    border: 0,
                  }}
                >
                  Utilisez les flèches pour déplacer ce texte. Maintenez Maj et
                  utilisez les flèches pour le redimensionner. Maintenez Alt
                  pour un réglage précis.
                </span>
                <div style={{ position: "absolute", inset: 12, borderRadius: 16, border: "1px solid rgba(255,255,255,0.14)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.14)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", pointerEvents: "none", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}>{showBefore ? i18nT("image_source_bbdaeab9") : `${fitLabel} • ${zoomLabel}`}</div>
                  {!isMobile ? <div style={{ fontSize: 11, padding: "6px 10px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}>{i18nT("glisser_molette_double_clic_292d179a")}</div> : null}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.72, padding: isMobile ? "12px 10px 0" : "10px 2px 0", lineHeight: 1.55, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "break-word", wordBreak: "normal" }}>{i18nT("deplacez_l_image_ajustez_le_zoom_b7f704f4")}{embedded ? " Les blocs de texte se déplacent et se redimensionnent directement sur le visuel." : ` ${isolationNote || i18nT("ces_reglages_concernent_uniquement_ce_canal_c0d2ebf2")}`}</div>
          </div>

          <div style={{ minWidth: 0, minHeight: 0, height: isCompact ? "auto" : "100%", display: isMobile ? "flex" : "grid", gridTemplateColumns: settingsGridColumns, gridTemplateRows: settingsGridColumns ? "auto minmax(0, 1fr)" : undefined, flexDirection: isMobile ? "column" : undefined, alignContent: "stretch", alignItems: "stretch", gap: 12, order: isMobile ? 2 : 1, flex: isMobile ? "0 0 auto" : undefined }}>
            <div style={{ display: "grid", gap: 8, padding: isMobile ? 12 : 14, borderRadius: 20, minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", gridColumn: settingsGridColumns ? "1" : undefined, gridRow: settingsGridColumns ? "1" : undefined }}>
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

            <div style={{ display: "grid", alignContent: "start", gap: 10, padding: isMobile ? 12 : 14, borderRadius: 20, minWidth: 0, width: "100%", height: settingsGridColumns ? "fit-content" : undefined, boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", gridColumn: settingsGridColumns ? "1" : undefined, gridRow: settingsGridColumns ? "2" : undefined }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, opacity: 0.82 }}><span>{i18nT("arriere_plan_d45252c1")}</span><small style={{ opacity: 0.7 }}>Fond du canevas</small></div>
              <select value={bgMode} onChange={(e) => onBackgroundModeChange(e.target.value as BackgroundMode)} style={{ ...studioSelectStyle, minHeight: 40 }}>
                <option value="transparent" style={studioOptionStyle}>{i18nT("transparent_0491f7bd")}</option>
                <option value="white" style={studioOptionStyle}>{i18nT("blanc_f03e5122")}</option>
                <option value="black" style={studioOptionStyle}>{i18nT("noir_c34fc172")}</option>
                <option value="color" style={studioOptionStyle}>{i18nT("couleur_personnalisee_a2881bf3")}</option>
              </select>
              {bgMode === "color" ? (
                <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.82 }}>
                  <span>{i18nT("couleur_de_fond_84c3e127")}</span>
                  <input type="color" value={bgFill} onChange={(e) => onBackgroundColorChange?.(e.target.value)} style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "transparent" }} />
                </label>
              ) : null}
            </div>

            {onOverlayChange ? (
              <div style={{ display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", alignContent: "start", gap: 9, padding: isMobile ? 12 : 14, borderRadius: 20, minWidth: 0, minHeight: 0, width: "100%", height: settingsGridColumns ? "100%" : undefined, boxSizing: "border-box", border: "1px solid rgba(192,132,252,0.22)", background: "rgba(192,132,252,0.06)", gridColumn: settingsGridColumns ? "2" : undefined, gridRow: settingsGridColumns ? "1 / 3" : undefined, overflow: isCompact ? "visible" : "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 850 }}>Textes et liens</div>
                  <button type="button" className={buttonClassName} onClick={addOverlay} disabled={overlayItems.length >= MAX_IMAGE_OVERLAY_ITEMS} style={{ minHeight: 32, padding: "0 10px", fontSize: 11, opacity: overlayItems.length >= MAX_IMAGE_OVERLAY_ITEMS ? 0.5 : 1 }}>＋ Ajouter un texte</button>
                </div>
                {overlayItems.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
                    {overlayItems.map((item, index) => (
                      <button
                        key={item.id || `text-tab-${index}`}
                        type="button"
                        className={buttonClassName}
                        aria-pressed={index === activeOverlayIndex}
                        onClick={() => setActiveOverlayIndex(index)}
                        style={{ minWidth: 0, minHeight: 30, padding: "0 7px", justifyContent: "center", overflow: "hidden", borderColor: index === activeOverlayIndex ? "rgba(76,195,255,0.6)" : undefined, background: index === activeOverlayIndex ? "rgba(76,195,255,0.13)" : undefined, fontSize: 10, textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {item.text || `Texte ${index + 1}`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button type="button" className={buttonClassName} onClick={addOverlay} style={{ width: "100%", minHeight: 56, justifyContent: "center", borderStyle: "dashed" }}>＋ Ajouter le premier texte</button>
                )}
                {activeOverlay ? (
                  <div style={{ minHeight: 0, display: "grid", alignContent: "start", gap: 8, overflow: isCompact ? "visible" : "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <small style={{ opacity: 0.68 }}>Bloc {activeOverlayIndex + 1} · déplaçable sur l’image</small>
                      <button type="button" className={buttonClassName} onClick={() => removeOverlay()} style={{ minHeight: 28, padding: "0 8px", fontSize: 10 }}>Supprimer</button>
                    </div>
                    <textarea
                      value={activeOverlay.text || ""}
                      maxLength={180}
                      rows={2}
                      onChange={(event) => updateOverlay({ text: event.target.value })}
                      placeholder={i18nT("retoucher_texte_placeholder")}
                      style={{ width: "100%", minHeight: 58, resize: "none", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(2,6,23,0.72)", color: "#fff", padding: "9px 10px", boxSizing: "border-box", font: "inherit" }}
                    />
                    <label style={{ display: "grid", gap: 4, fontSize: 11, opacity: 0.88 }}>
                      <span>Lien de ce texte <small style={{ opacity: 0.65 }}>(facultatif)</small></span>
                      <input
                        type="url"
                        value={activeOverlay.linkUrl || ""}
                        onChange={(event) => updateOverlay({ linkUrl: event.target.value })}
                        placeholder="https://…"
                        style={{ width: "100%", minHeight: 36, borderRadius: 11, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(2,6,23,0.72)", color: "#fff", padding: "0 10px", boxSizing: "border-box", font: "inherit" }}
                      />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
                      <label style={{ display: "grid", gap: 4, fontSize: 11, opacity: 0.88 }}>
                        <span>Police</span>
                        <select value={activeOverlay.fontFamily || "inter"} onChange={(event) => updateOverlay({ fontFamily: event.target.value as ImageOverlayFontFamily })} style={studioSelectStyle}>
                          <option value="inter" style={studioOptionStyle}>Inter</option>
                          <option value="arial" style={studioOptionStyle}>Arial</option>
                          <option value="georgia" style={studioOptionStyle}>Georgia</option>
                          <option value="verdana" style={studioOptionStyle}>Verdana</option>
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 4, fontSize: 11, opacity: 0.88 }}>
                        <span>Taille · {(activeOverlay.fontSize || 4.6).toFixed(1)}</span>
                        <input type="range" min="1.5" max="10" step="0.25" value={activeOverlay.fontSize || 4.6} onChange={(event) => updateOverlay({ fontSize: Number(event.target.value) })} style={{ width: "100%", minHeight: 36, accentColor: "#4cc3ff" }} />
                      </label>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 44px", gap: 8 }}>
                      <select value={activeOverlay.style || "solid"} onChange={(event) => updateOverlay({ style: event.target.value as ImageOverlay["style"] })} aria-label="Style du bandeau" style={studioSelectStyle}>
                        <option value="solid" style={studioOptionStyle}>Panneau sombre</option>
                        <option value="glass" style={studioOptionStyle}>Verre translucide</option>
                      </select>
                      <input type="color" value={activeOverlay.color || "#ffffff"} onChange={(event) => updateOverlay({ color: event.target.value })} aria-label="Couleur du texte" title="Couleur du texte" style={{ width: 44, height: 36, padding: 2, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent" }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 44px", gap: 8 }}>
                      <select value={activeOverlay.borderWidth ?? 0} onChange={(event) => updateOverlay({ borderWidth: Number(event.target.value) })} aria-label="Épaisseur de la bordure" style={studioSelectStyle}>
                        <option value="0" style={studioOptionStyle}>Bordure transparente</option>
                        <option value="1" style={studioOptionStyle}>Bordure fine</option>
                        <option value="2" style={studioOptionStyle}>Bordure standard</option>
                        <option value="4" style={studioOptionStyle}>Bordure épaisse</option>
                      </select>
                      <input type="color" value={activeOverlay.borderColor || "#38bdf8"} disabled={(activeOverlay.borderWidth ?? 0) === 0} onChange={(event) => updateOverlay({ borderColor: event.target.value })} aria-label="Couleur de la bordure" title={(activeOverlay.borderWidth ?? 0) === 0 ? "Activez une bordure pour choisir sa couleur" : "Couleur de la bordure"} style={{ width: 44, height: 36, padding: 2, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", opacity: (activeOverlay.borderWidth ?? 0) === 0 ? 0.4 : 1 }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 7 }}>
                      <button type="button" className={buttonClassName} aria-pressed={activeOverlay.bold !== false} onClick={() => updateOverlay({ bold: activeOverlay.bold === false })} style={{ minHeight: 34, justifyContent: "center", fontWeight: 900, borderColor: activeOverlay.bold !== false ? "rgba(76,195,255,0.55)" : undefined }}>B</button>
                      <button type="button" className={buttonClassName} aria-pressed={Boolean(activeOverlay.italic)} onClick={() => updateOverlay({ italic: !activeOverlay.italic })} style={{ minHeight: 34, justifyContent: "center", fontStyle: "italic", borderColor: activeOverlay.italic ? "rgba(76,195,255,0.55)" : undefined }}>I</button>
                      <button type="button" className={buttonClassName} aria-pressed={Boolean(activeOverlay.underline)} onClick={() => updateOverlay({ underline: !activeOverlay.underline })} style={{ minHeight: 34, justifyContent: "center", textDecoration: "underline", borderColor: activeOverlay.underline ? "rgba(76,195,255,0.55)" : undefined }}>U</button>
                    </div>
                    <small style={{ opacity: 0.62, lineHeight: 1.35 }}>Le lien appartient uniquement à ce bloc. Déplacez-le et redimensionnez-le directement sur le visuel.</small>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {sidebarItems?.length ? (
            <div style={{ minWidth: 0, minHeight: 0, display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateRows: isMobile ? undefined : "minmax(0, 1fr)", gap: 12, order: isMobile ? 3 : 2, flex: isMobile ? "0 0 auto" : undefined }}>
              <div style={{ minHeight: 0, height: isMobile || isCompact ? "auto" : "100%",
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
                    overflowY: isMobile || isCompact ? "visible" : "auto",
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
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

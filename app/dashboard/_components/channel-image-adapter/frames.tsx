import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { BackgroundMode, PreviewImage, PreviewVideo } from "./types";

import { useNaturalImageMeta } from "./hooks";

import { clampNumber, formatPreviewVideoBytes, formatPreviewVideoSeconds, getTransformBackgroundMode, previewBackgroundStyle, safePreviewZoom } from "./utils";


export function FinalImageFrame({
  image,
  aspectRatio,
  fallbackMode = "black",
  fitLabel,
  badge,
}: {
  image?: PreviewImage | null;
  aspectRatio: string;
  fallbackMode?: BackgroundMode;
  fitLabel?: string;
  badge?: string;
}) {
  const i18nT = useTranslations("shell");
  const src = image?.previewUrl || "";
  const transform = image?.transform || {};
  const preset = image?.preset || { width: 1000, height: 1000 };
  const meta = useNaturalImageMeta(src, image?.imageMeta);
  const mode = getTransformBackgroundMode(transform, fallbackMode);
  const backgroundColor = transform.backgroundColor;
  const fit = transform.fit || "cover";
  const zoom = safePreviewZoom(fit, transform.zoom);

  const imageWidth = meta?.width || 0;
  const imageHeight = meta?.height || 0;
  const canvasWidth = preset.width || 1;
  const canvasHeight = preset.height || 1;

  const layout = (() => {
    if (!imageWidth || !imageHeight) return null;
    const baseScale = fit === "cover" ? Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight) : Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    const scale = baseScale * zoom;
    const drawW = imageWidth * scale;
    const drawH = imageHeight * scale;
    const maxX = Math.abs(drawW - canvasWidth) / 2;
    const maxY = Math.abs(drawH - canvasHeight) / 2;
    const dx = (canvasWidth - drawW) / 2 - maxX * clampNumber(transform.offsetX || 0, -100, 100) / 100;
    const dy = (canvasHeight - drawH) / 2 - maxY * clampNumber(transform.offsetY || 0, -100, 100) / 100;
    return {
      left: `${(dx / canvasWidth) * 100}%`,
      top: `${(dy / canvasHeight) * 100}%`,
      width: `${(drawW / canvasWidth) * 100}%`,
      height: `${(drawH / canvasHeight) * 100}%`,
    };
  })();



  return (
    <div style={{ position: "relative", borderRadius: "inherit", overflow: "hidden", aspectRatio, ...previewBackgroundStyle(mode, backgroundColor), border: "1px solid rgba(255,255,255,0.08)" }}>
      {src && layout ? (
        <img src={src} alt="preview" draggable={false} style={{ position: "absolute", ...layout, objectFit: "fill", display: "block", maxWidth: "none", userSelect: "none", pointerEvents: "none" }} />
      ) : src ? (
        <img src={src} alt="preview" style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{i18nT("aucune_image_768c8a5c")}</div>
      )}
      {fitLabel ? (
        <div style={{ position: "absolute", left: 8, bottom: 8, fontSize: 11, padding: "5px 8px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}>
          {fitLabel}
        </div>
      ) : null}
      {badge ? (
        <div style={{ position: "absolute", right: 8, bottom: 8, fontSize: 11, padding: "5px 8px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}>
          {badge}
        </div>
      ) : null}
    </div>
  );
}

export function VideoPreviewFrame({
  video,
  aspectRatio,
  badge = "Vidéo",
  dark = false,
}: {
  video?: PreviewVideo | null;
  aspectRatio: string;
  badge?: string;
  dark?: boolean;
}) {
  const i18nT = useTranslations("shell");
  const src = String(video?.previewUrl || "").trim();
  const duration = formatPreviewVideoSeconds(video?.duration);
  const size = formatPreviewVideoBytes(video?.size);
  const meta = [duration, size].filter(Boolean).join(" · ");

  return (
    <div
      style={{
        position: "relative",
        borderRadius: "inherit",
        overflow: "hidden",
        aspectRatio,
        background: dark ? "#020617" : "#0f172a",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "grid",
        placeItems: "center",
      }}
    >
      {src ? (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          style={{
            width: "100%",
            height: "100%",
            objectFit: video?.fitMode === "cover" ? "cover" : "contain",
            display: "block",
            background: "#020617",
          }}
        />
      ) : (
        <div style={{ color: "rgba(255,255,255,0.68)", fontSize: 12 }}>{i18nT("aucune_video_c4607a21")}</div>
      )}
      {badge ? (
        <div style={{ position: "absolute", left: 8, bottom: 8, fontSize: 11, padding: "5px 8px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", pointerEvents: "none" }}>
          {badge}
        </div>
      ) : null}
      {meta ? (
        <div style={{ position: "absolute", right: 8, bottom: 8, fontSize: 11, padding: "5px 8px", borderRadius: 999, background: "rgba(6,10,20,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", pointerEvents: "none" }}>
          {meta}
        </div>
      ) : null}
    </div>
  );
}

export function PublicationPreviewLightbox({
  open,
  images,
  initialIndex,
  aspectRatio,
  fallbackMode,
  onClose,
}: {
  open: boolean;
  images: PreviewImage[];
  initialIndex: number;
  aspectRatio: string;
  fallbackMode: BackgroundMode;
  onClose: () => void;
}) {
  const i18nT = useTranslations("shell");
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    if (!open) return;
    setIndex(clampNumber(initialIndex, 0, Math.max(0, images.length - 1)));
  }, [initialIndex, images.length, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (!images.length) return;
      if (event.key === "ArrowLeft") setIndex((prev) => (prev - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") setIndex((prev) => (prev + 1) % images.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [images.length, onClose, open]);

  if (!open || !images.length) return null;
  const safeIndex = clampNumber(index, 0, images.length - 1);
  const current = images[safeIndex] || images[0];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(2,6,23,0.86)", overflowY: "auto", overflowX: "hidden", padding: "18px 14px", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
      <div style={{ minHeight: "100%", display: "grid", alignItems: "center", justifyItems: "center", gap: 12 }}>
        <div style={{ width: "min(980px, 100%)", display: "grid", gap: 12 }}>
          <div style={{ position: "sticky", top: 8, zIndex: 3, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, color: "#fff", flexWrap: "wrap", padding: "8px 0" }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>{i18nT("carousel_image_95458801")}{" "}{safeIndex + 1} / {images.length}</div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{i18nT("fleches_clavier_boutons_ou_miniatures_f491f09e")}</div>
            </div>
            <button type="button" onClick={onClose} style={{ border: "1px solid rgba(255,255,255,0.18)", background: "rgba(15,23,42,0.86)", color: "#fff", borderRadius: 999, padding: "9px 14px", cursor: "pointer" }}>{i18nT("fermer_5ab4ec64")}</button>
          </div>

          <div style={{ display: "grid", justifyItems: "center" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: aspectRatio === "4 / 5" ? 620 : aspectRatio === "4 / 3" ? 860 : 760, borderRadius: 22, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 22px 60px rgba(0,0,0,0.36)", background: "#020617" }}>
              <FinalImageFrame image={current} aspectRatio={aspectRatio} fallbackMode={fallbackMode} />
              {images.length > 1 ? (
                <>
                  <button type="button" onClick={() => setIndex((prev) => (prev - 1 + images.length) % images.length)} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(2,6,23,0.62)", color: "#fff", cursor: "pointer" }}>‹</button>
                  <button type="button" onClick={() => setIndex((prev) => (prev + 1) % images.length)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(2,6,23,0.62)", color: "#fff", cursor: "pointer" }}>›</button>
                </>
              ) : null}
            </div>
          </div>

          {images.length > 1 ? (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 0 8px", justifyContent: "center" }}>
              {images.map((img, thumbIndex) => (
                <button key={thumbIndex} type="button" onClick={() => setIndex(thumbIndex)} style={{ flex: "0 0 auto", width: 58, height: 58, borderRadius: 12, overflow: "hidden", border: thumbIndex === safeIndex ? "2px solid #ffffff" : "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", padding: 0, cursor: "pointer" }} aria-label={i18nT("voir_l_image_value_71740aa0", { value0: thumbIndex + 1 })}>
                  <img src={img.previewUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

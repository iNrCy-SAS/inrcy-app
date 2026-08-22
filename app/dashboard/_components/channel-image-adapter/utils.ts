import type React from "react";

import { renderBoosterSiteInlineHtml, stripSiteTextFormatting } from "@/lib/boosterFormatting";

import { sanitizeHtml } from "@/lib/sanitizeHtml";

import type { BackgroundMode, RenderTransform } from "./types";


export const MOBILE_DOCK_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + var(--inrcy-safe-area-bottom)))";

export const CARD_WIDTH = 220;

export const CHECKERBOARD = "linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%, rgba(255,255,255,0.08)), linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%, rgba(255,255,255,0.08))";

export function legacyColorFromMode(mode: BackgroundMode, backgroundColor?: string) {
  if (backgroundColor) return backgroundColor;
  switch (mode) {
    case "white": return "#ffffff";
    case "black": return "#0d1320";
    case "gray": return "#d6dae2";
    case "sand": return "#efe4d3";
    case "brand": return "#ffffff";
    default: return "#ffffff";
  }
}

export function normalizedMode(
  mode: BackgroundMode,
): "transparent" | "white" | "black" | "color" {
  if (mode === "transparent") return "transparent";
  if (mode === "white") return "white";
  if (mode === "black") return "black";
  return "color";
}

export function previewBackgroundStyle(mode: BackgroundMode, backgroundColor?: string): React.CSSProperties {
  const normalized = normalizedMode(mode);
  if (normalized === "transparent") {
    return {
      backgroundColor: "#0d1320",
      backgroundImage: CHECKERBOARD,
      backgroundSize: "24px 24px",
      backgroundPosition: "0 0, 12px 12px",
    };
  }
  return { background: legacyColorFromMode(mode, backgroundColor) };
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function safePreviewZoom(fit: "contain" | "cover", zoom?: number) {
  return clampNumber(zoom || 1, 0.4, fit === "cover" ? 3 : 1);
}

export function cleanText(value?: string | null) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanNetworkText(value?: string | null) {
  return stripSiteTextFormatting(cleanText(value));
}

export function renderSafeSiteInlineHtml(value: string) {
  return sanitizeHtml(renderBoosterSiteInlineHtml(value));
}

export function getTransformBackgroundMode(transform?: RenderTransform, fallbackMode?: BackgroundMode): BackgroundMode {
  const rawMode = String(transform?.backgroundMode || "").trim().toLowerCase();
  if (rawMode === "blur" || transform?.blurBackground) return fallbackMode || "black";
  if (rawMode) return rawMode as BackgroundMode;
  return fallbackMode || "black";
}

export function formatPreviewVideoSeconds(seconds?: number | null) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const total = Math.max(0, Math.round(numeric));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatPreviewVideoBytes(bytes?: number | null) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return `${(numeric / (1024 * 1024)).toFixed(numeric >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

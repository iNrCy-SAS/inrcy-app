"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getMediaLibraryOptimizationRequirements } from "@/lib/mediaLibraryOptimizationPolicy";

export type MediaLibraryPickerItem = {
  id: string;
  bucket_name: string | null;
  storage_path: string;
  original_file_name?: string | null;
  media_type: "image" | "video";
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string | null;
  signed_url: string | null;
};

type MediaLibraryPickerModalProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
  accept?: "all" | "image" | "video";
  multiple?: boolean;
  maxSelection?: number;
  confirmLabel?: string;
  selectedHint?: string;
  maxImageBytes?: number;
  maxVideoBytes?: number;
  onOpenOptimizer?: (item: MediaLibraryPickerItem) => void;
  onOversizedMedia?: (item: MediaLibraryPickerItem) => void;
  onClose: () => void;
  onConfirm: (items: MediaLibraryPickerItem[]) => void | Promise<void>;
};

const MOBILE_DOCK_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + env(safe-area-inset-bottom, 0px)))";

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}


function formatLimitBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "la limite autorisée";
  return `${Math.max(1, Math.round(bytes / 1_000_000))} Mo`;
}

function formatDuration(seconds: number | null | undefined) {
  const safe = Number(seconds || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "—";
  const rounded = Math.round(safe);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function displayName(item: MediaLibraryPickerItem) {
  return (
    item.title ||
    item.storage_path.split("/").pop() ||
    (item.media_type === "video" ? "Vidéo iNrCy" : "Image iNrCy")
  );
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function getItemOptimizationRequirements(
  item: MediaLibraryPickerItem,
  targetBytes: number | undefined,
) {
  const hasTarget = Number.isFinite(Number(targetBytes)) && Number(targetBytes) > 0;
  if (!hasTarget) return null;
  return getMediaLibraryOptimizationRequirements({
    mediaType: item.media_type,
    sizeBytes: item.size_bytes,
    targetBytes,
    name: item.original_file_name || item.storage_path || item.title,
    mimeType: item.mime_type,
  });
}

export function mediaLibraryItemToAttachment(item: MediaLibraryPickerItem) {
  return {
    bucket: item.bucket_name || "inrcy-pro-media",
    path: item.storage_path,
    name: displayName(item),
    type:
      item.mime_type ||
      (item.media_type === "video" ? "video/mp4" : "image/jpeg"),
    size: item.size_bytes || 0,
    width: item.width,
    height: item.height,
    duration_seconds: item.duration_seconds,
  };
}

export default function MediaLibraryPickerModal({
  open,
  title = "Choisir depuis la Médiathèque",
  subtitle = "Sélectionnez un média déjà importé dans iNrCy.",
  accept = "all",
  multiple = true,
  maxSelection = 10,
  confirmLabel = "Ajouter",
  selectedHint,
  maxImageBytes,
  maxVideoBytes,
  onOpenOptimizer,
  onOversizedMedia,
  onClose,
  onConfirm,
}: MediaLibraryPickerModalProps) {
  const [items, setItems] = useState<MediaLibraryPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">(
    accept === "all" ? "all" : accept,
  );
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [oversizeBlocked, setOversizeBlocked] = useState(false);
  const [oversizeBlockedItem, setOversizeBlockedItem] = useState<MediaLibraryPickerItem | null>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTypeFilter(accept === "all" ? "all" : accept);
    setQuery("");
    setSelectedIds([]);
    setOversizeBlocked(false);
    setOversizeBlockedItem(null);
    setError("");
  }, [open, accept]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const updateCompact = () => setCompact(window.innerWidth <= 760);
    updateCompact();
    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, [open]);

  const loadItems = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        type: typeFilter,
        active: "active",
        limit: "120",
      });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(
        `/api/media-library/items?${params.toString()}`,
        {
          cache: "no-store",
        },
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || "Médiathèque indisponible.");
      }
      const nextItems = Array.isArray(json?.items) ? json.items : [];
      setItems(
        nextItems.filter((item: MediaLibraryPickerItem) => {
          if (accept !== "all" && item.media_type !== accept) return false;
          return Boolean(item?.id && item?.storage_path);
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Médiathèque indisponible.",
      );
    } finally {
      setLoading(false);
    }
  }, [accept, open, query, typeFilter]);

  useEffect(() => {
    if (!open) return;
    void loadItems();
  }, [loadItems, open]);

  const selectedItems = useMemo(() => {
    const map = new Map(items.map((item) => [item.id, item]));
    return selectedIds
      .map((id) => map.get(id))
      .filter(Boolean) as MediaLibraryPickerItem[];
  }, [items, selectedIds]);

  const toggleItem = (item: MediaLibraryPickerItem) => {
    setError("");
    setOversizeBlocked(false);
    setOversizeBlockedItem(null);
    const maxBytes =
      item.media_type === "video" ? maxVideoBytes : maxImageBytes;
    const optimizationRequirements = getItemOptimizationRequirements(
      item,
      maxBytes,
    );
    if (optimizationRequirements?.needsOptimization) {
      if (onOversizedMedia) {
        onClose();
        onOversizedMedia(item);
        return;
      }
      const limitLabel = formatLimitBytes(Number(maxBytes));
      setOversizeBlocked(true);
      setOversizeBlockedItem(item);
      setError(
        optimizationRequirements.needsConversion &&
          !optimizationRequirements.needsCompression
          ? "Ce format doit être optimisé avant son insertion."
          : `Ce média dépasse ${limitLabel}. Créez d'abord une copie optimisée dans la Médiathèque.`,
      );
      return;
    }
    setSelectedIds((current) => {
      if (current.includes(item.id))
        return current.filter((id) => id !== item.id);
      if (!multiple) return [item.id];
      if (current.length >= maxSelection) {
        setError(
          `Sélection limitée à ${maxSelection} fichier${maxSelection > 1 ? "s" : ""}.`,
        );
        return current;
      }
      return [...current, item.id];
    });
  };

  const validate = async () => {
    if (!selectedItems.length) {
      setError("Sélectionnez au moins un média.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm(selectedItems);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const displayTitle = compact ? "Médiathèque" : title;
  const displaySubtitle = compact ? "Ajouter un média" : subtitle;
  const hasError = Boolean(error);
  const modalGridTemplateRows = hasError
    ? "auto auto auto minmax(0, 1fr) auto"
    : "auto auto minmax(0, 1fr) auto";
  const modalComputedStyle: React.CSSProperties = compact
    ? {
        ...modalStyle,
        width: "min(100%, calc(100vw - 12px))",
        height: `calc(100dvh - ${MOBILE_DOCK_HEIGHT} - 12px)`,
        maxHeight: `calc(100dvh - ${MOBILE_DOCK_HEIGHT} - 12px)`,
        padding: 10,
        borderRadius: 22,
        gap: 7,
        gridTemplateRows: modalGridTemplateRows,
      }
    : {
        ...modalStyle,
        gridTemplateRows: modalGridTemplateRows,
      };
  const headerComputedStyle: React.CSSProperties = compact
    ? {
        ...headerStyle,
        gridTemplateColumns: "44px minmax(0, 1fr) 40px",
        gap: 10,
        alignItems: "center",
      }
    : headerStyle;
  const headerIconComputedStyle: React.CSSProperties = compact
    ? {
        ...headerIconStyle,
        width: 44,
        height: 44,
        borderRadius: 16,
        fontSize: 20,
      }
    : headerIconStyle;
  const titleComputedStyle: React.CSSProperties = compact
    ? {
        ...titleStyle,
        margin: 0,
        fontSize: 21,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }
    : titleStyle;
  const subtitleComputedStyle: React.CSSProperties = compact
    ? { ...subtitleStyle, margin: "2px 0 0", fontSize: 12, lineHeight: 1.15 }
    : subtitleStyle;
  const filtersComputedStyle: React.CSSProperties = compact
    ? {
        ...filtersStyle,
        gridTemplateColumns: "1fr",
        gap: 7,
        padding: 10,
        borderRadius: 16,
      }
    : filtersStyle;
  const listComputedStyle: React.CSSProperties = compact
    ? {
        ...listStyle,
        minHeight: 0,
        gap: 6,
        paddingRight: 1,
        paddingBottom: 2,
        overscrollBehavior: "contain",
      }
    : listStyle;
  const rowComputedStyle: React.CSSProperties = compact
    ? {
        ...rowStyle,
        gridTemplateColumns: "54px minmax(0, 1fr) auto 28px",
        gap: 7,
        padding: 7,
        borderRadius: 14,
        minHeight: 54,
      }
    : rowStyle;
  const thumbComputedStyle: React.CSSProperties = compact
    ? { ...thumbStyle, width: 54, height: 39, borderRadius: 10 }
    : thumbStyle;
  const footerComputedStyle: React.CSSProperties = compact
    ? {
        ...footerStyle,
        minHeight: 60,
        paddingTop: 7,
        alignItems: "stretch",
        flexDirection: "column",
        gap: 6,
        borderTop: "1px solid rgba(255,255,255,.08)",
      }
    : {
        ...footerStyle,
        minHeight: 54,
      };
  const footerActionsStyle: React.CSSProperties = compact
    ? {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        alignItems: "center",
        gap: 8,
        width: "100%",
      }
    : {
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        justifyContent: "flex-end",
      };
  const cancelButtonComputedStyle: React.CSSProperties = compact
    ? {
        ...cancelButtonStyle,
        width: "100%",
        minHeight: 42,
        padding: "9px 10px",
        borderRadius: 18,
        fontSize: 13,
        lineHeight: 1.05,
      }
    : cancelButtonStyle;
  const primaryButtonComputedStyle: React.CSSProperties = compact
    ? {
        ...primaryButtonStyle,
        width: "100%",
        minHeight: 42,
        padding: "9px 10px",
        borderRadius: 18,
        fontSize: 13,
        lineHeight: 1.05,
      }
    : primaryButtonStyle;
  const confirmButtonLabel = compact
    ? busy
      ? "Ajout…"
      : selectedItems.length
        ? `Ajouter (${selectedItems.length})`
        : "Ajouter"
    : busy
      ? "Ajout…"
      : confirmLabel;

  const filtersNode = compact ? (
    <div style={compactFiltersStyle}>
      <label style={compactTypeRowStyle}>
        <span style={compactInlineLabelStyle}>Type</span>
        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value as "all" | "image" | "video")
          }
          disabled={accept !== "all"}
          style={compactInputStyle}
        >
          <option value="all">Tous</option>
          <option value="image">Images</option>
          <option value="video">Vidéos</option>
        </select>
      </label>
      <div style={compactSearchRowStyle}>
        <span style={compactSearchIconStyle} aria-hidden="true">
          🔎
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="titre, tag, fichier..."
          style={compactSearchInputStyle}
          aria-label="Recherche"
        />
        <button
          type="button"
          style={compactApplyButtonStyle}
          onClick={loadItems}
          disabled={loading}
          aria-label="Appliquer les filtres"
        >
          {loading ? "…" : "OK"}
        </button>
      </div>
    </div>
  ) : (
    <div style={filtersComputedStyle}>
      <label style={fieldStyle}>
        <span>Type</span>
        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value as "all" | "image" | "video")
          }
          disabled={accept !== "all"}
          style={inputStyle}
        >
          <option value="all">Tous</option>
          <option value="image">Images</option>
          <option value="video">Vidéos</option>
        </select>
      </label>
      <label style={fieldStyle}>
        <span>Recherche</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="titre, tag, fichier..."
          style={inputStyle}
        />
      </label>
      <button
        type="button"
        style={ghostButtonStyle}
        onClick={loadItems}
        disabled={loading}
      >
        {loading ? "Chargement…" : "Appliquer"}
      </button>
    </div>
  );

  return (
    <div
      style={{
        ...overlayStyle,
        bottom: compact ? MOBILE_DOCK_HEIGHT : undefined,
        height: compact
          ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`
          : undefined,
        maxHeight: compact
          ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`
          : undefined,
        padding: compact ? 6 : overlayStyle.padding,
        alignItems: compact ? "start" : "center",
        justifyItems: "center",
      }}
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        style={modalComputedStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={headerComputedStyle}>
          <div style={headerIconComputedStyle} aria-hidden="true">
            🖼️
          </div>
          <div style={{ minWidth: 0 }}>
            {!compact ? <div style={kickerStyle}>Médiathèque iNrCy</div> : null}
            <h2 style={titleComputedStyle}>{displayTitle}</h2>
            <p style={subtitleComputedStyle}>{displaySubtitle}</p>
          </div>
          <button
            type="button"
            style={closeStyle}
            onClick={onClose}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        {filtersNode}

        {error ? (
          <div style={errorStyle}>
            <div>{error}</div>
            {oversizeBlocked && oversizeBlockedItem && onOpenOptimizer ? (
              <button
                type="button"
                onClick={() => {
                  const item = oversizeBlockedItem;
                  onClose();
                  onOpenOptimizer(item);
                }}
                style={{
                  ...ghostButtonStyle,
                  marginTop: 9,
                  padding: "8px 12px",
                }}
              >
                Optimiser le média
              </button>
            ) : null}
          </div>
        ) : null}

        <div style={listComputedStyle}>
          {loading ? (
            <div style={emptyStyle}>Chargement de votre Médiathèque…</div>
          ) : items.length === 0 ? (
            <div style={emptyStyle}>
              Aucun média disponible avec ces filtres.
            </div>
          ) : (
            items.map((item) => {
              const selected = selectedIds.includes(item.id);
              const itemLimit =
                item.media_type === "video" ? maxVideoBytes : maxImageBytes;
              const itemOptimizationRequirements =
                getItemOptimizationRequirements(item, itemLimit);
              const itemOversized = Boolean(
                itemOptimizationRequirements?.needsOptimization,
              );
              const tags =
                Array.isArray(item.tags) && item.tags.length
                  ? item.tags.join(", ")
                  : "Aucun tag";
              const openOptimizerForItem = (
                event: React.MouseEvent<HTMLButtonElement>,
              ) => {
                event.preventDefault();
                event.stopPropagation();
                if (!onOpenOptimizer) {
                  toggleItem(item);
                  return;
                }
                onClose();
                onOpenOptimizer(item);
              };
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => toggleItem(item)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggleItem(item);
                  }}
                  style={{
                    ...rowComputedStyle,
                    borderColor: selected
                      ? "rgba(105,239,255,.65)"
                      : itemOversized
                        ? "rgba(251,191,36,.22)"
                      : "rgba(255,255,255,.08)",
                    background: selected
                      ? "linear-gradient(90deg, rgba(76,195,255,.16), rgba(155,81,255,.12))"
                      : rowComputedStyle.background,
                  }}
                >
                  <span style={thumbComputedStyle}>
                    {item.media_type === "image" && item.signed_url ? (
                      <img src={item.signed_url} alt="" style={thumbImgStyle} />
                    ) : item.media_type === "video" && item.signed_url ? (
                      <video
                        src={item.signed_url}
                        style={thumbImgStyle}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <span aria-hidden>
                        {item.media_type === "video" ? "🎬" : "🖼️"}
                      </span>
                    )}
                  </span>
                  <span style={nameBlockStyle}>
                    <strong style={nameStyle}>{displayName(item)}</strong>
                    <small style={tagStyle}>{tags}</small>
                  </span>
                  {compact ? (
                    <span style={compactMediaStatusStyle}>
                      <span style={compactTypePillStyle}>
                        {item.media_type === "video" ? "Vidéo" : "Image"}
                      </span>
                      {itemOversized ? (
                        <button
                          type="button"
                          onClick={openOptimizerForItem}
                          style={compactOptimizeButtonStyle}
                          title="Optimiser automatiquement le format et/ou le poids"
                        >
                          À optimiser
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <>
                      <span style={pillStyle}>
                        {item.media_type === "video" ? "Vidéo" : "Image"}
                      </span>
                      <span style={optimizerCellStyle}>
                        {itemOversized ? (
                          <button
                            type="button"
                            onClick={openOptimizerForItem}
                            style={optimizeButtonStyle}
                            title="Optimiser automatiquement le format et/ou le poids"
                          >
                            À optimiser
                          </button>
                        ) : null}
                      </span>
                      <span style={metaStyle}>
                        {formatBytes(item.size_bytes)}
                      </span>
                      <span style={metaStyle}>
                        {item.media_type === "video"
                          ? formatDuration(item.duration_seconds)
                          : item.width && item.height
                            ? `${item.width}×${item.height}`
                            : "—"}
                      </span>
                      <span style={metaStyle}>
                        {dateLabel(item.created_at)}
                      </span>
                    </>
                  )}
                  <span style={checkStyle}>{selected ? "✓" : ""}</span>
                </div>
              );
            })
          )}
        </div>

        <div style={footerComputedStyle}>
          <span style={footerHintStyle}>
            {selectedItems.length
              ? `${selectedItems.length} média${selectedItems.length > 1 ? "s" : ""} sélectionné${selectedItems.length > 1 ? "s" : ""}`
              : selectedHint || "Choisissez vos médias dans la liste."}
          </span>
          <div style={footerActionsStyle}>
            <button
              type="button"
              style={{
                ...cancelButtonComputedStyle,
                opacity: busy ? 0.62 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
              onClick={onClose}
              disabled={busy}
            >
              Annuler
            </button>
            <button
              type="button"
              style={{
                ...primaryButtonComputedStyle,
                opacity: busy || !selectedItems.length ? 0.54 : 1,
                cursor: busy || !selectedItems.length ? "not-allowed" : "pointer",
              }}
              onClick={validate}
              disabled={busy || !selectedItems.length}
            >
              {confirmButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10050,
  display: "grid",
  placeItems: "center",
  padding: 16,
  boxSizing: "border-box",
  overflow: "hidden",
  background: "rgba(2,7,22,.78)",
  backdropFilter: "blur(18px)",
};

const modalStyle: React.CSSProperties = {
  width: "min(1000px, calc(100vw - 32px))",
  height: "min(820px, calc(100svh - 32px))",
  maxHeight: "calc(100svh - 32px)",
  display: "grid",
  gridTemplateRows: "auto auto auto minmax(0, 1fr) auto",
  gap: 10,
  borderRadius: 28,
  padding: 18,
  color: "#f7fbff",
  boxSizing: "border-box",
  overflow: "hidden",
  background:
    "radial-gradient(circle at top left, rgba(84,220,255,.16), transparent 28%), radial-gradient(circle at top right, rgba(189,78,255,.18), transparent 34%), linear-gradient(180deg, rgba(13,27,62,.98), rgba(5,12,30,.98))",
  border: "1px solid rgba(142,161,255,.28)",
  boxShadow:
    "0 34px 110px rgba(0,0,0,.52), inset 0 1px 0 rgba(255,255,255,.06)",
  minWidth: 0,
};

const headerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "54px minmax(0,1fr) 42px",
  alignItems: "start",
  gap: 12,
};

const headerIconStyle: React.CSSProperties = {
  width: 54,
  height: 54,
  display: "grid",
  placeItems: "center",
  borderRadius: 18,
  background:
    "linear-gradient(135deg, rgba(47,209,255,.28), rgba(188,74,255,.34))",
  border: "1px solid rgba(255,255,255,.14)",
};

const kickerStyle: React.CSSProperties = {
  color: "#69efff",
  textTransform: "uppercase",
  letterSpacing: ".14em",
  fontSize: 11,
  fontWeight: 950,
};

const titleStyle: React.CSSProperties = {
  margin: "3px 0 0",
  fontSize: 28,
  lineHeight: 1,
  letterSpacing: "-.04em",
};

const subtitleStyle: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#b8c6e8",
  fontWeight: 760,
  lineHeight: 1.35,
};

const closeStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(255,255,255,.10)",
  color: "#fff",
  fontSize: 25,
  fontWeight: 900,
  cursor: "pointer",
};

const filtersStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "150px minmax(0,1fr) 120px",
  gap: 10,
  padding: 12,
  borderRadius: 18,
  background: "rgba(2,9,28,.58)",
  border: "1px solid rgba(255,255,255,.07)",
  boxSizing: "border-box",
  minWidth: 0,
};

const fieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  color: "#dbe7ff",
  fontSize: 12,
  fontWeight: 900,
  minWidth: 0,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: "1px solid rgba(139,161,255,.18)",
  borderRadius: 14,
  background: "rgba(2,8,24,.86)",
  color: "#fff",
  padding: "11px 12px",
  outline: "none",
  fontWeight: 850,
};

const ghostButtonStyle: React.CSSProperties = {
  alignSelf: "end",
  minWidth: 0,
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 999,
  background:
    "linear-gradient(135deg, rgba(47,209,255,.30), rgba(134,94,255,.34))",
  color: "#fff",
  fontWeight: 950,
  padding: "11px 14px",
  cursor: "pointer",
};

const compactFiltersStyle: React.CSSProperties = {
  display: "grid",
  gap: 7,
  padding: 9,
  borderRadius: 16,
  background: "rgba(2,9,28,.58)",
  border: "1px solid rgba(255,255,255,.07)",
  boxSizing: "border-box",
  minWidth: 0,
};

const compactTypeRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "52px minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const compactInlineLabelStyle: React.CSSProperties = {
  color: "#dbe7ff",
  fontSize: 12,
  fontWeight: 950,
};

const compactInputStyle: React.CSSProperties = {
  ...inputStyle,
  height: 38,
  padding: "8px 11px",
  borderRadius: 13,
};

const compactSearchRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px minmax(0, 1fr) 52px",
  alignItems: "center",
  gap: 7,
  minWidth: 0,
};

const compactSearchIconStyle: React.CSSProperties = {
  height: 38,
  display: "grid",
  placeItems: "center",
  borderRadius: 13,
  background: "rgba(255,255,255,.06)",
  border: "1px solid rgba(255,255,255,.08)",
  fontSize: 15,
};

const compactSearchInputStyle: React.CSSProperties = {
  ...inputStyle,
  height: 38,
  padding: "8px 11px",
  borderRadius: 13,
};

const compactApplyButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  height: 38,
  padding: "8px 10px",
  borderRadius: 13,
  fontSize: 13,
};

const errorStyle: React.CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "rgba(255,61,99,.12)",
  border: "1px solid rgba(255,61,99,.28)",
  color: "#ffd7e1",
  fontWeight: 850,
  whiteSpace: "pre-wrap",
};

const listStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  display: "grid",
  alignContent: "start",
  gap: 8,
  paddingRight: 3,
  boxSizing: "border-box",
};

const emptyStyle: React.CSSProperties = {
  minHeight: 180,
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  borderRadius: 18,
  background: "rgba(255,255,255,.035)",
  border: "1px dashed rgba(255,255,255,.12)",
  color: "#aebce0",
  fontWeight: 900,
};

const rowStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  display: "grid",
  gridTemplateColumns:
    "68px minmax(90px,.75fr) 72px 92px 68px 80px minmax(78px,.25fr) 34px",
  gap: 10,
  alignItems: "center",
  padding: 10,
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.035)",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const thumbStyle: React.CSSProperties = {
  width: 68,
  height: 48,
  borderRadius: 12,
  overflow: "hidden",
  display: "grid",
  placeItems: "center",
  background: "rgba(255,255,255,.08)",
};

const thumbImgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const nameBlockStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 4,
};

const nameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 14,
};

const tagStyle: React.CSSProperties = {
  color: "#aebce0",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 760,
};

const pillStyle: React.CSSProperties = {
  justifySelf: "start",
  maxWidth: "100%",
  borderRadius: 999,
  padding: "6px 10px",
  background: "rgba(76,195,255,.12)",
  border: "1px solid rgba(76,195,255,.22)",
  color: "#dff6ff",
  fontSize: 12,
  fontWeight: 950,
};

const optimizerCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
};

const optimizeButtonStyle: React.CSSProperties = {
  maxWidth: "100%",
  borderRadius: 999,
  padding: "5px 9px",
  border: "1px solid rgba(251,191,36,.30)",
  background: "rgba(120,53,15,.20)",
  color: "#fde68a",
  fontSize: 11,
  lineHeight: 1.05,
  fontWeight: 950,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const compactMediaStatusStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  justifyItems: "start",
  alignContent: "center",
  gap: 2,
};

const compactTypePillStyle: React.CSSProperties = {
  ...pillStyle,
  padding: "3px 7px",
  fontSize: 10,
  lineHeight: 1.05,
};

const compactOptimizeButtonStyle: React.CSSProperties = {
  ...optimizeButtonStyle,
  padding: "3px 7px",
  fontSize: 9.5,
  lineHeight: 1.05,
};

const metaStyle: React.CSSProperties = {
  color: "#c7d4f0",
  fontSize: 12,
  fontWeight: 850,
  whiteSpace: "nowrap",
};

const checkStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  borderRadius: 999,
  background: "rgba(255,255,255,.08)",
  color: "#69efff",
  fontWeight: 950,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  flexShrink: 0,
  paddingTop: 8,
  background:
    "linear-gradient(180deg, rgba(5,12,30,.30), rgba(5,12,30,.96))",
  position: "relative",
  zIndex: 2,
};

const footerHintStyle: React.CSSProperties = {
  color: "#aebce0",
  fontSize: 11,
  fontWeight: 850,
  minWidth: 0,
  lineHeight: 1.18,
};

const cancelButtonStyle: React.CSSProperties = {
  boxSizing: "border-box",
  border: "1px solid rgba(255,255,255,.13)",
  borderRadius: 999,
  background: "rgba(255,255,255,.08)",
  color: "#fff",
  fontWeight: 950,
  padding: "11px 16px",
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  boxSizing: "border-box",
  border: "1px solid rgba(255,255,255,.16)",
  borderRadius: 999,
  background: "linear-gradient(135deg, #3b82f6, #b92be8)",
  color: "#fff",
  fontWeight: 950,
  padding: "11px 18px",
  cursor: "pointer",
};

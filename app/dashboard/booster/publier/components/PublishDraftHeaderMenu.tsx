"use client";

import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import menuStyles from "./publishDraftHeaderMenu.module.css";

type PublishDraftSummary = {
  id: string;
  title: string;
  preview: string;
  channels: string[];
  savedAt: string;
};

type MenuPosition = Pick<CSSProperties, "top" | "left" | "width">;

type Props = {
  activeDraftId?: string;
  buttonClassName: string;
  disabled?: boolean;
  emptyScopeLabel?: string;
  endpoint?: string;
  fallbackBadge?: string;
  moduleLabel?: string;
  onSelect: (draftId: string) => void | Promise<void>;
};

const CHANNEL_LABELS: Record<string, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr’Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
  x: "X",
};

function formatDraftDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatChannel(channel: string) {
  return CHANNEL_LABELS[channel] || channel;
}

function DraftsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M7 3.75h7.2L18.25 7.8V20.25H7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M14 3.75V8h4.25M9.75 12h5.75M9.75 15.25h5.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M4.25 7.25v13h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".72"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      className={open ? menuStyles.chevronOpen : undefined}
    >
      <path
        d="m4 6 4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d="M15.6 7.1A6.2 6.2 0 1 0 16 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12.2 7.1h3.7V3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PublishDraftHeaderMenu({
  activeDraftId = "",
  buttonClassName,
  disabled = false,
  emptyScopeLabel,
  endpoint = "/api/booster/events?view=drafts&limit=20",
  fallbackBadge = "Booster",
  moduleLabel = "Booster",
  onSelect,
}: Props) {
  const mailsT = useTranslations("mails");
  const boosterT = useTranslations("booster");
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<PublishDraftSummary[]>([]);

  const loadDrafts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result?.error || "draft_load_failed"));
      if (requestId !== requestIdRef.current) return;
      const nextDrafts = Array.isArray(result?.drafts)
        ? result.drafts
            .map((draft: Partial<PublishDraftSummary>) => ({
              id: String(draft?.id || "").trim(),
              title:
                String(draft?.title || "").trim() ||
                mailsT("brouillon_57d2d7a7"),
              preview: String(draft?.preview || "").trim(),
              channels: Array.isArray(draft?.channels)
                ? draft.channels
                    .map((channel) => String(channel || "").trim())
                    .filter(Boolean)
                : [],
              savedAt: String(draft?.savedAt || ""),
            }))
            .filter((draft: PublishDraftSummary) => Boolean(draft.id))
        : [];
      setDrafts(nextDrafts);
    } catch {
      if (requestId === requestIdRef.current) setLoadFailed(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [endpoint, mailsT]);

  const syncMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const compact = viewportWidth <= 768;
    const margin = compact ? 10 : 14;
    const width = Math.max(
      0,
      Math.min(compact ? viewportWidth - margin * 2 : 430, viewportWidth - margin * 2),
    );
    const minLeft = viewportLeft + margin;
    const maxLeft = viewportLeft + viewportWidth - width - margin;
    const left = compact
      ? minLeft
      : Math.min(Math.max(minLeft, rect.right - width), maxLeft);
    const top = Math.max(viewportTop + margin, rect.bottom + 10);
    const nextPosition = {
      top: Math.round(top),
      left: Math.round(left),
      width: Math.round(width),
    };

    setMenuPosition((current) => {
      if (
        current?.top === nextPosition.top &&
        current.left === nextPosition.left &&
        current.width === nextPosition.width
      ) {
        return current;
      }
      return nextPosition;
    });
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    setMenuPosition(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const toggleMenu = () => {
    if (disabled) return;
    if (open) {
      closeMenu();
      return;
    }
    setMenuPosition(null);
    setOpen(true);
    void loadDrafts();
  };

  useEffect(() => {
    if (!open) return;
    syncMenuPosition();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
    };
    const visualViewport = window.visualViewport;

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", syncMenuPosition);
    window.addEventListener("scroll", syncMenuPosition, true);
    visualViewport?.addEventListener("resize", syncMenuPosition);
    visualViewport?.addEventListener("scroll", syncMenuPosition);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", syncMenuPosition);
      window.removeEventListener("scroll", syncMenuPosition, true);
      visualViewport?.removeEventListener("resize", syncMenuPosition);
      visualViewport?.removeEventListener("scroll", syncMenuPosition);
    };
  }, [closeMenu, open, syncMenuPosition]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [],
  );

  const menu =
    open && menuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            id={menuId}
            ref={menuRef}
            className={menuStyles.menu}
            style={menuPosition}
            role="menu"
            aria-label={mailsT("brouillons_a55f3cd9")}
          >
            <div className={menuStyles.menuHeader}>
              <span className={menuStyles.menuIcon} aria-hidden="true">
                <DraftsIcon />
              </span>
              <span className={menuStyles.menuHeading}>
                <small>{moduleLabel}</small>
                <strong>{mailsT("brouillons_a55f3cd9")}</strong>
              </span>
              <span className={menuStyles.menuCount}>{drafts.length}</span>
              <button
                type="button"
                className={menuStyles.refreshButton}
                onClick={() => void loadDrafts()}
                disabled={loading}
                aria-label={mailsT("actualiser_9d3b2a7d")}
                title={mailsT("actualiser_9d3b2a7d")}
              >
                <RefreshIcon />
              </button>
            </div>

            <div className={menuStyles.list}>
              {loading ? (
                <div className={menuStyles.loadingState}>
                  <span className={menuStyles.loader} aria-hidden="true" />
                  {mailsT("chargement_01cba1df")}
                </div>
              ) : loadFailed ? (
                <button
                  type="button"
                  className={menuStyles.retryButton}
                  onClick={() => void loadDrafts()}
                >
                  <RefreshIcon />
                  {mailsT("actualiser_9d3b2a7d")}
                </button>
              ) : drafts.length === 0 ? (
                <div className={menuStyles.emptyState}>
                  <span className={menuStyles.emptyIcon} aria-hidden="true">
                    <DraftsIcon />
                  </span>
                  {mailsT("aucun_brouillon_dans_value_b6011534", {
                    value0:
                      emptyScopeLabel || boosterT("publications_0855684c"),
                  })}
                </div>
              ) : (
                drafts.map((draft) => {
                  const active = draft.id === activeDraftId;
                  const visibleChannels = draft.channels.slice(0, 3);
                  const remainingChannels = Math.max(
                    0,
                    draft.channels.length - visibleChannels.length,
                  );
                  const savedAt = formatDraftDate(draft.savedAt);

                  return (
                    <button
                      key={draft.id}
                      type="button"
                      role="menuitem"
                      className={`${menuStyles.draftItem} ${
                        active ? menuStyles.draftItemActive : ""
                      }`}
                      onClick={() => {
                        closeMenu();
                        void onSelect(draft.id);
                      }}
                    >
                      <span className={menuStyles.draftTopLine}>
                        <strong>{draft.title}</strong>
                        {active ? (
                          <span className={menuStyles.activeBadge}>✓</span>
                        ) : (
                          <span className={menuStyles.openArrow} aria-hidden="true">
                            →
                          </span>
                        )}
                      </span>
                      {draft.preview ? (
                        <span className={menuStyles.preview}>{draft.preview}</span>
                      ) : null}
                      <span className={menuStyles.meta}>
                        <span className={menuStyles.channelList}>
                          {visibleChannels.length ? (
                            visibleChannels.map((channel) => (
                              <span className={menuStyles.channelBadge} key={channel}>
                                {formatChannel(channel)}
                              </span>
                            ))
                          ) : (
                            <span className={menuStyles.channelBadge}>{fallbackBadge}</span>
                          )}
                          {remainingChannels ? (
                            <span className={menuStyles.channelBadge}>
                              +{remainingChannels}
                            </span>
                          ) : null}
                        </span>
                        {savedAt ? (
                          <time dateTime={draft.savedAt}>{savedAt}</time>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={menuStyles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={`${buttonClassName} ${menuStyles.trigger}`}
        onClick={toggleMenu}
        disabled={disabled}
        data-open={open ? "true" : "false"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={mailsT("brouillons_a55f3cd9")}
      >
        <span className={menuStyles.triggerIcon}>
          <DraftsIcon />
        </span>
        <span className={menuStyles.triggerLabel}>
          {mailsT("brouillons_a55f3cd9")}
        </span>
        {drafts.length > 0 ? (
          <span className={menuStyles.count}>{drafts.length}</span>
        ) : null}
        <span className={menuStyles.chevron} aria-hidden="true">
          <ChevronIcon open={open} />
        </span>
      </button>
      {menu}
    </div>
  );
}

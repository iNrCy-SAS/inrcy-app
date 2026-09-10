"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import menuStyles from "./publishDraftHeaderMenu.module.css";

type PublishDraftSummary = {
  id: string;
  title: string;
  preview: string;
  channels: string[];
  savedAt: string;
};

type Props = {
  activeDraftId?: string;
  buttonClassName: string;
  disabled?: boolean;
  onSelect: (draftId: string) => void | Promise<void>;
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
      <path d="M14 3.75V8h4.25M9.75 12h5.75M9.75 15.25h5.75" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.25 7.25v13h9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity=".72" />
    </svg>
  );
}

export default function PublishDraftHeaderMenu({
  activeDraftId = "",
  buttonClassName,
  disabled = false,
  onSelect,
}: Props) {
  const mailsT = useTranslations("mails");
  const boosterT = useTranslations("booster");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<PublishDraftSummary[]>([]);

  const loadDrafts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch("/api/booster/events?view=drafts&limit=20", {
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
              title: String(draft?.title || "").trim() || mailsT("brouillon_57d2d7a7"),
              preview: String(draft?.preview || "").trim(),
              channels: Array.isArray(draft?.channels)
                ? draft.channels.map((channel) => String(channel || "").trim()).filter(Boolean)
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
  }, [mailsT]);

  const toggleMenu = () => {
    if (disabled) return;
    setOpen((current) => {
      const next = !current;
      if (next) void loadDrafts();
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  return (
    <div ref={rootRef} className={menuStyles.root}>
      <button
        type="button"
        className={`${buttonClassName} ${menuStyles.trigger}`}
        onClick={toggleMenu}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={mailsT("brouillons_a55f3cd9")}
      >
        <DraftsIcon />
        <span className={menuStyles.triggerLabel}>{mailsT("brouillons_a55f3cd9")}</span>
        {drafts.length > 0 ? <span className={menuStyles.count}>{drafts.length}</span> : null}
        <span className={menuStyles.chevron} aria-hidden="true">⌄</span>
      </button>

      {open ? (
        <div className={menuStyles.menu} role="menu" aria-label={mailsT("brouillons_a55f3cd9")}>
          <div className={menuStyles.menuHeader}>
            <strong>{mailsT("brouillons_a55f3cd9")}</strong>
            <button
              type="button"
              className={menuStyles.refreshButton}
              onClick={() => void loadDrafts()}
              disabled={loading}
              aria-label={mailsT("actualiser_9d3b2a7d")}
              title={mailsT("actualiser_9d3b2a7d")}
            >
              ↻
            </button>
          </div>

          <div className={menuStyles.list}>
            {loading ? (
              <div className={menuStyles.emptyState}>{mailsT("chargement_01cba1df")}</div>
            ) : loadFailed ? (
              <button type="button" className={menuStyles.retryButton} onClick={() => void loadDrafts()}>
                {mailsT("actualiser_9d3b2a7d")}
              </button>
            ) : drafts.length === 0 ? (
              <div className={menuStyles.emptyState}>
                {mailsT("aucun_brouillon_dans_value_b6011534", {
                  value0: boosterT("publications_0855684c"),
                })}
              </div>
            ) : (
              drafts.map((draft) => {
                const active = draft.id === activeDraftId;
                return (
                  <button
                    key={draft.id}
                    type="button"
                    role="menuitem"
                    className={`${menuStyles.draftItem} ${active ? menuStyles.draftItemActive : ""}`}
                    onClick={() => {
                      setOpen(false);
                      void onSelect(draft.id);
                    }}
                  >
                    <span className={menuStyles.draftTopLine}>
                      <strong>{draft.title}</strong>
                      {active ? <span className={menuStyles.activeBadge}>✓</span> : null}
                    </span>
                    {draft.preview ? <span className={menuStyles.preview}>{draft.preview}</span> : null}
                    <span className={menuStyles.meta}>
                      {draft.channels.length ? draft.channels.join(" · ") : "Booster"}
                      {formatDraftDate(draft.savedAt) ? ` · ${formatDraftDate(draft.savedAt)}` : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

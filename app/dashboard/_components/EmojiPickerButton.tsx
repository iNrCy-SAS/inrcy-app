"use client";

import { useTranslations } from "next-intl";


import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type EmojiPickerButtonProps = {
  onSelect: (emoji: string) => void;
  onBeforeOpen?: () => void;
  disabled?: boolean;
  buttonStyle?: CSSProperties;
  className?: string;
};

type EmojiGroup = {
  key: string;
  labelKey: string;
  emojis: string[];
};

const EMOJI_GROUPS: EmojiGroup[] = [
  {
    key: "frequent",
    labelKey: "frequents_964a1839",
    emojis: ["😊", "😀", "😂", "😍", "😉", "😄", "😌", "🤩", "😎", "🙂", "🙌", "👏", "👍", "👎", "🙏", "💪", "✨", "🔥", "💡", "✅", "⭐", "🎉", "❤️", "📣"],
  },
  {
    key: "smileys",
    labelKey: "smileys_e18b128a",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😎", "🤩", "🤔", "😮", "😢", "😭", "😡"],
  },
  {
    key: "gestures",
    labelKey: "gestes_c73ece40",
    emojis: ["👍", "👎", "👌", "✌️", "🤞", "🤝", "👏", "🙌", "👐", "🙏", "💪", "👋", "👉", "👈", "☝️", "✍️", "🤗", "💯"],
  },
  {
    key: "business",
    labelKey: "pro_66d0c5e6",
    emojis: ["✨", "⭐", "🌟", "🔥", "💡", "✅", "❌", "⚠️", "📣", "📢", "📌", "🎯", "🚀", "💼", "📈", "📊", "🛍️", "🏆", "🎉", "🎁", "💬", "📩", "☎️", "🗓️"],
  },
  {
    key: "objects",
    labelKey: "objets_3b3a5f5b",
    emojis: ["📱", "💻", "⌚", "📸", "🎥", "🎨", "📝", "📚", "🔑", "🔒", "💳", "💰", "🛠️", "🏠", "📍", "🌐", "✉️", "📞", "⏰", "☀️", "☕", "🍽️", "🎵", "❤️"],
  },
];

const ALL_EMOJIS = Array.from(new Set(EMOJI_GROUPS.flatMap((group) => group.emojis)));
const RECENT_STORAGE_KEY = "inrcy:recent-emojis";

export default function EmojiPickerButton({
  onSelect,
  onBeforeOpen,
  disabled = false,
  buttonStyle,
  className,
}: EmojiPickerButtonProps) {
  const i18nT = useTranslations("media");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState("frequent");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) setRecent(stored.filter((item): item is string => typeof item === "string").slice(0, 24));
    } catch {
      // Le sélecteur reste utilisable même si le stockage local est indisponible.
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(310, window.innerWidth - 24);
      const estimatedHeight = Math.min(430, window.innerHeight - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = below + estimatedHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - estimatedHeight - 8);
      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open) onBeforeOpen?.();
    setOpen((current) => !current);
    if (open) setQuery("");
  };

  const visibleEmojis = query.trim()
    ? ALL_EMOJIS
    : activeGroup === "frequent"
      ? (recent.length ? recent : EMOJI_GROUPS[0].emojis)
      : EMOJI_GROUPS.find((group) => group.key === activeGroup)?.emojis || ALL_EMOJIS;

  const selectEmoji = (emoji: string) => {
    const nextRecent = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, 24);
    setRecent(nextRecent);
    try {
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(nextRecent));
    } catch {
      // Le choix est quand même inséré si le stockage local est bloqué.
    }
    onSelect(emoji);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        style={buttonStyle}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        aria-label={i18nT("ajouter_un_emoji_5073bf87")}
        title={i18nT("emojis_ac171aac")}
        aria-expanded={open}
        disabled={disabled}
      >
        😊
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={i18nT("selecteur_d_emojis_371e284c")}
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                zIndex: 100500,
                width: "min(310px, calc(100vw - 24px))",
                maxHeight: "min(430px, calc(100dvh - 24px))",
                overflow: "hidden",
                boxSizing: "border-box",
                padding: 10,
                borderRadius: 16,
                border: "1px solid rgba(125, 211, 252, 0.34)",
                background: "linear-gradient(180deg, rgba(21, 30, 53, 0.99), rgba(14, 19, 37, 0.99))",
                boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
                color: "white",
              }}
            >
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={i18nT("rechercher_un_emoji_ac220fec")}
                aria-label={i18nT("rechercher_un_emoji_e6092dd0")}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 8,
                  padding: "9px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(4,8,20,0.72)",
                  color: "white",
                  outline: "none",
                  font: "inherit",
                  fontSize: 13,
                }}
              />
              {!query.trim() ? (
                <div role="tablist" aria-label={i18nT("categories_d_emojis_45f203e0")} style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 8 }}>
                  {EMOJI_GROUPS.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      role="tab"
                      aria-selected={activeGroup === group.key}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setActiveGroup(group.key)}
                      style={{
                        flex: "0 0 auto",
                        border: activeGroup === group.key ? "1px solid rgba(125,211,252,0.58)" : "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        background: activeGroup === group.key ? "rgba(56,189,248,0.2)" : "rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.82)",
                        padding: "5px 7px",
                        cursor: "pointer",
                        font: "inherit",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                      }}
                    >
              {i18nT(group.labelKey)}
                    </button>
                  ))}
                </div>
              ) : null}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                  gap: 4,
                  overflowY: "auto",
                  maxHeight: "min(320px, calc(100dvh - 150px))",
                  padding: 2,
                }}
              >
                {visibleEmojis.map((emoji, index) => (
                  <button
                    key={`${emoji}-${index}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectEmoji(emoji)}
                    aria-label={i18nT("inserer_value_f2cefa14", { value0: emoji })}
                    title={emoji}
                    style={{
                      minWidth: 0,
                      aspectRatio: "1",
                      border: "1px solid transparent",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.05)",
                      color: "white",
                      cursor: "pointer",
                      fontSize: 20,
                      lineHeight: 1,
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

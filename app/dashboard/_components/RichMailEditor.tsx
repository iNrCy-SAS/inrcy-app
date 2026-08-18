"use client";

import { useTranslations } from "next-intl";


import React, { useEffect, useRef, useState, type CSSProperties } from "react";
import { highlightTemplatePlaceholdersInHtml, normalizeRichMailHtmlForSend, richMailHtmlToText, sanitizeRichMailHtml, stripTemplatePlaceholderHighlights, textToRichMailHtml } from "@/lib/mailRichText";
import EmojiPickerButton from "./EmojiPickerButton";

type RichMailEditorProps = {
  text: string;
  html: string;
  onChange: (next: { text: string; html: string }) => void;
  placeholder?: string;
  minHeight?: string | number;
  className?: string;
  editorStyle?: CSSProperties;
  toolbarTitle?: React.ReactNode;
  hideToolbarLabel?: boolean;
  compactToolbar?: boolean;
  highlightTemplatePlaceholders?: boolean;
  mobileFullscreen?: boolean;
};

export default function RichMailEditor({
  text,
  html,
  onChange,
  placeholder = "Votre message…",
  minHeight = "clamp(180px, 30vh, 260px)",
  className,
  editorStyle,
  toolbarTitle,
  hideToolbarLabel = false,
  compactToolbar = false,
  highlightTemplatePlaceholders = true,
  mobileFullscreen = false,
}: RichMailEditorProps) {
  const i18nT = useTranslations("mails");
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef("");
  const lastTouchYRef = useRef<number | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const skipNextToolbarClickRef = useRef(false);
  const [isEmpty, setIsEmpty] = useState(() => !String(text || "").trim());
  const [isExpanded, setIsExpanded] = useState(false);

  const saveSelection = () => {
    const node = editorRef.current;
    if (!node || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount <= 0) return;
    const range = selection.getRangeAt(0);
    if (!node.contains(range.commonAncestorContainer)) return;
    savedSelectionRef.current = range.cloneRange();
  };

  const restoreSelection = () => {
    const node = editorRef.current;
    const range = savedSelectionRef.current;
    if (!node || !range || typeof window === "undefined") return;
    try {
      if (!node.contains(range.commonAncestorContainer)) return;
      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      savedSelectionRef.current = null;
    }
  };

  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    const normalizedHtml = normalizeRichMailHtmlForSend(text, html || textToRichMailHtml(text));
    const nextHtml = highlightTemplatePlaceholders ? highlightTemplatePlaceholdersInHtml(normalizedHtml) : stripTemplatePlaceholderHighlights(normalizedHtml);
    if (lastHtmlRef.current === nextHtml) return;
    if (node.innerHTML === nextHtml) return;
    node.innerHTML = nextHtml;
    lastHtmlRef.current = nextHtml;
    setIsEmpty(!String(text || "").trim());
  }, [highlightTemplatePlaceholders, html, text]);

  const emitChange = (syncDisplay = false) => {
    const node = editorRef.current;
    if (!node) return;
    const rawHtml = stripTemplatePlaceholderHighlights(node.innerHTML);
    const cleanHtml = sanitizeRichMailHtml(rawHtml);
    const displayHtml = highlightTemplatePlaceholders ? highlightTemplatePlaceholdersInHtml(cleanHtml) : cleanHtml;
    const cleanText = richMailHtmlToText(cleanHtml || node.innerText || "");
    if (syncDisplay && node.innerHTML !== displayHtml) {
      node.innerHTML = displayHtml;
    }
    lastHtmlRef.current = displayHtml;
    setIsEmpty(!cleanText.trim());
    onChange({ text: cleanText, html: displayHtml || textToRichMailHtml(cleanText) });
  };

  const applyCommand = (command: "bold" | "italic" | "underline") => {
    const node = editorRef.current;
    if (!node) return;
    focusEditableWithoutScroll(node);
    restoreSelection();
    try {
      document.execCommand(command, false);
    } catch {
      // Les navigateurs anciens peuvent ignorer la commande.
    }
    emitChange();
    saveSelection();
  };

  const insertEmoji = (emoji: string) => {
    const node = editorRef.current;
    if (!node) return;
    focusEditableWithoutScroll(node);
    restoreSelection();
    try {
      document.execCommand("insertText", false, emoji);
    } catch {
      // Les navigateurs anciens peuvent ignorer la commande.
    }
    emitChange();
    saveSelection();
  };

  const keepEditorSelection = (event: React.MouseEvent<HTMLButtonElement>) => {
    saveSelection();
    if (event.cancelable) event.preventDefault();
  };

  const applyToolbarCommandFromTouch = (
    event: React.TouchEvent<HTMLButtonElement>,
    command: "bold" | "italic" | "underline",
  ) => {
    saveSelection();
    if (event.cancelable) event.preventDefault();
    skipNextToolbarClickRef.current = true;
    applyCommand(command);
    window.setTimeout(() => {
      skipNextToolbarClickRef.current = false;
    }, 500);
  };

  const applyToolbarCommandFromClick = (command: "bold" | "italic" | "underline") => {
    if (skipNextToolbarClickRef.current) {
      skipNextToolbarClickRef.current = false;
      return;
    }
    applyCommand(command);
  };

  const passScrollToParent = (deltaY: number) => {
    const node = editorRef.current;
    const scrollParent = findScrollableParent(node);
    if (!scrollParent) return false;
    scrollParent.scrollTop += deltaY;
    return true;
  };

  const shouldPassScrollToParent = (deltaY: number) => {
    const node = editorRef.current;
    if (!node) return false;
    const hasInternalScroll = node.scrollHeight > node.clientHeight + 1;
    if (!hasInternalScroll) return true;

    const isScrollingUp = deltaY < 0;
    const isScrollingDown = deltaY > 0;
    const atTop = node.scrollTop <= 0;
    const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;

    return (isScrollingUp && atTop) || (isScrollingDown && atBottom);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const deltaY = event.deltaY;
    if (!deltaY || !shouldPassScrollToParent(deltaY)) return;
    if (!passScrollToParent(deltaY)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    lastTouchYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const previousY = lastTouchYRef.current;
    const currentY = event.touches[0]?.clientY ?? null;
    if (previousY === null || currentY === null) return;

    const deltaY = previousY - currentY;
    lastTouchYRef.current = currentY;
    if (!deltaY || !shouldPassScrollToParent(deltaY)) return;
    if (!passScrollToParent(deltaY)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };

  const handleTouchEnd = () => {
    lastTouchYRef.current = null;
  };

  useEffect(() => {
    if (!isExpanded || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!mobileFullscreen && isExpanded) setIsExpanded(false);
  }, [mobileFullscreen, isExpanded]);

  const fillAvailable = minHeight === 0 || minHeight === "0" || minHeight === "0px";
  const buttonStyle = compactToolbar ? compactToolbarButtonStyle : toolbarButtonStyle;
  const toolbar = (
    <div style={{ display: "flex", gap: compactToolbar ? 5 : 6, alignItems: "center", flex: "0 0 auto" }}>
      <button type="button" onMouseDown={keepEditorSelection} onTouchStart={(event) => applyToolbarCommandFromTouch(event, "bold")} onClick={() => applyToolbarCommandFromClick("bold")} aria-label={i18nT("gras_bd63d1e9")} title={i18nT("gras_bd63d1e9")} style={buttonStyle}>
        <strong>B</strong>
      </button>
      <button type="button" onMouseDown={keepEditorSelection} onTouchStart={(event) => applyToolbarCommandFromTouch(event, "italic")} onClick={() => applyToolbarCommandFromClick("italic")} aria-label={i18nT("italique_023eb97e")} title={i18nT("italique_023eb97e")} style={buttonStyle}>
        <em>I</em>
      </button>
      <button type="button" onMouseDown={keepEditorSelection} onTouchStart={(event) => applyToolbarCommandFromTouch(event, "underline")} onClick={() => applyToolbarCommandFromClick("underline")} aria-label={i18nT("souligne_591b8563")} title={i18nT("souligne_591b8563")} style={buttonStyle}>
        <span style={{ textDecoration: "underline" }}>U</span>
      </button>
      <EmojiPickerButton onBeforeOpen={saveSelection} onSelect={insertEmoji} buttonStyle={buttonStyle} />
    </div>
  );

  const showExpandControl = mobileFullscreen;

  return (
    <div
      role={isExpanded ? "dialog" : undefined}
      aria-modal={isExpanded ? true : undefined}
      aria-label={isExpanded ? "Éditeur de message en plein écran" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compactToolbar ? 6 : 8,
        flex: "1 1 auto",
        minHeight: 0,
        overflow: "hidden",
        ...(isExpanded
          ? {
              position: "fixed" as const,
              inset: 0,
              bottom: "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + env(safe-area-inset-bottom, 0px)))",
              zIndex: 100000,
              padding: "max(14px, env(safe-area-inset-top)) 14px 14px",
              background: "linear-gradient(180deg, #10182b 0%, #12172a 55%, #0b1020 100%)",
              boxSizing: "border-box" as const,
            }
          : {}),
      }}
    >
      <div
        style={{
          display: showExpandControl ? "grid" : "flex",
          gridTemplateColumns: showExpandControl ? "minmax(0,1fr) auto minmax(0,1fr)" : undefined,
          alignItems: "center",
          justifyContent: showExpandControl ? undefined : "space-between",
          gap: 8,
          flexWrap: "nowrap",
          minWidth: 0,
          flex: "0 0 auto",
        }}
      >
        {toolbarTitle ? (
          <div style={{ minWidth: 0, justifySelf: showExpandControl ? "start" : undefined }}>{toolbarTitle}</div>
        ) : hideToolbarLabel ? (
          <span aria-hidden="true" style={{ minWidth: 0 }} />
        ) : (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", minWidth: 0 }}>{i18nT("mise_en_forme_du_message_87b921eb")}</span>
        )}
        {showExpandControl ? (
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            aria-label={isExpanded ? "Rétrécir l’éditeur" : "Agrandir l’éditeur"}
            title={isExpanded ? "Rétrécir" : "Agrandir"}
            style={expandButtonStyle}
          >
            {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        ) : null}
        <div style={{ justifySelf: showExpandControl ? "end" : undefined }}>{toolbar}</div>
      </div>

      <div
        style={{
          position: "relative",
          flex: fillAvailable ? "1 1 0" : "0 0 auto",
          minHeight: fillAvailable ? 0 : minHeight,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {isEmpty ? (
          <span
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              color: "rgba(255,255,255,0.42)",
              fontSize: 16,
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            {placeholder}
          </span>
        ) : null}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          className={className}
          onInput={() => {
            emitChange();
            saveSelection();
          }}
          onBlur={() => emitChange(true)}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = event.clipboardData.getData("text/plain") || "";
            document.execCommand("insertText", false, pasted);
            emitChange();
            saveSelection();
          }}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={{
            ...editorStyle,
            ...(isExpanded ? { minHeight: 0, height: "100%", maxHeight: "100%", borderRadius: 16, padding: 14 } : {}),
            width: "100%",
            flex: "1 1 auto",
            minHeight: fillAvailable ? 0 : "100%",
            height: "100%",
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "auto",
            scrollbarGutter: "stable",
            scrollPaddingTop: 12,
            scrollPaddingBottom: 24,
            fontSize: 16,
            lineHeight: 1.55,
            boxSizing: "border-box",
            display: "block",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}

function focusEditableWithoutScroll(node: HTMLElement) {
  try {
    node.focus({ preventScroll: true });
  } catch {
    node.focus();
  }
}

function findScrollableParent(node: HTMLElement | null): HTMLElement | null {
  let parent = node?.parentElement ?? null;

  while (parent) {
    const style = window.getComputedStyle(parent);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScrollY && parent.scrollHeight > parent.clientHeight + 1) {
      return parent;
    }
    parent = parent.parentElement;
  }

  const scrollingElement = document.scrollingElement;
  return scrollingElement instanceof HTMLElement ? scrollingElement : null;
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 8H3V3M16 8h5V3M8 16H3v5M16 16h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const expandButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  border: "1px solid rgba(56,189,248,0.36)",
  background: "linear-gradient(135deg, rgba(56,189,248,0.25), rgba(167,139,250,0.18))",
  color: "#ffffff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 6px 14px rgba(0,0,0,0.14)",
};

const toolbarButtonStyle: CSSProperties = {
  minWidth: 32,
  height: 30,
  borderRadius: 10,
  border: "1px solid rgba(56,189,248,0.36)",
  background: "linear-gradient(135deg, rgba(56,189,248,0.25), rgba(167,139,250,0.18))",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(0,0,0,0.16)",
};

const compactToolbarButtonStyle: CSSProperties = {
  ...toolbarButtonStyle,
  minWidth: 28,
  height: 28,
  borderRadius: 9,
  fontSize: 13,
  boxShadow: "0 6px 14px rgba(0,0,0,0.14)",
};

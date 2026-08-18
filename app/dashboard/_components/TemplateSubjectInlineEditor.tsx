"use client";

import { useTranslations } from "next-intl";


import { useEffect, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent } from "react";

type TemplateSubjectInlineEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export default function TemplateSubjectInlineEditor({
  value,
  onChange,
  placeholder = "Votre objet",
}: TemplateSubjectInlineEditorProps) {
  const i18nT = useTranslations("mails");
  const editableRef = useRef<HTMLSpanElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const showPlaceholder = !value.trim() && !isFocused;

  useEffect(() => {
    const node = editableRef.current;
    if (!node) return;
    if (document.activeElement === node) return;
    if (node.textContent !== value) node.textContent = value || "";
  }, [value]);

  const emitChange = () => {
    const node = editableRef.current;
    if (!node) return;
    const next = (node.textContent || "").replace(/\s*\n\s*/g, " ");
    onChange(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text);
    emitChange();
  };

  return (
    <div
      role="group"
      aria-label={i18nT("objet_du_message_b20d7489")}
      style={subjectShellStyle}
      onClick={() => editableRef.current?.focus()}
    >
      <span style={subjectLabelStyle}>{i18nT("objet_nbsp_82d7e48a")}</span>{" "}
      <span
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={i18nT("objet_3de621c5")}
        onInput={emitChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          const node = editableRef.current;
          if (!node) return;
          const trimmed = (node.textContent || "").replace(/\s*\n\s*/g, " ").trim();
          if (node.textContent !== trimmed) node.textContent = trimmed;
          onChange(trimmed);
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        style={{ ...subjectTextStyle, opacity: value.trim() ? 1 : 0.72 }}
      />
      {showPlaceholder ? <span style={placeholderStyle}>{placeholder}</span> : null}
    </div>
  );
}

const subjectShellStyle: CSSProperties = {
  display: "block",
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
  maxHeight: "4.35em",
  overflowY: "auto",
  overflowX: "hidden",
  WebkitOverflowScrolling: "touch",
  boxSizing: "border-box",
  textAlign: "left",
  color: "#ffffff",
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  cursor: "text",
};

const subjectLabelStyle: CSSProperties = {
  display: "inline",
  fontSize: "inherit",
  lineHeight: "inherit",
  fontWeight: 900,
  color: "rgba(255,255,255,0.86)",
  verticalAlign: "baseline",
};

const subjectTextStyle: CSSProperties = {
  display: "inline",
  minWidth: "1ch",
  outline: "none",
  color: "#ffffff",
  fontSize: "inherit",
  lineHeight: "inherit",
  fontWeight: 700,
  verticalAlign: "baseline",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};


const placeholderStyle: CSSProperties = {
  display: "inline",
  color: "rgba(255,255,255,0.46)",
  fontSize: "inherit",
  lineHeight: "inherit",
  fontWeight: 600,
  verticalAlign: "baseline",
  pointerEvents: "none",
};

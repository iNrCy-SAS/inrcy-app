"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useTranslations } from "next-intl";

import {
  businessDnaHtmlToPlainText,
  businessDnaTextToHtml,
  sanitizeBusinessDnaRichHtml,
} from "@/lib/businessDnaRichText";
import MediaSubjectVoiceButton from "../../_components/MediaSubjectVoiceButton";

type Props = {
  label?: string;
  value: string;
  html: string;
  onChange: (next: { text: string; html: string }) => void;
  placeholder: string;
  maxLength?: number;
  minHeight?: number;
  disabled?: boolean;
  onVoiceBusyChange?: (busy: boolean) => void;
};

export default function BusinessDnaRichTextEditor({
  label,
  value,
  html,
  onChange,
  placeholder,
  maxLength = 5_000,
  minHeight = 165,
  disabled = false,
  onVoiceBusyChange,
}: Props) {
  const t = useTranslations("dashboard.aiMemory");
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef("");
  const selectionRef = useRef<Range | null>(null);
  const voiceBaseRef = useRef<{ text: string; html: string } | null>(null);
  const voiceActiveRef = useRef(false);
  const [empty, setEmpty] = useState(!value.trim());
  const [voiceBusy, setVoiceBusy] = useState(false);
  const editorLocked = disabled || voiceBusy;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = sanitizeBusinessDnaRichHtml(html || businessDnaTextToHtml(value));
    if (nextHtml === lastHtmlRef.current || nextHtml === editor.innerHTML) return;
    editor.innerHTML = nextHtml;
    lastHtmlRef.current = nextHtml;
    setEmpty(!value.trim());
  }, [html, value]);

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange();
  };

  const restoreSelection = () => {
    const range = selectionRef.current;
    const editor = editorRef.current;
    if (!range || !editor || !editor.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const emitChange = () => {
    if (editorLocked) return;
    const editor = editorRef.current;
    if (!editor) return;
    let nextHtml = sanitizeBusinessDnaRichHtml(editor.innerHTML);
    let nextText = businessDnaHtmlToPlainText(nextHtml);
    if (nextText.length > maxLength) {
      nextText = nextText.slice(0, maxLength);
      nextHtml = businessDnaTextToHtml(nextText);
      editor.innerHTML = nextHtml;
    }
    lastHtmlRef.current = nextHtml;
    setEmpty(!nextText.trim());
    onChange({ text: nextText, html: nextHtml });
  };

  const applyVoiceChange = (nextValue: string) => {
    const base = voiceBaseRef.current || {
      text: value.trim(),
      html: sanitizeBusinessDnaRichHtml(html || businessDnaTextToHtml(value)),
    };
    const nextText = nextValue.trim().slice(0, maxLength);
    let nextHtml = "";

    if (!base.text) {
      nextHtml = businessDnaTextToHtml(nextText);
    } else if (nextText === base.text) {
      nextHtml = base.html;
    } else {
      const appendedText = nextText.startsWith(`${base.text}\n`)
        ? nextText.slice(base.text.length + 1).trim()
        : nextText.startsWith(`${base.text} `)
          ? nextText.slice(base.text.length + 1).trim()
          : "";
      nextHtml = appendedText
        ? sanitizeBusinessDnaRichHtml(`${base.html}${businessDnaTextToHtml(appendedText)}`)
        : businessDnaTextToHtml(nextText);
    }

    const synchronizedText = businessDnaHtmlToPlainText(nextHtml).slice(0, maxLength);
    const editor = editorRef.current;
    if (editor) editor.innerHTML = nextHtml;
    lastHtmlRef.current = nextHtml;
    setEmpty(!synchronizedText);
    onChange({ text: synchronizedText, html: nextHtml });
  };

  const handleVoiceBusyChange = (busy: boolean) => {
    if (busy && !voiceActiveRef.current) {
      voiceBaseRef.current = {
        text: value.trim(),
        html: sanitizeBusinessDnaRichHtml(html || businessDnaTextToHtml(value)),
      };
    }
    voiceActiveRef.current = busy;
    setVoiceBusy(busy);
    onVoiceBusyChange?.(busy);
    if (!busy) voiceBaseRef.current = null;
  };

  const keepSelection = (event: MouseEvent<HTMLButtonElement>) => {
    saveSelection();
    event.preventDefault();
  };

  const applyCommand = (command: "bold" | "italic" | "formatBlock" | "insertUnorderedList" | "removeFormat", value?: string) => {
    if (editorLocked) return;
    const editor = editorRef.current;
    if (!editor) return;
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    restoreSelection();
    try {
      document.execCommand(command, false, value);
    } catch {}
    emitChange();
    saveSelection();
  };

  const toolbarButtons = [
    { key: "bold", label: t("formatBold"), content: <strong>B</strong>, command: "bold" },
    { key: "italic", label: t("formatItalic"), content: <em>I</em>, command: "italic" },
    { key: "title", label: t("formatTitle"), content: <strong style={{ fontSize: 14 }}>T</strong>, command: "formatBlock", value: "h3" },
    { key: "list", label: t("formatList"), content: <span style={{ fontSize: 17, lineHeight: 1 }}>≡</span>, command: "insertUnorderedList" },
    { key: "clear", label: t("formatClear"), content: <span style={{ fontSize: 10.5 }}>Tx</span>, command: "removeFormat" },
  ] as const;

  return (
    <div style={{ display: "grid", gap: 7, minWidth: 0 }}>
      <div style={toolbarStyle}>
        {label ? <span style={editorLabelStyle}>{label}</span> : null}
        <span style={toolbarActionsStyle}>
          <MediaSubjectVoiceButton
            disabled={disabled}
            value={value}
            contextLabel={label || placeholder}
            onChange={applyVoiceChange}
            onBusyChange={handleVoiceBusyChange}
            purpose="content"
            placement="inline"
            mergeMode="paragraph"
            maxLength={maxLength}
          />
          {toolbarButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              disabled={editorLocked}
              aria-label={button.label}
              title={button.label}
              onMouseDown={keepSelection}
              onClick={() => applyCommand(button.command, "value" in button ? button.value : undefined)}
              style={{ ...toolbarButtonStyle, cursor: editorLocked ? "not-allowed" : "pointer" }}
            >
              {button.content}
            </button>
          ))}
        </span>
      </div>

      <div style={{ position: "relative", minWidth: 0 }}>
        {empty ? <span style={placeholderStyle}>{placeholder}</span> : null}
        <div
          ref={editorRef}
          contentEditable={!editorLocked}
          suppressContentEditableWarning
          role="textbox"
          aria-label={label || placeholder}
          aria-multiline="true"
          aria-disabled={editorLocked}
          aria-readonly={editorLocked}
          onInput={emitChange}
          onBlur={emitChange}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = event.clipboardData.getData("text/plain").slice(0, maxLength);
            try {
              document.execCommand("insertText", false, pasted);
            } catch {}
            emitChange();
          }}
          style={{
            ...editorStyle,
            minHeight,
            opacity: disabled ? 0.62 : 1,
            cursor: editorLocked ? "not-allowed" : "text",
          }}
        />
      </div>
      <span style={counterStyle}>{value.length}/{maxLength}</span>
    </div>
  );
}

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "7px 10px",
};
const toolbarActionsStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 5 };
const editorLabelStyle: CSSProperties = { flex: "1 1 190px", minWidth: 0, color: "rgba(255,255,255,0.88)", fontSize: 12.5, fontWeight: 850, lineHeight: 1.35 };
const toolbarButtonStyle: CSSProperties = {
  width: 29,
  height: 27,
  display: "grid",
  placeItems: "center",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.13)",
  background: "rgba(255,255,255,0.055)",
  color: "rgba(255,255,255,0.90)",
  padding: 0,
};
const editorStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  maxHeight: 520,
  overflowY: "auto",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(4,10,24,0.44)",
  color: "white",
  outline: "none",
  padding: "11px 12px",
  font: "inherit",
  fontSize: 14,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
const placeholderStyle: CSSProperties = {
  position: "absolute",
  inset: "11px 12px auto",
  zIndex: 1,
  pointerEvents: "none",
  color: "rgba(255,255,255,0.38)",
  fontSize: 14,
  lineHeight: 1.5,
};
const counterStyle: CSSProperties = { justifySelf: "end", color: "rgba(255,255,255,0.45)", fontSize: 10.5 };

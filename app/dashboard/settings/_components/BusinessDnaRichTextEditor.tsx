"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useTranslations } from "next-intl";

import {
  businessDnaHtmlToPlainText,
  businessDnaTextToHtml,
  sanitizeBusinessDnaRichHtml,
} from "@/lib/businessDnaRichText";
import MediaSubjectVoiceButton from "../../_components/MediaSubjectVoiceButton";
import { useInrAssistantLocalInterface } from "../../_hooks/useInrAssistantLocalInterface";
import { useInrAssistantVisibleControl } from "../../_hooks/useInrAssistantVisibleControl";
import { INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES, parseInrAssistantBusinessRichTextEdit, type InrAssistantBusinessRichTextField } from "@/lib/inrAssistantBusinessRichText";
import { applyNativeInrAssistantBusinessRichTextEdit } from "@/lib/inrAssistantBusinessRichTextNative";

type Props = {
  id?: string;
  label?: string;
  value: string;
  html: string;
  onChange: (next: { text: string; html: string }) => void;
  placeholder: string;
  maxLength?: number;
  minHeight?: number;
  disabled?: boolean;
  onVoiceBusyChange?: (busy: boolean) => void;
  assistantField?: InrAssistantBusinessRichTextField;
};

type EditorTextSelection = { start: number; end: number };

function captureTextSelection(editor: HTMLDivElement): EditorTextSelection | null {
  if (document.activeElement !== editor) return null;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  prefix.setEnd(range.endContainer, range.endOffset);
  return { start, end: prefix.toString().length };
}

function restoreTextSelection(editor: HTMLDivElement, saved: EditorTextSelection | null) {
  if (!saved) return;
  const boundary = (position: number) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = position;
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      node = walker.nextNode();
    }
    return { node: editor as Node, offset: editor.childNodes.length };
  };
  const start = boundary(saved.start);
  const end = boundary(saved.end);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export default function BusinessDnaRichTextEditor({
  id,
  label,
  value,
  html,
  onChange,
  placeholder,
  maxLength = 5_000,
  minHeight = 165,
  disabled = false,
  onVoiceBusyChange,
  assistantField,
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
  const assistantVisible = useInrAssistantVisibleControl(editorRef);
  const [formatReceipt, setFormatReceipt] = useState<{ sequence: number; html: string } | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = sanitizeBusinessDnaRichHtml(html || businessDnaTextToHtml(value));
    if (nextHtml === lastHtmlRef.current || nextHtml === editor.innerHTML) return;
    editor.innerHTML = nextHtml;
    lastHtmlRef.current = editor.innerHTML;
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
    }
    if (nextHtml !== editor.innerHTML) {
      const selection = captureTextSelection(editor);
      editor.innerHTML = nextHtml;
      restoreTextSelection(editor, selection);
    }
    // Keep the live DOM and persisted HTML identical, including after a
    // formatting command that created an invalid paragraph/list structure.
    const canonicalHtml = editor.innerHTML;
    lastHtmlRef.current = canonicalHtml;
    setEmpty(!nextText.trim());
    onChange({ text: nextText, html: canonicalHtml });
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
    const canonicalHtml = editor?.innerHTML ?? nextHtml;
    lastHtmlRef.current = canonicalHtml;
    setEmpty(!synchronizedText);
    onChange({ text: synchronizedText, html: canonicalHtml });
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

  const applyCommand = (command: "bold" | "italic" | "formatBlock" | "insertUnorderedList" | "removeFormat", value?: string, verify?: () => boolean) => {
    if (editorLocked) return false;
    const editor = editorRef.current;
    if (!editor) return false;
    const before = editor.innerHTML;
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    restoreSelection();
    try {
      document.execCommand(command, false, value);
    } catch { return false; }
    if (verify && !verify()) { editor.innerHTML = before; return false; }
    emitChange();
    saveSelection();
    return true;
  };
  const nextFormatSequence = (formatReceipt?.sequence ?? 0) + 1;
  useInrAssistantLocalInterface(INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES[assistantField || "detailedDescription"], { value, html, formatReceipt }, {
    select: {
      invoke(payload) {
        if (!assistantField || editorLocked || !editorRef.current || typeof payload !== "string" || payload.length > 6200) throw new Error("Rich text unavailable");
        const edit = parseInrAssistantBusinessRichTextEdit(JSON.parse(payload));
        if (!edit || !applyNativeInrAssistantBusinessRichTextEdit({ editor: editorRef.current, value, html, edit, select: range => { selectionRef.current = range.cloneRange(); }, apply: applyCommand })) throw new Error("Rich text selection or format could not be verified");
        setFormatReceipt({ sequence: nextFormatSequence, html: editorRef.current.innerHTML });
      },
      matches(snapshot) {
        const receipt = (snapshot as { formatReceipt?: { sequence?: number; html?: string } } | undefined)?.formatReceipt;
        return receipt?.sequence === nextFormatSequence && receipt.html === editorRef.current?.innerHTML;
      },
    },
  }, assistantVisible && Boolean(assistantField), editorLocked);

  const toolbarButtons = [
    { key: "bold", label: t("formatBold"), content: <strong>B</strong>, command: "bold" },
    { key: "italic", label: t("formatItalic"), content: <em>I</em>, command: "italic" },
    { key: "title", label: t("formatTitle"), content: <strong style={{ fontSize: 14 }}>T</strong>, command: "formatBlock", value: "h3" },
    { key: "list", label: t("formatList"), content: <span style={{ fontSize: 17, lineHeight: 1 }}>≡</span>, command: "insertUnorderedList" },
    { key: "clear", label: t("formatClear"), content: <span style={{ fontSize: 10.5 }}>Tx</span>, command: "removeFormat" },
  ] as const;

  return (
    <div data-business-dna-rich-editor style={{ display: "grid", gap: 7, minWidth: 0 }}>
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

      <div data-business-dna-rich-editor-body style={{ position: "relative", minWidth: 0 }}>
        {empty ? <span style={placeholderStyle}>{placeholder}</span> : null}
        <div
          id={id}
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

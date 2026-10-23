import { useEffect, useRef, type CSSProperties, type MutableRefObject } from "react";
import {
  readSanitizedElementHtml,
  syncSanitizedElementHtml,
} from "@/lib/sanitizeHtml";
import {
  editableHtmlToSiteText,
  siteTextToEditableHtml,
} from "@/lib/boosterFormatting";

type RichSiteContentEditorProps = {
  value: string;
  onChange: (value: string) => void;
  minHeight: number;
  editorRef: MutableRefObject<HTMLDivElement | null>;
  style: CSSProperties;
  className?: string;
  ariaLabel?: string;
  multiline?: boolean;
  readOnly?: boolean;
};

export default function RichSiteContentEditor({
  value,
  onChange,
  minHeight,
  editorRef,
  style,
  className,
  ariaLabel,
  multiline = true,
  readOnly = false,
}: RichSiteContentEditorProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedValueRef = useRef<string>("");

  useEffect(() => {
    const node = localRef.current;
    if (!node) return;
    editorRef.current = node;
    return () => {
      if (editorRef.current === node) editorRef.current = null;
    };
  }, [editorRef]);

  useEffect(() => {
    const node = localRef.current;
    if (!node) return;

    const currentValue = editableHtmlToSiteText(readSanitizedElementHtml(node));
    if (document.activeElement === node && currentValue === value) {
      lastSyncedValueRef.current = value;
      return;
    }

    if (lastSyncedValueRef.current === value && currentValue === value) return;

    syncSanitizedElementHtml(node, siteTextToEditableHtml(value));
    lastSyncedValueRef.current = value;
  }, [value]);

  const sync = () => {
    const node = localRef.current;
    if (!node) return;
    const nextValue = editableHtmlToSiteText(readSanitizedElementHtml(node));
    lastSyncedValueRef.current = nextValue;
    onChange(nextValue);
  };

  return (
    <div
      ref={localRef}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline={multiline}
      aria-readonly={readOnly}
      className={className}
      onInput={sync}
      onBlur={sync}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (!multiline && event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
      }}
      onPaste={(event) => {
        if (event.cancelable) event.preventDefault();
        const pastedText = event.clipboardData.getData("text/plain");
        const text = multiline ? pastedText : pastedText.replace(/[\r\n]+/g, " ");
        document.execCommand("insertText", false, text);
        sync();
      }}
      style={{
        ...style,
        minHeight,
        height: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        outline: "none",
      }}
    />
  );
}

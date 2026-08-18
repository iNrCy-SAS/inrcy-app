"use client";

import { useTranslations } from "next-intl";


import {
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { editableHtmlToSiteText } from "@/lib/boosterFormatting";
import { readSanitizedElementHtml } from "@/lib/sanitizeHtml";

type TextDraft = {
  body: string;
};

type UseAgentRichTextEditorsParams<
  TCampaignDraft extends TextDraft,
  TPublishDraft extends TextDraft,
> = {
  setCampaignTextDraft: Dispatch<SetStateAction<TCampaignDraft>>;
  setPublishTextDraft: Dispatch<SetStateAction<TPublishDraft>>;
};

export function useAgentRichTextEditors<
  TCampaignDraft extends TextDraft,
  TPublishDraft extends TextDraft,
>({
  setCampaignTextDraft,
  setPublishTextDraft,
}: UseAgentRichTextEditorsParams<TCampaignDraft, TPublishDraft>) {
  const i18nT = useTranslations("agent");
  const publishBodyEditorRef = useRef<HTMLDivElement | null>(null);
  const campaignBodyEditorRef = useRef<HTMLDivElement | null>(null);
  const publishEmojiSelectionRef = useRef<Range | null>(null);
  const campaignEmojiSelectionRef = useRef<Range | null>(null);

  function syncCampaignBodyFromEditor(editor: HTMLDivElement) {
    const nextBody = editableHtmlToSiteText(
      readSanitizedElementHtml(editor),
    ).slice(0, 6000);
    setCampaignTextDraft((current) => ({
      ...current,
      body: nextBody,
    }));
  }

  function syncPublishBodyFromEditor(editor: HTMLDivElement) {
    const nextBody = editableHtmlToSiteText(
      readSanitizedElementHtml(editor),
    ).slice(0, 6000);
    setPublishTextDraft((current) => ({
      ...current,
      body: nextBody,
    }));
  }

  function selectionTargetsEditor(editor: HTMLDivElement) {
    if (typeof window === "undefined") return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    return Boolean(
      anchor && focus && editor.contains(anchor) && editor.contains(focus),
    );
  }

  function saveRichEditorSelection(
    editor: HTMLDivElement | null,
    selectionRef: MutableRefObject<Range | null>,
  ) {
    if (!editor || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    selectionRef.current = range.cloneRange();
  }

  function restoreRichEditorSelection(
    editor: HTMLDivElement,
    selectionRef: MutableRefObject<Range | null>,
  ) {
    const range = selectionRef.current;
    if (!range || !editor.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function applyRichEditorFormat(
    editor: HTMLDivElement | null,
    kind: "bold" | "italic" | "underline",
    sync: (editor: HTMLDivElement) => void,
  ) {
    if (!editor || typeof document === "undefined") return;
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }

    const command =
      kind === "bold" ? "bold" : kind === "italic" ? "italic" : "underline";
    const selection =
      typeof window !== "undefined" ? window.getSelection() : null;
    const hasSelection = Boolean(
      selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        selectionTargetsEditor(editor),
    );

    if (hasSelection) {
      document.execCommand(command, false);
    } else {
      const placeholderHtml =
        kind === "bold"
          ? "<strong>texte</strong>"
          : kind === "italic"
            ? "<em>texte</em>"
            : "<u>texte</u>";
      document.execCommand(i18nT("inserthtml_d8d4d068"), false, placeholderHtml);
    }

    sync(editor);
  }

  function insertRichEditorEmoji(
    editor: HTMLDivElement | null,
    selectionRef: MutableRefObject<Range | null>,
    emoji: string,
    sync: (editor: HTMLDivElement) => void,
  ) {
    if (!editor || typeof document === "undefined") return;
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    restoreRichEditorSelection(editor, selectionRef);
    document.execCommand("insertText", false, emoji);
    sync(editor);
  }

  function applyCampaignTextFormat(kind: "bold" | "italic" | "underline") {
    applyRichEditorFormat(
      campaignBodyEditorRef.current,
      kind,
      syncCampaignBodyFromEditor,
    );
  }

  function applyPublishTextFormat(kind: "bold" | "italic" | "underline") {
    applyRichEditorFormat(
      publishBodyEditorRef.current,
      kind,
      syncPublishBodyFromEditor,
    );
  }

  function insertPublishEmoji(emoji: string) {
    insertRichEditorEmoji(
      publishBodyEditorRef.current,
      publishEmojiSelectionRef,
      emoji,
      syncPublishBodyFromEditor,
    );
  }

  function insertCampaignEmoji(emoji: string) {
    insertRichEditorEmoji(
      campaignBodyEditorRef.current,
      campaignEmojiSelectionRef,
      emoji,
      syncCampaignBodyFromEditor,
    );
  }

  return {
    publishBodyEditorRef,
    campaignBodyEditorRef,
    publishEmojiSelectionRef,
    campaignEmojiSelectionRef,
    saveRichEditorSelection,
    applyCampaignTextFormat,
    applyPublishTextFormat,
    insertPublishEmoji,
    insertCampaignEmoji,
  };
}

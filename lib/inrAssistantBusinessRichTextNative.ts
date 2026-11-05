import { sanitizeBusinessDnaRichHtml, businessDnaTextToHtml } from "./businessDnaRichText.ts";
import type { InrAssistantBusinessRichTextEdit, InrAssistantBusinessRichTextFormat } from "./inrAssistantBusinessRichText.ts";
const sameText = (value: string) => value.replace(/\u00a0/g, " ");
const commands = { bold: ["bold"], italic: ["italic"], heading: ["formatBlock", "h3"], list: ["insertUnorderedList"], remove_format: ["removeFormat"] } as const;
function hasFormat(format: InrAssistantBusinessRichTextFormat, editor: HTMLDivElement) {
  if (format === "heading") return String(document.queryCommandValue("formatBlock")).toLowerCase().replace(/[<>]/g, "") === "h3";
  if (format === "remove_format") {
    const selection = window.getSelection(); if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0), inline = new Set(["B", "STRONG", "I", "EM", "U"]);
    for (const endpoint of [range.startContainer, range.endContainer]) {
      let parent = endpoint.nodeType === Node.ELEMENT_NODE ? endpoint as Element : endpoint.parentElement;
      while (parent && parent !== editor) { if (inline.has(parent.tagName)) return false; parent = parent.parentElement; }
    }
    const walker = document.createTreeWalker(range.cloneContents(), NodeFilter.SHOW_ELEMENT); let node = walker.nextNode();
    while (node) { if (inline.has((node as Element).tagName)) return false; node = walker.nextNode(); }
    return true;
  }
  return document.queryCommandState(commands[format][0]);
}
/** Only the caller's editor and an exact unique text range. No HTML, DOM
 * selector or command string can arrive from an assistant payload. */
export function applyNativeInrAssistantBusinessRichTextEdit(options: {
  editor: HTMLDivElement; value: string; html: string; edit: InrAssistantBusinessRichTextEdit;
  select: (range: Range) => void;
  apply: (command: "bold" | "italic" | "formatBlock" | "insertUnorderedList" | "removeFormat", value: string | undefined, verify: () => boolean) => boolean;
}) {
  const { editor, edit } = options, canonical = document.createElement("div");
  canonical.innerHTML = sanitizeBusinessDnaRichHtml(options.html || businessDnaTextToHtml(options.value));
  if (!editor.isConnected || editor.innerHTML !== canonical.innerHTML) return false;
  const text = editor.textContent || "";
  let start = 0, end = text.length;
  if (!edit.wholeField) {
    const selected = edit.selectionText!; start = text.indexOf(selected);
    if (start < 0 || text.indexOf(selected, start + 1) >= 0) return false;
    end = start + selected.length;
  }
  if (start === end) return false;
  const boundary = (position: number) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let left = position, node = walker.nextNode();
    while (node) { const length = node.textContent?.length || 0; if (left <= length) return { node, offset: left }; left -= length; node = walker.nextNode(); }
    return { node: editor as Node, offset: editor.childNodes.length };
  };
  const first = boundary(start), last = boundary(end), range = document.createRange(); range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset);
  if (!edit.wholeField && range.toString() !== edit.selectionText) return false;
  editor.focus({ preventScroll: true }); const selection = window.getSelection(); if (!selection) return false; selection.removeAllRanges(); selection.addRange(range); options.select(range);
  const verify = () => { const selected = window.getSelection(); return sameText(editor.textContent || "") === sameText(text) && Boolean(selected?.rangeCount && editor.contains(selected.getRangeAt(0).commonAncestorContainer)) && hasFormat(edit.format, editor); };
  if (verify()) return true;
  const command = commands[edit.format];
  return options.apply(command[0], command.length > 1 ? command[1] : undefined, verify) && verify();
}

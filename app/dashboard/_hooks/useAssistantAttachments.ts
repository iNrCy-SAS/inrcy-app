"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ASSISTANT_ATTACHMENT_BUCKET, ASSISTANT_ATTACHMENT_MAX_COUNT, ASSISTANT_ATTACHMENT_TOTAL_BYTES, AssistantAttachmentError, assistantAttachmentFile, parseAssistantAttachments, type AssistantAttachment } from "@/lib/inrAssistantAttachments";
import { assistantAttachmentErrorCopy } from "../_components/dashboardAssistantAttachmentCopy";

export function useAssistantAttachments({ accountId, actorUserId, locale, ensureConversation }: { accountId: string; actorUserId: string; locale: string; ensureConversation: () => string }) {
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<{ controller: AbortController; revision: number } | null>(null);
  const revisionRef = useRef(0);
  const reset = useCallback(() => { revisionRef.current++; activeRef.current?.controller.abort(); activeRef.current = null; setAttachments([]); setBusy(false); setError(null); setMenuOpen(false); setLibraryOpen(false); }, []);
  useEffect(() => { return () => { revisionRef.current++; activeRef.current?.controller.abort(); }; }, [accountId, actorUserId]);

  const add = async (files: File[] | null, ids?: string[]) => {
    if (activeRef.current || (getActiveBrowserUserId() || accountId) !== accountId) return;
    const currentConversation = ensureConversation();
    const operation = { controller: new AbortController(), revision: revisionRef.current };
    activeRef.current = operation;
    const current = () => activeRef.current === operation && !operation.controller.signal.aborted && revisionRef.current === operation.revision && (getActiveBrowserUserId() || accountId) === accountId;
    const timeout = setTimeout(() => operation.controller.abort(), 120_000);
    setBusy(true); setError(null); setMenuOpen(false); setLibraryOpen(false);
    const accepted: AssistantAttachment[] = [];
    const request = async (body: unknown) => {
      const response = await fetch("/api/assistant/attachments", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: operation.controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.accountId !== accountId) throw new AssistantAttachmentError(data?.code || "attachment_unavailable");
      return data;
    };
    try {
      const count = files?.length ?? ids?.length ?? 0;
      if (!count || attachments.length + count > ASSISTANT_ATTACHMENT_MAX_COUNT) throw new AssistantAttachmentError("attachment_limit");
      if (files) {
        files.forEach(file => assistantAttachmentFile(file));
        if ([...attachments, ...files].reduce((sum, file) => sum + file.size, 0) > ASSISTANT_ATTACHMENT_TOTAL_BYTES) throw new AssistantAttachmentError("attachment_limit");
        const prepared = await request({ action: "prepare", conversationId: currentConversation, files: files.map(file => ({ name: file.name, type: file.type, size: file.size })) });
        if (!Array.isArray(prepared.prepared) || prepared.prepared.length !== files.length) throw new AssistantAttachmentError("attachment_unavailable");
        for (let index = 0; index < files.length; index++) {
          if (!current()) return;
          const item = prepared.prepared[index];
          const result = await createClient().storage.from(ASSISTANT_ATTACHMENT_BUCKET).uploadToSignedUrl(item.upload.path, item.upload.token, files[index], { contentType: item.upload.contentType });
          if (result.error) throw new AssistantAttachmentError("attachment_unavailable");
          if (!current()) return;
          const finalized = await request({ action: "finalize", conversationId: currentConversation, attachment: item.attachment });
          accepted.push(...parseAssistantAttachments(finalized.attachments));
        }
      } else {
        const result = await request({ action: "library", conversationId: currentConversation, ids });
        accepted.push(...parseAssistantAttachments(result.attachments));
      }
      parseAssistantAttachments([...attachments, ...accepted]);
    } catch (failure) {
      if (current()) setError(assistantAttachmentErrorCopy(locale, failure instanceof AssistantAttachmentError ? failure.code : undefined));
    } finally {
      clearTimeout(timeout);
      if (activeRef.current === operation) {
        if (current() && accepted.length) setAttachments(previous => { try { return parseAssistantAttachments([...previous, ...accepted]); } catch { return previous; } });
        activeRef.current = null; setBusy(false);
        if (operation.controller.signal.aborted && revisionRef.current === operation.revision) setError(assistantAttachmentErrorCopy(locale, undefined));
      }
    }
  };
  return { attachments, setAttachments, busy, error, menuOpen, setMenuOpen, libraryOpen, setLibraryOpen, inputRef, reset,
    selectDevice: () => { ensureConversation(); setMenuOpen(false); inputRef.current?.click(); },
    selectLibrary: () => { ensureConversation(); setMenuOpen(false); setLibraryOpen(true); },
    addDevice: (files: File[]) => add(files), addLibrary: (ids: string[]) => add(null, ids) };
}

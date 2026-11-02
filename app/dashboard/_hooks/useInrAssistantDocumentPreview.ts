"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";
import type { DocumentServerVersion } from "./useDocumentUnsavedChanges";
import type { InrAssistantDocumentPrefill } from "@/lib/inrAssistantDocumentUiCommands";

/** A local preview has an identity without saving it. Only its opaque revision leaves
 * the form; client names, lines and prices remain local to the native renderer. */
export function useInrAssistantDocumentPreview(kind: "quote" | "invoice", savedId: string, snapshot: unknown, pendingChanges = false, mail?: { isFinalized: boolean; serverVersion: DocumentServerVersion | null; prefill?: InrAssistantDocumentPrefill }) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const signature = JSON.stringify(snapshot);
  const [version, setVersion] = useState({ signature, revision: 0 });
  // Adjusting this component's derived state during render prevents committing a
  // frame advertising the old revision with the new form. No effect writes data.
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const selection = { kind, id: savedId || `preview_${instance}` };
  const revision = `preview_${instance}_${version.revision}`;
  const accountId = getActiveBrowserUserId();
  const current = useRef({ accountId, savedId, revision, signature, active: true });
  useLayoutEffect(() => { current.current = { accountId, savedId, revision, signature, active: true }; }, [accountId, savedId, revision, signature]);
  useLayoutEffect(() => () => { current.current.active = false; }, []);
  const captureRevision = useCallback(() => ({ ...current.current }), []);
  const isCurrentRevision = useCallback((captured: ReturnType<typeof captureRevision>) =>
    current.current.active && captured.accountId === getActiveBrowserUserId() &&
    captured.accountId === current.current.accountId && captured.savedId === current.current.savedId &&
    captured.revision === current.current.revision, []);
  const isSameContent = useCallback((captured: ReturnType<typeof captureRevision>, persistedFields: string[]) => {
    if (!current.current.active || captured.accountId !== getActiveBrowserUserId() || captured.accountId !== current.current.accountId) return false;
    const comparable = (value: string) => JSON.stringify(Object.fromEntries(
      Object.entries(JSON.parse(value)).filter(([key]) => !persistedFields.includes(key)),
    ));
    return comparable(captured.signature) === comparable(current.current.signature);
  }, []);
  const canPrepareMail = !!savedId && !pendingChanges && mail?.isFinalized === true && mail.serverVersion?.documentId === savedId &&
    mail.serverVersion.accountId === accountId && Number.isFinite(Date.parse(mail.serverVersion.updatedAt));
  useInrAssistantScreen({ selection, revision, availableCommands: canPrepareMail ? ["export_document_pdf", "create_document_template", "prepare_document_mail"] : ["export_document_pdf", "create_document_template"],
    pendingChanges: !savedId || pendingChanges, ...(canPrepareMail ? { documentVersion: mail!.serverVersion!.updatedAt } : {}), ...(mail?.prefill ? { documentPrefill: mail.prefill } : {}) });
  return { selection, revision, canPrepareMail, captureRevision, isCurrentRevision, isSameContent };
}

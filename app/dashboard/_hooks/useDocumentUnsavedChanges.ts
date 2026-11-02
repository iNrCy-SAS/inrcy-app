"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";

export type DocumentSaveVersion = {
  accountId: string | null;
  documentId: string;
  generation: number;
  signature: string;
};

/** Tracks the editable form, independently of asynchronously loaded PDF preferences. */
export function useDocumentUnsavedChanges(documentId: string, snapshot: Record<string, unknown>) {
  const accountId = getActiveBrowserUserId();
  const key = JSON.stringify([accountId, documentId]);
  const signature = JSON.stringify(snapshot);
  const [baseline, setBaseline] = useState({ key, signature: signature as string | null });
  // A newly hydrated document is clean. Reset synchronously, before children/guards commit.
  if (baseline.key !== key || baseline.signature === null) setBaseline({ key, signature });
  const dirty = baseline.key === key && baseline.signature !== null && baseline.signature !== signature;
  const current = useRef({ accountId, documentId, signature, dirty });
  const generation = useRef(0);
  useLayoutEffect(() => { current.current = { accountId, documentId, signature, dirty }; }, [accountId, documentId, signature, dirty]);

  const markHydrated = useCallback(() => {
    generation.current++;
    setBaseline(previous => ({ ...previous, signature: null }));
  }, []);

  const captureSave = useCallback((persistedFields: Record<string, unknown> = {}): DocumentSaveVersion => ({
    accountId: current.current.accountId, documentId: current.current.documentId, generation: generation.current,
    signature: JSON.stringify({ ...JSON.parse(current.current.signature), ...persistedFields }),
  }), []);

  const isCurrentSave = useCallback((version: DocumentSaveVersion) =>
    version.accountId === getActiveBrowserUserId() &&
    version.documentId === current.current.documentId &&
    version.generation === generation.current, []);

  const isUnchanged = useCallback((version: DocumentSaveVersion, persistedFields: Record<string, unknown> = {}) =>
    isCurrentSave(version) && current.current.signature === JSON.stringify({ ...JSON.parse(version.signature), ...persistedFields }), [isCurrentSave]);

  const markSaved = useCallback((version: DocumentSaveVersion, savedId: string) => {
    if (!savedId || !isCurrentSave(version)) return false;
    setBaseline({ key: JSON.stringify([version.accountId, savedId]), signature: version.signature });
    // A caller may immediately finalize a newly created draft before React commits its ID.
    current.current = { ...current.current, documentId: savedId };
    return true;
  }, [isCurrentSave]);

  // Finalization may assign an official number/status; acknowledge only those fields,
  // never unrelated edits made while its request was pending.
  const markPersistedFields = useCallback((version: DocumentSaveVersion, fields: Record<string, unknown>) => {
    if (!isCurrentSave(version)) return false;
    setBaseline(previous => previous.signature === null ? previous : {
      ...previous, signature: JSON.stringify({ ...JSON.parse(previous.signature), ...fields }),
    });
    return true;
  }, [isCurrentSave]);

  const { registerGuard, requestNavigation } = useDashboardUnsavedNavigation();
  const id = useId();
  const confirming = useRef(false);
  const confirmExit = useCallback(async () => {
    const started = current.current;
    if (!started.dirty) return true;
    if (confirming.current) return false;
    confirming.current = true;
    try {
      const accepted = await confirmInrcy({
        title: "Quitter sans sauvegarder ?",
        message: "Vous avez modifié ce document. Si vous quittez maintenant, les modifications non enregistrées seront perdues.",
        confirmLabel: "Quitter", cancelLabel: "Continuer l’édition", variant: "warning",
      });
      return accepted && started.accountId === getActiveBrowserUserId() &&
        started.documentId === current.current.documentId && started.signature === current.current.signature;
    } finally { confirming.current = false; }
  }, []);

  useEffect(() => registerGuard({ id, shouldBlock: () => current.current.dirty, confirmExit }), [registerGuard, id, confirmExit]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!current.current.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  return { dirty, markHydrated, captureSave, isCurrentSave, isUnchanged, markSaved, markPersistedFields, requestNavigation };
}

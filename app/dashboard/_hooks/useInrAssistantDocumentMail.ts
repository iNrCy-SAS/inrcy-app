"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import type { InrAssistantDocumentMailCommand } from "@/lib/inrAssistantDocumentUiCommands";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import type { DocumentServerVersion } from "./useDocumentUnsavedChanges";

export function useInrAssistantDocumentMail(options: {
  selection: InrAssistantDocumentMailCommand["selection"];
  revision: string;
  serverVersion: DocumentServerVersion | null;
  enabled: boolean;
  prepare: (command: InrAssistantDocumentMailCommand, stillCurrent: () => boolean) => Promise<boolean>;
}) {
  const key = useId(), pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const current = useRef(options);
  useLayoutEffect(() => { current.current = options; });
  const { enabled, revision, selection: { kind, id } } = options;
  const updatedAt = options.serverVersion?.updatedAt;
  useEffect(() => {
    if (!enabled || !updatedAt) return;
    let active = true, busy = false;
    register(key, {
      command: "prepare_document_mail", selection: { kind, id }, revision, expectedUpdatedAt: updatedAt,
      // Only the signed incoming command supplies the actual recipient.
      recipient: "", pathname,
      run: async (stillCurrent, command) => {
        const state = current.current;
        const valid = () => active && stillCurrent() && current.current.enabled &&
          current.current.selection.kind === kind && current.current.selection.id === id && current.current.revision === revision &&
          current.current.serverVersion?.updatedAt === updatedAt && current.current.serverVersion.accountId === getActiveBrowserUserId();
        if (busy || !valid() || command.command !== "prepare_document_mail" || command.expectedUpdatedAt !== updatedAt || command.revision !== revision) return false;
        busy = true;
        try { return await state.prepare(command, valid); } finally { busy = false; }
      },
    });
    return () => { active = false; register(key, null); };
  }, [enabled, id, key, kind, pathname, register, revision, updatedAt]);
}

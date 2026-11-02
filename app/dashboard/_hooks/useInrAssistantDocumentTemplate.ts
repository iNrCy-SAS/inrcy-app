"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import type { InrAssistantDocumentTemplateCommand } from "@/lib/inrAssistantDocumentUiCommands";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";

export function useInrAssistantDocumentTemplate(options: {
  selection: InrAssistantDocumentTemplateCommand["selection"]; revision: string;
  create: (templateName: string, stillCurrent: () => boolean, started: () => void) => Promise<boolean>;
}) {
  const key = useId(), pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const accountId = getActiveBrowserUserId(), current = useRef(options), busy = useRef(false);
  const attempts = useRef(new Set<string>());
  useLayoutEffect(() => { current.current = options; });
  const { revision, selection: { kind, id } } = options;
  useEffect(() => {
    let active = true;
    register(key, { command: "create_document_template", selection: { kind, id }, revision, templateName: "", pathname,
      run: async (stillCurrent, command) => {
        const valid = () => active && stillCurrent() && accountId === getActiveBrowserUserId() && current.current.selection.kind === kind && current.current.selection.id === id && current.current.revision === revision;
        if (busy.current || !valid() || command.command !== "create_document_template" || command.revision !== revision || command.selection.id !== id || command.selection.kind !== kind || !command.templateName.trim() || command.templateName.length > 120) return false;
        const attempt = JSON.stringify([accountId, id, revision, command.templateName]);
        // A repeated delivery cannot create a second model, including after an uncertain result.
        if (attempts.current.has(attempt)) return false;
        busy.current = true;
        try { return await current.current.create(command.templateName, valid, () => attempts.current.add(attempt)); }
        finally { busy.current = false; }
      },
    });
    return () => { active = false; register(key, null); };
  }, [accountId, id, key, kind, pathname, register, revision]);
}

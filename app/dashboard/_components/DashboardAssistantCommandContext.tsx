"use client";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantUiCommand } from "@/lib/inrAssistantUiCommands";

export type InrAssistantScreenHandler = InrAssistantUiCommand & { pathname: string; run: (stillCurrent: () => boolean) => Promise<boolean> };
export const DashboardAssistantCommandContext = createContext<(key: string, handler: InrAssistantScreenHandler | null) => void>(() => {});

/** Reuse the document's native renderer; never click arbitrary DOM nodes or export another selection. */
export function useInrAssistantDocumentPdf(selection: InrAssistantUiCommand["selection"] | null, buildPdf: () => Promise<Blob | null>, filename: string) {
  const register = useContext(DashboardAssistantCommandContext);
  const key = useId(), pathname = usePathname();
  const current = useRef({ selection, buildPdf, filename });
  current.current = { selection, buildPdf, filename };
  const kind = selection?.kind, id = selection?.id;
  useEffect(() => {
    if (!kind || !id) return;
    let busy = false, active = true;
    register(key, { command: "export_document_pdf", selection: { kind, id }, pathname, run: async (stillCurrent) => {
      if (!active || !stillCurrent() || busy || current.current.selection?.kind !== kind || current.current.selection.id !== id) return false;
      busy = true;
      try {
        const blob = await current.current.buildPdf();
        if (!active || !stillCurrent() || !blob || blob.type !== "application/pdf" || current.current.selection?.kind !== kind || current.current.selection.id !== id) return false;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${current.current.filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.pdf$/i, "") || "document"}.pdf`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return true;
      } finally { busy = false; }
    } });
    return () => { active = false; register(key, null); };
  }, [key, pathname, register, kind, id]);
}

"use client";
import { useId, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { registerInrAssistantContentReport } from "@/lib/inrAssistantContentReport";

export function useInrAssistantContentReport(draft: { open: boolean; surface: string; content: string; reason: string; comment: string; status: "idle" | "sending" | "sent" | "error"; attempted: boolean; generation: number }, submit: (stillCurrent: () => boolean) => Promise<boolean>) {
  const key = useId(), pathname = usePathname(), { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const version = useRef({ fingerprint: "", revision: "" });
  const fingerprint = JSON.stringify({ actorUserId, activeAccountId, pathname, open: draft.open, surface: draft.surface, content: draft.content, reason: draft.reason, comment: draft.comment, generation: draft.generation });
  useLayoutEffect(() => {
    if (fingerprint !== version.current.fingerprint) version.current = { fingerprint, revision: crypto.randomUUID() };
    registerInrAssistantContentReport(key, actorUserId && activeAccountId ? { accountId: activeAccountId, actorUserId, pathname, revision: version.current.revision, open: draft.open, status: draft.status, attempted: draft.attempted, submit } : null);
  });
  useLayoutEffect(() => () => registerInrAssistantContentReport(key, null), [key]);
}

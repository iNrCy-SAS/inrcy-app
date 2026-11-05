"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { runInrAssistantNativeMediaOptimization } from "@/lib/inrAssistantNativeMediaOptimization";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";

type Target = { id: string; media_type: string; size_bytes: number | null; is_active?: boolean | null; mime_type?: string | null; title?: string | null; tags?: string[] | null; updated_at?: string | null };
export function useInrAssistantLibraryOptimization(options: { target: Target | null; selectedIds: string[]; blocked: boolean; workspace?: { id: string; revision: string }; refresh: (isCurrent: () => boolean) => Promise<unknown> }) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const scopeKey = `${actorUserId}:${activeAccountId}`;
  const [busy, setBusy] = useState(false), [status, setStatus] = useState({ scopeKey, message: "" });
  const pending = useRef(false), mounted = useRef(true);
  const target = options.target && ["image", "video"].includes(options.target.media_type) && options.target.is_active !== false ? options.target : null;
  const signature = JSON.stringify({ scopeKey, target: target && { id: target.id, size: target.size_bytes, mime: target.mime_type, updatedAt: target.updated_at, title: target.title, tags: target.tags } });
  const [version, setVersion] = useState({ signature, value: 0 });
  if (version.signature !== signature) setVersion({ signature, value: version.value + 1 });
  const workspaceId = options.workspace?.id;
  const revision = options.workspace?.revision ?? `optimize_${instance}_${version.value}`;
  const current = useRef({ options, revision });
  const commitWaiter = useRef<{ finish: (ok: boolean) => void; isCurrent: () => boolean } | null>(null);
  useLayoutEffect(() => { current.current = { options, revision }; if (!busy && commitWaiter.current) commitWaiter.current.finish(commitWaiter.current.isCurrent()); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; commitWaiter.current?.finish(false); }; }, []);
  const enabled = pathname === "/dashboard/mediatheque" && Boolean(target) && !options.blocked && !busy;
  const editorId = workspaceId ?? target?.id;
  useInrAssistantScreen(target && editorId && pathname === "/dashboard/mediatheque" ? { selection: { kind: "media", id: editorId }, revision, step: "media",
    availableCommands: enabled ? ["optimize_media"] : [], ...(options.selectedIds.length > 25 ? { selectionOverflow: true } : options.selectedIds.length ? { selectedMediaIds: options.selectedIds } : {}) } : null);
  const id = target?.id;
  useEffect(() => {
    if (!id || pathname !== "/dashboard/mediatheque") return;
    const selectionId = workspaceId ?? id;
    register(instance, { command: "optimize_media", selection: { kind: "media", id: selectionId }, ...(workspaceId ? { mediaId: id } : {}), revision, pathname,
      getCommittedScreen: () => ({ pathname, selection: { kind: "media", id: current.current.options.workspace?.id ?? current.current.options.target!.id }, revision: current.current.revision }),
      run: async (stillCurrent, command, scopeCurrent) => {
      if (command.command !== "optimize_media" || pending.current || !stillCurrent() || current.current.options.blocked || command.revision !== current.current.revision || (command.mediaId ?? command.selection.id) !== id || current.current.options.target?.id !== id) return false;
      const capturedRevision = current.current.revision;
      const targetStamp = (value: Target | null) => JSON.stringify(value && { id: value.id, updatedAt: value.updated_at, size: value.size_bytes, mime: value.mime_type, title: value.title, tags: value.tags });
      const capturedTarget = targetStamp(current.current.options.target);
      const isCurrent = () => mounted.current && scopeCurrent() && (current.current.options.workspace ? targetStamp(current.current.options.target) === capturedTarget : current.current.revision === capturedRevision) && !current.current.options.blocked;
      const setMessage = (message: string) => setStatus({ scopeKey, message });
      pending.current = true; setBusy(true); setMessage("Optimisation native en cours. L’original reste conservé.");
      try {
        await runInrAssistantNativeMediaOptimization({ mediaId: id, targetBytes: command.targetBytes, isCurrent });
        if (!isCurrent()) return false;
        await current.current.options.refresh(isCurrent);
        if (!isCurrent()) return false;
        setMessage("La copie optimisée a été vérifiée dans Mes médias. L’original est conservé.");
        if (current.current.options.workspace) return await new Promise<boolean>(resolve => {
          const timer = setTimeout(() => waiting.finish(false), 5_000);
          const waiting = { isCurrent, finish: (ok: boolean) => { if (commitWaiter.current !== waiting) return; clearTimeout(timer); commitWaiter.current = null; resolve(ok); } };
          commitWaiter.current = waiting;
          // The list refresh may have committed the new copy under a new shared
          // revision. Wait for this native busy flag to commit before the receipt.
          setBusy(false);
        });
        return true;
      } catch (error) {
        if (isCurrent()) setMessage(error instanceof Error ? error.message : "La copie optimisée n’a pas pu être vérifiée.");
        return false;
      } finally { pending.current = false; if (mounted.current) setBusy(false); }
    } });
    return () => register(instance, null);
  }, [id, instance, pathname, register, revision, scopeKey, workspaceId]);
  return { busy, available: enabled, message: status.scopeKey === scopeKey ? status.message : "" };
}

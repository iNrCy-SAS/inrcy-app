"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { runInrAssistantNativeMediaOptimization } from "@/lib/inrAssistantNativeMediaOptimization";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";

type Target = { id: string; media_type: string; size_bytes: number | null; is_active?: boolean | null; mime_type?: string | null; title?: string | null; tags?: string[] | null; updated_at?: string | null };
export function useInrAssistantLibraryOptimization(options: { target: Target | null; selectedIds: string[]; blocked: boolean; refresh: (isCurrent: () => boolean) => Promise<unknown> }) {
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
  const revision = `optimize_${instance}_${version.value}`;
  const current = useRef({ options, revision });
  useLayoutEffect(() => { current.current = { options, revision }; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const enabled = pathname === "/dashboard/mediatheque" && Boolean(target) && !options.blocked && !busy;
  useInrAssistantScreen(target && pathname === "/dashboard/mediatheque" ? { selection: { kind: "media", id: target.id }, revision, step: "media",
    availableCommands: enabled ? ["optimize_media"] : [], ...(options.selectedIds.length > 25 ? { selectionOverflow: true } : options.selectedIds.length ? { selectedMediaIds: options.selectedIds } : {}) } : null);
  const id = target?.id;
  useEffect(() => {
    if (!id || pathname !== "/dashboard/mediatheque") return;
    register(instance, { command: "optimize_media", selection: { kind: "media", id }, revision, pathname,
      getCommittedScreen: () => ({ pathname, selection: { kind: "media", id: current.current.options.target!.id }, revision: current.current.revision }),
      run: async (stillCurrent, command, scopeCurrent) => {
      if (command.command !== "optimize_media" || pending.current || !stillCurrent() || current.current.options.blocked || command.revision !== current.current.revision) return false;
      const capturedRevision = current.current.revision;
      const isCurrent = () => mounted.current && scopeCurrent() && current.current.revision === capturedRevision && !current.current.options.blocked;
      const setMessage = (message: string) => setStatus({ scopeKey, message });
      pending.current = true; setBusy(true); setMessage("Optimisation native en cours. L’original reste conservé.");
      try {
        await runInrAssistantNativeMediaOptimization({ mediaId: id, targetBytes: command.targetBytes, isCurrent });
        if (!isCurrent()) return false;
        await current.current.options.refresh(isCurrent);
        if (!isCurrent()) return false;
        setMessage("La copie optimisée a été vérifiée dans Mes médias. L’original est conservé.");
        return true;
      } catch (error) {
        if (isCurrent()) setMessage(error instanceof Error ? error.message : "La copie optimisée n’a pas pu être vérifiée.");
        return false;
      } finally { pending.current = false; if (mounted.current) setBusy(false); }
    } });
    return () => register(instance, null);
  }, [id, instance, pathname, register, revision, scopeKey]);
  return { busy, message: status.scopeKey === scopeKey ? status.message : "" };
}

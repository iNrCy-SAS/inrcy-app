"use client";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { InrAssistantBadgeUiCommand } from "@/lib/inrAssistantBadgeUiCommands";
import { DashboardAssistantCommandContext } from "../_components/DashboardAssistantCommandContext";
import { useInrAssistantScreen } from "../_components/DashboardAssistantScreenContext";

export function useInrAssistantBadgeCommands(options: { snapshot: unknown; enabled: boolean; pendingChanges: boolean; download: (format: "png" | "pdf", canDownload: () => boolean) => Promise<boolean> }) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_"), pathname = usePathname(), register = useContext(DashboardAssistantCommandContext);
  const signature = JSON.stringify(options.snapshot), [version, setVersion] = useState({ signature, revision: 0 });
  if (version.signature !== signature) setVersion({ signature, revision: version.revision + 1 });
  const revision = `badge_${instance}_${version.revision}`, current = useRef({ options, revision });
  useLayoutEffect(() => { current.current = { options, revision }; });
  const mounted = ["/dashboard", "/dashboard/settings"].includes(pathname), enabled = mounted && options.enabled && !options.pendingChanges;
  useInrAssistantScreen(mounted ? { selection: { kind: "channel", id: "inrbadge" }, revision, channel: "inrbadge", panel: "inrbadge", pendingChanges: options.pendingChanges, availableCommands: enabled ? ["download_badge_qr"] : [] } : null);
  useEffect(() => {
    if (!enabled) return;
    let active = true, busy = false;
    const command: InrAssistantBadgeUiCommand = { command: "download_badge_qr", selection: { kind: "channel", id: "inrbadge" }, revision, format: "png" };
    register(`${instance}:badge`, { ...command, pathname, getCommittedScreen: () => ({ pathname, selection: { kind: "channel", id: "inrbadge" }, revision: current.current.revision }), run: async (stillCurrent, incoming, scopeCurrent) => {
      if (incoming.command !== "download_badge_qr" || !active || busy || !stillCurrent() || incoming.revision !== current.current.revision || !current.current.options.enabled || current.current.options.pendingChanges) return false;
      busy = true;
      const canDownload = () => active && stillCurrent() && scopeCurrent() && incoming.revision === current.current.revision && current.current.options.enabled && !current.current.options.pendingChanges;
      try { return await current.current.options.download(incoming.format, canDownload); } catch { return false; } finally { busy = false; }
    } });
    return () => { active = false; register(`${instance}:badge`, null); };
  }, [enabled, instance, pathname, register, revision]);
}

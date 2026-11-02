"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { createClient } from "@/lib/supabaseClient";
import { getInrAssistantClientScreen, selectInrAssistantClientScreen, parseInrAssistantClientContext, type InrAssistantClientScreen } from "@/lib/inrAssistantClientContext";
import type { InrAssistantNavigation, InrAssistantUiCommand } from "@/lib/inrAssistantUiCommands";
import { runInrAssistantUiActions, type InrAssistantUiAction, type InrAssistantUiResult } from "@/lib/inrAssistantUiActions";
import type { InrAssistantStudioDraft } from "@/lib/inrAssistantStudioDraft";
import { clearInrAssistantStudioDraft, inrAssistantStudioDraftHref, requestInrAssistantStudioDraft, stageInrAssistantStudioDraft, waitForInrAssistantStudioDraft } from "@/lib/inrAssistantStudioHandoff";
import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import { dashboardAssistantCopy } from "./dashboardAssistantCopy";
import { useAssistantFirstArrival } from "../_hooks/useAssistantFirstArrival";
import { useDashboardUnsavedNavigation } from "./DashboardUnsavedNavigationProvider";
import { DashboardAssistantScreenContext } from "./DashboardAssistantScreenContext";
import { DashboardAssistantCommandContext, type InrAssistantScreenHandler } from "./DashboardAssistantCommandContext";
import AssistantSession from "./DashboardAssistantSession";
import { clearActorSessions } from "./dashboardAssistantSessionState";

type ContactDraft = { actorUserId: string; accountId: string; message: string };
export type AssistantBadgeState = "active" | "pending" | "unread" | null;
type AssistantControls = { openAssistant: () => void; toggleAssistant: () => void; assistantOpen: boolean; assistantLabel: string; assistantContactDraft: string | null; assistantUnread: boolean; assistantPending: boolean; assistantActive: boolean; assistantBadgeState: AssistantBadgeState };

const AssistantContext = createContext<AssistantControls>({
  openAssistant: () => {}, toggleAssistant: () => {}, assistantOpen: false, assistantLabel: "iNr’Assistant", assistantContactDraft: null, assistantUnread: false, assistantPending: false, assistantActive: false, assistantBadgeState: null,
});

export function useDashboardAssistant() {
  return useContext(AssistantContext);
}

export default function DashboardAssistantProvider({ children }: { children: ReactNode }) {
  const { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screenScope = `${actorUserId}:${activeAccountId}`;
  const [screenOverrides, setScreenOverrides] = useState<Record<string, { scope: string; value: InrAssistantClientScreen }>>({});
  const registerScreen = useCallback((id: string, value: unknown) => {
    const parsed = value ? parseInrAssistantClientContext({ screen: value })?.screen : undefined;
    setScreenOverrides(previous => {
      if (previous[id]?.scope === screenScope && JSON.stringify(previous[id]?.value) === JSON.stringify(parsed)) return previous;
      const next = { ...previous };
      if (parsed) next[id] = { scope: screenScope, value: parsed }; else delete next[id];
      return next;
    });
  }, [screenScope]);
  const screen = selectInrAssistantClientScreen(getInrAssistantClientScreen(pathname, searchParams), Object.values(screenOverrides).filter(entry => entry.scope === screenScope).map(entry => entry.value));
  const screenHandlers = useRef(new Map<string, { actorUserId: string; activeAccountId: string; handler: InrAssistantScreenHandler }>());
  const uiTargetWaiters = useRef(new Set<() => void>());
  const uiExecution = useRef<{ epoch: number; busy: boolean }>({ epoch: 0, busy: false });
  const registerCommand = useCallback((key: string, handler: InrAssistantScreenHandler | null) => {
    if (handler) screenHandlers.current.set(key, { actorUserId, activeAccountId, handler });
    else screenHandlers.current.delete(key);
    uiTargetWaiters.current.forEach(notify => notify());
  }, [actorUserId, activeAccountId]);
  const query = searchParams.toString();
  const screenRef = useRef({ pathname, screen, query });
  useEffect(() => { screenRef.current = { pathname, screen, query }; uiTargetWaiters.current.forEach(notify => notify()); }, [pathname, screen, query]);
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const [revision, setRevision] = useState(0);
  const [browserActorId, setBrowserActorId] = useState(actorUserId);
  const [browserAccountId, setBrowserAccountId] = useState(activeAccountId);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft | null>(null);
  const [onboardingWelcome, setOnboardingWelcome] = useState(false);
  const [unread, setUnread] = useState(false);
  const [assistantPending, setAssistantPending] = useState(false);
  const visibleRef = useRef(false);
  const copy = dashboardAssistantCopy(useLocale());
  const allowed = Boolean(actorUserId && activeAccountId && browserActorId === actorUserId && browserAccountId === activeAccountId);
  const navigationScopeRef = useRef({ actorUserId, activeAccountId, allowed });
  useEffect(() => { navigationScopeRef.current = { actorUserId, activeAccountId, allowed }; }, [actorUserId, activeAccountId, allowed]);
  const openAssistant = useCallback(() => {
    if (!allowed || (getActiveBrowserUserId() || activeAccountId) !== activeAccountId) return;
    setOpen(true);
    setMinimized(false);
    visibleRef.current = true;
    setUnread(false);
  }, [allowed, activeAccountId]);
  const welcomeFirstArrival = useCallback(() => {
    setOnboardingWelcome(true);
    openAssistant();
  }, [openAssistant]);
  useAssistantFirstArrival({ actorUserId, accountId: activeAccountId,
    enabled: allowed && pathname === "/dashboard" && !["panel", "action", "help", "generator", "stats"].some(key => searchParams.has(key)),
    onWelcome: welcomeFirstArrival });
  const close = useCallback(() => { visibleRef.current = false; setOpen(false); setMinimized(false); }, []);
  const minimize = useCallback(() => { visibleRef.current = false; setMinimized(true); }, []);
  const revealNavigationDestination = useCallback(() => {
    // Match the full-screen assistant breakpoint; desktop keeps the conversation beside the tool.
    if (!visibleRef.current || typeof window === "undefined" || !window.matchMedia("(max-width: 1100px)").matches) return false;
    minimize();
    return true;
  }, [minimize]);
  const toggleAssistant = useCallback(() => {
    if (visibleRef.current) minimize(); else openAssistant();
  }, [minimize, openAssistant]);
  const onReply = useCallback(() => { if (!visibleRef.current) setUnread(true); }, []);
  const assistantContactDraft = allowed && contactDraft?.actorUserId === actorUserId && contactDraft.accountId === activeAccountId ? contactDraft.message : null;
  const assistantActive = allowed && !(open && !minimized) && ((open && minimized) || unread || assistantPending);
  const assistantBadgeState: AssistantBadgeState = assistantActive ? unread ? "unread" : assistantPending ? "pending" : "active" : null;
  const assistantLabel = `${open && !minimized ? copy.minimize : assistantActive ? copy.restore : copy.open}${unread ? ` · ${copy.newReply}` : assistantPending ? ` · ${copy.pending}` : ""}`;
  const controls = useMemo(() => ({ openAssistant, toggleAssistant, assistantOpen: open && !minimized && allowed, assistantLabel, assistantContactDraft, assistantUnread: unread && allowed, assistantPending: assistantPending && allowed, assistantActive, assistantBadgeState }), [openAssistant, toggleAssistant, open, minimized, allowed, assistantLabel, assistantContactDraft, unread, assistantPending, assistantActive, assistantBadgeState]);
  const contactHuman = useCallback((message: string) => {
    void requestNavigation(() => {
      const scope = navigationScopeRef.current;
      if (!scope.allowed || scope.actorUserId !== actorUserId || scope.activeAccountId !== activeAccountId || (getActiveBrowserUserId() || activeAccountId) !== activeAccountId) return;
      setContactDraft({ actorUserId, accountId: activeAccountId, message: message.slice(0, 6000) });
      router.push("/dashboard?panel=contact&panelSource=assistant", { scroll: false });
      revealNavigationDestination();
    });
  }, [requestNavigation, router, actorUserId, activeAccountId, revealNavigationDestination]);
  const navigateInternally = useCallback((href: string) => {
    if (!/^\/dashboard(?:[/?#]|$)/.test(href) || href.includes("\\")) return;
    const target = new URL(href, "https://inrcy.local");
    if (target.origin !== "https://inrcy.local" || !/^\/dashboard(?:\/|$)/.test(target.pathname)) return;
    if (target.pathname === "/dashboard" && target.searchParams.get("panel") === "compte" && !target.searchParams.has("panelSource")) target.searchParams.set("panelSource", "settings");
    void requestNavigation(() => {
      const scope = navigationScopeRef.current;
      if (!scope.allowed || scope.actorUserId !== actorUserId || scope.activeAccountId !== activeAccountId || (getActiveBrowserUserId() || activeAccountId) !== activeAccountId) return;
      router.push(`${target.pathname}${target.search}${target.hash}`);
      revealNavigationDestination();
    });
  }, [requestNavigation, router, actorUserId, activeAccountId, revealNavigationDestination]);
  const openMediaLibrary = useCallback(() => navigateInternally("/dashboard/mediatheque"), [navigateInternally]);
  const executeScreenCommand = useCallback(async (command: InrAssistantUiCommand) => {
    if (command.command === "download_media" || command.command === "download_stats_report") {
      const stillCurrent = () => {
        const scope = navigationScopeRef.current, current = screenRef.current;
        const selectionMatches = command.command !== "download_media" || command.selectionMode !== "current" || current.pathname === "/dashboard/mediatheque"
          && current.screen?.selectedMediaIds?.length === command.mediaIds.length && command.mediaIds.every(id => current.screen?.selectedMediaIds?.includes(id));
        return selectionMatches && scope.allowed && scope.actorUserId === actorUserId && scope.activeAccountId === activeAccountId && (getActiveBrowserUserId() || activeAccountId) === activeAccountId;
      };
      if (!stillCurrent()) return false;
      try {
        let href: string, filename: string;
        if (command.command === "download_media") {
          const response = await fetch("/api/media-library/download", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: command.mediaIds }), signal: AbortSignal.timeout(30_000) });
          const data = await response.json();
          if (!response.ok || data?.ok !== true || typeof data.downloadUrl !== "string" || !stillCurrent()) return false;
          const url = new URL(data.downloadUrl, window.location.origin);
          if (url.origin !== window.location.origin || url.pathname !== "/api/media-library/download") return false;
          href = url.href; filename = "mes-medias.zip";
        } else {
          href = `/api/assistant/reports/${encodeURIComponent(command.reportId)}/download`; filename = "bilan-statistiques.pdf";
        }
        if (!stillCurrent()) return false;
        const link = document.createElement("a"); link.href = href; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove(); return true;
      } catch { return false; }
    }
    const matches = [...screenHandlers.current.entries()].filter(([, entry]) => entry.actorUserId === actorUserId && entry.activeAccountId === activeAccountId && entry.handler.command === command.command && entry.handler.selection.kind === command.selection.kind && entry.handler.selection.id === command.selection.id
      && (!command.revision || "revision" in entry.handler && entry.handler.revision === command.revision));
    if (matches.length !== 1) return false;
    const [key, entry] = matches[0];
    const stillCurrent = () => {
      const scope = navigationScopeRef.current, current = screenRef.current;
      return scope.allowed && scope.actorUserId === actorUserId && scope.activeAccountId === activeAccountId
        && (getActiveBrowserUserId() || activeAccountId) === activeAccountId && screenHandlers.current.get(key) === entry
        && current.pathname === entry.handler.pathname && current.screen?.selection?.kind === command.selection.kind
        && current.screen.selection.id === command.selection.id && current.screen.availableCommands?.includes(command.command) === true
        && (!command.revision || current.screen.revision === command.revision);
    };
    if (!stillCurrent()) return false;
    const scopeCurrent = () => {
      const scope = navigationScopeRef.current, current = screenRef.current;
      return scope.allowed && scope.actorUserId === actorUserId && scope.activeAccountId === activeAccountId
        && (getActiveBrowserUserId() || activeAccountId) === activeAccountId
        && current.pathname === entry.handler.pathname && current.screen?.selection?.kind === command.selection.kind
        && current.screen.selection.id === command.selection.id;
    };
    try { return await entry.handler.run(stillCurrent, command, scopeCurrent); } catch { return false; }
  }, [actorUserId, activeAccountId]);
  const executeUiActions = useCallback(async (actions: InrAssistantUiAction[], onResult?: (result: InrAssistantUiResult) => Promise<void>, beforeAction?: (action: InrAssistantUiAction) => Promise<boolean>) => {
    const execution = uiExecution.current;
    if (execution.busy) return actions.map(action => ({ actionId: action.id, source: "browser_reported" as const, status: "cancelled" as const }));
    execution.busy = true;
    const epoch = execution.epoch;
    const mountedRevisions = new Map<string, string>();
    const rememberDocumentRevision = (navigation: InrAssistantNavigation) => {
      const revision = screenRef.current.screen?.revision;
      if (navigation.documentId && revision) mountedRevisions.set(`${navigation.destination === "quotes" ? "quote" : "invoice"}:${navigation.documentId}`, revision);
    };
    const isCurrent = () => {
      const scope = navigationScopeRef.current;
      return execution.epoch === epoch && scope.allowed && scope.actorUserId === actorUserId && scope.activeAccountId === activeAccountId
        && (getActiveBrowserUserId() || activeAccountId) === activeAccountId;
    };
    const mounted = (navigation: InrAssistantNavigation) => {
      const target = new URL(navigation.href, "https://inrcy.local"), current = screenRef.current;
      if (current.pathname !== target.pathname) return false;
      if (navigation.documentId) {
        const kind = navigation.destination === "quotes" ? "quote" : "invoice";
        return current.screen?.selection?.id === navigation.documentId && current.screen.selection.kind === kind
          && [...screenHandlers.current.values()].filter(entry => entry.actorUserId === actorUserId && entry.activeAccountId === activeAccountId
            && entry.handler.command === "export_document_pdf" && entry.handler.selection.kind === kind && entry.handler.selection.id === navigation.documentId).length === 1;
      }
      const params = new URLSearchParams(current.query);
      return [...target.searchParams].every(([key, value]) => params.get(key) === value);
    };
    const navigate = async (navigation: InrAssistantNavigation) => {
      if (!isCurrent()) return false;
      if (mounted(navigation)) { rememberDocumentRevision(navigation); return true; }
      const starting = screenRef.current;
      const target = new URL(navigation.href, "https://inrcy.local");
      const leftForAnotherTarget = () => {
        const current = screenRef.current;
        const routeChanged = current.pathname !== starting.pathname || current.query !== starting.query;
        const params = new URLSearchParams(current.query);
        const targetRoute = current.pathname === target.pathname && [...target.searchParams].every(([key, value]) => params.get(key) === value);
        const selectionChangedElsewhere = navigation.documentId && current.screen?.selection?.id && current.screen.selection.id !== starting.screen?.selection?.id && current.screen.selection.id !== navigation.documentId;
        return Boolean(routeChanged && !targetRoute || selectionChangedElsewhere);
      };
      let pushed = false;
      const accepted = await requestNavigation(() => {
        if (!isCurrent()) return;
        router.push(navigation.href); pushed = true; revealNavigationDestination();
      });
      if (!accepted || !pushed || !isCurrent()) return false;
      return new Promise<boolean>(resolve => {
        const finish = (result: boolean) => { clearTimeout(timer); uiTargetWaiters.current.delete(check); resolve(result); };
        const check = () => { if (!isCurrent() || leftForAnotherTarget()) finish(false); else if (mounted(navigation)) { rememberDocumentRevision(navigation); finish(true); } };
        const timer = setTimeout(() => finish(false), 30_000);
        uiTargetWaiters.current.add(check); check();
      });
    };
    const command = (value: InrAssistantUiCommand) => {
      const revision = value.command === "export_document_pdf" ? value.revision ?? mountedRevisions.get(`${value.selection.kind}:${value.selection.id}`) : undefined;
      return executeScreenCommand(value.command === "export_document_pdf" && revision ? { ...value, revision } : value);
    };
    try { return await runInrAssistantUiActions(actions, { isCurrent, navigate, command, onResult, beforeAction }); }
    finally { execution.busy = false; }
  }, [actorUserId, activeAccountId, requestNavigation, router, revealNavigationDestination, executeScreenCommand]);
  const insertStudioDraft = useCallback(async (value: InrAssistantStudioDraft) => {
    const currentScope = () => {
      const scope = navigationScopeRef.current;
      return scope.allowed && scope.actorUserId === actorUserId && scope.activeAccountId === activeAccountId && (getActiveBrowserUserId() || activeAccountId) === activeAccountId;
    };
    if (!currentScope()) return false;
    const scope = { actorUserId, accountId: activeAccountId };
    let inserted = false;
    let minimizedForNavigation = false;
    try {
      await requestNavigation(async () => {
        if (!currentScope()) return;
        const staged = stageInrAssistantStudioDraft(scope, value);
        if (!staged) throw new Error("studio_draft_unavailable");
        try {
          const handled = await requestInrAssistantStudioDraft(scope, staged.id);
          if (!currentScope()) return;
          if (handled !== null) {
            inserted = handled;
            if (inserted) minimizedForNavigation = revealNavigationDestination();
            return;
          }
          const href = inrAssistantStudioDraftHref(staged.id);
          if (!href) throw new Error("studio_draft_unavailable");
          const acknowledged = waitForInrAssistantStudioDraft(scope, staged.id);
          router.push(href);
          minimizedForNavigation = revealNavigationDestination();
          inserted = await acknowledged && currentScope();
          if (!inserted && currentScope()) throw new Error("studio_draft_unavailable");
        } finally {
          clearInrAssistantStudioDraft(scope, staged.id);
        }
      });
      return inserted;
    } finally {
      if (!inserted && minimizedForNavigation && currentScope()) openAssistant();
    }
  }, [actorUserId, activeAccountId, revealNavigationDestination, openAssistant, requestNavigation, router]);

  useEffect(() => {
    const execution = uiExecution.current, waiters = uiTargetWaiters.current;
    const syncAccount = () => {
      execution.epoch += 1;
      waiters.forEach(notify => notify());
      setOpen(false);
      setMinimized(false);
      setContactDraft(null);
      setOnboardingWelcome(false);
      setUnread(false);
      setAssistantPending(false);
      visibleRef.current = false;
      setBrowserAccountId(getActiveBrowserUserId() || activeAccountId);
      setRevision((value) => value + 1);
    };
    syncAccount();
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, syncAccount);
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      setBrowserActorId(session?.user.id || "");
      if (session?.user.id !== actorUserId) {
        execution.epoch += 1;
        waiters.forEach(notify => notify());
        clearActorSessions(actorUserId);
        visibleRef.current = false;
        setOpen(false);
        setMinimized(false);
        setContactDraft(null);
        setOnboardingWelcome(false);
        setUnread(false);
        setAssistantPending(false);
      }
    });
    return () => {
      execution.epoch += 1;
      waiters.forEach(notify => notify());
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, syncAccount);
      data.subscription.unsubscribe();
    };
  }, [actorUserId, activeAccountId]);

  return <AssistantContext.Provider value={controls}><DashboardAssistantScreenContext.Provider value={registerScreen}><DashboardAssistantCommandContext.Provider value={registerCommand}>
    {children}
    <AssistantSession
      key={`${actorUserId}:${activeAccountId}:${browserActorId}:${revision}`}
      actorUserId={actorUserId}
      activeAccountId={activeAccountId}
      allowed={allowed}
      open={open && !minimized && allowed}
      close={close}
      minimize={minimize}
      onHumanContact={contactHuman}
      onboardingWelcome={onboardingWelcome}
      onReply={onReply}
      onPendingChange={setAssistantPending}
      onOpenMediaLibrary={openMediaLibrary}
      onInternalNavigate={navigateInternally}
      onScreenCommand={executeScreenCommand}
      onUiActions={executeUiActions}
      onInsertStudioDraft={insertStudioDraft}
      screen={screen}
    />
  </DashboardAssistantCommandContext.Provider></DashboardAssistantScreenContext.Provider></AssistantContext.Provider>;
}

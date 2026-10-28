"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type FormEvent, type ReactNode,
} from "react";
import { useLocale } from "next-intl";
import Image from "next/image";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { createClient } from "@/lib/supabaseClient";
import { getInrAssistantClientScreen, selectInrAssistantClientScreen, parseInrAssistantClientContext, parseInrAssistantRequestId, type InrAssistantClientError, type InrAssistantClientScreen } from "@/lib/inrAssistantClientContext";
import { readInrAssistantResponse } from "@/lib/inrAssistantClientStream";
import { getInrAssistantContextualHelp } from "@/lib/inrAssistantContextualHelp";
import type { InrAssistantActivity } from "@/lib/inrAssistantActivity";
import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import { dashboardAssistantCopy } from "./dashboardAssistantCopy";
import { dashboardAssistantErrorCopy } from "./dashboardAssistantErrorCopy";
import DashboardAssistantMessageContent from "./DashboardAssistantMessageContent";
import { useAssistantFirstArrival } from "../_hooks/useAssistantFirstArrival";
import { useAssistantAttachments } from "../_hooks/useAssistantAttachments";
import { ASSISTANT_ATTACHMENT_ACCEPT, ASSISTANT_ATTACHMENT_MAX_COUNT, ASSISTANT_ATTACHMENT_MAX_BYTES, ASSISTANT_ATTACHMENT_VIDEO_MAX_BYTES, parseAssistantAttachments, type AssistantAttachment } from "@/lib/inrAssistantAttachments";
import { dashboardAssistantAttachmentCopy, assistantAttachmentErrorCopy } from "./dashboardAssistantAttachmentCopy";
import { useDashboardUnsavedNavigation } from "./DashboardUnsavedNavigationProvider";
import { DashboardAssistantScreenContext } from "./DashboardAssistantScreenContext";
import { DashboardAssistantCommandContext, type InrAssistantScreenHandler } from "./DashboardAssistantCommandContext";
import { parseInrAssistantTaskProgress, type InrAssistantTaskProgress, type InrAssistantUiCommand } from "@/lib/inrAssistantUiCommands";
import { dashboardAssistantTaskCopy, dashboardAssistantPdfCopy } from "./dashboardAssistantTaskCopy";
import { deriveInrAssistantStudioDraft, parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "@/lib/inrAssistantStudioDraft";
import { clearInrAssistantStudioDraft, inrAssistantStudioDraftHref, requestInrAssistantStudioDraft, stageInrAssistantStudioDraft, waitForInrAssistantStudioDraft } from "@/lib/inrAssistantStudioHandoff";
import styles from "./DashboardAssistantProvider.module.css";

type AssistantMedia = {
  status: "processing" | "completed" | "failed";
  mediaType?: "image" | "video";
  requestId?: string;
  mediaId?: string;
  url?: string;
  message?: string;
};
const MediaLibraryPickerModal = dynamic(() => import("./MediaLibraryPickerModal"), { ssr: false });
type ChatMessage = { role: "user" | "assistant"; content: string; media?: AssistantMedia; studioDraft?: InrAssistantStudioDraft; turnId?: string; attachments?: AssistantAttachment[]; taskProgress?: InrAssistantTaskProgress };
const POSITION_STORAGE_KEY = "inrcy_assistant_position_v1";
const SESSION_STORAGE_PREFIX = "inrcy_assistant_session_v1:";
const SESSION_TTL = 6 * 60 * 60 * 1000;
const TURN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLLABORATION_AGENTS = {
  publications: { name: "Agent Publications", image: "/agent/agent-publications.webp" },
  stats: { name: "Agent Stats", image: "/agent/agent-stats.webp" },
  emailing: { name: "Agent Emailings", image: "/agent/agent-campaigns.webp" },
} as const;
type StoredSession = { version: 1; actorUserId: string; accountId: string; conversationId?: string; updatedAt: number; messages: ChatMessage[]; draft: string; draftAttachments?: AssistantAttachment[]; interrupted: boolean; retryable: boolean; visibleError?: InrAssistantClientError };

const sessionStorageKey = (actor: string, account: string) => `${SESSION_STORAGE_PREFIX}${encodeURIComponent(actor)}:${encodeURIComponent(account)}`;
function clearActorSessions(actor: string) {
  try {
    const prefix = `${SESSION_STORAGE_PREFIX}${encodeURIComponent(actor)}:`;
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch { /* The current in-memory session still resets when storage is unavailable. */ }
}

function storedMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const rows: ChatMessage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || (row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string" || !row.content.trim()) return null;
    if (row.role === "user" && (typeof row.turnId !== "string" || !TURN_ID_PATTERN.test(row.turnId))) return null;
    let attachments: AssistantAttachment[] = [];
    try { if (row.role === "user") attachments = parseAssistantAttachments(row.attachments); } catch { /* An invalid local attachment cannot become a server reference. */ }
    const studioDraft = row.role === "assistant" ? parseInrAssistantStudioDraft(row.studioDraft) : null;
    const taskProgress = row.role === "assistant" ? parseInrAssistantTaskProgress(row.taskProgress) : null;
    rows.push({ role: row.role, content: row.content.slice(0, row.role === "user" ? 4000 : 60000), ...(studioDraft ? { studioDraft } : {}), ...(taskProgress ? { taskProgress } : {}), ...(row.role === "user" ? { turnId: row.turnId, ...(attachments.length ? { attachments } : {}) } : {}) });
  }
  while (rows.length > 1 && rows.reduce((total, row) => total + row.content.length, 0) > 400000) rows.shift();
  return rows;
}

/** Display history may contain a full long answer; model input remains much smaller. */
function requestMessages(conversation: ChatMessage[]) {
  const rows = conversation.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, role === "user" ? 4000 : 12000) }));
  const encoder = new TextEncoder();
  while (rows.length > 1 && encoder.encode(JSON.stringify(rows)).byteLength > 20000) rows.shift();
  return rows;
}

function readStoredSession(actorUserId: string, accountId: string): StoredSession | null {
  const key = sessionStorageKey(actorUserId, accountId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    if (raw.length > 1000000) throw new Error("Oversized session");
    const value = JSON.parse(raw);
    if (value?.version !== 1 || value.actorUserId !== actorUserId || value.accountId !== accountId || !Number.isFinite(value.updatedAt) || value.updatedAt > Date.now() + 5000 || Date.now() - value.updatedAt > SESSION_TTL || typeof value.draft !== "string") throw new Error("Invalid session");
    const messages = storedMessages(value.messages);
    if (!messages) throw new Error("Invalid messages");
    const visibleError = parseInrAssistantClientContext({ visibleError: value.visibleError })?.visibleError;
    let draftAttachments: AssistantAttachment[] = [];
    try { draftAttachments = parseAssistantAttachments(value.draftAttachments); } catch { /* Ignore malformed browser state. */ }
    return { version: 1, actorUserId, accountId, ...(typeof value.conversationId === "string" && TURN_ID_PATTERN.test(value.conversationId) ? { conversationId: value.conversationId } : {}), updatedAt: value.updatedAt, messages, draft: value.draft.slice(0, 4000), draftAttachments, interrupted: value.interrupted === true, retryable: value.retryable === true, ...(visibleError ? { visibleError } : {}) };
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* Memory-only fallback. */ }
    return null;
  }
}

function parseAssistantMedia(value: unknown): AssistantMedia | undefined {
  if (!value || typeof value !== "object") return;
  const media = value as Record<string, unknown>;
  if (!["processing", "completed", "failed", "ready_to_save"].includes(String(media.status))) return;
  const item = media.media && typeof media.media === "object" ? media.media as Record<string, unknown> : {};
  const kind = media.mediaType || item.mediaType;
  const mediaType = kind === "image" || kind === "video" ? kind : undefined;
  const rawUrl = item.url ?? media.url;
  let url: string | undefined;
  if (typeof rawUrl === "string") {
    try {
      const parsed = new URL(rawUrl, "https://inrcy.local");
      if (["http:", "https:"].includes(parsed.protocol) && (/^https?:\/\//i.test(rawUrl) || /^\/api\//.test(rawUrl))) url = rawUrl;
    } catch { /* An invalid provider URL must never become a rendered media source. */ }
  }
  return {
    status: media.status === "ready_to_save" ? "processing" : media.status as AssistantMedia["status"],
    ...(mediaType ? { mediaType } : {}),
    ...(url ? { url } : {}),
    ...(typeof media.requestId === "string" ? { requestId: media.requestId } : {}),
    ...(typeof item.id === "string" ? { mediaId: item.id } : typeof media.mediaId === "string" ? { mediaId: media.mediaId } : {}),
    ...(typeof media.message === "string" ? { message: media.message.slice(0, 1200) } : {}),
  };
}
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
  const registerCommand = useCallback((key: string, handler: InrAssistantScreenHandler | null) => {
    if (handler) screenHandlers.current.set(key, { actorUserId, activeAccountId, handler });
    else screenHandlers.current.delete(key);
  }, [actorUserId, activeAccountId]);
  const screenRef = useRef({ pathname, screen });
  useEffect(() => { screenRef.current = { pathname, screen }; }, [pathname, screen]);
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
    });
  }, [requestNavigation, router, actorUserId, activeAccountId]);
  const navigateInternally = useCallback((href: string) => {
    if (!/^\/dashboard(?:[/?#]|$)/.test(href) || href.includes("\\")) return;
    const target = new URL(href, "https://inrcy.local");
    if (target.origin !== "https://inrcy.local" || !/^\/dashboard(?:\/|$)/.test(target.pathname)) return;
    if (target.pathname === "/dashboard" && target.searchParams.get("panel") === "compte" && !target.searchParams.has("panelSource")) target.searchParams.set("panelSource", "settings");
    void requestNavigation(() => {
      const scope = navigationScopeRef.current;
      if (!scope.allowed || scope.actorUserId !== actorUserId || scope.activeAccountId !== activeAccountId || (getActiveBrowserUserId() || activeAccountId) !== activeAccountId) return;
      router.push(`${target.pathname}${target.search}${target.hash}`);
    });
  }, [requestNavigation, router, actorUserId, activeAccountId]);
  const openMediaLibrary = useCallback(() => navigateInternally("/dashboard/mediatheque"), [navigateInternally]);
  const executeScreenCommand = useCallback(async (command: InrAssistantUiCommand) => {
    const matches = [...screenHandlers.current.entries()].filter(([, entry]) => entry.actorUserId === actorUserId && entry.activeAccountId === activeAccountId && entry.handler.command === command.command && entry.handler.selection.kind === command.selection.kind && entry.handler.selection.id === command.selection.id);
    if (matches.length !== 1) return false;
    const [key, entry] = matches[0];
    const stillCurrent = () => {
      const scope = navigationScopeRef.current, current = screenRef.current;
      return scope.allowed && scope.actorUserId === actorUserId && scope.activeAccountId === activeAccountId
        && (getActiveBrowserUserId() || activeAccountId) === activeAccountId && screenHandlers.current.get(key) === entry
        && current.pathname === entry.handler.pathname && current.screen?.selection?.kind === command.selection.kind
        && current.screen.selection.id === command.selection.id && current.screen.availableCommands?.includes(command.command) === true;
    };
    if (!stillCurrent()) return false;
    try { return await entry.handler.run(stillCurrent); } catch { return false; }
  }, [actorUserId, activeAccountId]);
  const insertStudioDraft = useCallback(async (value: InrAssistantStudioDraft) => {
    const currentScope = () => {
      const scope = navigationScopeRef.current;
      return scope.allowed && scope.actorUserId === actorUserId && scope.activeAccountId === activeAccountId && (getActiveBrowserUserId() || activeAccountId) === activeAccountId;
    };
    if (!currentScope()) return false;
    const scope = { actorUserId, accountId: activeAccountId };
    let inserted = false;
    minimize();
    try {
      await requestNavigation(async () => {
        if (!currentScope()) return;
        const staged = stageInrAssistantStudioDraft(scope, value);
        if (!staged) throw new Error("studio_draft_unavailable");
        try {
          const handled = await requestInrAssistantStudioDraft(scope, staged.id);
          if (!currentScope()) return;
          if (handled !== null) { inserted = handled; return; }
          const href = inrAssistantStudioDraftHref(staged.id);
          if (!href) throw new Error("studio_draft_unavailable");
          const acknowledged = waitForInrAssistantStudioDraft(scope, staged.id);
          router.push(href);
          inserted = await acknowledged && currentScope();
          if (!inserted && currentScope()) throw new Error("studio_draft_unavailable");
        } finally {
          clearInrAssistantStudioDraft(scope, staged.id);
        }
      });
      return inserted;
    } finally {
      if (!inserted && currentScope()) openAssistant();
    }
  }, [actorUserId, activeAccountId, minimize, openAssistant, requestNavigation, router]);

  useEffect(() => {
    const syncAccount = () => {
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
      onInsertStudioDraft={insertStudioDraft}
      screen={screen}
    />
  </DashboardAssistantCommandContext.Provider></DashboardAssistantScreenContext.Provider></AssistantContext.Provider>;
}

function AssistantSession({ actorUserId, activeAccountId, allowed, open, close, minimize, onHumanContact, starterDraft, onStarterConsumed, onboardingWelcome = false, onReply, onPendingChange, onOpenMediaLibrary, onInternalNavigate, onScreenCommand, onInsertStudioDraft, screen }: {
  actorUserId: string; activeAccountId: string; allowed: boolean; open: boolean; close: () => void;
  minimize: () => void; onHumanContact: (message: string) => void;
  starterDraft?: string; onStarterConsumed?: () => void;
  onboardingWelcome?: boolean;
  onReply?: () => void; onPendingChange?: (pending: boolean) => void;
  onOpenMediaLibrary?: () => void;
  onInternalNavigate?: (href: string) => void;
  onScreenCommand?: (command: InrAssistantUiCommand) => Promise<boolean>;
  onInsertStudioDraft?: (draft: InrAssistantStudioDraft) => Promise<boolean>;
  screen?: InrAssistantClientScreen;
}) {
  const locale = useLocale();
  const copy = dashboardAssistantCopy(locale);
  const contextHelp = getInrAssistantContextualHelp(screen, locale);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryMessages, setRetryMessages] = useState<ChatMessage[] | null>(null);
  const [handoffSummary, setHandoffSummary] = useState("");
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<"left" | "right">("right");
  const [visibleError, setVisibleError] = useState<InrAssistantClientError | undefined>();
  const [sessionRestored, setSessionRestored] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [memoryUnavailable, setMemoryUnavailable] = useState(false);
  const [activities, setActivities] = useState<InrAssistantActivity[]>([]);
  const [collaborationExpanded, setCollaborationExpanded] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const historyControllerRef = useRef<AbortController | null>(null);
  const localEditRevisionRef = useRef(0);
  const autoHistoryAttemptedRef = useRef(false);
  const latestScopeRef = useRef({ actorUserId, activeAccountId, allowed });
  const activitySeenRef = useRef(false);
  const studioInsertionRef = useRef(false);
  const attachmentCopy = dashboardAssistantAttachmentCopy(locale);
  const files = useAssistantAttachments({ accountId: activeAccountId, actorUserId, locale, ensureConversation: () => {
    historyControllerRef.current?.abort(); localEditRevisionRef.current++; autoHistoryAttemptedRef.current = true;
    const id = conversationId || crypto.randomUUID(); setConversationId(id); return id;
  } });
  const portalTarget = open && typeof document !== "undefined" ? portalHost?.isConnected ? portalHost : document.body : null;
  useEffect(() => { latestScopeRef.current = { actorUserId, activeAccountId, allowed }; }, [actorUserId, activeAccountId, allowed]);

  useEffect(() => () => { controllerRef.current?.abort(); historyControllerRef.current?.abort(); }, []);

  useEffect(() => {
    if (!open) return;
    const syncHost = () => {
      const next = document.querySelector<HTMLDialogElement>("dialog:modal") || document.body;
      setPortalHost(current => current === next ? current : next);
    };
    syncHost();
    // Native Help uses the browser's top layer. Move the same conversation into
    // that host, then back to body when navigation closes or removes the host.
    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    try {
      if (localStorage.getItem(POSITION_STORAGE_KEY) === "left") setPosition("left");
    } catch { /* Position still works when browser preferences are unavailable. */ }
  }, []);

  const togglePosition = () => {
    const next = position === "left" ? "right" : "left";
    setPosition(next);
    try { localStorage.setItem(POSITION_STORAGE_KEY, next); } catch { /* Keep the current in-memory preference. */ }
  };

  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);

  useEffect(() => {
    if (!starterDraft) return;
    localEditRevisionRef.current++;
    setDraft(starterDraft);
    onStarterConsumed?.();
  }, [starterDraft, onStarterConsumed]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.show();
    const ownsScrollLock = window.matchMedia("(max-width: 1100px)").matches;
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const syncViewport = () => {
      dialog.style.setProperty("--assistant-viewport-height", `${viewport?.height || window.innerHeight}px`);
      dialog.style.setProperty("--assistant-viewport-width", `${viewport?.width || window.innerWidth}px`);
      dialog.style.setProperty("--assistant-viewport-top", `${Math.max(0, viewport?.offsetTop || 0)}px`);
      dialog.style.setProperty("--assistant-viewport-left", `${Math.max(0, viewport?.offsetLeft || 0)}px`);
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    const frame = requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      dialog.close();
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, portalTarget]);

  useEffect(() => {
    if (!open) return;
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [open, messages, pending, error, activities]);

  useEffect(() => {
    if (sessionRestored || !allowed || (getActiveBrowserUserId() || activeAccountId) !== activeAccountId) return;
    const saved = readStoredSession(actorUserId, activeAccountId);
    if (saved) {
      setMessages(saved.messages);
      setDraft(saved.draft);
      files.setAttachments(saved.draftAttachments || []);
      if (saved.conversationId) setConversationId(saved.conversationId);
      setVisibleError(saved.visibleError);
      if ((saved.interrupted || saved.retryable) && saved.messages.at(-1)?.role === "user") {
        setRetryMessages(saved.messages);
        setError(copy.interrupted);
      }
    }
    setSessionRestored(true);
  }, [actorUserId, activeAccountId, allowed, copy.interrupted, sessionRestored]);

  useEffect(() => {
    if (!sessionRestored || !allowed || (getActiveBrowserUserId() || activeAccountId) !== activeAccountId) return;
    try {
      const snapshot: StoredSession = { version: 1, actorUserId, accountId: activeAccountId, ...(conversationId ? { conversationId } : {}), updatedAt: Date.now(), messages: storedMessages(messages.slice(-12)) || [], draft: draft.slice(0, 4000), draftAttachments: files.attachments, interrupted: pending, retryable: Boolean(retryMessages), ...(visibleError ? { visibleError } : {}) };
      sessionStorage.setItem(sessionStorageKey(actorUserId, activeAccountId), JSON.stringify(snapshot));
    } catch { /* Storage restrictions must never block an existing conversation. */ }
  }, [actorUserId, activeAccountId, allowed, messages, draft, pending, retryMessages, visibleError, sessionRestored, conversationId, files.attachments]);

  const loadHistory = useCallback(async () => {
    if (!allowed || controllerRef.current || (getActiveBrowserUserId() || activeAccountId) !== activeAccountId) return;
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    const revision = localEditRevisionRef.current;
    const current = () => !controller.signal.aborted && historyControllerRef.current === controller
      && latestScopeRef.current.allowed && latestScopeRef.current.actorUserId === actorUserId
      && latestScopeRef.current.activeAccountId === activeAccountId && (getActiveBrowserUserId() || activeAccountId) === activeAccountId;
    const timeout = setTimeout(() => controller.abort("timeout"), 15000);
    try {
      const response = await fetch("/api/assistant/history", { credentials: "include", cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) throw new Error("History unavailable");
      if (payload?.available !== true) { setMemoryUnavailable(true); return; }
      setMemoryUnavailable(false);
      if (revision !== localEditRevisionRef.current || controllerRef.current) return;
      const conversation = payload.conversation;
      const rows = storedMessages(conversation?.messages);
      if (!conversation || typeof conversation.id !== "string" || !TURN_ID_PATTERN.test(conversation.id) || !rows) return;
      setConversationId(conversation.id);
      setMessages(rows);
      setDraft("");
      setVisibleError(undefined);
      setHandoffSummary("");
      const pendingTurn = conversation.pendingTurn?.turnId;
      const interrupted = typeof pendingTurn === "string" && TURN_ID_PATTERN.test(pendingTurn) && rows.at(-1)?.role === "user" && rows.at(-1)?.turnId === pendingTurn;
      setRetryMessages(interrupted ? rows : null);
      setError(interrupted ? copy.interrupted : null);
    } catch {
      if (current()) setMemoryUnavailable(true);
    } finally {
      clearTimeout(timeout);
      if (historyControllerRef.current === controller) historyControllerRef.current = null;
    }
  }, [allowed, activeAccountId, actorUserId, copy.interrupted]);

  useEffect(() => {
    if (!sessionRestored || !open || !allowed || pending || messages.length || draft.trim() || starterDraft || autoHistoryAttemptedRef.current) return;
    autoHistoryAttemptedRef.current = true;
    void loadHistory();
  }, [sessionRestored, open, allowed, pending, messages.length, draft, starterDraft, loadHistory]);

  const newConversation = () => {
    if (pending || controllerRef.current || files.busy) return;
    historyControllerRef.current?.abort();
    localEditRevisionRef.current++;
    autoHistoryAttemptedRef.current = true;
    setConversationId(crypto.randomUUID());
    setMessages([]); setDraft(""); setError(null); setVisibleError(undefined); setRetryMessages(null); setHandoffSummary("");
    setActivities([]); activitySeenRef.current = false;
    files.reset();
    composerRef.current?.focus();
  };

  const insertDraft = async (value: InrAssistantStudioDraft, sourceMessage: ChatMessage) => {
    const current = () => latestScopeRef.current.allowed && latestScopeRef.current.actorUserId === actorUserId
      && latestScopeRef.current.activeAccountId === activeAccountId && (getActiveBrowserUserId() || activeAccountId) === activeAccountId;
    if (controllerRef.current || files.busy || studioInsertionRef.current || !onInsertStudioDraft || !current()) return;
    studioInsertionRef.current = true;
    setError(null);
    try {
      const inserted = await onInsertStudioDraft(value);
      if (inserted && current()) setMessages(rows => rows.includes(sourceMessage) ? [...rows, { role: "assistant", content: value.mediaType === "video" ? copy.studioDraftInsertedVideo : copy.studioDraftInsertedImage }] : rows);
    } catch (cause) {
      if (current()) setError(cause instanceof Error && cause.message === "studio_draft_busy" ? copy.studioDraftBusy : copy.studioDraftUnavailable);
    } finally { studioInsertionRef.current = false; }
  };

  const send = async (conversation: ChatMessage[], taskIntent?: "continue" | "check_status") => {
    if (controllerRef.current || !allowed) return;
    const accountAtStart = getActiveBrowserUserId() || activeAccountId;
    if (accountAtStart !== activeAccountId) return;
    const controller = new AbortController();
    historyControllerRef.current?.abort();
    localEditRevisionRef.current++;
    autoHistoryAttemptedRef.current = true;
    const currentConversationId = conversationId || crypto.randomUUID();
    setConversationId(currentConversationId);
    controllerRef.current = controller;
    setPending(true);
    setError(null);
    setRetryMessages(null);
    setHandoffSummary("");
    setActivities([]); activitySeenRef.current = false;
    const clientContext = parseInrAssistantClientContext({ screen, visibleError });
    setVisibleError(undefined);
    // Media creation may legitimately outlast an ordinary answer. The server
    // bounds normal model calls independently and owns the generation timeout.
    const timeout = setTimeout(() => controller.abort("timeout"), 810_000);
    const stillCurrent = () => !controller.signal.aborted
      && latestScopeRef.current.allowed
      && latestScopeRef.current.actorUserId === actorUserId
      && latestScopeRef.current.activeAccountId === accountAtStart
      && (getActiveBrowserUserId() || activeAccountId) === accountAtStart;
    let autoInsertMessage: ChatMessage | null = null;
    let navigationHref: string | undefined;
    let screenCommand: InrAssistantUiCommand | undefined;
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, signal: controller.signal,
        body: JSON.stringify({ conversationId: currentConversationId, turnId: conversation.findLast((message) => message.role === "user")?.turnId, attachments: conversation.findLast(message => message.role === "user")?.attachments, messages: requestMessages(conversation), ...(clientContext ? { clientContext } : {}), ...(taskIntent ? { taskIntent } : {}) }),
      });
      const { payload, failed } = await readInrAssistantResponse(response, activity => {
        if (!stillCurrent()) return;
        if (!activitySeenRef.current) { activitySeenRef.current = true; setCollaborationExpanded(true); }
        setActivities(current => {
          const found = current.findIndex(item => item.id === activity.id);
          if (found >= 0) return current.map((item, index) => index === found ? { ...activity, agent: item.agent } : item);
          return current.length < 32 ? [...current, activity] : current;
        });
      });
      if (!stillCurrent()) return;
      if (payload?.accountId && payload.accountId !== accountAtStart) { close(); return; }
      if (typeof payload?.memorySaved === "boolean") setMemoryUnavailable(!payload.memorySaved);
      if (!failed && payload?.pending === true) {
        const requestId = parseInrAssistantRequestId(payload.requestId) || parseInrAssistantRequestId(response.headers.get("X-Request-Id"));
        setError(copy.inProgress);
        setVisibleError({ code: "assistant_pending", ...(requestId ? { requestId } : {}), occurredAt: new Date().toISOString() });
        setRetryMessages(conversation);
        return;
      }
      if (!response.ok || failed || typeof payload?.message !== "string" || !payload.message.trim()) {
        setError(typeof payload?.code === "string" && payload.code.startsWith("attachment_") ? assistantAttachmentErrorCopy(locale, payload.code) : dashboardAssistantErrorCopy(locale, payload?.code, response.status));
        setVisibleError(parseInrAssistantClientContext({ visibleError: { code: payload?.code, requestId: parseInrAssistantRequestId(payload?.requestId) || response.headers.get("X-Request-Id"), occurredAt: new Date().toISOString() } })?.visibleError);
        setRetryMessages(conversation);
        return;
      }
      const media = parseAssistantMedia(payload.media);
      const studioDraft = parseInrAssistantStudioDraft(payload.studioDraft);
      const assistantMessage: ChatMessage = { role: "assistant", content: payload.message, ...(media ? { media } : {}), ...(studioDraft ? { studioDraft } : {}), ...(payload.taskProgress ? { taskProgress: payload.taskProgress } : {}) };
      setMessages([...conversation, assistantMessage]);
      if (studioDraft && payload.insertStudioDraft === true) autoInsertMessage = assistantMessage;
      navigationHref = payload.navigation?.href;
      screenCommand = payload.uiCommand;
      onReply?.();
      setHandoffSummary(payload.needsHuman === true ? typeof payload.handoffSummary === "string" && payload.handoffSummary.trim() ? payload.handoffSummary.slice(0, 4500) : payload.message.slice(0, 4500) : "");
    } catch {
      if (controller.signal.reason === "timeout") {
        setError(dashboardAssistantErrorCopy(locale, "assistant_client_timeout"));
        setVisibleError({ code: "assistant_client_timeout", occurredAt: new Date().toISOString() });
        setRetryMessages(conversation);
      } else if (stillCurrent()) {
        setError(dashboardAssistantErrorCopy(locale));
        setVisibleError({ code: "assistant_client_network", occurredAt: new Date().toISOString() });
        setRetryMessages(conversation);
      }
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setPending(false);
      }
    }
    // Insertion is a free UI operation. Wait until the chat request has released
    // its controller, then let Studio apply its own pending/unsaved guard.
    if (autoInsertMessage?.studioDraft && stillCurrent()) await insertDraft(autoInsertMessage.studioDraft, autoInsertMessage);
    // Only a fresh verified server result triggers navigation. Loading history never replays it.
    if (screenCommand && stillCurrent()) {
      setPending(true);
      try {
        const started = await onScreenCommand?.(screenCommand) === true;
        if (stillCurrent()) setMessages(current => [...current, { role: "assistant", content: dashboardAssistantPdfCopy(locale, started) }]);
      } finally { if (stillCurrent()) setPending(false); }
    }
    if (navigationHref && stillCurrent()) onInternalNavigate?.(navigationHref);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim() || (files.attachments.length ? attachmentCopy.prompt : "");
    if (!content || pending || files.busy || !allowed) return;
    const conversation: ChatMessage[] = [...messages, { role: "user", content, turnId: crypto.randomUUID(), ...(files.attachments.length ? { attachments: files.attachments } : {}) }];
    setMessages(conversation);
    setDraft("");
    files.setAttachments([]);
    void send(conversation);
  };

  const taskCopy = dashboardAssistantTaskCopy(locale);
  const continueTask = (processing: boolean) => {
    if (pending || files.busy || !allowed || draft.trim() || files.attachments.length) return;
    const conversation: ChatMessage[] = [...messages, { role: "user", content: processing ? taskCopy.checkRequest : taskCopy.continueRequest, turnId: crypto.randomUUID() }];
    setMessages(conversation);
    void send(conversation, processing ? "check_status" : "continue");
  };

  const prepareHumanContact = () => {
    if (!handoffSummary) return;
    const request = draft.trim() || messages.findLast((message) => message.role === "user")?.content || "";
    const lastReply = messages.findLast((message) => message.role === "assistant")?.content || "";
    onHumanContact([
      request ? `${copy.requestLabel}\n${request.slice(0, 2500)}` : "",
      handoffSummary || (lastReply ? `${copy.exchangeLabel}\n${lastReply.slice(0, 2500)}` : ""),
    ].filter(Boolean).join("\n\n"));
  };

  return open && allowed ? createPortal(<dialog
      ref={dialogRef} id="inrcy-assistant-dialog" className={styles.dialog} aria-labelledby="inrcy-assistant-title"
      data-position={position}
      data-disable-pull-refresh="true" data-testid="dashboard-assistant"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (files.menuOpen) files.setMenuOpen(false); else if (files.libraryOpen) files.setLibraryOpen(false); else close(); } }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <Image className={styles.avatar} src="/agent/agent-assist-pink-v2.png" width={42} height={42} sizes="(max-width: 1100px) 36px, 42px" alt="" draggable={false} />
          <h2 id="inrcy-assistant-title">iNr’Assistant</h2>
          <button type="button" className={`${styles.iconButton} ${styles.positionButton}`} onClick={togglePosition}
            aria-label={position === "right" ? copy.moveLeft : copy.moveRight} title={position === "right" ? copy.moveLeft : copy.moveRight}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{position === "right"
              ? <path d="M5 4v16m8-13-5 5 5 5M8 12h11" />
              : <path d="M19 4v16M11 7l5 5-5 5M5 12h11" />}</svg>
          </button>
          <button type="button" className={styles.iconButton} onClick={minimize} aria-label={copy.minimize} title={copy.minimize}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <button type="button" className={styles.iconButton} aria-label={copy.newChat} title={copy.newChat}
            disabled={pending || files.busy || !messages.length}
            onClick={newConversation}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button type="button" className={styles.iconButton} onClick={close} aria-label={copy.close} title={copy.close}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        {messages.length > 0 && contextHelp && !pending ? <aside className={styles.contextHelp} aria-label={contextHelp.tool} data-testid="assistant-context-help">
          <p>{contextHelp.tool}</p><div>{contextHelp.suggestions.map(suggestion => <button type="button" key={suggestion}
            onClick={() => { localEditRevisionRef.current++; setDraft(suggestion); composerRef.current?.focus(); }}>{suggestion}</button>)}</div>
        </aside> : null}
        <div ref={transcriptRef} className={styles.transcript} role="log" aria-label="iNr’Assistant" aria-live="polite" aria-relevant="additions text" aria-busy={pending}>
          {!messages.length ? <div className={styles.welcome}>
            <h3>{onboardingWelcome ? copy.onboardingGreeting : contextHelp?.tool || copy.prompt}</h3><p>{onboardingWelcome ? copy.onboardingMessage : copy.intro}</p>
            <div className={styles.suggestions} data-testid={contextHelp && !onboardingWelcome ? "assistant-context-help" : undefined}>{(onboardingWelcome ? [copy.onboardingConnect] : contextHelp?.suggestions || copy.suggestions).map((suggestion) => <button key={suggestion} type="button"
              onClick={() => { localEditRevisionRef.current++; setDraft(onboardingWelcome && suggestion === copy.onboardingConnect ? copy.onboardingRequest : suggestion); composerRef.current?.focus(); }}>{suggestion}<span aria-hidden="true">↗</span></button>)}</div>
          </div> : messages.map((message, index) => {
            const previous = messages[index - 1];
            const studioDraft = message.role === "assistant" ? message.studioDraft || (previous?.role === "user" ? deriveInrAssistantStudioDraft(previous.content, message.content) : null) : null;
            return <div key={index} className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`}>
            <span className={styles.speaker}>{message.role === "user" ? copy.you : "iNr’Assistant"}</span>
            {message.role === "assistant" ? <DashboardAssistantMessageContent content={message.content} onInternalNavigate={onInternalNavigate} /> : <p>{message.content}</p>}
            {message.taskProgress && (message.taskProgress.completed.length > 0 || message.taskProgress.remaining.length > 0) ? <section className={styles.taskProgress} aria-label={taskCopy.title} data-testid="assistant-task-progress" data-outcome={message.taskProgress.outcome}>
              <strong>{taskCopy.status[message.taskProgress.outcome]}</strong>
              {message.taskProgress.completed.length ? <><p>{taskCopy.confirmed}</p><ul>{message.taskProgress.completed.map(label => <li key={label}>✓ {label}</li>)}</ul></> : null}
              {message.taskProgress.remaining.length ? <><p>{taskCopy.remaining}</p><ul>{message.taskProgress.remaining.map(label => <li key={label}>{label}</li>)}</ul></> : null}
              {index === messages.length - 1 && ["partial", "processing"].includes(message.taskProgress.outcome) ? <button type="button" disabled={pending || files.busy || Boolean(draft.trim()) || files.attachments.length > 0} onClick={() => continueTask(message.taskProgress?.outcome === "processing")}>{message.taskProgress.outcome === "processing" ? taskCopy.check : taskCopy.continue}</button> : null}
            </section> : null}
            {message.attachments?.length ? <ul className={styles.sentAttachments}>{message.attachments.map(file => <li key={file.id}><span aria-hidden="true">📎</span> {file.name}</li>)}</ul> : null}
            {message.media ? <div className={styles.mediaResult} data-media-status={message.media.status}>
              {message.media.status === "completed" && message.media.url && message.media.mediaType ? message.media.mediaType === "image"
                ? <img src={message.media.url} alt={copy.mediaReady} loading="lazy" />
                : <video src={message.media.url} controls playsInline preload="metadata" aria-label={copy.mediaReady} /> : null}
              <p role={message.media.status === "processing" ? "status" : undefined}>{message.media.message || (message.media.status === "processing" ? copy.mediaProcessing : message.media.status === "failed" ? copy.mediaFailed : copy.mediaReady)}</p>
              {message.media.status === "completed" ? <button type="button" onClick={onOpenMediaLibrary}>{copy.mediaLibrary}<span aria-hidden="true">↗</span></button> : null}
            </div> : null}
            {studioDraft && onInsertStudioDraft ? <button type="button" className={styles.studioDraftButton} data-testid="assistant-studio-draft" disabled={pending || files.busy} onClick={() => void insertDraft(studioDraft, message)}>{studioDraft.mediaType === "video" ? copy.insertStudioVideo : copy.insertStudioImage}<span aria-hidden="true">↗</span></button> : null}
          </div>; })}
          {pending ? <div className={styles.pendingStatus}><p className={styles.pending} role="status"><span aria-hidden="true" />{copy.pending}</p>{!activities.length ? <p className={styles.pendingHint}>{copy.keepWorking}</p> : null}</div> : null}
          {activities.length ? <section className={styles.collaboration} aria-label={copy.collaboration} data-testid="assistant-collaboration">
            <button type="button" className={styles.collaborationHeading} aria-expanded={collaborationExpanded} aria-controls="inrcy-assistant-collaboration" onClick={() => setCollaborationExpanded(value => !value)}>
              {copy.collaboration}<svg viewBox="0 0 24 24" aria-hidden="true" data-expanded={collaborationExpanded}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <ul id="inrcy-assistant-collaboration" className={styles.collaborationList} hidden={!collaborationExpanded}>
              {activities.map(activity => {
                const agent = COLLABORATION_AGENTS[activity.agent];
                const status = activity.status === "running" && !pending ? copy.activityUnconfirmed : copy.activityStatuses[activity.status];
                return <li key={activity.id} data-activity-id={activity.id} data-state={activity.status} data-pending={pending}>
                  <Image src={agent.image} width={32} height={32} sizes="32px" alt="" draggable={false} />
                  <div className={styles.collaborationText}><p>{copy.collaborating} <strong>{agent.name}</strong></p><span>{activity.label}</span></div>
                  <span className={styles.activityStatus}>{status}</span>
                </li>;
              })}
            </ul>
          </section> : null}
          {error ? <div className={styles.error} role="alert"><p>{error}</p><div className={styles.errorActions}>{retryMessages ? <button type="button" onClick={() => void send(retryMessages)}>{copy.retry}</button> : null}</div></div> : null}
        </div>
        {handoffSummary ? <div className={styles.humanAction}><button type="button" onClick={prepareHumanContact}>{copy.human}<span aria-hidden="true">↗</span></button></div> : null}
        {memoryUnavailable ? <p className={styles.memoryNotice} role="status">{copy.historyUnavailable}</p> : null}
        {files.attachments.length || files.busy || files.error ? <div className={styles.attachmentTray}>
          {files.attachments.length ? <ul>{files.attachments.map(file => <li key={file.id}><span title={file.name}>{file.name}</span><button type="button" disabled={files.busy} aria-label={`${attachmentCopy.remove} ${file.name}`} onClick={() => files.setAttachments(current => current.filter(item => item.id !== file.id))}>×</button></li>)}</ul> : null}
          {files.busy ? <p role="status">{attachmentCopy.loading}</p> : null}
          {files.error ? <p role="alert">{files.error}</p> : null}
        </div> : null}
        <form className={styles.composer} onSubmit={submit}>
          <input hidden type="file" ref={files.inputRef} multiple accept={ASSISTANT_ATTACHMENT_ACCEPT} onChange={event => { const selected = Array.from(event.target.files || []); event.target.value = ""; if (selected.length) void files.addDevice(selected); }} />
          <textarea ref={composerRef} value={draft} onChange={(event) => { localEditRevisionRef.current++; setDraft(event.target.value); }}
            rows={2} maxLength={4000} aria-label={copy.placeholder} placeholder={copy.placeholder}
            enterKeyHint="send" onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(event); }
            }} />
          <div className={styles.composerActions}>
          {files.menuOpen ? <div className={styles.attachmentMenu} role="group" aria-label={attachmentCopy.attach}>
            <button type="button" onClick={files.selectDevice}>{attachmentCopy.device}</button>
            <button type="button" onClick={files.selectLibrary}>{attachmentCopy.library}</button>
            <small>{attachmentCopy.limits}</small>
          </div> : null}
          <button type="button" className={styles.attachButton} aria-label={attachmentCopy.attach} title={attachmentCopy.attach} aria-expanded={files.menuOpen} disabled={pending || files.busy || files.attachments.length >= ASSISTANT_ATTACHMENT_MAX_COUNT} onClick={() => files.setMenuOpen(value => !value)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2m-7 12 9-9" /></svg>
          </button>
          <button type="submit" className={styles.sendButton} aria-label={copy.send} title={copy.send} disabled={pending || files.busy || (!draft.trim() && !files.attachments.length)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" /></svg>
          </button>
          </div>
        </form>
        {files.libraryOpen ? createPortal(<div className={styles.pickerLayer}><MediaLibraryPickerModal open multiple maxSelection={ASSISTANT_ATTACHMENT_MAX_COUNT - files.attachments.length} title={attachmentCopy.library} confirmLabel={attachmentCopy.add} subtitle={attachmentCopy.limits}
          maxImageBytes={ASSISTANT_ATTACHMENT_MAX_BYTES} maxVideoBytes={ASSISTANT_ATTACHMENT_VIDEO_MAX_BYTES}
          getItemDisabledReason={item => Number(item.size_bytes) > (item.media_type === "video" ? ASSISTANT_ATTACHMENT_VIDEO_MAX_BYTES : ASSISTANT_ATTACHMENT_MAX_BYTES) ? attachmentCopy.limits : undefined}
          onClose={() => { files.setLibraryOpen(false); composerRef.current?.focus(); }}
          onConfirm={items => files.addLibrary(items.map(item => item.id))} /></div>, portalTarget || document.body) : null}
      </div>
    </dialog>, portalTarget || document.body) : null;
}

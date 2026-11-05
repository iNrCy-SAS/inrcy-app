"use client";

import { filterMetaPilotItems } from "@/lib/metaChannelUiAccess";
import { useTranslations } from "next-intl";
import {
  MODULE_SNAPSHOT_KEYS,
  readModuleSnapshot,
  writeModuleSnapshot,
} from "@/lib/browserModuleSnapshotCache";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PROFILE_VERSION_EVENT,
  type ProfileVersionChangeDetail,
} from "@/lib/profileVersioning";
import {
  MAILBOX_PAGE_SIZE,
  emptyFolderCounts,
  normalizeFolderCounts,
  type BoxView,
  type Folder,
  type FolderCounts,
  type OutboxItem,
} from "../_lib/mailboxPhase1";
import {
  MAILBOX_HISTORY_PREFETCH_CONCURRENCY,
  buildMailboxHistoryPreloadPlan,
  isMailboxHistorySnapshotFresh,
  mailboxHistoryContextKey,
  mailboxHistoryGroupKey,
  mailboxHistoryPageCount,
  mailboxHistoryPageKey,
  mailboxHistoryRefreshInterval,
  normalizeMailboxHistoryQuery,
  type MailboxHistoryContext,
  type MailboxHistorySnapshot,
} from "../_lib/mailboxHistoryPreload";

type InrSendDefaultSnapshot = {
  items: OutboxItem[];
  page: number;
  total: number | null;
  hasMore: boolean;
  folderCounts: FolderCounts;
  draftFolderCounts: FolderCounts;
};

const INRSEND_HISTORY_RECOVERY_THROTTLE_MS = 10_000;

const INRSEND_COUNTS_CACHE_MS = 30_000;

function mailboxHistoryCountsKey(context: MailboxHistoryContext) {
  return `account=${encodeURIComponent(context.filterAccountId)}|q=${encodeURIComponent(context.query)}`;
}

/** Owns history hydration, context guards, request deduplication and browser refresh subscriptions. */
export function useMailboxHistory({ metaPilotEnabled }: { metaPilotEnabled: boolean }) {
  const i18nT = useTranslations("mails");
  // Keep the server render and the first browser render identical. Reading
  // sessionStorage inside a state initializer made the server display `0`
  // while the hydrating client displayed `…`, forcing React to rebuild iNrSend.
  const [initialHistorySnapshot, setInitialHistorySnapshot] =
    useState<InrSendDefaultSnapshot | null>(null);

  const [historyCacheHydrated, setHistoryCacheHydrated] = useState(false);

  const [folder, setFolder] = useState<Folder>("publications");

  const [boxView, setBoxView] = useState<BoxView>("sent");

  const [items, setItems] = useState<OutboxItem[]>([]);

  const [loading, setLoading] = useState(true);

  const [historyLoadedOnce, setHistoryLoadedOnce] = useState(false);
  const [historyReadVersion, setHistoryReadVersion] = useState(0);

  const [historyCountsLoadedOnce, setHistoryCountsLoadedOnce] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [historyPage, setHistoryPage] = useState(1);

  const historyPageRef = useRef(1);

  const [historyHasMorePotential, setHistoryHasMorePotential] = useState(false);

  const [historyTotalCount, setHistoryTotalCount] = useState<number | null>(null);

  const [folderCounts, setFolderCounts] = useState<FolderCounts>(() =>
    emptyFolderCounts(),
  );

  const [draftFolderCounts, setDraftFolderCounts] = useState<FolderCounts>(() =>
    emptyFolderCounts(),
  );

  const historyCacheRef = useRef<Map<string, MailboxHistorySnapshot<OutboxItem>>>(new Map());

  const historyInFlightRef = useRef<Map<string, Promise<MailboxHistorySnapshot<OutboxItem> | null>>>(new Map());

  const historyCountsInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const historyCountsFetchedAtRef = useRef<Map<string, number>>(new Map());

  const historyCountsDisplayKeyRef = useRef("");

  const historyDisplayedContextKeyRef = useRef("");

  const historyLoadedContextKeyRef = useRef("");

  const historyPreloadGenerationRef = useRef(0);

  const historyPreloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onHistoryCacheHydration = useEffectEvent(() => {
    const snapshot =
      readModuleSnapshot<InrSendDefaultSnapshot>(
        MODULE_SNAPSHOT_KEYS.inrSendDefault,
      )?.data ?? null;
    setInitialHistorySnapshot(snapshot);
    if (snapshot) {
      const restoredItems = filterMetaPilotItems(Array.isArray(snapshot.items) ? snapshot.items : [], metaPilotEnabled);
      const restoredPage = Math.max(1, snapshot.page || 1);
      setItems(restoredItems);
      setLoading(false);
      setHistoryLoadedOnce(true);
      setSelectedId(restoredItems[0]?.id ?? null);
      setHistoryPage(restoredPage);
      historyPageRef.current = restoredPage;
      setHistoryHasMorePotential(Boolean(snapshot.hasMore));
      setHistoryTotalCount(snapshot.total ?? null);
      setFolderCounts(snapshot.folderCounts ?? emptyFolderCounts());
      setDraftFolderCounts(snapshot.draftFolderCounts ?? emptyFolderCounts());
      historyDisplayedContextKeyRef.current = mailboxHistoryContextKey({
        folder: "publications",
        boxView: "sent",
        filterAccountId: "",
        query: "",
      });
    }
    setHistoryCacheHydrated(true);
  });

  useEffect(() => {
    onHistoryCacheHydration();
  }, []);

  useEffect(() => {
    historyPageRef.current = historyPage;
  }, [historyPage]);

  const [filterAccountId, setFilterAccountId] = useState<string>("");

  // Recherche dans l'historique iNr'Send
  const [historyQuery, setHistoryQuery] = useState("");

  const [searchOpen, setSearchOpen] = useState(false);

  const historySearchRef = useRef<HTMLInputElement | null>(null);

  const activeHistoryContext = useMemo<MailboxHistoryContext>(() => ({
    folder,
    boxView,
    filterAccountId,
    query: normalizeMailboxHistoryQuery(historyQuery),
  }), [boxView, filterAccountId, folder, historyQuery]);

  const activeHistoryContextKey = useMemo(
    () => mailboxHistoryContextKey(activeHistoryContext),
    [activeHistoryContext],
  );

  const activeHistoryContextKeyRef = useRef(activeHistoryContextKey);

  const activeHistoryContextRef = useRef(activeHistoryContext);

  useLayoutEffect(() => {
    activeHistoryContextKeyRef.current = activeHistoryContextKey;
    activeHistoryContextRef.current = activeHistoryContext;
  }, [activeHistoryContext, activeHistoryContextKey]);

  useEffect(() => {
    if (!initialHistorySnapshot) return;
    const initialContext: MailboxHistoryContext = {
      folder: "publications",
      boxView: "sent",
      filterAccountId: "",
      query: "",
    };
    historyCacheRef.current.set(
      mailboxHistoryPageKey(initialContext, initialHistorySnapshot.page),
      {
        items: initialHistorySnapshot.items,
        page: initialHistorySnapshot.page,
        total: initialHistorySnapshot.total,
        hasMore: initialHistorySnapshot.hasMore,
        folderCounts: initialHistorySnapshot.folderCounts,
        draftFolderCounts: initialHistorySnapshot.draftFolderCounts,
        fetchedAt: Date.now(),
      },
    );
  }, [initialHistorySnapshot]);

  useEffect(() => () => {
    historyPreloadGenerationRef.current += 1;
    if (historyPreloadTimerRef.current) {
      clearTimeout(historyPreloadTimerRef.current);
      historyPreloadTimerRef.current = null;
    }
  }, []);

  const applyHistorySnapshot = useCallback((
    context: MailboxHistoryContext,
    snapshot: MailboxHistorySnapshot<OutboxItem>,
  ) => {
    const contextKey = mailboxHistoryContextKey(context);
    if (activeHistoryContextKeyRef.current !== contextKey) return false;

    setItems(filterMetaPilotItems(snapshot.items, metaPilotEnabled));
    setHistoryPage(snapshot.page);
    setHistoryHasMorePotential(snapshot.hasMore);
    setHistoryTotalCount(snapshot.total);
    if (snapshot.folderCounts) setFolderCounts(snapshot.folderCounts);
    if (snapshot.draftFolderCounts) setDraftFolderCounts(snapshot.draftFolderCounts);
    setSelectedId((previous) =>
      snapshot.items.some((item) => item.id === previous)
        ? previous
        : (snapshot.items[0]?.id ?? null),
    );
    historyDisplayedContextKeyRef.current = contextKey;
    setHistoryReadVersion(previous => previous + 1);

    const isDefaultSnapshot =
      snapshot.page === 1 &&
      context.folder === "publications" &&
      context.boxView === "sent" &&
      !context.filterAccountId &&
      !context.query;
    if (isDefaultSnapshot && snapshot.folderCounts && snapshot.draftFolderCounts) {
      writeModuleSnapshot<InrSendDefaultSnapshot>(MODULE_SNAPSHOT_KEYS.inrSendDefault, {
        items: snapshot.items,
        page: snapshot.page,
        total: snapshot.total,
        hasMore: snapshot.hasMore,
        folderCounts: snapshot.folderCounts,
        draftFolderCounts: snapshot.draftFolderCounts,
      });
    }

    return true;
  }, [metaPilotEnabled]);

  const fetchHistoryPage = useCallback(async (options: {
    context: MailboxHistoryContext;
    page: number;
    totalHint?: number | null;
    folderCountsHint?: FolderCounts;
    draftFolderCountsHint?: FolderCounts;
  }): Promise<MailboxHistorySnapshot<OutboxItem> | null> => {
    const targetPage = Math.max(1, Math.floor(options.page || 1));
    const pageKey = mailboxHistoryPageKey(options.context, targetPage);
    const requestKey = pageKey;
    const existingRequest = historyInFlightRef.current.get(requestKey);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      try {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        params.set("pageSize", String(MAILBOX_PAGE_SIZE));
        params.set("folder", options.context.folder);
        params.set("boxView", options.context.boxView);
        if (options.context.filterAccountId) {
          params.set("filterAccountId", options.context.filterAccountId);
        }
        if (options.context.query) params.set("q", options.context.query);
        params.set("includeCounts", "0");

        const response = await fetch(`/api/inrsend/history?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            payload?.error || i18nT("history_load_failed"),
          );
        }

        const nextItems = Array.isArray(payload?.items)
          ? filterMetaPilotItems(payload.items as OutboxItem[], metaPilotEnabled)
          : [];
        const nextPage = typeof payload?.page === "number"
          ? Math.max(1, Number(payload.page))
          : targetPage;
        const nextFolderCounts = payload?.folderCounts
          ? normalizeFolderCounts(payload.folderCounts)
          : options.folderCountsHint;
        const nextDraftFolderCounts = payload?.draftFolderCounts
          ? normalizeFolderCounts(payload.draftFolderCounts)
          : options.draftFolderCountsHint;
        const nextTotal = typeof payload?.total === "number"
          ? Math.max(0, Number(payload.total))
          : typeof options.totalHint === "number"
            ? Math.max(0, Number(options.totalHint))
            : null;
        const nextHasMore = nextTotal != null
          ? nextPage < mailboxHistoryPageCount(nextTotal, MAILBOX_PAGE_SIZE)
          : Boolean(payload?.hasMore);

        const snapshot: MailboxHistorySnapshot<OutboxItem> = {
          items: nextItems,
          page: nextPage,
          total: nextTotal,
          hasMore: nextHasMore,
          folderCounts: nextFolderCounts,
          draftFolderCounts: nextDraftFolderCounts,
          fetchedAt: Date.now(),
        };
        historyCacheRef.current.set(pageKey, snapshot);
        return snapshot;
      } catch (error) {
        console.error(error);
        return null;
      } finally {
        historyInFlightRef.current.delete(requestKey);
      }
    })();

    historyInFlightRef.current.set(requestKey, request);
    return request;
  }, [i18nT, metaPilotEnabled]);

  const loadHistoryCounts = useCallback(async (
    context: MailboxHistoryContext,
    options?: { force?: boolean },
  ) => {
    const countsKey = mailboxHistoryCountsKey(context);
    const now = Date.now();
    const lastFetchedAt = historyCountsFetchedAtRef.current.get(countsKey) || 0;
    if (
      !options?.force &&
      historyCountsDisplayKeyRef.current === countsKey &&
      now - lastFetchedAt < INRSEND_COUNTS_CACHE_MS
    ) {
      return true;
    }

    const existingRequest = historyCountsInFlightRef.current.get(countsKey);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      try {
        const params = new URLSearchParams();
        params.set("countsOnly", "1");
        params.set("folder", context.folder);
        params.set("boxView", context.boxView);
        if (context.filterAccountId) {
          params.set("filterAccountId", context.filterAccountId);
        }
        if (context.query) params.set("q", context.query);

        const response = await fetch(`/api/inrsend/history?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.countsIncluded !== true) return false;

        const nextFolderCounts = normalizeFolderCounts(payload.folderCounts);
        const nextDraftFolderCounts = normalizeFolderCounts(payload.draftFolderCounts);
        historyCountsFetchedAtRef.current.set(countsKey, Date.now());

        const currentContext = activeHistoryContextRef.current;
        if (mailboxHistoryCountsKey(currentContext) !== countsKey) return true;

        const activeCounts = currentContext.boxView === "drafts"
          ? nextDraftFolderCounts
          : nextFolderCounts;
        const nextTotal = Math.max(0, Number(activeCounts[currentContext.folder] || 0));
        setFolderCounts(nextFolderCounts);
        setDraftFolderCounts(nextDraftFolderCounts);
        setHistoryTotalCount(nextTotal);
        setHistoryHasMorePotential(
          historyPageRef.current < mailboxHistoryPageCount(nextTotal, MAILBOX_PAGE_SIZE),
        );
        setHistoryCountsLoadedOnce(true);
        historyCountsDisplayKeyRef.current = countsKey;

        const currentSnapshot = historyCacheRef.current.get(
          mailboxHistoryPageKey(currentContext, historyPageRef.current),
        );
        if (currentSnapshot) {
          const enrichedSnapshot = {
            ...currentSnapshot,
            total: nextTotal,
            hasMore:
              historyPageRef.current < mailboxHistoryPageCount(nextTotal, MAILBOX_PAGE_SIZE),
            folderCounts: nextFolderCounts,
            draftFolderCounts: nextDraftFolderCounts,
          };
          historyCacheRef.current.set(
            mailboxHistoryPageKey(currentContext, historyPageRef.current),
            enrichedSnapshot,
          );

          const isDefaultSnapshot =
            enrichedSnapshot.page === 1 &&
            currentContext.folder === "publications" &&
            currentContext.boxView === "sent" &&
            !currentContext.filterAccountId &&
            !currentContext.query;
          if (isDefaultSnapshot) {
            writeModuleSnapshot<InrSendDefaultSnapshot>(MODULE_SNAPSHOT_KEYS.inrSendDefault, {
              items: enrichedSnapshot.items,
              page: enrichedSnapshot.page,
              total: enrichedSnapshot.total,
              hasMore: enrichedSnapshot.hasMore,
              folderCounts: nextFolderCounts,
              draftFolderCounts: nextDraftFolderCounts,
            });
          }
        }

        return true;
      } catch (error) {
        console.error(error);
        return false;
      } finally {
        historyCountsInFlightRef.current.delete(countsKey);
      }
    })();

    historyCountsInFlightRef.current.set(countsKey, request);
    return request;
  }, []);

  const scheduleHistoryPreload = useCallback((
    context: MailboxHistoryContext,
    snapshot: MailboxHistorySnapshot<OutboxItem>,
  ) => {
    const availableFolderCounts = snapshot.folderCounts;
    const availableDraftFolderCounts = snapshot.draftFolderCounts;

    historyPreloadGenerationRef.current += 1;
    const generation = historyPreloadGenerationRef.current;
    if (historyPreloadTimerRef.current) {
      clearTimeout(historyPreloadTimerRef.current);
      historyPreloadTimerRef.current = null;
    }

    const plan = buildMailboxHistoryPreloadPlan({
      currentContext: context,
      currentPage: snapshot.page,
      pageSize: MAILBOX_PAGE_SIZE,
      currentTotal: snapshot.total,
      currentHasMore: snapshot.hasMore,
    }).filter((job) => {
      const cached = historyCacheRef.current.get(
        mailboxHistoryPageKey(job.context, job.page),
      );
      return !isMailboxHistorySnapshotFresh(cached);
    });

    if (!plan.length) return;

    historyPreloadTimerRef.current = setTimeout(() => {
      historyPreloadTimerRef.current = null;
      let cursor = 0;
      const worker = async () => {
        while (cursor < plan.length && generation === historyPreloadGenerationRef.current) {
          const job = plan[cursor];
          cursor += 1;
          const pageKey = mailboxHistoryPageKey(job.context, job.page);
          if (isMailboxHistorySnapshotFresh(historyCacheRef.current.get(pageKey))) {
            continue;
          }
          await fetchHistoryPage({
            context: job.context,
            page: job.page,
            totalHint: job.total,
            folderCountsHint: availableFolderCounts,
            draftFolderCountsHint: availableDraftFolderCounts,
          });
        }
      };

      void Promise.all(
        Array.from(
          { length: Math.min(MAILBOX_HISTORY_PREFETCH_CONCURRENCY, plan.length) },
          () => worker(),
        ),
      );
    }, 600);
  }, [fetchHistoryPage]);

  const loadHistory = useCallback(
    async (options?: { page?: number; silent?: boolean; force?: boolean }) => {
      const context = activeHistoryContext;
      const contextKey = mailboxHistoryContextKey(context);
      const countsKey = mailboxHistoryCountsKey(context);
      if (historyCountsDisplayKeyRef.current !== countsKey) {
        setHistoryCountsLoadedOnce(false);
      }
      const targetPage = Math.max(
        1,
        options?.page ?? historyPageRef.current ?? 1,
      );
      // Calls without options come from refresh buttons, mutations or external
      // version events. They deliberately bypass the cache.
      const force = options?.force ?? options === undefined;

      if (force) {
        historyPreloadGenerationRef.current += 1;
        const groupPrefix = `${mailboxHistoryGroupKey(context)}|`;
        for (const key of historyCacheRef.current.keys()) {
          if (key.startsWith(groupPrefix)) historyCacheRef.current.delete(key);
        }
      }

      const pageKey = mailboxHistoryPageKey(context, targetPage);
      const cached = force ? null : historyCacheRef.current.get(pageKey);
      if (isMailboxHistorySnapshotFresh(cached)) {
        applyHistorySnapshot(context, cached);
        setHistoryLoadedOnce(true);
        setLoading(false);
        scheduleHistoryPreload(context, cached);
        void loadHistoryCounts(context, { force });
        return cached;
      }

      const contextChanged =
        Boolean(historyDisplayedContextKeyRef.current) &&
        historyDisplayedContextKeyRef.current !== contextKey;
      if (contextChanged) {
        setItems([]);
        setSelectedId(null);
      }
      if (!options?.silent || contextChanged) setLoading(true);

      const snapshot = await fetchHistoryPage({
        context,
        page: targetPage,
      });

      if (snapshot) {
        applyHistorySnapshot(context, snapshot);
        scheduleHistoryPreload(context, snapshot);
        void loadHistoryCounts(context, { force });
      } else if (activeHistoryContextKeyRef.current === contextKey) {
        // A transient API error must never erase a previously visible history or
        // replace valid counters with zeros. Keep the last known UI state and let
        // the recovery refresh retry silently.
        if (!historyLoadedOnce && !initialHistorySnapshot) {
          setHistoryPage(targetPage);
          setHistoryHasMorePotential(false);
          setHistoryTotalCount(null);
          setSelectedId(null);
        }
      }

      if (activeHistoryContextKeyRef.current === contextKey) {
        setHistoryLoadedOnce(true);
        setLoading(false);
      }
      return snapshot;
    },
    [
      activeHistoryContext,
      applyHistorySnapshot,
      fetchHistoryPage,
      historyLoadedOnce,
      initialHistorySnapshot,
      loadHistoryCounts,
      scheduleHistoryPreload,
    ],
  );

  const filteredItems = items;

  const historyPageCount = useMemo(() => {
    if (historyTotalCount == null) {
      return Math.max(1, historyPage + (historyHasMorePotential ? 1 : 0));
    }
    return Math.max(1, Math.ceil(historyTotalCount / MAILBOX_PAGE_SIZE));
  }, [historyHasMorePotential, historyPage, historyTotalCount]);

  const visibleItems = filteredItems;

  // refresh des changements de filtres / recherche
  useEffect(() => {
    if (!historyCacheHydrated) return;
    if (historyLoadedContextKeyRef.current === activeHistoryContextKey) return;
    const isInitialContextLoad = historyLoadedContextKeyRef.current === "";
    historyLoadedContextKeyRef.current = activeHistoryContextKey;
    void loadHistory({
      page: 1,
      silent: isInitialContextLoad && Boolean(initialHistorySnapshot),
      // The cached snapshot makes navigation instant, but it can predate a
      // publication that just finished. Always revalidate the first visible
      // context once; later tab/search changes can still reuse their cache.
      force: isInitialContextLoad,
    });
  }, [
    activeHistoryContextKey,
    historyCacheHydrated,
    initialHistorySnapshot,
    loadHistory,
  ]);

  // UX recherche: Ctrl/Cmd+K pour ouvrir, Esc pour fermer (sans perdre la saisie)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const isK = key === "k";
      const isEsc = key === "escape" || key === "esc";

      if ((e.ctrlKey || e.metaKey) && isK) {
        e.preventDefault();
        setSearchOpen(true);
        // focus après rendu
        requestAnimationFrame(() => historySearchRef.current?.focus());
        return;
      }

      if (isEsc && searchOpen) {
        e.preventDefault();
        setSearchOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    requestAnimationFrame(() => historySearchRef.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (!(
        detail?.field === "inrsend_version" ||
        detail?.field === "docs_version" ||
        detail?.field === "publications_version"
      ))
        return;
      void loadHistory({ silent: true, force: true });
    };

    window.addEventListener(
      PROFILE_VERSION_EVENT,
      handleProfileVersionChange as EventListener,
    );
    return () => {
      window.removeEventListener(
        PROFILE_VERSION_EVENT,
        handleProfileVersionChange as EventListener,
      );
    };
  }, [loadHistory]);

  useEffect(() => {
    let lastRefreshAt = 0;
    let stopped = false;
    let recoveryTimer: number | null = null;

    const refreshVisibleHistory = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRefreshAt < INRSEND_HISTORY_RECOVERY_THROTTLE_MS) return;
      lastRefreshAt = now;
      void loadHistory({ silent: true, force: true });
    };

    const scheduleRecovery = () => {
      if (stopped) return;
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null;
        refreshVisibleHistory();
        scheduleRecovery();
      }, mailboxHistoryRefreshInterval({
        context: activeHistoryContext,
        items,
      }));
    };

    scheduleRecovery();
    const handleFocus = () => refreshVisibleHistory();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshVisibleHistory();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      if (recoveryTimer != null) window.clearTimeout(recoveryTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeHistoryContext, items, loadHistory]);

  return {
    folder,
    setFolder,
    boxView,
    setBoxView,
    items,
    setItems,
    loading,
    historyLoadedOnce,
    historyCountsLoadedOnce,
    selectedId,
    setSelectedId,
    historyPage,
    historyHasMorePotential,
    historyTotalCount,
    folderCounts,
    draftFolderCounts,
    filterAccountId,
    setFilterAccountId,
    historyQuery,
    setHistoryQuery,
    searchOpen,
    setSearchOpen,
    historySearchRef,
    loadHistory,
    filteredItems,
    historyPageCount,
    historyReadVersion,
    historyDisplayedContextKey: historyDisplayedContextKeyRef.current,
    visibleItems
  };
}

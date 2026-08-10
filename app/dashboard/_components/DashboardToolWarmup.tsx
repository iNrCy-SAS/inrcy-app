"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  MODULE_SNAPSHOT_KEYS,
  readFreshModuleSnapshot,
  writeModuleSnapshot,
} from "@/lib/browserModuleSnapshotCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { useDashboardEdition } from "./DashboardEditionProvider";

export const DASHBOARD_TOOL_WARMUP_EVENT = "inrcy:dashboard-tool-warmup";
export const DASHBOARD_PREFETCH_ATTRIBUTE = "data-dashboard-prefetch";

const ROUTES_TO_PREFETCH = [
  "/dashboard/stats",
  "/dashboard/propulser",
  "/dashboard/fideliser",
  "/dashboard/e-reputation",
  "/dashboard/mails",
  "/dashboard/crm",
  "/dashboard/agenda",
  "/dashboard/agent",
  "/dashboard/mediatheque",
  "/dashboard/gps",
  "/dashboard/factures",
  "/dashboard/devis",
] as const;

const STANDARD_ROUTES_TO_PREFETCH = [
  "/dashboard/agent",
  "/dashboard/stats",
  "/dashboard/e-reputation",
  "/dashboard/mails",
  "/dashboard/mediatheque",
  "/dashboard/gps",
] as const;

const SNAPSHOT_FRESHNESS_MS = 2 * 60 * 1000;
const MAX_CONCURRENT_WARMUPS = 2;

type WarmupTask = {
  key: string;
  priority: number;
  run: () => Promise<void> | void;
};

type WarmupEventDetail = { path?: string };

export function requestDashboardToolWarmup(path: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WarmupEventDetail>(DASHBOARD_TOOL_WARMUP_EVENT, {
      detail: { path },
    }),
  );
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function currentAgendaRange() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  const dayFromMonday = (gridStart.getDay() + 6) % 7;
  gridStart.setDate(gridStart.getDate() - dayFromMonday);
  gridStart.setHours(0, 0, 0, 0);

  const gridEnd = new Date(monthEnd);
  const dayToSunday = (7 - gridEnd.getDay()) % 7;
  gridEnd.setDate(gridEnd.getDate() + dayToSunday + 1);
  gridEnd.setHours(0, 0, 0, 0);

  return {
    year: now.getFullYear(),
    monthIndex: now.getMonth(),
    timeMin: gridStart.toISOString(),
    timeMax: gridEnd.toISOString(),
  };
}

function normalizedPath(path: string) {
  try {
    return new URL(path, window.location.origin).pathname;
  } catch {
    return path.split("?")[0] || path;
  }
}

export default function DashboardToolWarmup() {
  const router = useRouter();
  const edition = useDashboardEdition();
  const standardMode = edition === "standard";

  useEffect(() => {
    let cancelled = false;
    let activeCount = 0;
    let idleTimer: number | null = null;
    let idleCallbackId: number | null = null;
    const queued = new Map<string, WarmupTask>();
    const completed = new Set<string>();

    const pump = () => {
      if (cancelled) return;
      while (activeCount < MAX_CONCURRENT_WARMUPS && queued.size > 0) {
        const next = Array.from(queued.values()).sort(
          (left, right) => right.priority - left.priority,
        )[0];
        queued.delete(next.key);
        if (completed.has(next.key)) continue;
        activeCount += 1;
        void Promise.resolve()
          .then(next.run)
          .catch(() => undefined)
          .finally(() => {
            activeCount -= 1;
            completed.add(next.key);
            pump();
          });
      }
    };

    const enqueue = (task: WarmupTask) => {
      if (cancelled || completed.has(task.key)) return;
      const existing = queued.get(task.key);
      if (!existing || task.priority > existing.priority) queued.set(task.key, task);
      pump();
    };

    const prefetchRoute = (path: string, priority = 10) => {
      enqueue({
        key: `route:${path}`,
        priority,
        run: () => router.prefetch(path),
      });
    };

    const agendaRange = currentAgendaRange();
    const agendaKey = MODULE_SNAPSHOT_KEYS.agendaMonth(
      agendaRange.year,
      agendaRange.monthIndex,
    );

    const enqueueSnapshotForPath = (path: string, priority = 20) => {
      const pathname = normalizedPath(path);

      if (pathname === "/dashboard/crm") {
        enqueue({
          key: "snapshot:crm",
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(MODULE_SNAPSHOT_KEYS.crmDefault, SNAPSHOT_FRESHNESS_MS)) return;
            const data = await fetchJson("/api/crm/contacts?page=1&pageSize=20");
            if (data) writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.crmDefault, data);
          },
        });
      }

      if (pathname === "/dashboard/mails") {
        enqueue({
          key: "snapshot:inrsend",
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(MODULE_SNAPSHOT_KEYS.inrSendDefault, SNAPSHOT_FRESHNESS_MS)) return;
            const data = await fetchJson("/api/inrsend/history?page=1&pageSize=20&folder=publications&boxView=sent");
            if (data) writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.inrSendDefault, data);
          },
        });
      }

      if (pathname === "/dashboard/agenda") {
        enqueue({
          key: "snapshot:agenda-month",
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(agendaKey, SNAPSHOT_FRESHNESS_MS)) return;
            const params = new URLSearchParams({
              timeMin: agendaRange.timeMin,
              timeMax: agendaRange.timeMax,
            });
            const data = await fetchJson(`/api/calendar/events?${params.toString()}`);
            if (data?.ok) writeModuleSnapshot(agendaKey, data);
          },
        });
      }

      if (pathname === "/dashboard/propulser") {
        enqueue({
          key: "snapshot:propulser",
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(MODULE_SNAPSHOT_KEYS.propulserMetrics, SNAPSHOT_FRESHNESS_MS)) return;
            const [metrics, weeklySummary] = await Promise.all([
              fetchJson("/api/propulser/metrics?days=30"),
              fetchJson("/api/loyalty/weekly-summary"),
            ]);
            if (metrics || weeklySummary) {
              writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.propulserMetrics, { metrics, weeklySummary });
            }
          },
        });
      }

      if (pathname === "/dashboard/fideliser") {
        enqueue({
          key: "snapshot:fideliser",
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(MODULE_SNAPSHOT_KEYS.fideliserMetrics, SNAPSHOT_FRESHNESS_MS)) return;
            const [metrics, weeklySummary] = await Promise.all([
              fetchJson("/api/fideliser/metrics?days=30"),
              fetchJson("/api/loyalty/weekly-summary"),
            ]);
            if (metrics || weeklySummary) {
              writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.fideliserMetrics, { metrics, weeklySummary });
            }
          },
        });
      }

      if (pathname === "/dashboard/e-reputation") {
        enqueue({
          key: "snapshot:e-reputation",
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(MODULE_SNAPSHOT_KEYS.eReputationGoogle, 60_000)) return;
            const data = await fetchJson("/api/e-reputation/google/reviews?pageSize=50");
            if (data) writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.eReputationGoogle, data);
          },
        });
      }

      if (pathname === "/dashboard/mediatheque") {
        enqueue({
          key: "snapshot:media-library",
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(MODULE_SNAPSHOT_KEYS.mediaLibraryDefault, 90_000)) return;
            const data = await fetchJson("/api/media-library/items?limit=180&type=all&active=active");
            if (Array.isArray(data?.items)) {
              writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.mediaLibraryDefault, {
                items: data.items,
                stats: data.stats ?? {
                  total: data.items.length,
                  images: 0,
                  videos: 0,
                  total_bytes: 0,
                },
              });
            }
          },
        });
      }

      if (pathname === "/dashboard/agent") {
        enqueue({
          key: "snapshot:agent",
          priority,
          run: async () => {
            const { warmAgentRuntimeSnapshot } = await import("../agent/_hooks/useAgentRuntimeData");
            await warmAgentRuntimeSnapshot();
          },
        });
      }

      if (pathname === "/dashboard/factures" || pathname === "/dashboard/devis") {
        const type = pathname.endsWith("factures") ? "facture" : "devis";
        const key = type === "facture" ? MODULE_SNAPSHOT_KEYS.facturesList : MODULE_SNAPSHOT_KEYS.devisList;
        enqueue({
          key: `snapshot:${type}`,
          priority,
          run: async () => {
            if (readFreshModuleSnapshot(key, SNAPSHOT_FRESHNESS_MS)) return;
            const { fetchDocRecords } = await import("../_documents/docSaveStore");
            const docs = await fetchDocRecords(type);
            writeModuleSnapshot(key, { docs, storageMode: "supabase" as const });
          },
        });
      }
    };

    const prioritize = (path: string) => {
      if (!path || !path.startsWith("/dashboard")) return;
      if (
        standardMode &&
        !STANDARD_ROUTES_TO_PREFETCH.includes(normalizedPath(path) as (typeof STANDARD_ROUTES_TO_PREFETCH)[number])
      ) return;
      prefetchRoute(path, 100);
      enqueueSnapshotForPath(path, 90);
    };

    const routeFromTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return element?.closest<HTMLElement>(`[${DASHBOARD_PREFETCH_ATTRIBUTE}]`)?.getAttribute(DASHBOARD_PREFETCH_ATTRIBUTE) || "";
    };

    const onIntent = (event: Event) => {
      const path = routeFromTarget(event.target);
      if (path) prioritize(path);
    };
    const onExplicitWarmup = (event: Event) => {
      const path = (event as CustomEvent<WarmupEventDetail>).detail?.path;
      if (path) prioritize(path);
    };

    document.addEventListener("pointerover", onIntent, true);
    document.addEventListener("focusin", onIntent, true);
    document.addEventListener("pointerdown", onIntent, true);
    window.addEventListener(DASHBOARD_TOOL_WARMUP_EVENT, onExplicitWarmup as EventListener);

    const startProgressiveWarmup = () => {
      const routes = standardMode ? STANDARD_ROUTES_TO_PREFETCH : ROUTES_TO_PREFETCH;
      routes.forEach((route, index) => {
        prefetchRoute(route, 20 - Math.floor(index / 2));
      });

      // iNr'Send is the only data snapshot warmed without explicit intent. Its
      // first page is bounded and directly fixes the slow-open complaint. The
      // former six-tool sweep fired several Supabase history/metrics queries
      // 800 ms after every dashboard mount, even when those tools were never
      // opened. All other snapshots remain intent-first through pointer,
      // focus, click or the explicit warmup event above.
      enqueueSnapshotForPath("/dashboard/mails", 12);
    };

    const scheduleProgressiveWarmup = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if ("requestIdleCallback" in window) {
          idleCallbackId = window.requestIdleCallback(startProgressiveWarmup, { timeout: 2_500 });
        } else {
          startProgressiveWarmup();
        }
      }, 800);
    };

    const handleAccountChange = () => {
      completed.clear();
      queued.clear();
      scheduleProgressiveWarmup();
    };

    scheduleProgressiveWarmup();
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleAccountChange);

    return () => {
      cancelled = true;
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      if (idleCallbackId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
      queued.clear();
      document.removeEventListener("pointerover", onIntent, true);
      document.removeEventListener("focusin", onIntent, true);
      document.removeEventListener("pointerdown", onIntent, true);
      window.removeEventListener(DASHBOARD_TOOL_WARMUP_EVENT, onExplicitWarmup as EventListener);
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleAccountChange);
    };
  }, [router, standardMode]);

  return null;
}

"use client";
import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";
import { parseInrAssistantSendHistorySelection } from "@/lib/inrAssistantHistoryUiSelection";
import { mailboxHistoryContextKey, normalizeMailboxHistoryQuery } from "../mails/_lib/mailboxHistoryPreload";
import type { BoxView, OutboxItem } from "../mails/_lib/mailboxPhase1";

type Options = {
  enabled: boolean; query: string; boxView: BoxView; page: number; pageCount: number; filterAccountId: string;
  displayedContextKey: string; readVersion: number; loading: boolean; searchOpen: boolean;
  visibleItems: readonly OutboxItem[]; detailsOpen: boolean; detailsId: string | null; blocked: boolean;
  setQuery(value: string): void; clearSearch(): void; setSearchOpen(value: boolean): void; setBoxView(value: BoxView): void;
  loadHistory(options?: { page?: number; force?: boolean }): Promise<{ page: number; items: OutboxItem[] } | null>;
  openDetails(item: OutboxItem): void;
};
type Snapshot = { query: string; boxView: BoxView; page: number; displayedContextKey: string; readVersion: number; loading: boolean; searchOpen: boolean; visibleIds: string[]; detailsOpen: boolean; detailsId: string | null };
const asSnapshot = (value: unknown) => value && typeof value === "object" ? value as Snapshot : null;
const expectedKey = (options: Options, query = options.query, boxView = options.boxView) => mailboxHistoryContextKey({ folder: "publications", boxView, query: normalizeMailboxHistoryQuery(query), filterAccountId: options.filterAccountId });

/** These ports call only the native Publications reader and visible controls.
 * Snapshots stay local; IDs must occur in both the visible list and a fresh
 * account-scoped native response before a detail can be opened. */
export function useInrAssistantSendHistoryControls(options: Options) {
  const { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const pathname = usePathname(), scope = `${actorUserId}:${activeAccountId}:${pathname}`;
  const latest = useRef({ options, scope }), alive = useRef(false);
  useLayoutEffect(() => { latest.current = { options, scope }; });
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && latest.current.scope === scope && latest.current.options.enabled
    && latest.current.options.query === options.query && latest.current.options.boxView === options.boxView
    && latest.current.options.filterAccountId === options.filterAccountId && !latest.current.options.detailsOpen;
  const freshRead = async (page: number, stillCurrent: () => boolean) => {
    if (!stillCurrent()) throw new Error("History request is no longer current");
    const result = await options.loadHistory({ page, force: true });
    if (!stillCurrent() || !current() || !result || result.page !== page) throw new Error("History read was not verified");
    return result;
  };
  const snapshot: Snapshot = { query: options.query, boxView: options.boxView, page: options.page,
    displayedContextKey: options.displayedContextKey, readVersion: options.readVersion, loading: options.loading,
    searchOpen: options.searchOpen, visibleIds: options.visibleItems.map(item => item.id), detailsOpen: options.detailsOpen, detailsId: options.detailsId };
  const verified = (value: unknown, query = options.query, boxView = options.boxView) => {
    const result = asSnapshot(value);
    return !!result && !result.loading && result.query === query && result.boxView === boxView
      && result.displayedContextKey === expectedKey(options, query, boxView) && result.readVersion > options.readVersion;
  };
  useInrAssistantLocalInterface("send_history", snapshot, {
    open: { invoke: () => options.setSearchOpen(true), matches: value => asSnapshot(value)?.searchOpen === true },
    close: { invoke: () => options.setSearchOpen(false), matches: value => asSnapshot(value)?.searchOpen === false },
    search: {
      async invoke(value, stillCurrent) {
        if (!stillCurrent()) throw new Error("History request is no longer current");
        if (typeof value !== "string" || value.length > 200) throw new Error("Invalid history search");
        if (value) options.setQuery(value); else options.clearSearch();
        options.setSearchOpen(true);
        if (value === options.query) await freshRead(1, stillCurrent);
      },
      matches: (value, query) => typeof query === "string" && verified(value, query) && asSnapshot(value)?.searchOpen === true,
    },
    retry: { invoke: async (_value, stillCurrent) => { await freshRead(options.page, stillCurrent); }, matches: value => verified(value) },
    select: {
      async invoke(value, stillCurrent) {
        if (!stillCurrent()) throw new Error("History request is no longer current");
        const selected = parseInrAssistantSendHistorySelection(value);
        if (!selected) throw new Error("Invalid history selection");
        if (selected.field === "boxView") {
          options.setBoxView(selected.value);
          if (selected.value === options.boxView) await freshRead(1, stillCurrent);
          return;
        }
        if (selected.field === "page") {
          const page = selected.value === "previous" ? options.page - 1 : selected.value === "next" ? options.page + 1 : selected.value;
          if (page < 1 || page > options.pageCount || page > 100) throw new Error("Unavailable history page");
          await freshRead(page, stillCurrent); return;
        }
        const visible = options.visibleItems.find(item => item.id === selected.value && item.folder === "publications");
        if (!visible) throw new Error("History item is not visible");
        const result = await freshRead(options.page, stillCurrent);
        const owned = result.items.find(item => item.id === visible.id && item.folder === "publications");
        if (!owned || !latest.current.options.visibleItems.some(item => item.id === owned.id)) throw new Error("History item is no longer visible");
        options.openDetails(owned);
      },
      matches(value, input) {
        const selected = parseInrAssistantSendHistorySelection(input), result = asSnapshot(value);
        if (!selected || !result) return false;
        if (selected.field === "boxView") return verified(value, options.query, selected.value);
        if (selected.field === "page") {
          const page = selected.value === "previous" ? options.page - 1 : selected.value === "next" ? options.page + 1 : selected.value;
          return verified(value) && result.page === page;
        }
        return verified(value) && result.detailsOpen && result.detailsId === selected.value && result.visibleIds.includes(selected.value);
      },
    },
  }, options.enabled, options.blocked || options.loading || options.detailsOpen || !options.readVersion || options.displayedContextKey !== expectedKey(options));
}

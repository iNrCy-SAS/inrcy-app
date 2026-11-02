"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_PAGE_SIZE } from "./crm.shared";
import type { Category, ContactType, CrmContact } from "./crm.types";

type MutableRef<T> = { current: T | null };
type ValueRef<T> = { current: T };
type SetState<T> = Dispatch<SetStateAction<T>>;

type LoadContactsOptions = {
  page?: number;
  pageSize?: number;
  query?: string;
  preserveSuccess?: boolean;
  append?: boolean;
  silent?: boolean;
};

type LoadContacts = (options?: LoadContactsOptions) => Promise<unknown>;

export function useCrmContactLifecycleEffects({
  query,
  setServerQuery,
  pageSize,
  serverQuery,
  categoryFilter,
  typeFilter,
  departmentFilter,
  importantOnly,
  setExpandedMobileContactId,
  setPage,
  isResponsive,
  mobileAppendNextRef,
  page,
  loadContacts,
  mergeContactWithLocalState,
  setContacts,
  selectedContactIds,
  setSelectedContactsById,
  contacts,
  initialSnapshotAvailable,
}: {
  query: string;
  setServerQuery: SetState<string>;
  pageSize: number;
  serverQuery: string;
  categoryFilter: Category;
  typeFilter: ContactType;
  departmentFilter: string;
  importantOnly: boolean;
  setExpandedMobileContactId: SetState<string | null>;
  setPage: SetState<number>;
  isResponsive: boolean;
  mobileAppendNextRef: ValueRef<boolean>;
  page: number;
  loadContacts: LoadContacts;
  mergeContactWithLocalState: (contact: CrmContact) => CrmContact;
  setContacts: SetState<CrmContact[]>;
  selectedContactIds: Set<string>;
  setSelectedContactsById: SetState<Record<string, CrmContact>>;
  contacts: CrmContact[];
  initialSnapshotAvailable: boolean;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setServerQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, setServerQuery]);

  useEffect(() => {
    mobileAppendNextRef.current = false;
    setExpandedMobileContactId(null);
    setPage(1);
  }, [pageSize, serverQuery, categoryFilter, typeFilter, departmentFilter, importantOnly, mobileAppendNextRef, setExpandedMobileContactId, setPage]);

  useEffect(() => {
    const append = isResponsive && mobileAppendNextRef.current && page > 1;
    void loadContacts({
      page,
      pageSize,
      query: serverQuery,
      append,
      preserveSuccess: append || page > 1,
      silent: initialSnapshotAvailable && page === 1 && !append,
    });
    mobileAppendNextRef.current = false;
  }, [
    isResponsive,
    loadContacts,
    page,
    pageSize,
    serverQuery,
    categoryFilter,
    typeFilter,
    departmentFilter,
    importantOnly,
    initialSnapshotAvailable,
    mobileAppendNextRef,
  ]);

  useEffect(() => {
    // Keep derived fields in sync when local ⭐ important / notes change
    setContacts((prev) => prev.map((c) => mergeContactWithLocalState(c)));
    setSelectedContactsById((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Record<string, CrmContact> = {};
      for (const [id, contact] of Object.entries(prev)) {
        next[id] = mergeContactWithLocalState(contact);
      }
      return next;
    });
  }, [mergeContactWithLocalState, setContacts, setSelectedContactsById]);

  useEffect(() => {
    if (contacts.length === 0 || selectedContactIds.size === 0) return;
    setSelectedContactsById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const contact of contacts) {
        if (!selectedContactIds.has(contact.id)) continue;
        next[contact.id] = contact;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [contacts, selectedContactIds, setSelectedContactsById]);
}

export function useCrmFloatingUiEffects({
  actionsOpen,
  actionsRef,
  setActionsOpen,
  statsRef,
  setStatsOpen,
  exportOpen,
  exportRef,
  setExportOpen,
  headerSearchOpen,
  headerSearchRef,
  headerSearchInputRef,
  setHeaderSearchOpen,
  desktopFiltersOpen,
  desktopFiltersRef,
  setDesktopFiltersOpen,
  isResponsive,
  setMobileFiltersOpen,
  setExpandedMobileContactId,
}: {
  actionsOpen: boolean;
  actionsRef: MutableRef<HTMLDivElement>;
  setActionsOpen: SetState<boolean>;
  statsRef: MutableRef<HTMLDivElement>;
  setStatsOpen: SetState<boolean>;
  exportOpen: boolean;
  exportRef: MutableRef<HTMLDivElement>;
  setExportOpen: SetState<boolean>;
  headerSearchOpen: boolean;
  headerSearchRef: MutableRef<HTMLDivElement>;
  headerSearchInputRef: MutableRef<HTMLInputElement>;
  setHeaderSearchOpen: SetState<boolean>;
  desktopFiltersOpen: boolean;
  desktopFiltersRef: MutableRef<HTMLDivElement>;
  setDesktopFiltersOpen: SetState<boolean>;
  isResponsive: boolean;
  setMobileFiltersOpen: SetState<boolean>;
  setExpandedMobileContactId: SetState<string | null>;
}) {
  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = actionsRef.current;
      if (!el) return;
      if (el.contains(e.target as any)) return;
      setActionsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [actionsOpen, actionsRef, setActionsOpen]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = statsRef.current;
      if (!el) return;
      if (el.contains(e.target as any)) return;
      setStatsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [statsRef, setStatsOpen]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = exportRef.current;
      if (!el) return;
      if (el.contains(e.target as any)) return;
      setExportOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [exportOpen, exportRef, setExportOpen]);

  useEffect(() => {
    if (!headerSearchOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = headerSearchRef.current;
      if (!el) return;
      if (el.contains(e.target as any)) return;
      setHeaderSearchOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [headerSearchOpen, headerSearchRef, setHeaderSearchOpen]);

  useEffect(() => {
    if (!desktopFiltersOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = desktopFiltersRef.current;
      if (!el) return;
      if (el.contains(e.target as any)) return;
      setDesktopFiltersOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [desktopFiltersOpen, desktopFiltersRef, setDesktopFiltersOpen]);

  useEffect(() => {
    if (!headerSearchOpen) return;
    const timer = window.setTimeout(() => {
      headerSearchInputRef.current?.focus();
      headerSearchInputRef.current?.select();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [headerSearchOpen, headerSearchInputRef]);

  useEffect(() => {
    if (isResponsive) return;
    setHeaderSearchOpen(false);
    setMobileFiltersOpen(false);
    setExpandedMobileContactId(null);
  }, [isResponsive, setHeaderSearchOpen, setMobileFiltersOpen, setExpandedMobileContactId]);

  useEffect(() => {
    if (isResponsive) {
      setDesktopFiltersOpen(false);
    } else {
      setHeaderSearchOpen(false);
    }
  }, [isResponsive, setDesktopFiltersOpen, setHeaderSearchOpen]);
}

export function useCrmTableViewportEffects({
  isResponsive,
  loading,
  page,
  pageSize,
  visibleContactsLength,
  showDesktopEmptyMessage,
  tableWrapRef,
  setDesktopRowHeight,
  mobileLoadMoreRef,
  contactsLength,
  total,
  pageCount,
  mobileAppendNextRef,
  setPage,
}: {
  isResponsive: boolean;
  loading: boolean;
  page: number;
  pageSize: number;
  visibleContactsLength: number;
  showDesktopEmptyMessage: boolean;
  tableWrapRef: MutableRef<HTMLDivElement>;
  setDesktopRowHeight: SetState<number>;
  mobileLoadMoreRef: MutableRef<HTMLDivElement>;
  contactsLength: number;
  total: number;
  pageCount: number;
  mobileAppendNextRef: ValueRef<boolean>;
  setPage: SetState<number>;
}) {
  const visibleContacts = { length: visibleContactsLength };
  const contacts = { length: contactsLength };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isResponsive) return;

    const el = tableWrapRef.current;
    if (!el) return;

    const HEADER_HEIGHT = 34;

    const recompute = () => {
      const wrapHeight = el.clientHeight || 0;
      if (wrapHeight <= HEADER_HEIGHT) return;
      const next = Math.max(18, Math.floor((wrapHeight - HEADER_HEIGHT - 2) / DEFAULT_PAGE_SIZE));
      setDesktopRowHeight((prev) => (prev === next ? prev : next));
    };

    const raf = window.requestAnimationFrame(recompute);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(recompute) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", recompute);

    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [isResponsive, loading, page, pageSize, visibleContacts.length, showDesktopEmptyMessage, tableWrapRef, setDesktopRowHeight]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isResponsive) return;

    const sentinel = mobileLoadMoreRef.current;
    if (!sentinel) return;

    const root = tableWrapRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (loading) return;
        if (contacts.length >= total) return;
        if (mobileAppendNextRef.current) return;

        mobileAppendNextRef.current = true;
        setPage((prev) => (prev >= pageCount ? prev : prev + 1));
      },
      {
        root,
        rootMargin: "220px 0px 220px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isResponsive, loading, contacts.length, total, pageCount, mobileLoadMoreRef, tableWrapRef, mobileAppendNextRef, setPage]);
}

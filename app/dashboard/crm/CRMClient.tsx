"use client";

import { useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./crm.module.css";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";
import HelpModal from "../_components/HelpModal";
import CRMContactModal from "./_components/CRMContactModal";
import CRMContactsView from "./_components/CRMContactsView";
import CRMHeader from "./_components/CRMHeader";
import CRMPagination from "./_components/CRMPagination";
import CRMToolbar from "./_components/CRMToolbar";
import {
  buildDisplayName,
  CATEGORY_LABEL,
  DEFAULT_PAGE_SIZE,
  emptyDraft,
  parseDisplayName,
  TYPE_LABEL,
} from "./crm.shared";
import type { Category, ContactType, CrmContact, CrmSummary } from "./crm.types";
import { createCrmNavigationActions, useCrmImportExportActions } from "./crm.client-actions";
import {
  useCrmContactLifecycleEffects,
  useCrmFloatingUiEffects,
  useCrmTableViewportEffects,
} from "./crm.client-hooks";
import { hasAccountingDashboardAccess } from "@/lib/dashboardEdition";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";

type CrmDefaultSnapshot = {
  contacts?: CrmContact[];
  total?: number;
  page?: number;
  pageSize?: number;
  pageCount?: number;
  summary?: Partial<CrmSummary>;
};

function readInitialCrmSnapshot(): CrmDefaultSnapshot | null {
  const snapshot = readModuleSnapshot<CrmDefaultSnapshot>(MODULE_SNAPSHOT_KEYS.crmDefault);
  return snapshot?.data && Array.isArray(snapshot.data.contacts) ? snapshot.data : null;
}

export default function CRMClient() {
  const i18nT = useTranslations("crm");
  const dashboardEdition = useDashboardEdition();
  const documentsEnabled = hasAccountingDashboardAccess(dashboardEdition);
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const [initialSnapshot] = useState<CrmDefaultSnapshot | null>(() => readInitialCrmSnapshot());

  // Toujours arriver en haut du module (évite de récupérer le scroll du dashboard)
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo(0, 0);
  }, []);

  // --- Responsive (table & layout) ---
  const [isResponsive, setIsResponsive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 760px)");
    const update = () => setIsResponsive(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateCompactUi = () => setIsCompactUi(window.innerWidth <= 980 || window.innerHeight <= 560);
    updateCompactUi();
    window.addEventListener("resize", updateCompactUi);
    return () => window.removeEventListener("resize", updateCompactUi);
  }, []);


  // Orientation: gérée globalement via <OrientationGuard />

  const [loading, setLoading] = useState(() => !initialSnapshot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [contacts, setContacts] = useState<CrmContact[]>(() => (initialSnapshot?.contacts ?? []) as CrmContact[]);
  const [total, setTotal] = useState(() => Number(initialSnapshot?.total ?? 0));
  const [page, setPage] = useState(() => Math.max(1, Number(initialSnapshot?.page ?? 1)));
  const [pageSize, setPageSize] = useState<number>(() => Number(initialSnapshot?.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE);
  const [pageCount, setPageCount] = useState(() => Math.max(1, Number(initialSnapshot?.pageCount ?? 1)));
  const [kpis, setKpis] = useState<CrmSummary>(() => ({
    total: Number(initialSnapshot?.summary?.total ?? initialSnapshot?.total ?? 0),
    prospects: Number(initialSnapshot?.summary?.prospects ?? 0),
    clients: Number(initialSnapshot?.summary?.clients ?? 0),
    partenaires: Number(initialSnapshot?.summary?.partenaires ?? 0),
    fournisseurs: Number(initialSnapshot?.summary?.fournisseurs ?? 0),
    autres: Number(initialSnapshot?.summary?.autres ?? 0),
  }));
  const [query, setQuery] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  const requestSeqRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  // Mobile UI
  const [addOpen, setAddOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const headerSearchRef = useRef<HTMLDivElement | null>(null);
  const headerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const desktopFiltersRef = useRef<HTMLDivElement | null>(null);
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<Category>("");
  const [typeFilter, setTypeFilter] = useState<ContactType>("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const mobileAppendNextRef = useRef(false);
  const mobileLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [isCompactUi, setIsCompactUi] = useState(false);
  const [desktopRowHeight, setDesktopRowHeight] = useState(30);
  const [importing, setImporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"" | "csv" | "xlsx">("");

  // ✅ Sélection multi-contacts (pour actions : mail, etc.)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(() => new Set());
  const [selectedContactsById, setSelectedContactsById] = useState<Record<string, CrmContact>>({});
  const [importantIds, setImportantIds] = useState<Set<string>>(() => {
    try {
      const raw = readAccountCacheValue("inrcy_crm_important_ids");
      const ids = raw ? JSON.parse(raw) : [];
      return new Set<string>(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  });
  const [notesById, setNotesById] = useState<Record<string, string>>(() => {
    try {
      const raw = readAccountCacheValue("inrcy_crm_notes_by_id");
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
    } catch {
      return {};
    }
  });

  const [draft, setDraft] = useState<ReturnType<typeof emptyDraft>>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedMobileContactId, setExpandedMobileContactId] = useState<string | null>(null);
  const [contactNavigationBusy, setContactNavigationBusy] = useState(false);

  const mergeContactWithLocalState = useCallback(
    (contact: CrmContact): CrmContact => ({
      ...contact,
      notes: (contact?.notes ?? notesById?.[contact.id] ?? "") as string,
      important: Boolean(contact?.important || importantIds.has(contact.id)),
    }),
    [importantIds, notesById],
  );

  const loadContacts = useCallback(
    async (options?: {
      page?: number;
      pageSize?: number;
      query?: string;
      preserveSuccess?: boolean;
      append?: boolean;
      silent?: boolean;
    }) => {
      const targetPage = Math.max(1, options?.page ?? page);
      const targetPageSize = options?.pageSize ?? pageSize;
      const targetQuery = options?.query ?? serverQuery;
      const requestId = ++requestSeqRef.current;

      if (!options?.silent) setLoading(true);
      setError(null);
      if (!options?.preserveSuccess) setSuccess(null);

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(targetPageSize),
        });
        if (targetQuery) params.set("q", targetQuery);
        if (categoryFilter) params.set("category", categoryFilter);
        if (typeFilter) params.set("contactType", typeFilter);
        if (departmentFilter.trim()) params.set("department", departmentFilter.trim());
        if (importantOnly) params.set("important", "1");

        const r = await fetch(`/api/crm/contacts?${params.toString()}`, { method: "GET" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de charger les contacts du CRM."));
        if (requestId !== requestSeqRef.current) return;

        const nextTotal = typeof j?.total === "number" ? j.total : 0;
        const nextPageCount = Math.max(1, typeof j?.pageCount === "number" ? j.pageCount : 1);
        const safePage = Math.min(targetPage, nextPageCount);

        if (targetPage > nextPageCount && nextTotal > 0) {
          setPage(safePage);
          return;
        }

        const base = Array.isArray(j?.contacts) ? j.contacts : [];
        const merged: CrmContact[] = base.map((c: CrmContact) => mergeContactWithLocalState(c));

        setContacts((prev: CrmContact[]) => {
          if (!options?.append) return merged;
          const known = new Set(prev.map((contact: CrmContact) => contact.id));
          return [...prev, ...merged.filter((contact: CrmContact) => !known.has(contact.id))];
        });
        setTotal(nextTotal);
        setPage(safePage);
        setPageSize(typeof j?.pageSize === "number" ? j.pageSize : targetPageSize);
        setPageCount(nextPageCount);
        const nextSummary: CrmSummary = {
          total: Number(j?.summary?.total ?? nextTotal ?? 0),
          prospects: Number(j?.summary?.prospects ?? 0),
          clients: Number(j?.summary?.clients ?? 0),
          partenaires: Number(j?.summary?.partenaires ?? 0),
          fournisseurs: Number(j?.summary?.fournisseurs ?? 0),
          autres: Number(j?.summary?.autres ?? 0),
        };
        setKpis(nextSummary);

        const isDefaultSnapshot = targetPage === 1 && !targetQuery && !categoryFilter && !typeFilter && !departmentFilter.trim() && !importantOnly;
        if (isDefaultSnapshot) {
          writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.crmDefault, {
            contacts: merged,
            total: nextTotal,
            page: safePage,
            pageSize: typeof j?.pageSize === "number" ? j.pageSize : targetPageSize,
            pageCount: nextPageCount,
            summary: nextSummary,
          });
        }

        return { contacts: merged, total: nextTotal, page: safePage, pageSize: targetPageSize, pageCount: nextPageCount, summary: nextSummary };
      } catch (e: any) {
        if (requestId !== requestSeqRef.current) return;
        setError(getSimpleFrenchErrorMessage(e, "Impossible de charger les contacts du CRM."));
        return null;
      } finally {
        if (requestId === requestSeqRef.current) setLoading(false);
      }
    },
    [
      mergeContactWithLocalState,
      page,
      pageSize,
      serverQuery,
      categoryFilter,
      typeFilter,
      departmentFilter,
      importantOnly,
    ],
  );

  useCrmContactLifecycleEffects({
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
    initialSnapshotAvailable: Boolean(initialSnapshot),
  });

  useCrmFloatingUiEffects({
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
  });

  const selectedContacts = useMemo(() => {
    if (selectedContactIds.size === 0) return [] as CrmContact[];
    return Array.from(selectedContactIds)
      .map((id) => selectedContactsById[id])
      .filter(Boolean) as CrmContact[];
  }, [selectedContactIds, selectedContactsById]);

  const editingContact = useMemo(() => {
    if (!editingId) return null as CrmContact | null;
    return contacts.find((c) => c.id === editingId) ?? selectedContactsById[editingId] ?? null;
  }, [contacts, editingId, selectedContactsById]);

  const primaryContact = useMemo(() => {
    // Priority: clicked contact (editing panel), else single selected contact
    if (editingContact) return editingContact;
    if (selectedContacts.length === 1) return selectedContacts[0];
    return null;
  }, [editingContact, selectedContacts]);

  const visibleContacts = contacts;
  const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((c) => selectedContactIds.has(c.id));
  const activeFiltersCount = [categoryFilter, typeFilter, departmentFilter.trim(), importantOnly ? "important" : ""]
    .filter(Boolean)
    .length;
  const hasActiveSearchOrFilters = Boolean(query.trim()) || activeFiltersCount > 0;
  const emptyMessage = hasActiveSearchOrFilters
    ? "Aucun contact trouvé avec ces critères."
    : "Aucun contact pour le moment.";
  const showDesktopEmptyMessage = visibleContacts.length === 0 && !loading;
  const desktopPlaceholderRowCount = Math.max(0, pageSize - visibleContacts.length - (showDesktopEmptyMessage ? 1 : 0));
  const desktopPlaceholderRows = Array.from({ length: desktopPlaceholderRowCount });
  const mobileHasMore = isResponsive && contacts.length < total;
  const activeFilterChips = [
    categoryFilter ? `Catégorie : ${CATEGORY_LABEL[categoryFilter as Exclude<Category, "">]}` : "",
    typeFilter ? `Type : ${TYPE_LABEL[typeFilter as Exclude<ContactType, "">]}` : "",
    departmentFilter.trim() ? `Département : ${departmentFilter.trim()}` : "",
    importantOnly ? "Important" : "",
  ].filter(Boolean);

  useCrmTableViewportEffects({
    isResponsive,
    loading,
    page,
    pageSize,
    visibleContactsLength: visibleContacts.length,
    showDesktopEmptyMessage,
    tableWrapRef,
    setDesktopRowHeight,
    mobileLoadMoreRef,
    contactsLength: contacts.length,
    total,
    pageCount,
    mobileAppendNextRef,
    setPage,
  });

  const selectedEmails = useMemo(() => {
    const emails = selectedContacts
      .map((c) => (c.email || "").trim())
      .filter(Boolean);
    // unique
    return Array.from(new Set(emails));
  }, [selectedContacts]);

  const actionEmails = useMemo(() => {
    if (selectedEmails.length > 0) return selectedEmails;
    const em = (primaryContact?.email || "").trim();
    return em ? [em] : [];
  }, [selectedEmails, primaryContact]);

  const actionRecipients = useMemo(() => {
    const source = selectedContacts.length > 0 ? selectedContacts : primaryContact ? [primaryContact] : [];
    const seen = new Set<string>();
    return source
      .map((contact) => {
        const email = (contact.email || "").trim();
        if (!email) return null;
        const lower = email.toLowerCase();
        if (seen.has(lower)) return null;
        seen.add(lower);
        return {
          email,
          contact_id: contact.id,
          display_name: buildDisplayName(contact) || null,
        };
      })
      .filter(Boolean) as Array<{ email: string; contact_id: string; display_name: string | null }>;
  }, [selectedContacts, primaryContact]);


  const toggleSelect = (id: string) => {
    const contact = visibleContacts.find((item) => item.id === id) ?? selectedContactsById[id];
    const isSelected = selectedContactIds.has(id);

    setSelectedContactIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

    setSelectedContactsById((prev) => {
      const next = { ...prev };
      if (isSelected) delete next[id];
      else if (contact) next[id] = contact;
      return next;
    });
  };

  const clearSelection = useCallback(() => {
    setSelectedContactIds(new Set());
    setSelectedContactsById({});
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedContactIds((prev) => {
      const next = new Set<string>(prev);
      visibleContacts.forEach((contact) => next.add(contact.id));
      return next;
    });

    setSelectedContactsById((prev) => {
      const next = { ...prev };
      visibleContacts.forEach((contact) => {
        next[contact.id] = contact;
      });
      return next;
    });
  }, [visibleContacts]);

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedContactIds((prev) => {
        const next = new Set<string>(prev);
        visibleContacts.forEach((contact) => next.delete(contact.id));
        return next;
      });

      setSelectedContactsById((prev) => {
        const next = { ...prev };
        visibleContacts.forEach((contact) => {
          delete next[contact.id];
        });
        return next;
      });
      return;
    }

    selectAllVisible();
  };


  const persistImportant = (next: Set<string>) => {
    try {
      writeAccountCacheValue("inrcy_crm_important_ids", JSON.stringify(Array.from(next)));
    } catch {}
  };

  const persistNotes = (next: Record<string, string>) => {
    try {
      writeAccountCacheValue("inrcy_crm_notes_by_id", JSON.stringify(next));
    } catch {}
  };

  const toggleImportant = (id: string) => {
    // Source of truth: the backend `important` boolean.
    // We still keep the local storage set for backward compatibility, but UI prefers `contact.important`.
    const current = contacts.find((c) => c.id === id);
    const nextImportant = !Boolean(current?.important || importantIds.has(id));

    // Optimistic UI update
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, important: nextImportant } : c)));
    setImportantIds((prev) => {
      const next = new Set<string>(prev);
      if (nextImportant) next.add(id);
      else next.delete(id);
      persistImportant(next);
      return next;
    });

    fetch("/api/crm/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, important: nextImportant }),
    }).catch(() => {
      // Revert on network error
      setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, important: !nextImportant } : c)));
      setImportantIds((prev) => {
        const next = new Set<string>(prev);
        if (!nextImportant) next.add(id);
        else next.delete(id);
        persistImportant(next);
        return next;
      });
    });
  };

  const setNoteForId = (id: string, note: string) => {
    setNotesById((prev) => {
      const next = { ...prev, [id]: note };
      persistNotes(next);
      return next;
    });
  };


  const { handleImportFile, triggerImport, exportCsv, exportExcel } = useCrmImportExportActions({
    fileInputRef,
    setImporting,
    setError,
    setSuccess,
    setPage,
    loadContacts,
    serverQuery,
    categoryFilter,
    typeFilter,
    departmentFilter,
    importantOnly,
    mergeContactWithLocalState,
    setExportingFormat,
  });

  const { sendMailToAction, sendMailToContact, goNewDevis, goNewFacture, goPlanifierIntervention } =
    createCrmNavigationActions({
      router,
      actionRecipients,
      actionEmails,
      primaryContact,
    });

  function startNew() {
    setEditingId(null);
    setExpandedMobileContactId(null);
    setDraft(emptyDraft());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEdit(c: CrmContact) {
    setEditingId(c.id);
    setDraft({
      display_name: buildDisplayName(c),
      siret: (c.siret ?? "") as string,
      email: (c.email ?? "") as string,
      phone: (c.phone ?? "") as string,
      address: (c.address ?? "") as string,
      billing_address: (c.billing_address ?? "") as string,
      delivery_address: (c.delivery_address ?? "") as string,
      vat_number: (c.vat_number ?? "") as string,
      city: (c.city ?? "") as string,
      postal_code: (c.postal_code ?? "") as string,
      // ✅ évite le warning React (uncontrolled -> controlled)
      category: ((c.category as any) ?? "") as Category,
      contact_type: ((c.contact_type as any) ?? "") as ContactType,
      notes: ((c.notes as any) ?? "") as string,
      important: Boolean((c as any).important ?? importantIds.has(c.id)),
    });
    setAddOpen(true);
    try {
      if (window.matchMedia("(max-width: 900px)").matches) {
        return;
      }
    } catch {}

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const editingContactIndex = editingId ? contacts.findIndex((contact) => contact.id === editingId) : -1;
  const responsiveListContainsPreviousPages = isResponsive && contacts.length > pageSize;
  const contactListIsSinglePageWindow = !isResponsive || !responsiveListContainsPreviousPages;
  const editingContactPosition = editingContactIndex >= 0
    ? contactListIsSinglePageWindow
      ? (page - 1) * pageSize + editingContactIndex + 1
      : editingContactIndex + 1
    : 0;
  const contactNavigationLabel = editingContactPosition > 0 ? `${editingContactPosition} / ${Math.max(total, editingContactPosition)}` : "";
  const canNavigatePreviousContact = Boolean(editingId) && (
    editingContactIndex > 0 || (contactListIsSinglePageWindow && page > 1)
  );
  const canNavigateNextContact = Boolean(editingId) && (
    editingContactIndex >= 0 && editingContactIndex < contacts.length - 1
      ? true
      : page < pageCount || contacts.length < total
  );

  const navigateEditingContact = useCallback(async (direction: -1 | 1) => {
    if (!editingId || contactNavigationBusy) return;
    const currentIndex = contacts.findIndex((contact) => contact.id === editingId);
    if (currentIndex < 0) return;

    const localTarget = contacts[currentIndex + direction];
    if (localTarget) {
      startEdit(localTarget);
      return;
    }

    const targetPage = page + direction;
    if (targetPage < 1 || targetPage > pageCount) return;

    setContactNavigationBusy(true);
    try {
      const result = await loadContacts({
        page: targetPage,
        pageSize,
        query: serverQuery,
        preserveSuccess: true,
        append: false,
        silent: true,
      });
      const nextContacts = result && typeof result === "object" && "contacts" in result
        ? (result.contacts as CrmContact[])
        : [];
      const target = direction > 0 ? nextContacts[0] : nextContacts[nextContacts.length - 1];
      if (target) startEdit(target);
    } finally {
      setContactNavigationBusy(false);
    }
  }, [contactNavigationBusy, contacts, editingId, loadContacts, page, pageCount, pageSize, serverQuery]);

  const deliverySameAsPrimary = !String(draft.delivery_address || "").trim() || String(draft.delivery_address || "").trim() === String(draft.address || "").trim();

  function updatePrimaryAddress(value: string) {
    setDraft((current) => {
      const previousAddress = String(current.address || "").trim();
      const previousDelivery = String(current.delivery_address || "").trim();
      const linked = !previousDelivery || previousDelivery === previousAddress;
      return {
        ...current,
        address: value,
        delivery_address: linked ? value : current.delivery_address,
      };
    });
  }

  function setDeliverySameAsPrimary(checked: boolean) {
    setDraft((current) => ({
      ...current,
      delivery_address: checked ? String(current.address || "") : "",
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);

    const { last_name, first_name, company_name } = parseDisplayName(draft.display_name);

    const payload = {
      // champ unique
      display_name: draft.display_name.trim(),

      // champs legacy (en attendant Supabase)
      last_name,
      first_name,
      company_name,

      // autres champs
      siret: (draft.siret || "").trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      billing_address: (draft.billing_address || draft.address || "").trim(),
      delivery_address: (draft.delivery_address || "").trim(),
      vat_number: (draft.vat_number || "").trim(),
      city: (draft.city || "").trim(),
      postal_code: (draft.postal_code || "").trim(),
      category: draft.category,
      contact_type: draft.contact_type,
      notes: (draft.notes || "").trim(),
      important: Boolean(draft.important),
    };

    try {
      const r = await fetch("/api/crm/contacts", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible d'enregistrer."));
      const nextPage = isResponsive ? 1 : editingId ? page : 1;
      if (nextPage === 1) setPage(1);
      await loadContacts({ page: nextPage, preserveSuccess: true });
      // If editing, persist ⭐ + notes locally (works even if backend doesn't store it yet)
      if (editingId) {
        setNoteForId(editingId, (draft.notes || "").trim());
        if (draft.important) {
          setImportantIds((prev) => {
            const next = new Set<string>(prev);
            next.add(editingId);
            persistImportant(next);
            return next;
          });
        } else {
          setImportantIds((prev) => {
            const next = new Set<string>(prev);
            next.delete(editingId);
            persistImportant(next);
            return next;
          });
        }
      }
      startNew();
      setAddOpen(false);
      setSuccess(editingId ? "Contact mis à jour." : "Contact ajouté.");
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, editingId ? "Impossible de mettre à jour ce contact." : "Impossible d’ajouter ce contact."));
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (selectedContactIds.size === 0) return;
    const n = selectedContactIds.size;
    const ok = await confirmInrcy({
      title: n > 1 ? "Supprimer les contacts ?" : "Supprimer le contact ?",
      message: i18nT("cette_action_supprimera_definitivement_value_con_9ecfd7cf", { value0: n, value1: n > 1 ? "s" : "" }),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      variant: "danger",
    });
    if (!ok) return;

    setSaving(true);
    setError(null);
    try {
      const ids = Array.from(selectedContactIds) as string[];
      // Suppression en parallèle (API actuelle : 1 id par requête)
      await Promise.all(
        ids.map(async (id) => {
          const r = await fetch(`/api/crm/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de supprimer."));
        })
      );

      // reload + reset states
      const targetReloadPage = isResponsive ? 1 : page;
      if (targetReloadPage === 1) setPage(1);
      await loadContacts({ page: targetReloadPage, preserveSuccess: true });
      setSelectedContactIds(new Set());
      setSelectedContactsById({});
      if (editingId && ids.includes(editingId)) startNew();
      setSuccess(n > 1 ? "Contacts supprimés." : "Contact supprimé.");
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, n > 1 ? "Impossible de supprimer les contacts sélectionnés." : "Impossible de supprimer ce contact."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const ok = await confirmInrcy({
      title: i18nT("supprimer_le_contact_81399390"),
      message: i18nT("cette_action_supprimera_definitivement_ce_contac_cac6d970"),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      variant: "danger",
    });
    if (!ok) return;

    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/crm/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de supprimer."));
      const targetReloadPage = isResponsive ? 1 : page;
      if (targetReloadPage === 1) setPage(1);
      await loadContacts({ page: targetReloadPage, preserveSuccess: true });
      setSelectedContactIds((prev) => {
        const next = new Set<string>(prev);
        next.delete(id);
        return next;
      });
      setSelectedContactsById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (editingId === id) startNew();
      setSuccess(i18nT("contact_supprime_fd4c9d21"));
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, "Impossible de supprimer ce contact."));
    } finally {
      setSaving(false);
    }
  }

  const statsValue = (value: number) => (loading && contacts.length === 0 ? "…" : value);
  const statsItems = [
    { label: i18nT("contacts_b0dd615c"), value: statsValue(kpis.total) },
    { label: i18nT("prospects_8f522b12"), value: statsValue(kpis.prospects) },
    { label: i18nT("clients_28e22fe3"), value: statsValue(kpis.clients) },
    { label: i18nT("partenaires_e56efd6d"), value: statsValue(kpis.partenaires) },
    { label: i18nT("fournisseurs_06b6d88c"), value: statsValue(kpis.fournisseurs) },
    { label: i18nT("autres_2f0dd042"), value: statsValue(kpis.autres) },
  ];

  const openAddModal = () => setAddOpen(true);

  const toggleDraftImportant = () => {
    if (editingId) toggleImportant(editingId);
    setDraft((s) => ({ ...s, important: !s.important }));
  };

  return (
    <div
      className={styles.shell}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest(`.${styles.card}`)) return;
        startNew();
      }}
    >
      <CRMHeader
        isResponsive={isResponsive}
        isCompactUi={isCompactUi}
        saving={saving}
        importing={importing}
        loading={loading}
        total={total}
        exportingFormat={exportingFormat}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        statsOpen={statsOpen}
        setStatsOpen={setStatsOpen}
        headerSearchOpen={headerSearchOpen}
        setHeaderSearchOpen={setHeaderSearchOpen}
        setHelpOpen={setHelpOpen}
        query={query}
        setQuery={setQuery}
        triggerImport={triggerImport}
        exportExcel={exportExcel}
        exportCsv={exportCsv}
        startNew={startNew}
        openAddModal={openAddModal}
        statsItems={statsItems}
        exportRef={exportRef}
        statsRef={statsRef}
        headerSearchRef={headerSearchRef}
        headerSearchInputRef={headerSearchInputRef}
        onCloseDashboard={() => router.push("/dashboard")}
      />

      <HelpModal open={helpOpen} title={i18nT("inr_crm_010c9ef1")} onClose={() => setHelpOpen(false)}>
        <p style={{ marginTop: 0 }}>{i18nT("inr_crm_centralise_tous_vos_contacts_3afc3d01")}</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>{i18nT("ajoutez_et_enregistrez_vos_contacts_prospects_0668b259")}</li>
          <li>{i18nT("classez_et_retrouvez_rapidement_vos_informations_f86675a7")}</li>
          <li>{i18nT("suivez_vos_opportunites_et_organisez_vos_3def31a2")}</li>
        </ul>
      </HelpModal>

      <CRMContactModal
        open={addOpen}
        error={error}
        isResponsive={isResponsive}
        editingId={editingId}
        draft={draft}
        setDraft={setDraft}
        saving={saving}
        deliverySameAsPrimary={deliverySameAsPrimary}
        setDeliverySameAsPrimary={setDeliverySameAsPrimary}
        updatePrimaryAddress={updatePrimaryAddress}
        onToggleImportant={toggleDraftImportant}
        onClose={() => setAddOpen(false)}
        onSave={save}
        navigationLabel={contactNavigationLabel}
        navigationBusy={contactNavigationBusy}
        canNavigatePrevious={canNavigatePreviousContact}
        canNavigateNext={canNavigateNextContact}
        onNavigatePrevious={() => navigateEditingContact(-1)}
        onNavigateNext={() => navigateEditingContact(1)}
      />

      <section className={`${styles.card} ${styles.tableCard} ${styles.crmBoardCard}`} onClick={(e) => e.stopPropagation()}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.xlsx,.xls,text/csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await handleImportFile(f);
            } catch (err: any) {
              setError(getSimpleFrenchErrorMessage(err, "Import impossible."));
              setImporting(false);
            }
          }}
        />

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <CRMToolbar
          documentsEnabled={documentsEnabled}
          isResponsive={isResponsive}
          saving={saving}
          importing={importing}
          selectedCount={selectedContactIds.size}
          visibleContacts={visibleContacts}
          actionsOpen={actionsOpen}
          setActionsOpen={setActionsOpen}
          mobileFiltersOpen={mobileFiltersOpen}
          setMobileFiltersOpen={setMobileFiltersOpen}
          desktopFiltersOpen={desktopFiltersOpen}
          setDesktopFiltersOpen={setDesktopFiltersOpen}
          activeFiltersCount={activeFiltersCount}
          activeFilterChips={activeFilterChips}
          actionEmails={actionEmails}
          primaryContact={primaryContact}
          clearSelection={clearSelection}
          selectAllVisible={selectAllVisible}
          removeSelected={removeSelected}
          sendMailToAction={sendMailToAction}
          goNewDevis={goNewDevis}
          goNewFacture={goNewFacture}
          goPlanifierIntervention={goPlanifierIntervention}
          actionsRef={actionsRef}
          desktopFiltersRef={desktopFiltersRef}
          query={query}
          setQuery={setQuery}
          pageSize={pageSize}
          setPage={setPage}
          setPageSize={setPageSize}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          departmentFilter={departmentFilter}
          setDepartmentFilter={setDepartmentFilter}
          importantOnly={importantOnly}
          setImportantOnly={setImportantOnly}
        />

        {loading && !(isResponsive && page > 1) ? <div className={styles.muted}>{i18nT("chargement_a209b664")}</div> : null}

        <div className={styles.tableWrap} ref={tableWrapRef}>
          <CRMContactsView
            documentsEnabled={documentsEnabled}
            isResponsive={isResponsive}
            visibleContacts={visibleContacts}
            emptyMessage={emptyMessage}
            selectedContactIds={selectedContactIds}
            expandedMobileContactId={expandedMobileContactId}
            setExpandedMobileContactId={setExpandedMobileContactId}
            toggleSelect={toggleSelect}
            sendMailToContact={sendMailToContact}
            goPlanifierIntervention={goPlanifierIntervention}
            goNewDevis={goNewDevis}
            goNewFacture={goNewFacture}
            startEdit={startEdit}
            toggleImportant={toggleImportant}
            remove={remove}
            mobileLoadMoreRef={mobileLoadMoreRef}
            loading={loading}
            page={page}
            mobileHasMore={mobileHasMore}
            allVisibleSelected={allVisibleSelected}
            toggleSelectAllVisible={toggleSelectAllVisible}
            showDesktopEmptyMessage={showDesktopEmptyMessage}
            desktopRowHeight={desktopRowHeight}
            desktopPlaceholderRows={desktopPlaceholderRows}
          />
        </div>

        <CRMPagination
          isResponsive={isResponsive}
          total={total}
          visibleCount={visibleContacts.length}
          page={page}
          pageSize={pageSize}
          pageCount={pageCount}
          loading={loading}
          setPage={setPage}
        />
      </section>
    </div>
  );
}

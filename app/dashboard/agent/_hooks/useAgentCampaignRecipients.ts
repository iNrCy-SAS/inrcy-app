"use client";

import { useMemo, useState, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import type { RecipientsPickerModal } from "../_components/AgentCampaignEditors";
import type { AgentPreparedAction, AutomationKey, CampaignRecipientPreview, CrmContactForAgent } from "../_lib/agent.types";
import type { AgentTranslator } from "../_lib/agent.i18n";
import { firstSafeString } from "../_lib/agent.utils";
import { recipientsForAction, contactDisplayName, contactToCampaignRecipient, parseRecipientEmails, sanitizeDepartmentFilter, contactDepartment, manualRecipientFromEmail } from "../_lib/agent.campaign-preview";

type Options = {
  selectedPreparedAction: AgentPreparedAction | null;
  selectedKey: AutomationKey;
  campaignSaveState: "idle" | "saving";
  setCampaignSaveState: Dispatch<SetStateAction<"idle" | "saving">>;
  patchCampaignAction: (body: Record<string, unknown>, fallbackError: string) => Promise<AgentPreparedAction>;
  i18nT: AgentTranslator;
  showNotice: (message: string) => void;
  onOpen: () => void;
};

/** Owns recipient draft, filtering and CRM mutations for the Agent campaign editor. */
export function useAgentCampaignRecipients({ selectedPreparedAction, selectedKey, campaignSaveState, setCampaignSaveState, patchCampaignAction, i18nT, showNotice, onOpen }: Options) {
  const [recipientsEditOpen, setRecipientsEditOpen] = useState(false);
  const [crmContacts, setCrmContacts] = useState<CrmContactForAgent[]>([]);
  const [crmContactsLoading, setCrmContactsLoading] = useState(false);
  const [crmRecipientSearch, setCrmRecipientSearch] = useState("");
  const [crmRecipientFiltersOpen, setCrmRecipientFiltersOpen] = useState(false);
  const [crmRecipientCategory, setCrmRecipientCategory] = useState("all");
  const [crmRecipientType, setCrmRecipientType] = useState("all");
  const [crmRecipientDepartment, setCrmRecipientDepartment] = useState("");
  const [crmRecipientImportantOnly, setCrmRecipientImportantOnly] =
    useState(false);
  const [manualRecipientsInput, setManualRecipientsInput] = useState("");
  const [selectedRecipientEmails, setSelectedRecipientEmails] = useState<
    string[]
  >([]);
  const [newRecipientOpen, setNewRecipientOpen] = useState(false);
  const [newRecipientDraft, setNewRecipientDraft] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [newRecipientState, setNewRecipientState] = useState<"idle" | "saving">(
    "idle"
  );

  const campaignRecipients = recipientsForAction(selectedPreparedAction);
  const filteredCrmContacts = useMemo(() => {
    const q = crmRecipientSearch.trim().toLowerCase();
    const department = sanitizeDepartmentFilter(crmRecipientDepartment);
    return crmContacts.filter((contact) => {
      if (!firstSafeString(contact.email)) return false;
      if (crmRecipientImportantOnly && !contact.important) return false;
      if (
        crmRecipientCategory !== "all" &&
        firstSafeString(contact.category).toLowerCase() !== crmRecipientCategory
      )
        return false;
      if (
        crmRecipientType !== "all" &&
        firstSafeString(contact.contact_type).toLowerCase() !== crmRecipientType
      )
        return false;
      if (
        department &&
        !contactDepartment(contact.postal_code).startsWith(department)
      )
        return false;
      if (!q) return true;
      return [
        contactDisplayName(contact),
        contact.email,
        contact.phone,
        contact.company_name,
        contact.city,
        contact.postal_code,
        contact.contact_type,
        contact.category,
      ]
        .map((value) => firstSafeString(value).toLowerCase())
        .some((value) => value.includes(q));
    });
  }, [
    crmContacts,
    crmRecipientCategory,
    crmRecipientDepartment,
    crmRecipientImportantOnly,
    crmRecipientSearch,
    crmRecipientType,
  ]);
  const crmRecipientsByEmail = useMemo(() => {
    return new Map(
      crmContacts
        .map((contact) => contactToCampaignRecipient(contact))
        .filter((recipient): recipient is CampaignRecipientPreview =>
          Boolean(recipient)
        )
        .map((recipient) => [recipient.email.toLowerCase(), recipient])
    );
  }, [crmContacts]);
  const manualSelectedRecipientEmails = useMemo(() => {
    return selectedRecipientEmails.filter(
      (email) => !crmRecipientsByEmail.has(email.toLowerCase())
    );
  }, [crmRecipientsByEmail, selectedRecipientEmails]);
  const filteredCrmRecipientEmails = useMemo(() => {
    return filteredCrmContacts
      .map((contact) =>
        contactToCampaignRecipient(contact)?.email.toLowerCase()
      )
      .filter((email): email is string => Boolean(email));
  }, [filteredCrmContacts]);
  const filteredCrmSelectedCount = useMemo(() => {
    const selected = new Set(
      selectedRecipientEmails.map((email) => email.toLowerCase())
    );
    return filteredCrmRecipientEmails.filter((email) => selected.has(email))
      .length;
  }, [filteredCrmRecipientEmails, selectedRecipientEmails]);
  const filteredCrmAllSelected =
    filteredCrmRecipientEmails.length > 0 &&
    filteredCrmSelectedCount === filteredCrmRecipientEmails.length;
  const activeCrmRecipientFiltersCount =
    (crmRecipientCategory !== "all" ? 1 : 0) +
    (crmRecipientType !== "all" ? 1 : 0) +
    (crmRecipientDepartment.trim() ? 1 : 0) +
    (crmRecipientImportantOnly ? 1 : 0);
  async function loadCrmContactsForAgent() {
    setCrmContactsLoading(true);
    try {
      const response = await fetch("/api/crm/contacts?all=1&pageSize=500", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        contacts?: CrmContactForAgent[];
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || "Contacts CRM indisponibles.");
      setCrmContacts(Array.isArray(payload?.contacts) ? payload.contacts : []);
    } catch {
      showNotice(i18nT("crm_contacts_unavailable"));
    } finally {
      setCrmContactsLoading(false);
    }
  }

  async function openRecipientsEditor() {
    const currentRecipients = recipientsForAction(selectedPreparedAction);
    setSelectedRecipientEmails(
      currentRecipients.map((recipient) => recipient.email.toLowerCase())
    );
    onOpen();
    setRecipientsEditOpen(true);
    setCrmRecipientSearch("");
    setManualRecipientsInput("");
    setCrmRecipientFiltersOpen(false);
    await loadCrmContactsForAgent();
  }

  function toggleRecipientSelection(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    if (!email) return;
    setSelectedRecipientEmails((current) =>
      current.includes(email)
        ? current.filter((item) => item !== email)
        : [...current, email]
    );
  }

  function addManualRecipientsFromInput() {
    const emails = parseRecipientEmails(manualRecipientsInput);
    if (!emails.length) {
      showNotice(i18nT("valid_email_required"));
      return;
    }
    setSelectedRecipientEmails((current) => {
      const next = new Set(current.map((email) => email.toLowerCase()));
      for (const email of emails) next.add(email);
      return Array.from(next);
    });
    setManualRecipientsInput("");
    showNotice(i18nT("recipients_added", { count: emails.length }));
  }

  function selectAllFilteredCrmRecipients() {
    const emails = filteredCrmContacts
      .map((contact) =>
        contactToCampaignRecipient(contact)?.email.toLowerCase()
      )
      .filter((email): email is string => Boolean(email));
    setSelectedRecipientEmails((current) => {
      const next = new Set(current.map((email) => email.toLowerCase()));
      for (const email of emails) next.add(email);
      return Array.from(next);
    });
  }

  function clearFilteredCrmRecipients() {
    const emailsToRemove = new Set(
      filteredCrmContacts
        .map((contact) =>
          contactToCampaignRecipient(contact)?.email.toLowerCase()
        )
        .filter((email): email is string => Boolean(email))
    );
    setSelectedRecipientEmails((current) =>
      current.filter((email) => !emailsToRemove.has(email.toLowerCase()))
    );
  }

  function toggleFilteredCrmRecipients() {
    if (filteredCrmAllSelected) {
      clearFilteredCrmRecipients();
      return;
    }
    selectAllFilteredCrmRecipients();
  }

  function removeSelectedRecipient(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    setSelectedRecipientEmails((current) =>
      current.filter((item) => item.toLowerCase() !== email)
    );
  }

  async function saveCampaignRecipients() {
    if (!selectedPreparedAction || campaignSaveState === "saving") return;
    const previousByEmail = new Map(
      campaignRecipients.map((recipient) => [
        recipient.email.toLowerCase(),
        recipient,
      ])
    );
    const pendingManualEmails = parseRecipientEmails(manualRecipientsInput);
    const emails = Array.from(
      new Set([
        ...selectedRecipientEmails.map((email) => email.toLowerCase()),
        ...pendingManualEmails,
      ])
    );
    const recipients = emails
      .map(
        (email) =>
          crmRecipientsByEmail.get(email) ||
          previousByEmail.get(email) ||
          manualRecipientFromEmail(email)
      )
      .filter((recipient): recipient is CampaignRecipientPreview =>
        Boolean(recipient)
      );

    if (!recipients.length) {
      showNotice(i18nT("recipient_required"));
      return;
    }

    setCampaignSaveState("saving");
    try {
      await patchCampaignAction(
        { editType: "campaign_recipients", recipients },
        i18nT("campaign_recipients_update_failed")
      );
      setRecipientsEditOpen(false);
      setManualRecipientsInput("");
      showNotice(i18nT("campaign_recipients_updated"));
    } catch {
      showNotice(i18nT("campaign_recipients_update_failed"));
    } finally {
      setCampaignSaveState("idle");
    }
  }

  async function addNewRecipientToCrm() {
    if (newRecipientState === "saving") return;
    const email = newRecipientDraft.email.trim().toLowerCase();
    const name = newRecipientDraft.name.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
      showNotice(i18nT("email_required"));
      return;
    }

    setNewRecipientState("saving");
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name || email,
          email,
          phone: newRecipientDraft.phone.trim(),
          category: "professionnel",
          contact_type: selectedKey === "loyalty" ? "client" : "prospect",
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || i18nT("crm_contact_add_failed"));
      await loadCrmContactsForAgent();
      setSelectedRecipientEmails((current) =>
        current.includes(email) ? current : [...current, email]
      );
      setNewRecipientDraft({ name: "", email: "", phone: "" });
      setNewRecipientOpen(false);
      showNotice(i18nT("crm_contact_added"));
    } catch {
      showNotice(i18nT("crm_contact_add_failed"));
    } finally {
      setNewRecipientState("idle");
    }
  }


  const pickerProps: Omit<ComponentProps<typeof RecipientsPickerModal>, "preview"> = {
    open: recipientsEditOpen,
    manualRecipientsInput: manualRecipientsInput,
    manualSelectedRecipientEmails: manualSelectedRecipientEmails,
    crmSearch: crmRecipientSearch,
    filtersOpen: crmRecipientFiltersOpen,
    activeFiltersCount: activeCrmRecipientFiltersCount,
    category: crmRecipientCategory,
    contactType: crmRecipientType,
    department: crmRecipientDepartment,
    importantOnly: crmRecipientImportantOnly,
    filteredContacts: filteredCrmContacts,
    filteredAllSelected: filteredCrmAllSelected,
    contactsLoading: crmContactsLoading,
    selectedRecipientEmails: selectedRecipientEmails,
    newRecipientOpen: newRecipientOpen,
    newRecipientDraft: newRecipientDraft,
    newRecipientState: newRecipientState,
    saveState: campaignSaveState,
    onClose: () => setRecipientsEditOpen(false),
    onManualRecipientsChange: setManualRecipientsInput,
    onAddManualRecipients: addManualRecipientsFromInput,
    onRemoveSelectedRecipient: removeSelectedRecipient,
    onSearchChange: setCrmRecipientSearch,
    onToggleFilters: () =>
          setCrmRecipientFiltersOpen((current) => !current),
    onToggleFiltered: toggleFilteredCrmRecipients,
    onToggleNewRecipient: () => setNewRecipientOpen((current) => !current),
    onCategoryChange: setCrmRecipientCategory,
    onContactTypeChange: setCrmRecipientType,
    onDepartmentChange: (value) =>
          setCrmRecipientDepartment(sanitizeDepartmentFilter(value)),
    onToggleImportantOnly: () =>
          setCrmRecipientImportantOnly((current) => !current),
    onNewRecipientNameChange: (name) =>
          setNewRecipientDraft((current) => ({ ...current, name })),
    onNewRecipientEmailChange: (email) =>
          setNewRecipientDraft((current) => ({ ...current, email })),
    onAddNewRecipient: addNewRecipientToCrm,
    onToggleRecipient: toggleRecipientSelection,
    onSave: saveCampaignRecipients,
  };
  return { isOpen: recipientsEditOpen, open: openRecipientsEditor, close: () => setRecipientsEditOpen(false), pickerProps };
}

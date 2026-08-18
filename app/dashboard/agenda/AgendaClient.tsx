"use client";

import { useTranslations } from "next-intl";


import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./agenda.module.css";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";
import {
  addDays,
  buildCrmDisplayName,
  buildIso,
  buildQuarterHourOptions,
  composeAddressLine,
  endOfMonth,
  getContactOptionLabel,
  isDraftEvent,
  endOfWeekSunday,
  isDateOnly,
  keyOf,
  parseCrmDisplayName,
  parseDateOnly,
  startOfMonth,
  startOfWeekMonday,
  toDateOnly,
  type ContactCategory,
  type ContactPayload,
  type ContactType,
  type CrmContact,
  type DayEvent,
  type EventItem,
  type GuestContactForm,
  type MailAccountOption,
  type RdvKind,
  type RdvMode,
} from "./agenda.shared";
import { AgendaCalendarCard, AgendaEventModal, AgendaHeader, AgendaSidebar } from "./agenda.ui";


function normalizeCompareValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeCompareValue(item));
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const item = normalizeCompareValue(input[key]);
      if (item === undefined || item === "") continue;
      output[key] = item;
    }
    return output;
  }
  if (typeof value === "string") return value.trim();
  return value ?? null;
}


function parseTimeToMinutesLocal(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  if (hour === 24 && minute !== 0) return null;
  return hour * 60 + minute;
}

function timeFromMinutesLocal(value: number) {
  const safeValue = Math.max(0, Math.min(24 * 60, Math.round(value)));
  const hour = Math.floor(safeValue / 60);
  const minute = safeValue % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToTime(value: string, minutes: number) {
  const base = parseTimeToMinutesLocal(value);
  if (base === null) return "10:00";
  return timeFromMinutesLocal(base + minutes);
}

function stableCompareString(value: unknown) {
  return JSON.stringify(normalizeCompareValue(value));
}

function comparableIso(value: unknown) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function comparableContact(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    crm_contact_id: String(raw.crm_contact_id ?? raw.contactId ?? raw.id ?? "").trim(),
    display_name: String(raw.display_name ?? "").trim(),
    first_name: String(raw.first_name ?? "").trim(),
    last_name: String(raw.last_name ?? "").trim(),
    company_name: String(raw.company_name ?? "").trim(),
    email: String(raw.email ?? "").trim().toLowerCase(),
    phone: String(raw.phone ?? "").trim(),
    address: String(raw.address ?? "").trim(),
    city: String(raw.city ?? "").trim(),
    postal_code: String(raw.postal_code ?? "").trim(),
    siren: String(raw.siren ?? "").trim(),
    category: String(raw.category ?? "").trim(),
    contact_type: String(raw.contact_type ?? "").trim(),
    notes: String(raw.notes ?? "").trim(),
    important: Boolean(raw.important),
  };
}

function comparableGuests(value: unknown) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => comparableContact(item))
    .filter((item) => item.display_name || item.email || item.crm_contact_id)
    .sort((a, b) => `${a.email}|${a.display_name}`.localeCompare(`${b.email}|${b.display_name}`));
}

function comparableMeta(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const intervention = raw.intervention && typeof raw.intervention === "object" ? (raw.intervention as Record<string, unknown>) : {};
  const reminders = raw.reminders && typeof raw.reminders === "object" ? (raw.reminders as Record<string, unknown>) : {};
  return {
    status: String(raw.status ?? "").trim(),
    source: String(raw.source ?? "").trim(),
    requestId: String(raw.requestId ?? "").trim(),
    kind: String(raw.kind ?? "intervention").trim(),
    contact: comparableContact(raw.contact),
    guests: comparableGuests(raw.guests),
    reminders: {
      mailAccountId: String(reminders.mailAccountId ?? reminders.mail_account_id ?? "").trim(),
      enabled: reminders.enabled === false ? false : true,
    },
    intervention: {
      status: String(intervention.status ?? "").trim(),
      address: normalizeCompareValue(intervention.address),
    },
  };
}

function comparablePayload(payload: any) {
  return stableCompareString({
    summary: String(payload?.summary ?? "Évènement").trim(),
    description: String(payload?.description ?? "").trim(),
    location: String(payload?.location ?? "").trim(),
    start: comparableIso(payload?.start),
    end: comparableIso(payload?.end),
    inrcy: comparableMeta(payload?.inrcy),
  });
}

function comparableEvent(event: DayEvent | undefined | null) {
  if (!event) return "";
  return stableCompareString({
    summary: String(event.summary ?? "Évènement").trim(),
    description: String(event.description ?? "").trim(),
    location: String(event.location ?? "").trim(),
    start: comparableIso(event.startDate ?? event.start),
    end: comparableIso(event.endDate ?? event.end),
    inrcy: comparableMeta(event.inrcy),
  });
}

type AgendaMonthSnapshot = {
  ok?: boolean;
  events?: EventItem[];
  appointmentRequests?: EventItem[];
};

type AgendaContactsSnapshot = { contacts?: CrmContact[] };
type AgendaSettingsSnapshot = {
  accounts?: MailAccountOption[];
  selectedMailAccountId?: string;
  reminderOffsetsMinutes?: number[];
};

function readInitialAgendaMonthSnapshot(date: Date) {
  return readModuleSnapshot<AgendaMonthSnapshot>(
    MODULE_SNAPSHOT_KEYS.agendaMonth(date.getFullYear(), date.getMonth()),
  )?.data ?? null;
}

export default function AgendaClient() {
  const i18nT = useTranslations("agenda");
  const [initialMonth] = useState(() => startOfMonth(new Date()));
  const [initialAgendaSnapshot] = useState<AgendaMonthSnapshot | null>(() => readInitialAgendaMonthSnapshot(initialMonth));
  const [initialContactsSnapshot] = useState<AgendaContactsSnapshot | null>(() => readModuleSnapshot<AgendaContactsSnapshot>(MODULE_SNAPSHOT_KEYS.agendaContacts)?.data ?? null);
  const [initialSettingsSnapshot] = useState<AgendaSettingsSnapshot | null>(() => readModuleSnapshot<AgendaSettingsSnapshot>(MODULE_SNAPSHOT_KEYS.agendaSettings)?.data ?? null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [events, setEvents] = useState<EventItem[]>(() => Array.isArray(initialAgendaSnapshot?.events) ? initialAgendaSnapshot.events : []);
  const [appointmentRequests, setAppointmentRequests] = useState<EventItem[]>(() => Array.isArray(initialAgendaSnapshot?.appointmentRequests) ? initialAgendaSnapshot.appointmentRequests : []);
  const [activeRequestIndex, setActiveRequestIndex] = useState(0);
  const [loading, setLoading] = useState(() => !initialAgendaSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [cursorMonth, setCursorMonth] = useState<Date>(() => initialMonth);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  });
  const [query, setQuery] = useState("");
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  const [contacts, setContacts] = useState<CrmContact[]>(() => Array.isArray(initialContactsSnapshot?.contacts) ? initialContactsSnapshot.contacts : []);
  const [contactsLoading, setContactsLoading] = useState(() => !initialContactsSnapshot);

  const [rdvOpen, setRdvOpen] = useState(false);
  const [rdvMode, setRdvMode] = useState<RdvMode>("create");
  const [rdvEventId, setRdvEventId] = useState("");
  const [rdvSummary, setRdvSummary] = useState("");
  const [rdvDate, setRdvDate] = useState("");
  const [rdvStart, setRdvStart] = useState("09:00");
  const [rdvEnd, setRdvEnd] = useState("10:00");
  const [rdvLocation, setRdvLocation] = useState("");
  const [rdvNotes, setRdvNotes] = useState("");
  const [rdvKind, setRdvKind] = useState<RdvKind>("agenda");
  const [intType, setIntType] = useState("");
  const [intStatus, setIntStatus] = useState("confirmé");
  const [intReference, setIntReference] = useState("");
  const [rdvContactId, setRdvContactId] = useState("");
  const [rdvNewContactName, setRdvNewContactName] = useState("");
  const [rdvNewContactEmail, setRdvNewContactEmail] = useState("");
  const [rdvNewContactPhone, setRdvNewContactPhone] = useState("");
  const [rdvNewContactAddress, setRdvNewContactAddress] = useState("");
  const [rdvNewContactCity, setRdvNewContactCity] = useState("");
  const [rdvNewContactPostal, setRdvNewContactPostal] = useState("");
  const [rdvNewContactSiren, setRdvNewContactSiren] = useState("");
  const [rdvNewContactCategory, setRdvNewContactCategory] = useState<ContactCategory>("particulier");
  const [rdvNewContactType, setRdvNewContactType] = useState<ContactType>("prospect");
  const [rdvNewContactImportant, setRdvNewContactImportant] = useState(false);
  const [rdvNewContactNotes, setRdvNewContactNotes] = useState("");
  const [crmAddFeedback, setCrmAddFeedback] = useState("");
  const [rdvSaving, setRdvSaving] = useState(false);
  const [rdvError, setRdvError] = useState<string | null>(null);
  const [rdvExistingContact, setRdvExistingContact] = useState<any | null>(null);
  const [rdvGuests, setRdvGuests] = useState<GuestContactForm[]>([]);

  const [mailAccounts, setMailAccounts] = useState<MailAccountOption[]>(() => Array.isArray(initialSettingsSnapshot?.accounts) ? initialSettingsSnapshot.accounts : []);
  const [agendaMailAccountId, setAgendaMailAccountId] = useState(() => String(initialSettingsSnapshot?.selectedMailAccountId || ""));
  const [agendaMailLoading, setAgendaMailLoading] = useState(() => !initialSettingsSnapshot);
  const [agendaMailSaving, setAgendaMailSaving] = useState(false);
  const [agendaMailError, setAgendaMailError] = useState<string | null>(null);
  const [agendaReminderOffsetsMinutes, setAgendaReminderOffsetsMinutes] = useState<number[]>(() => Array.isArray(initialSettingsSnapshot?.reminderOffsetsMinutes) ? initialSettingsSnapshot.reminderOffsetsMinutes : [1440, 120]);
  const [rdvRemindersEnabled, setRdvRemindersEnabled] = useState(true);
  const rdvRemindersAvailable = agendaReminderOffsetsMinutes.length > 0;

  useEffect(() => {
    if (!rdvRemindersAvailable) setRdvRemindersEnabled(false);
  }, [rdvRemindersAvailable]);

  const rdvFormIdentity = `${rdvMode}:${rdvEventId || "new-event"}`;
  const rdvFormSnapshot = useMemo(() => stableCompareString({
    summary: rdvSummary,
    date: rdvDate,
    start: rdvStart,
    end: rdvEnd,
    location: rdvLocation,
    notes: rdvNotes,
    kind: rdvKind,
    intervention: {
      type: intType,
      status: intStatus,
      reference: intReference,
    },
    contactId: rdvContactId,
    contact: {
      display_name: rdvNewContactName,
      email: rdvNewContactEmail,
      phone: rdvNewContactPhone,
      address: rdvNewContactAddress,
      city: rdvNewContactCity,
      postal_code: rdvNewContactPostal,
      siren: rdvNewContactSiren,
      category: rdvNewContactCategory,
      contact_type: rdvNewContactType,
      important: rdvNewContactImportant,
      notes: rdvNewContactNotes,
    },
    guests: rdvGuests,
    reminders: {
      enabled: rdvRemindersEnabled,
    },
  }), [
    intReference,
    intStatus,
    intType,
    rdvContactId,
    rdvDate,
    rdvEnd,
    rdvGuests,
    rdvKind,
    rdvLocation,
    rdvNewContactAddress,
    rdvNewContactCategory,
    rdvNewContactCity,
    rdvNewContactEmail,
    rdvNewContactImportant,
    rdvNewContactName,
    rdvNewContactNotes,
    rdvNewContactPhone,
    rdvNewContactPostal,
    rdvNewContactSiren,
    rdvNewContactType,
    rdvNotes,
    rdvRemindersEnabled,
    rdvStart,
    rdvSummary,
  ]);
  const [rdvBaseline, setRdvBaseline] = useState<{ identity: string; snapshot: string } | null>(null);

  useLayoutEffect(() => {
    setRdvBaseline((current) => {
      if (!rdvOpen) return null;
      if (current?.identity === rdvFormIdentity) return current;
      return { identity: rdvFormIdentity, snapshot: rdvFormSnapshot };
    });
  }, [rdvFormIdentity, rdvFormSnapshot, rdvOpen]);

  const rdvHasUnsavedChanges = rdvOpen
    && rdvBaseline?.identity === rdvFormIdentity
    && rdvFormSnapshot !== rdvBaseline.snapshot;

  const closeRdvModal = useCallback(() => {
    setRdvOpen(false);
    setRdvError(null);
  }, []);

  const requestCloseRdvModal = useCallback(async () => {
    if (!rdvOpen) return;
    if (!rdvHasUnsavedChanges) {
      closeRdvModal();
      return;
    }
    const ok = await confirmInrcy({
      eyebrow: i18nT("agenda_891e9d6d"),
      title: rdvMode === "request" ? "Fermer la demande ?" : "Fermer l’évènement ?",
      message: rdvMode === "request" ? "La demande restera à valider dans iNr’Calendar." : "Vous avez modifié cet évènement. Si vous fermez maintenant, les modifications seront perdues.",
      confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
      cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
      variant: "warning",
    });
    if (!ok) return;
    closeRdvModal();
  }, [closeRdvModal, rdvHasUnsavedChanges, rdvMode, rdvOpen]);

  useUnsavedExitGuard({
    active: rdvOpen,
    shouldBlock: rdvHasUnsavedChanges && !rdvSaving,
    onConfirmExit: closeRdvModal,
    eyebrow: i18nT("agenda_891e9d6d"),
    title: rdvMode === "request" ? "Fermer la demande ?" : "Fermer l’évènement ?",
    message: rdvMode === "request" ? "La demande restera à valider dans iNr’Calendar." : "Vous avez modifié cet évènement. Si vous fermez maintenant, les modifications seront perdues.",
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  const quarterHourOptions = useMemo(() => buildQuarterHourOptions(), []);
  const startTimeOptions = useMemo(
    () => (quarterHourOptions.includes(rdvStart) ? quarterHourOptions : [rdvStart, ...quarterHourOptions.filter((value) => value !== rdvStart)]),
    [quarterHourOptions, rdvStart]
  );
  const endTimeOptions = useMemo(() => {
    const minimumEnd = parseTimeToMinutesLocal(addMinutesToTime(rdvStart, 60)) ?? 600;
    const options = [...quarterHourOptions, "24:00"].filter((value) => (parseTimeToMinutesLocal(value) ?? 0) >= minimumEnd);
    return options;
  }, [quarterHourOptions, rdvStart]);

  const setRdvStartAndSyncEnd = useCallback((value: string) => {
    const nextMinimumEnd = addMinutesToTime(value, 60);
    const nextMinimumEndMinutes = parseTimeToMinutesLocal(nextMinimumEnd);
    setRdvStart(value);
    setRdvEnd((previousEnd) => {
      const previousEndMinutes = parseTimeToMinutesLocal(previousEnd);
      if (previousEndMinutes === null || nextMinimumEndMinutes === null || previousEndMinutes < nextMinimumEndMinutes) return nextMinimumEnd;
      return previousEnd;
    });
  }, []);

  useEffect(() => {
    if (!rdvContactId) return;
    const contact = contacts.find((item) => item.id === rdvContactId);
    if (!contact) return;

    setRdvLocation(composeAddressLine(contact.address ?? "", contact.postal_code ?? "", contact.city ?? ""));
    setRdvNewContactName(buildCrmDisplayName((contact.first_name ?? "").trim(), (contact.last_name ?? "").trim(), (contact.company_name ?? "").trim()));
    setRdvNewContactEmail((contact.email ?? "").trim());
    setRdvNewContactPhone((contact.phone ?? "").trim());
    setRdvNewContactAddress((contact.address ?? "").trim());
    setRdvNewContactCity((contact.city ?? "").trim());
    setRdvNewContactPostal((contact.postal_code ?? "").trim());
    setRdvNewContactSiren((contact.siren ?? "").trim());
    setRdvNewContactCategory((contact.category as ContactCategory) || "particulier");
    setRdvNewContactType((contact.contact_type as ContactType) || "prospect");
    setRdvNewContactImportant(Boolean(contact.important));
    setRdvNewContactNotes((contact.notes ?? "").trim());
    setCrmAddFeedback("");
    setRdvExistingContact(null);
  }, [rdvContactId, contacts]);

  async function loadAgendaMailSettings(options?: { silent?: boolean }) {
    if (!options?.silent) setAgendaMailLoading(true);
    setAgendaMailError(null);
    try {
      const response = await fetch("/api/calendar/settings");
      if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible de charger la boîte d’envoi agenda."));
      const json = await response.json().catch(() => ({}));
      const nextAccounts = Array.isArray((json as any)?.accounts) ? (json as any).accounts : [];
      const nextSelectedMailAccountId = String((json as any)?.selectedMailAccountId || "");
      const nextReminderOffsets = Array.isArray((json as any)?.reminderOffsetsMinutes) ? (json as any).reminderOffsetsMinutes.map((item: unknown) => Number(item)).filter((item: number) => Number.isFinite(item)) : [];
      setMailAccounts(nextAccounts);
      setAgendaMailAccountId(nextSelectedMailAccountId);
      setAgendaReminderOffsetsMinutes(nextReminderOffsets);
      writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.agendaSettings, {
        accounts: nextAccounts,
        selectedMailAccountId: nextSelectedMailAccountId,
        reminderOffsetsMinutes: nextReminderOffsets,
      });
    } catch (e: any) {
      setAgendaMailError(getSimpleFrenchErrorMessage(e, "Impossible de charger la boîte d’envoi agenda."));
    } finally {
      setAgendaMailLoading(false);
    }
  }


  function createEmptyGuest(): GuestContactForm {
    return {
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contactId: "",
      name: "",
      email: "",
    };
  }

  function buildGuestDisplayNameFromContact(contact: CrmContact) {
    return getContactOptionLabel(contact, i18nT("contact_b37456c4"));
  }

  function normalizeGuestForms(value: unknown): GuestContactForm[] {
    const list = Array.isArray(value) ? value : [];
    return list
      .map((item, index) => {
        const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const email = String(raw.email ?? "").trim();
        const fullName = [raw.first_name, raw.last_name]
          .map((part) => String(part ?? "").trim())
          .filter(Boolean)
          .join(" ")
          .trim();
        const name = String(raw.display_name || fullName || raw.company_name || "").trim();
        const contactId = String(raw.crm_contact_id ?? raw.contactId ?? raw.id ?? "").trim();
        if (!name && !email && !contactId) return null;
        return {
          id: `guest-${index}-${contactId || email || name}`,
          contactId,
          name,
          email,
        } satisfies GuestContactForm;
      })
      .filter(Boolean) as GuestContactForm[];
  }

  function addGuest() {
    setRdvGuests((prev) => [...prev, createEmptyGuest()]);
  }

  function removeGuest(id: string) {
    setRdvGuests((prev) => prev.filter((guest) => guest.id !== id));
  }

  function updateGuestField(id: string, field: "name" | "email", value: string) {
    setRdvGuests((prev) => prev.map((guest) => (guest.id === id ? { ...guest, [field]: value } : guest)));
  }

  function updateGuestContactId(id: string, contactId: string) {
    const contact = contacts.find((item) => item.id === contactId);
    setRdvGuests((prev) =>
      prev.map((guest) => {
        if (guest.id !== id) return guest;
        if (!contactId || !contact) return { ...guest, contactId };
        return {
          ...guest,
          contactId,
          name: buildGuestDisplayNameFromContact(contact),
          email: String(contact.email ?? "").trim(),
        };
      })
    );
  }

  function buildGuestContacts(): ContactPayload[] {
    return rdvGuests
      .map((guest) => {
        const contact = guest.contactId ? contacts.find((item) => item.id === guest.contactId) : null;
        if (contact) {
          const displayName = buildGuestDisplayNameFromContact(contact);
          return {
            crm_contact_id: contact.id,
            display_name: displayName || "Invité",
            first_name: String(contact.first_name ?? "").trim() || undefined,
            last_name: String(contact.last_name ?? "").trim() || undefined,
            company_name: String(contact.company_name ?? "").trim() || undefined,
            email: String(contact.email ?? "").trim(),
            phone: String(contact.phone ?? "").trim(),
            address: String(contact.address ?? "").trim(),
            city: String(contact.city ?? "").trim() || undefined,
            postal_code: String(contact.postal_code ?? "").trim() || undefined,
            siren: String(contact.siren ?? "").trim() || undefined,
            category: contact.category || undefined,
            contact_type: contact.contact_type || undefined,
            notes: String(contact.notes ?? "").trim() || undefined,
            important: Boolean(contact.important),
          } as ContactPayload & { crm_contact_id?: string };
        }

        const rawName = guest.name.trim();
        const parsed = parseCrmDisplayName(rawName);
        const email = guest.email.trim();
        if (!rawName && !email) return null;
        return {
          display_name: rawName || email || "Invité",
          first_name: parsed.first_name.trim() || undefined,
          last_name: parsed.last_name.trim() || undefined,
          company_name: parsed.company_name.trim() || undefined,
          email,
          phone: "",
          address: "",
        } as ContactPayload;
      })
      .filter((guest): guest is ContactPayload => Boolean(guest && (guest.display_name || guest.email)));
  }

  async function saveAgendaMailAccount(nextId: string) {
    const previousId = agendaMailAccountId;
    setAgendaMailAccountId(nextId);
    setAgendaMailSaving(true);
    setAgendaMailError(null);
    try {
      const response = await fetch("/api/calendar/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedMailAccountId: nextId }),
      });
      if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible d’enregistrer la boîte d’envoi agenda."));
    } catch (e: any) {
      setAgendaMailAccountId(previousId);
      setAgendaMailError(getSimpleFrenchErrorMessage(e, "Impossible d’enregistrer la boîte d’envoi agenda."));
    } finally {
      setAgendaMailSaving(false);
    }
  }

  function hydrateContactFields(contact: any | null) {
    const raw = contact && typeof contact === "object" ? contact : null;
    const displayName = String(raw?.display_name ?? "").trim();
    const firstName = String(raw?.first_name ?? "").trim();
    const lastName = String(raw?.last_name ?? "").trim();
    const companyName = String(raw?.company_name ?? "").trim();
    const address = String(raw?.address ?? "").trim();
    const city = String(raw?.city ?? "").trim();
    const postalCode = String(raw?.postal_code ?? "").trim();

    setRdvNewContactName(displayName || buildCrmDisplayName(firstName, lastName, companyName));
    setRdvNewContactEmail(String(raw?.email ?? "").trim());
    setRdvNewContactPhone(String(raw?.phone ?? "").trim());
    setRdvNewContactAddress(address);
    setRdvNewContactCity(city);
    setRdvNewContactPostal(postalCode);
    setRdvNewContactSiren(String(raw?.siren ?? "").trim());
    setRdvNewContactCategory((String(raw?.category ?? "").trim() as ContactCategory) || "particulier");
    setRdvNewContactType((String(raw?.contact_type ?? "").trim() as ContactType) || "prospect");
    setRdvNewContactImportant(Boolean(raw?.important));
    setRdvNewContactNotes(String(raw?.notes ?? "").trim());

    const structuredLocation = composeAddressLine(address, postalCode, city);
    if (structuredLocation) setRdvLocation(structuredLocation);
  }

  async function loadContacts(options?: { silent?: boolean }) {
    if (!options?.silent) setContactsLoading(true);
    try {
      const response = await fetch("/api/crm/contacts?all=1&pageSize=200");
      if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible de charger les contacts du CRM."));
      const json = await response.json().catch(() => ({}));
      const nextContacts = Array.isArray((json as any)?.contacts) ? (json as any).contacts : [];
      setContacts(nextContacts);
      writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.agendaContacts, { contacts: nextContacts });
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, "Impossible de charger les contacts du CRM."));
    } finally {
      setContactsLoading(false);
    }
  }

  useEffect(() => {
    const action = (searchParams?.get("action") || "").toLowerCase();
    if (action !== "new") return;

    const contactId = searchParams?.get("contactId") || "";
    const contactName = searchParams?.get("contactName") || "";
    const contactFirstName = searchParams?.get("contactFirstName") || "";
    const contactCompany = searchParams?.get("contactCompany") || "";
    const contactEmail = searchParams?.get("contactEmail") || "";
    const contactPhone = searchParams?.get("contactPhone") || "";
    const contactAddress = searchParams?.get("contactAddress") || "";
    const contactPostalCode = searchParams?.get("contactPostalCode") || "";
    const contactCity = searchParams?.get("contactCity") || "";
    const rdvDateParam = searchParams?.get("rdvDate") || "";
    const rdvStartParam = searchParams?.get("rdvStart") || "";
    const rdvEndParam = searchParams?.get("rdvEnd") || "";
    const summaryParam = searchParams?.get("summary") || "";
    const notesParam = searchParams?.get("notes") || "";

    loadContacts();
    openCreateRdv(selectedDate);

    if (/^\d{4}-\d{2}-\d{2}$/.test(rdvDateParam)) setRdvDate(rdvDateParam);
    if (/^\d{2}:\d{2}$/.test(rdvStartParam)) {
      setRdvStart(rdvStartParam);
      if (!/^\d{2}:\d{2}$/.test(rdvEndParam)) setRdvEnd(addMinutesToTime(rdvStartParam, 60));
    }
    if (/^\d{2}:\d{2}$/.test(rdvEndParam)) setRdvEnd(rdvEndParam);
    if (summaryParam) setRdvSummary(summaryParam);
    if (notesParam) setRdvNotes(notesParam);

    if (contactId) setRdvContactId(contactId);
    if (contactName || contactFirstName || contactCompany) {
      setRdvNewContactName(contactName || buildCrmDisplayName(contactFirstName, "", contactCompany));
    }
    if (contactEmail) setRdvNewContactEmail(contactEmail);
    if (contactPhone) setRdvNewContactPhone(contactPhone);
    if (contactAddress) setRdvNewContactAddress(contactAddress);
    if (contactCity) setRdvNewContactCity(contactCity);
    if (contactPostalCode) setRdvNewContactPostal(contactPostalCode);

    try {
      const nextQuery = new URLSearchParams(searchParams?.toString() || "");
      nextQuery.delete("action");
      router.replace(`/dashboard/agenda?${nextQuery.toString()}`);
    } catch {}
  }, [router, searchParams, selectedDate]);

  function openCreateRdv(date: Date) {
    setRdvMode("create");
    setRdvEventId("");
    setActiveRequestIndex(0);
    setRdvKind("agenda");
    setRdvSummary("Rendez-vous");
    setRdvDate(toDateOnly(date));
    setRdvStart("09:00");
    setRdvEnd("10:00");
    setRdvLocation("");
    setRdvNotes("");
    setIntType("");
    setIntStatus(i18nT("confirme_9fbcd433"));
    setIntReference("");
    setRdvExistingContact(null);
    setRdvGuests([]);
    setRdvContactId("");
    setRdvNewContactName("");
    setRdvNewContactEmail("");
    setRdvNewContactPhone("");
    setRdvNewContactAddress("");
    setRdvNewContactCity("");
    setRdvNewContactPostal("");
    setRdvNewContactSiren("");
    setRdvNewContactCategory("particulier");
    setRdvNewContactType("prospect");
    setRdvNewContactImportant(false);
    setRdvNewContactNotes("");
    setCrmAddFeedback("");
    setRdvRemindersEnabled(rdvRemindersAvailable);
    setRdvError(null);
    setRdvOpen(true);
  }

  function openAppointmentRequestAt(index: number) {
    const safeIndex = Math.max(0, Math.min(index, normalizedAppointmentRequests.length - 1));
    const request = normalizedAppointmentRequests[safeIndex];
    if (!request) return;

    const rawMeta = request.inrcy && typeof request.inrcy === "object" ? request.inrcy : {};
    const contact = rawMeta?.contact && typeof rawMeta.contact === "object" ? rawMeta.contact : {};
    const details = rawMeta?.inrBadgeAppointmentRequest && typeof rawMeta.inrBadgeAppointmentRequest === "object" ? rawMeta.inrBadgeAppointmentRequest : {};
    const clientName = String((details as any)?.clientName || (contact as any)?.display_name || "").trim();
    const clientCompany = String((details as any)?.clientCompany || (contact as any)?.company_name || "").trim();
    const clientEmail = String((details as any)?.clientEmail || (contact as any)?.email || "").trim();
    const clientPhone = String((details as any)?.clientPhone || (contact as any)?.phone || "").trim();
    const message = String((details as any)?.message || request.description || "").replace(/^Demande depuis iNr'Badge\s*/i, "").trim();
    const start = request.startDate ?? (request.start ? new Date(request.start) : null);
    const end = request.endDate ?? (request.end ? new Date(request.end) : null);
    const baseDate = start ?? selectedDate;

    setRdvMode("request");
    setRdvEventId(request.id);
    setActiveRequestIndex(safeIndex);
    setRdvKind("agenda");
    setRdvSummary(`Rendez-vous - ${clientName || "iNr'Badge"}`);
    setRdvDate(toDateOnly(baseDate));
    setRdvStart(start ? `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}` : "09:00");
    setRdvEnd(end ? `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}` : "10:00");
    setRdvLocation("");
    setRdvNotes(message);
    setIntType("");
    setIntStatus(i18nT("confirme_9fbcd433"));
    setIntReference("");
    setRdvExistingContact(null);
    setRdvGuests([]);
    setRdvContactId("");
    setRdvNewContactName(buildCrmDisplayName(clientName, "", clientCompany));
    setRdvNewContactEmail(clientEmail);
    setRdvNewContactPhone(clientPhone);
    setRdvNewContactAddress("");
    setRdvNewContactCity("");
    setRdvNewContactPostal("");
    setRdvNewContactSiren("");
    setRdvNewContactCategory(clientCompany ? "professionnel" : "particulier");
    setRdvNewContactType("prospect");
    setRdvNewContactImportant(false);
    setRdvNewContactNotes("");
    setCrmAddFeedback("");
    setRdvRemindersEnabled(rdvRemindersAvailable);
    setRdvError(null);
    if (start) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
      setSelectedDate(day);
      setCursorMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
    setRdvOpen(true);
  }

  function openEditRdv(event: DayEvent) {
    setRdvMode("edit");
    setRdvEventId(event.id);

    const rawMeta = (event?.inrcy && typeof event.inrcy === "object") ? event.inrcy : {};
    const rawReminders = (rawMeta as any)?.reminders && typeof (rawMeta as any).reminders === "object" ? (rawMeta as any).reminders : {};
    setRdvRemindersEnabled(rdvRemindersAvailable && rawReminders.enabled !== false);
    const kind = rawMeta?.kind === "agenda" ? "agenda" : "intervention";
    const meta = rawMeta?.intervention ?? null;
    const address = (meta as any)?.address;
    const existingContact = rawMeta?.contact && typeof rawMeta.contact === "object" ? rawMeta.contact : null;
    setRdvGuests(normalizeGuestForms((rawMeta as any)?.guests));

    setRdvKind(kind);
    setRdvSummary(event.summary || (kind === "intervention" ? "Intervention" : "Rendez-vous"));

    const start = event.startDate ?? (event.start ? new Date(event.start) : null);
    const end = event.endDate ?? (event.end ? new Date(event.end) : null);
    const baseDate = start ?? selectedDate;

    setRdvDate(toDateOnly(baseDate));
    setRdvStart(start ? `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}` : "09:00");
    setRdvEnd(end ? `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}` : "10:00");
    setRdvLocation(event.location ?? "");
    setRdvNotes(typeof event.description === "string" ? event.description : "");

    if (address && typeof address === "object") {
      const fallbackLocation = composeAddressLine(String(address.street ?? ""), String(address.postal_code ?? ""), String(address.city ?? ""));
      if (!event.location && fallbackLocation) setRdvLocation(fallbackLocation);
    } else if (typeof address === "string" && !event.location) {
      setRdvLocation(String(address));
    }

    setIntType(String(meta?.type ?? ""));
    setIntStatus(String(meta?.status ?? "confirmé"));
    setIntReference(String(meta?.reference ?? ""));
    setRdvExistingContact(existingContact);
    setRdvContactId("");
    hydrateContactFields(existingContact);
    setCrmAddFeedback("");
    setRdvError(null);
    setRdvOpen(true);
  }

  async function ensureContact(): Promise<ContactPayload | null> {
    if (rdvContactId) {
      const contact = contacts.find((item) => item.id === rdvContactId);
      if (!contact) return null;

      const display_name =
        `${(contact.first_name ?? "").trim()} ${(contact.last_name ?? "").trim()}`.trim() ||
        (contact.company_name ?? "").trim() ||
        "Contact";

      const address = (contact.address ?? "").trim();
      const city = (contact.city ?? "").trim();
      const postal_code = (contact.postal_code ?? "").trim();

      return {
        display_name,
        first_name: (contact.first_name ?? "").trim() || undefined,
        last_name: (contact.last_name ?? "").trim() || undefined,
        company_name: (contact.company_name ?? "").trim() || undefined,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        address,
        city: city || undefined,
        postal_code: postal_code || undefined,
        siren: (contact.siren ?? "").trim() || undefined,
        category: (contact.category as ContactCategory) || "particulier",
        contact_type: (contact.contact_type as ContactType) || "prospect",
        notes: (contact.notes ?? "").trim() || undefined,
        important: Boolean(contact.important),
      };
    }

    const rawDisplayName = rdvNewContactName.trim();
    const parsed = parseCrmDisplayName(rawDisplayName);
    const lastName = parsed.last_name.trim();
    const firstName = parsed.first_name.trim();
    const companyName = parsed.company_name.trim();
    const email = rdvNewContactEmail.trim();
    const phone = rdvNewContactPhone.trim();
    const address = rdvNewContactAddress.trim();
    const city = rdvNewContactCity.trim();
    const postal_code = rdvNewContactPostal.trim();

    if (!rawDisplayName && !email && !phone && !address) {
      return rdvExistingContact && typeof rdvExistingContact === "object" ? rdvExistingContact : null;
    }

    return {
      display_name: rawDisplayName || "Nouveau contact",
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      company_name: companyName || undefined,
      email,
      phone,
      address,
      city: city || undefined,
      postal_code: postal_code || undefined,
      siren: rdvNewContactSiren.trim() || undefined,
      notes: rdvNewContactNotes.trim() || undefined,
    };
  }

  async function addContactToCrmFromCoords() {
    setCrmAddFeedback("");
    try {
      if (rdvContactId) {
        setCrmAddFeedback(i18nT("deja_ajoute_au_crm_d7a41a78"));
        return;
      }

      const rawDisplayName = rdvNewContactName.trim();
      const parsed = parseCrmDisplayName(rawDisplayName);
      const firstName = parsed.first_name.trim();
      const lastName = parsed.last_name.trim();
      const companyName = parsed.company_name.trim();
      const email = rdvNewContactEmail.trim();
      const phone = rdvNewContactPhone.trim();
      const address = rdvNewContactAddress.trim();
      const city = rdvNewContactCity.trim();
      const postal_code = rdvNewContactPostal.trim();
      const display_name = (rawDisplayName || "Nouveau contact").trim();

      if (!display_name && !email && !phone) {
        setCrmAddFeedback(i18nT("renseigne_au_minimum_un_nom_email_88fa2f47"));
        return;
      }

      const normEmail = email.toLowerCase();
      const normPhone = phone.replace(/\D/g, "");
      const existing = contacts.find((contact) => {
        const contactEmail = (contact.email ?? "").toLowerCase();
        const contactPhone = (contact.phone ?? "").replace(/\D/g, "");
        const displayName = (contact.display_name ?? "").toLowerCase().trim();
        if (normEmail && contactEmail && contactEmail === normEmail) return true;
        if (normPhone && contactPhone && contactPhone === normPhone) return true;
        if (display_name && displayName && displayName === display_name.toLowerCase()) return true;
        return false;
      });

      if (existing) {
        setRdvContactId(existing.id);
        setCrmAddFeedback(i18nT("deja_ajoute_au_crm_d7a41a78"));
        return;
      }

      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name,
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          company_name: companyName || undefined,
          email,
          phone,
          address,
          city: city || undefined,
          postal_code: postal_code || undefined,
        }),
      }).catch(() => null);

      const json = response ? await response.json().catch(() => ({})) : {};
      if (!response || !response.ok) {
        throw new Error(
          response
            ? await getSimpleFrenchApiError(response, "Impossible d’ajouter le contact au CRM")
            : "Connexion au serveur impossible pour le moment. Merci de réessayer."
        );
      }

      await loadContacts();
      const createdId = (json as any)?.id as string | undefined;

      if (createdId) {
        setRdvContactId(createdId);
      } else {
        const updated = await fetch("/api/crm/contacts?all=1&pageSize=200").then((item) => item.json()).catch(() => null);
        const updatedContacts = Array.isArray(updated) ? updated : Array.isArray((updated as any)?.contacts) ? (updated as any).contacts : [];
        if (Array.isArray(updatedContacts)) {
          const found = updatedContacts.find(
            (contact: any) =>
              (email && (contact.email ?? "").toLowerCase() === normEmail) ||
              (normPhone && (contact.phone ?? "").replace(/\D/g, "") === normPhone) ||
              ((contact.display_name ?? "").toLowerCase().trim() === display_name.toLowerCase())
          );
          if (found?.id) setRdvContactId(found.id);
        }
      }

      setCrmAddFeedback(i18nT("ajoute_au_crm_fbe3398c"));
    } catch (e: any) {
      setCrmAddFeedback(getSimpleFrenchErrorMessage(e, "Impossible d'ajouter ce contact au CRM."));
    }
  }

  async function buildRdvPayload(targetStatus: "draft" | "confirmed" | null) {
    const safeSummary = rdvSummary.trim() || "Évènement";
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(rdvDate) ? rdvDate : keyOf(selectedDate);
    const safeStart = /^\d{2}:\d{2}$/.test(rdvStart) ? rdvStart : "09:00";
    const safeEnd = /^\d{2}:\d{2}$/.test(rdvEnd) ? rdvEnd : "10:00";

    const startIso = buildIso(safeDate, safeStart);
    let endIso = buildIso(safeDate, safeEnd);
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      const date = new Date(Date.parse(startIso));
      date.setMinutes(date.getMinutes() + 60);
      endIso = date.toISOString();
    }

    const contact = (await ensureContact()) ?? (rdvMode === "edit" ? rdvExistingContact : null);
    const guests = buildGuestContacts();
    const coordsLocation = composeAddressLine(rdvNewContactAddress.trim(), rdvNewContactPostal.trim(), rdvNewContactCity.trim());
    const structuredLocation = (rdvLocation.trim() || coordsLocation).trim();
    const activeRequest = rdvMode === "request" ? normalizedAppointmentRequests[activeRequestIndex] : null;
    const activeRequestMeta = activeRequest?.inrcy && typeof activeRequest.inrcy === "object" ? activeRequest.inrcy : {};
    const isDraft = targetStatus === "draft";

    return {
      summary: safeSummary,
      location: structuredLocation || null,
      description: rdvNotes.trim(),
      start: startIso,
      end: endIso,
      contact,
      inrcy: {
        ...(rdvMode === "request" ? {
          source: "inrbadge",
          requestId: rdvEventId,
          inrBadgeAppointmentRequest: (activeRequestMeta as any)?.inrBadgeAppointmentRequest,
        } : {}),
        ...(targetStatus ? { status: targetStatus } : {}),
        kind: rdvKind,
        contact: contact ?? undefined,
        guests,
        reminders: {
          mailAccountId: isDraft ? undefined : agendaMailAccountId || undefined,
          enabled: isDraft ? false : rdvRemindersAvailable ? rdvRemindersEnabled : false,
        },
        intervention: {
          status: intStatus.trim() || undefined,
          address: rdvLocation.trim()
            ? { street: rdvLocation.trim() || undefined }
            : {
                street: rdvNewContactAddress.trim() || undefined,
                city: rdvNewContactCity.trim() || undefined,
                postal_code: rdvNewContactPostal.trim() || undefined,
              },
        },
      },
    };
  }

  async function saveRdvDraft() {
    if (rdvMode === "request") return;
    setRdvSaving(true);
    setRdvError(null);
    setSuccess(null);
    try {
      const payload = await buildRdvPayload("draft");
      const response = rdvMode === "edit" && rdvEventId
        ? await fetch(`/api/calendar/events?id=${encodeURIComponent(rdvEventId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/calendar/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(
          !response.ok
            ? await getSimpleFrenchApiError(response, "Impossible d’enregistrer le brouillon.")
            : getSimpleFrenchErrorMessage(json?.error, "Impossible d’enregistrer le brouillon.")
        );
      }
      setRdvOpen(false);
      await loadEventsForMonth(cursorMonth);
      setSuccess(i18nT("brouillon_enregistre_56ee4bbc"));
    } catch (e: any) {
      setRdvError(getSimpleFrenchErrorMessage(e, "Impossible d’enregistrer le brouillon."));
    } finally {
      setRdvSaving(false);
    }
  }

  async function submitRdv() {
    setRdvSaving(true);
    setRdvError(null);
    setSuccess(null);
    try {
      const currentBeforeSubmit = rdvMode === "edit" ? normalized.find((event) => event.id === rdvEventId) : null;
      const payload: any = await buildRdvPayload(
        rdvMode === "edit" && currentBeforeSubmit && !isDraftEvent(currentBeforeSubmit)
          ? null
          : "confirmed",
      );

      if (rdvMode === "create") {
        const response = await fetch("/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.ok) {
          throw new Error(
            !response.ok
              ? await getSimpleFrenchApiError(response, "Impossible de créer le rendez-vous.")
              : getSimpleFrenchErrorMessage(json?.error, "Impossible de créer le rendez-vous.")
          );
        }
      } else if (rdvMode === "request") {
        if (!rdvEventId) throw new Error("Demande de rendez-vous introuvable.");

        const response = await fetch(`/api/calendar/events?id=${encodeURIComponent(rdvEventId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.ok) {
          throw new Error(
            !response.ok
              ? await getSimpleFrenchApiError(response, "Impossible de valider le rendez-vous.")
              : getSimpleFrenchErrorMessage(json?.error, "Impossible de valider le rendez-vous.")
          );
        }
      } else {
        const currentEvent = normalized.find((event) => event.id === rdvEventId);
        const hasLocalChanges = comparablePayload(payload) !== comparableEvent(currentEvent);

        if (!hasLocalChanges) {
          setRdvOpen(false);
          setSuccess(i18nT("aucune_modification_detectee_4884a271"));
          return;
        }

        const draftToConfirm = Boolean(currentBeforeSubmit && isDraftEvent(currentBeforeSubmit));
        const confirmed = await confirmInrcy({
          eyebrow: i18nT("agenda_891e9d6d"),
          title: draftToConfirm ? "Confirmer le brouillon" : "Confirmer la modification",
          message: draftToConfirm
            ? "Ce brouillon va devenir un vrai rendez-vous. Les confirmations et rappels suivront vos réglages. Voulez-vous continuer ?"
            : "Ce rendez-vous va être mis à jour. Les mails de mise à jour seront envoyés selon vos réglages. Voulez-vous continuer ?",
          confirmLabel: draftToConfirm ? "Confirmer le RDV" : "Confirmer la modification",
          cancelLabel: i18nT("annuler_49ba3292"),
          variant: "warning",
        });

        if (!confirmed) {
          return;
        }

        const response = await fetch(`/api/calendar/events?id=${encodeURIComponent(rdvEventId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.ok) {
          throw new Error(
            !response.ok
              ? await getSimpleFrenchApiError(response, "Impossible de modifier le rendez-vous.")
              : getSimpleFrenchErrorMessage(json?.error, "Impossible de modifier le rendez-vous.")
          );
        }

        if (json?.unchanged) {
          setRdvOpen(false);
          setSuccess(i18nT("aucune_modification_detectee_4884a271"));
          return;
        }
      }

      const confirmedDraft = Boolean(currentBeforeSubmit && isDraftEvent(currentBeforeSubmit));
      setRdvOpen(false);
      await loadEventsForMonth(cursorMonth);
      setSuccess(rdvMode === "create" ? "Rendez-vous ajouté." : rdvMode === "request" ? "Rendez-vous validé. Confirmation et rappels suivent le circuit iNr’Calendar." : confirmedDraft ? "Brouillon confirmé." : "Rendez-vous modifié.");
    } catch (e: any) {
      setRdvError(getSimpleFrenchErrorMessage(e, rdvMode === "create" ? "Impossible de créer le rendez-vous." : rdvMode === "request" ? "Impossible de valider le rendez-vous." : "Impossible de modifier le rendez-vous."));
    } finally {
      setRdvSaving(false);
    }
  }

  async function deleteRdv() {
    if (!rdvEventId) return;
    setRdvSaving(true);
    setRdvError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/calendar/events?id=${encodeURIComponent(rdvEventId)}`, { method: "DELETE" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(
          !response.ok
            ? await getSimpleFrenchApiError(response, "Impossible de supprimer ce rendez-vous.")
            : getSimpleFrenchErrorMessage(json?.error, "Impossible de supprimer ce rendez-vous.")
        );
      }
      setRdvOpen(false);
      await loadEventsForMonth(cursorMonth);
      setSuccess(i18nT("rendez_vous_supprime_27bd089e"));
    } catch (e: any) {
      setRdvError(getSimpleFrenchErrorMessage(e, "Impossible de supprimer ce rendez-vous."));
    } finally {
      setRdvSaving(false);
    }
  }

  async function rejectAppointmentRequest() {
    if (!rdvEventId || rdvMode !== "request") return;
    const confirmed = await confirmInrcy({
      eyebrow: i18nT("inr_calendar_f5f54ab6"),
      title: i18nT("refuser_cette_demande_8213dba0"),
      message: i18nT("aucun_rendez_vous_ne_sera_cree_5f1bd901"),
      confirmLabel: i18nT("refuser_62897154"),
      cancelLabel: i18nT("annuler_49ba3292"),
      variant: "danger",
    });
    if (!confirmed) return;

    setRdvSaving(true);
    setRdvError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/calendar/appointment-requests?id=${encodeURIComponent(rdvEventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(
          !response.ok
            ? await getSimpleFrenchApiError(response, "Impossible de refuser cette demande.")
            : getSimpleFrenchErrorMessage(json?.error, "Impossible de refuser cette demande.")
        );
      }

      setRdvOpen(false);
      await loadEventsForMonth(cursorMonth);
      setSuccess(i18nT("demande_de_rendez_vous_refusee_6769d371"));
    } catch (e: any) {
      setRdvError(getSimpleFrenchErrorMessage(e, "Impossible de refuser cette demande."));
    } finally {
      setRdvSaving(false);
    }
  }

  async function deleteEventById(id: string) {
    if (!id) return;
    try {
      const response = await fetch(`/api/calendar/events?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(
          !response.ok
            ? await getSimpleFrenchApiError(response, "Impossible de supprimer ce rendez-vous.")
            : getSimpleFrenchErrorMessage(json?.error, "Impossible de supprimer ce rendez-vous.")
        );
      }
      await loadEventsForMonth(cursorMonth);
    } catch (e: any) {
      const message = getSimpleFrenchErrorMessage(e, "Impossible de supprimer ce rendez-vous.");
      if (rdvOpen) setRdvError(message);
      else setError(message);
    }
  }

  async function loadEventsForMonth(monthDate: Date, options?: { silent?: boolean }) {
    const snapshotKey = MODULE_SNAPSHOT_KEYS.agendaMonth(monthDate.getFullYear(), monthDate.getMonth());
    const cached = readModuleSnapshot<AgendaMonthSnapshot>(snapshotKey)?.data ?? null;
    if (cached) {
      setEvents(Array.isArray(cached.events) ? cached.events : []);
      setAppointmentRequests(Array.isArray(cached.appointmentRequests) ? cached.appointmentRequests : []);
    }
    if (!options?.silent && !cached) setLoading(true);
    else setLoading(false);
    setError(null);
    try {
      const monthStart = startOfMonth(monthDate);
      const monthEnd = endOfMonth(monthDate);
      const gridStart = startOfWeekMonday(monthStart);
      const gridEnd = endOfWeekSunday(monthEnd);
      const timeMin = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate(), 0, 0, 0, 0);
      const timeMax = addDays(new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate(), 0, 0, 0, 0), 1);

      const response = await fetch(
        `/api/calendar/events?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}`
      );

      if (!response.ok) {
        setError(await getSimpleFrenchApiError(response, "Impossible de charger l’agenda."));
        return;
      }

      const json = await response.json().catch(() => ({}));
      if (!json.ok) {
        setError(getSimpleFrenchErrorMessage(json?.error, "Impossible de charger l’agenda."));
        return;
      }

      const nextEvents = Array.isArray(json.events) ? json.events : [];
      const nextAppointmentRequests = Array.isArray(json.appointmentRequests) ? json.appointmentRequests : [];
      setEvents(nextEvents);
      setAppointmentRequests(nextAppointmentRequests);
      writeModuleSnapshot(snapshotKey, { ok: true, events: nextEvents, appointmentRequests: nextAppointmentRequests });
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, "Impossible de charger l’agenda."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContacts({ silent: Boolean(initialContactsSnapshot) });
    void loadAgendaMailSettings({ silent: Boolean(initialSettingsSnapshot) });
  }, []);

  useEffect(() => {
    const refreshAgendaSettings = () => {
      void loadAgendaMailSettings();
    };

    window.addEventListener("inrcalendar:settings-updated", refreshAgendaSettings);
    return () => window.removeEventListener("inrcalendar:settings-updated", refreshAgendaSettings);
  }, []);

  useEffect(() => {
    void loadEventsForMonth(cursorMonth, { silent: Boolean(readInitialAgendaMonthSnapshot(cursorMonth)) });
  }, [cursorMonth]);

  const monthStart = useMemo(() => startOfMonth(cursorMonth), [cursorMonth]);
  const monthEnd = useMemo(() => endOfMonth(cursorMonth), [cursorMonth]);
  const gridStart = useMemo(() => startOfWeekMonday(monthStart), [monthStart]);
  const gridEnd = useMemo(() => endOfWeekSunday(monthEnd), [monthEnd]);

  const days = useMemo(() => {
    const list: Date[] = [];
    let day = new Date(gridStart);
    while (day <= gridEnd) {
      list.push(new Date(day));
      day = addDays(day, 1);
    }
    return list;
  }, [gridEnd, gridStart]);

  const isSixWeeks = days.length > 35;

  const normalized = useMemo<DayEvent[]>(() => {
    return events.map((event) => {
      const allDay = isDateOnly(event.start);
      const startDate = event.start ? (allDay ? parseDateOnly(event.start) : new Date(event.start)) : null;
      const endDate = event.end ? (isDateOnly(event.end) ? parseDateOnly(event.end) : new Date(event.end)) : null;
      return { ...event, allDay, startDate, endDate };
    });
  }, [events]);

  const normalizedAppointmentRequests = useMemo<DayEvent[]>(() => {
    return appointmentRequests.map((event) => {
      const allDay = isDateOnly(event.start);
      const startDate = event.start ? (allDay ? parseDateOnly(event.start) : new Date(event.start)) : null;
      const endDate = event.end ? (isDateOnly(event.end) ? parseDateOnly(event.end) : new Date(event.end)) : null;
      return { ...event, allDay, startDate, endDate };
    });
  }, [appointmentRequests]);

  useEffect(() => {
    const requestId = searchParams?.get("request") || "";
    if (!requestId || !normalizedAppointmentRequests.length) return;
    const index = normalizedAppointmentRequests.findIndex((request) => request.id === requestId);
    if (index < 0) return;
    openAppointmentRequestAt(index);
    try {
      const nextQuery = new URLSearchParams(searchParams?.toString() || "");
      nextQuery.delete("request");
      const suffix = nextQuery.toString();
      router.replace(`/dashboard/agenda${suffix ? `?${suffix}` : ""}`);
    } catch {}
  }, [normalizedAppointmentRequests, router, searchParams]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    const push = (key: string, event: DayEvent) => {
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    };

    for (const event of normalized) {
      if (!event.startDate) continue;
      if (event.allDay) {
        const start = new Date(event.startDate);
        const endExclusive = event.endDate ? new Date(event.endDate) : addDays(start, 1);
        let day = new Date(start);
        while (day < endExclusive) {
          push(keyOf(day), event);
          day = addDays(day, 1);
        }
      } else {
        const start = new Date(event.startDate);
        const end = event.endDate ? new Date(event.endDate) : new Date(event.startDate);
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
        let day = new Date(startDay);
        while (day <= endDay) {
          push(keyOf(day), event);
          day = addDays(day, 1);
        }
      }
    }

    for (const [key, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        const ta = a.startDate ? a.startDate.getTime() : 0;
        const tb = b.startDate ? b.startDate.getTime() : 0;
        return ta - tb;
      });
      map.set(key, list);
    }

    return map;
  }, [normalized]);

  const selectedKey = useMemo(() => keyOf(selectedDate), [selectedDate]);
  const selectedEvents = useMemo(() => eventsByDay.get(selectedKey) ?? [], [eventsByDay, selectedKey]);
  const globalMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    return normalized
      .filter((event) => (event.summary ?? "").toLowerCase().includes(normalizedQuery) || (event.location ?? "").toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        const ta = a.startDate ? a.startDate.getTime() : 0;
        const tb = b.startDate ? b.startDate.getTime() : 0;
        return ta - tb;
      });
  }, [normalized, query]);

  const navigableEvents = useMemo(() => {
    const source = query.trim() ? globalMatches : normalized;
    return [...source].sort((a, b) => {
      const ta = a.startDate ? a.startDate.getTime() : 0;
      const tb = b.startDate ? b.startDate.getTime() : 0;
      return ta - tb;
    });
  }, [globalMatches, normalized, query]);
  const navigableEventIndex = rdvMode === "edit" ? navigableEvents.findIndex((event) => event.id === rdvEventId) : -1;
  const eventNavigationLabel = navigableEventIndex >= 0 ? `${navigableEventIndex + 1} / ${navigableEvents.length}` : "";

  const navigateAgendaEvent = useCallback(async (direction: -1 | 1) => {
    if (rdvMode !== "edit" || navigableEventIndex < 0) return;
    const target = navigableEvents[navigableEventIndex + direction];
    if (!target) return;
    if (rdvHasUnsavedChanges) {
      const ok = await confirmInrcy({
        eyebrow: i18nT("agenda_891e9d6d"),
        title: i18nT("changer_d_evenement_8ee6ed37"),
        message: i18nT("les_modifications_non_enregistrees_de_l_11d9582d"),
        confirmLabel: i18nT("changer_d_evenement_7bd0879c"),
        cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
        variant: "warning",
      });
      if (!ok) return;
    }
    openEditRdv(target);
  }, [navigableEventIndex, navigableEvents, rdvHasUnsavedChanges, rdvMode]);

  const todayKey = useMemo(() => keyOf(new Date()), []);

  const goToday = () => {
    const now = new Date();
    setCursorMonth(startOfMonth(now));
    setSelectedDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
  };

  const goPrev = () => setCursorMonth(new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() - 1, 1));
  const goNext = () => setCursorMonth(new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 1));

  const jumpToEvent = (event: DayEvent) => {
    if (!event.startDate) return;
    const day = new Date(event.startDate.getFullYear(), event.startDate.getMonth(), event.startDate.getDate(), 0, 0, 0, 0);
    setSelectedDate(day);
    setCursorMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    setShowMobileSearch(false);
  };

  const rdvCurrentEvent = rdvMode === "edit" ? normalized.find((event) => event.id === rdvEventId) : null;
  const rdvIsDraft = isDraftEvent(rdvCurrentEvent);

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <AgendaHeader
          helpOpen={helpOpen}
          setHelpOpen={setHelpOpen}
          settingsOpen={settingsOpen}
          onOpenSettings={() => setSettingsOpen(true)}
          onCloseSettings={() => setSettingsOpen(false)}
          query={query}
          setQuery={setQuery}
          showMobileSearch={showMobileSearch}
          setShowMobileSearch={setShowMobileSearch}
          appointmentRequestsCount={normalizedAppointmentRequests.length}
          onOpenAppointmentRequests={() => openAppointmentRequestAt(Math.min(activeRequestIndex, Math.max(0, normalizedAppointmentRequests.length - 1)))}
          onClose={() => router.push("/dashboard")}
        />

        <div className={styles.layout}>
          <AgendaCalendarCard
            cursorMonth={cursorMonth}
            loading={loading}
            error={error}
            success={success}
            days={days}
            isSixWeeks={isSixWeeks}
            selectedKey={selectedKey}
            todayKey={todayKey}
            eventsByDay={eventsByDay}
            onDaySelect={setSelectedDate}
            onPrev={goPrev}
            onToday={goToday}
            onNext={goNext}
            onRefresh={() => loadEventsForMonth(cursorMonth)}
          />

          <AgendaSidebar
            selectedDate={selectedDate}
            selectedEvents={selectedEvents}
            loading={loading}
            query={query}
            globalMatches={globalMatches}
            onCreateEvent={() => openCreateRdv(selectedDate)}
            onOpenEvent={openEditRdv}
            onDeleteEvent={deleteEventById}
            onJumpToEvent={jumpToEvent}
          />
        </div>
      </div>

      <AgendaEventModal
        open={rdvOpen}
        rdvMode={rdvMode}
        rdvIsDraft={rdvIsDraft}
        rdvError={rdvError}
        rdvSaving={rdvSaving}
        rdvSummary={rdvSummary}
        rdvDate={rdvDate}
        rdvStart={rdvStart}
        rdvEnd={rdvEnd}
        rdvLocation={rdvLocation}
        rdvNotes={rdvNotes}
        rdvKind={rdvKind}
        intType={intType}
        intStatus={intStatus}
        intReference={intReference}
        rdvContactId={rdvContactId}
        rdvNewContactName={rdvNewContactName}
        rdvNewContactEmail={rdvNewContactEmail}
        rdvNewContactPhone={rdvNewContactPhone}
        rdvNewContactAddress={rdvNewContactAddress}
        rdvNewContactCity={rdvNewContactCity}
        rdvNewContactPostal={rdvNewContactPostal}
        rdvNewContactSiren={rdvNewContactSiren}
        rdvNewContactCategory={rdvNewContactCategory}
        rdvNewContactType={rdvNewContactType}
        rdvNewContactImportant={rdvNewContactImportant}
        rdvNewContactNotes={rdvNewContactNotes}
        rdvGuests={rdvGuests}
        rdvRemindersEnabled={rdvRemindersEnabled}
        rdvRemindersAvailable={rdvRemindersAvailable}
        crmAddFeedback={crmAddFeedback}
        contacts={contacts}
        contactsLoading={contactsLoading}
        startTimeOptions={startTimeOptions}
        endTimeOptions={endTimeOptions}
        onClose={requestCloseRdvModal}
        navigationLabel={eventNavigationLabel}
        canNavigatePrevious={rdvMode === "edit" && navigableEventIndex > 0}
        canNavigateNext={rdvMode === "edit" && navigableEventIndex >= 0 && navigableEventIndex < navigableEvents.length - 1}
        onNavigatePrevious={() => navigateAgendaEvent(-1)}
        onNavigateNext={() => navigateAgendaEvent(1)}
        onDelete={deleteRdv}
        onSubmit={submitRdv}
        onSaveDraft={saveRdvDraft}
        requestIndex={activeRequestIndex}
        requestCount={normalizedAppointmentRequests.length}
        onPreviousRequest={() => openAppointmentRequestAt((activeRequestIndex - 1 + normalizedAppointmentRequests.length) % normalizedAppointmentRequests.length)}
        onNextRequest={() => openAppointmentRequestAt((activeRequestIndex + 1) % normalizedAppointmentRequests.length)}
        onRejectRequest={rejectAppointmentRequest}
        onAddContactToCrm={addContactToCrmFromCoords}
        onAddGuest={addGuest}
        onRemoveGuest={removeGuest}
        onUpdateGuestContactId={updateGuestContactId}
        onUpdateGuestField={updateGuestField}
        clearCrmAddFeedback={() => setCrmAddFeedback("")}
        setRdvKind={setRdvKind}
        setRdvSummary={setRdvSummary}
        setRdvDate={setRdvDate}
        setRdvStart={setRdvStartAndSyncEnd}
        setRdvEnd={setRdvEnd}
        setRdvLocation={setRdvLocation}
        setRdvNotes={setRdvNotes}
        setIntType={setIntType}
        setIntStatus={setIntStatus}
        setIntReference={setIntReference}
        setRdvContactId={setRdvContactId}
        setRdvNewContactName={setRdvNewContactName}
        setRdvNewContactEmail={setRdvNewContactEmail}
        setRdvNewContactPhone={setRdvNewContactPhone}
        setRdvNewContactAddress={setRdvNewContactAddress}
        setRdvNewContactCity={setRdvNewContactCity}
        setRdvNewContactPostal={setRdvNewContactPostal}
        setRdvNewContactSiren={setRdvNewContactSiren}
        setRdvNewContactCategory={setRdvNewContactCategory}
        setRdvNewContactType={setRdvNewContactType}
        setRdvNewContactImportant={setRdvNewContactImportant}
        setRdvNewContactNotes={setRdvNewContactNotes}
        setRdvRemindersEnabled={setRdvRemindersEnabled}
      />
    </div>
  );
}

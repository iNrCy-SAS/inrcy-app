import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { optionalEnv } from "@/lib/env";
import { sendTxMail } from "@/lib/txMailer";
import { sendMailFromIntegration } from "@/lib/inrsend/sendMailFromIntegration";
import { withApi } from "@/lib/observability/withApi";
import { insertNotificationOnce } from "@/lib/notificationWriter";
import {
  buildClientExchangePreferences,
  DEFAULT_CLIENT_EXCHANGE_PREFERENCES,
  formatClientDateOnly,
  formatClientTimeOnly,
  getCalendarClientTexts,
  type ClientExchangePreferences,
} from "@/lib/clientCommunication";

/**
 * Agenda iNrCy NATIF (sans Google Calendar)
 *
 * Contrat conservé côté front :
 * - GET  /api/calendar/events?timeMin=ISO&timeMax=ISO  -> { ok:true, events: [...] }
 * - POST /api/calendar/events                         -> crée un event
 * - PATCH/DELETE via ?id=...                          -> modifie/supprime
 */

type CreateEventBody = {
  summary?: string;
  description?: string;
  location?: string;
  start?: string; // ISO datetime
  end?: string; // ISO datetime
  allDay?: boolean;
  date?: string; // YYYY-MM-DD if allDay
  inrcy?: unknown;
  contact?: unknown;
};

function assertIsoDateTime(v: unknown) {
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  return !Number.isNaN(t);
}

function assertDateOnly(v: unknown) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function normalizeAllDayRange(dateOnly: string) {
  // start inclusive, end exclusive (comme Google)
  const start = new Date(`${dateOnly}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type ReminderMeta = {
  enabled?: boolean;
  inAppMinutesBefore?: number;
  emailMinutesBefore?: number;
  mailAccountId?: string | null;
  lastInAppReminderAt?: string | null;
  lastEmailReminderAt?: string | null;
  emailSentAtByRecipient?: unknown;
};

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hasOwn(obj: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return cleanString(value).toLowerCase();
}

function normalizeGuests(value: unknown) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const raw = safeObj(item);
      const firstName = cleanString(raw.first_name);
      const lastName = cleanString(raw.last_name);
      const companyName = cleanString(raw.company_name);
      const displayName = cleanString(raw.display_name) || [firstName, lastName].filter(Boolean).join(" ").trim() || companyName;
      const email = cleanString(raw.email);
      const crmContactId = cleanString(raw.crm_contact_id ?? raw.contactId ?? raw.id);
      if (!displayName && !email && !crmContactId) return null;
      return {
        ...(crmContactId ? { crm_contact_id: crmContactId } : {}),
        display_name: displayName || email || "Invité",
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        ...(companyName ? { company_name: companyName } : {}),
        email,
        phone: cleanString(raw.phone),
        address: cleanString(raw.address),
        ...(cleanString(raw.city) ? { city: cleanString(raw.city) } : {}),
        ...(cleanString(raw.postal_code) ? { postal_code: cleanString(raw.postal_code) } : {}),
        ...(cleanString(raw.siren) ? { siren: cleanString(raw.siren) } : {}),
        ...(cleanString(raw.category) ? { category: cleanString(raw.category) } : {}),
        ...(cleanString(raw.contact_type) ? { contact_type: cleanString(raw.contact_type) } : {}),
        ...(cleanString(raw.notes) ? { notes: cleanString(raw.notes) } : {}),
        ...(typeof raw.important === "boolean" ? { important: raw.important } : {}),
      };
    })
    .filter(Boolean);
}

function getContactEmailsFromMeta(metaInput: unknown) {
  const meta = safeObj(metaInput);
  const contact = safeObj(meta.contact);
  const guests = Array.isArray(meta.guests) ? meta.guests : [];
  return [contact, ...guests.map((guest) => safeObj(guest))]
    .map((item) => normalizeEmail(item.email))
    .filter(Boolean)
    .sort()
    .join("|");
}

function resetReminderDelivery(metaInput: unknown) {
  const meta = safeObj(metaInput);
  const reminders = safeObj(meta.reminders);
  return {
    ...meta,
    reminders: {
      ...reminders,
      lastInAppReminderAt: null,
      lastEmailReminderAt: null,
      emailSentAtByRecipient: {},
    },
  };
}

function isPendingAppointmentRequest(metaInput: unknown) {
  const meta = safeObj(metaInput);
  return String(meta.source || "").toLowerCase() === "inrbadge" && String(meta.status || "").toLowerCase() === "pending";
}

function isRejectedAppointmentRequest(metaInput: unknown) {
  const meta = safeObj(metaInput);
  return String(meta.source || "").toLowerCase() === "inrbadge" && String(meta.status || "").toLowerCase() === "rejected";
}

function isDraftAgendaEvent(metaInput: unknown) {
  const meta = safeObj(metaInput);
  return String(meta.status || "").toLowerCase() === "draft";
}


function mapAgendaRowToClientEvent(e: Record<string, unknown>) {
  return {
    id: e.id,
    summary: e.title ?? "(Sans titre)",
    start: e.all_day ? (e.start_at ? String(e.start_at).slice(0, 10) : null) : e.start_at,
    end: e.all_day ? (e.end_at ? String(e.end_at).slice(0, 10) : null) : e.end_at,
    location: e.location ?? null,
    htmlLink: null,
    description: e.description ?? null,
    inrcy: e.meta ?? null,
  };
}

function toComparableIso(value: unknown) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function normalizeOptionalString(value: unknown) {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function normalizeComparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeComparable(item));
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const item = normalizeComparable(input[key]);
      if (item === undefined) continue;
      if (item === "") continue;
      if (Array.isArray(item) && item.length === 0) {
        out[key] = [];
        continue;
      }
      out[key] = item;
    }
    return out;
  }
  if (typeof value === "string") return value.trim();
  return value ?? null;
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeComparable(value));
}

function buildEventComparable(input: {
  title: unknown;
  description: unknown;
  location: unknown;
  allDay: unknown;
  startAt: unknown;
  endAt: unknown;
  meta: unknown;
}) {
  return stableStringify({
    title: normalizeOptionalString(input.title) || "(Sans titre)",
    description: normalizeOptionalString(input.description),
    location: normalizeOptionalString(input.location),
    all_day: Boolean(input.allDay),
    start_at: toComparableIso(input.startAt),
    end_at: toComparableIso(input.endAt),
    meta: input.meta,
  });
}

function buildAgendaMeta(input: unknown, previous?: unknown, rootContact?: unknown) {
  const next = safeObj(input);
  const prev = safeObj(previous);
  const prevReminders = safeObj(prev.reminders);
  const nextReminders = safeObj(next.reminders);
  const nextContact = safeObj(next.contact);
  const prevContact = safeObj(prev.contact);
  const bodyContact = safeObj(rootContact);
  const prevGuests = Array.isArray(prev.guests) ? normalizeGuests(prev.guests) : [];
  const nextGuests = hasOwn(next, "guests") ? normalizeGuests(next.guests) : undefined;

  const nextMailAccountId = typeof nextReminders.mailAccountId === "string" ? nextReminders.mailAccountId.trim() : nextReminders.mailAccountId === null ? null : undefined;
  const prevMailAccountId = typeof prevReminders.mailAccountId === "string" ? prevReminders.mailAccountId.trim() : prevReminders.mailAccountId === null ? null : undefined;

  const nextRemindersEnabled = typeof nextReminders.enabled === "boolean" ? nextReminders.enabled : undefined;
  const prevRemindersEnabled = typeof prevReminders.enabled === "boolean" ? prevReminders.enabled : undefined;

  const reminders: ReminderMeta = {
    enabled: nextRemindersEnabled !== undefined ? nextRemindersEnabled : prevRemindersEnabled !== undefined ? prevRemindersEnabled : true,
    inAppMinutesBefore: Number(nextReminders.inAppMinutesBefore ?? prevReminders.inAppMinutesBefore ?? 120),
    emailMinutesBefore: Number(nextReminders.emailMinutesBefore ?? prevReminders.emailMinutesBefore ?? 1440),
    mailAccountId: nextMailAccountId !== undefined ? (nextMailAccountId || null) : (prevMailAccountId || null),
    lastInAppReminderAt: typeof prevReminders.lastInAppReminderAt === "string" ? prevReminders.lastInAppReminderAt : null,
    lastEmailReminderAt: typeof prevReminders.lastEmailReminderAt === "string" ? prevReminders.lastEmailReminderAt : null,
    emailSentAtByRecipient: prevReminders.emailSentAtByRecipient,
  };

  const contact = Object.keys(nextContact).length
    ? nextContact
    : Object.keys(bodyContact).length
      ? bodyContact
      : Object.keys(prevContact).length
        ? prevContact
        : undefined;

  return {
    ...prev,
    ...next,
    ...(contact ? { contact } : {}),
    guests: nextGuests !== undefined ? nextGuests : prevGuests,
    reminders,
  };
}

const AGENDA_TIMEZONE = "Europe/Paris";

async function createAgendaConfirmationNotification(userId: string, title: string, startAt: string, remindersEnabled = true) {
  const when = new Date(startAt);
  const whenLabel = Number.isFinite(when.getTime())
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: AGENDA_TIMEZONE,
      }).format(when)
    : "bientôt";

  await insertNotificationOnce({
    user_id: userId,
    category: "information",
    kind: "agenda_event_saved",
    title: "Rendez-vous enregistré dans iNrCalendar",
    body: remindersEnabled
      ? `“${title || "Rendez-vous"}” est bien positionné pour le ${whenLabel}. Les rappels suivront les réglages iNr’Calendar pour le pro, le contact lié et les invités renseignés.`
      : `“${title || "Rendez-vous"}” est bien positionné pour le ${whenLabel}. Les rappels sont désactivés pour ce rendez-vous.`,
    cta_label: "Ouvrir l’agenda",
    cta_url: "/dashboard/agenda",
    dedupe_key: `agenda_saved:${userId}:${title}:${startAt}`,
    meta: { source: "agenda" },
  });
}


type ConfirmationMailRow = {
  title: string | null;
  description: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
};

type ConfirmationRecipient = {
  kind?: "contact" | "pro";
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  companyName?: string | null;
  phone?: string | null;
};

type ProMailDetails = {
  email?: string | null;
  firstName?: string | null;
  companyName?: string | null;
  phone?: string | null;
};

type CalendarMailSettings = {
  selectedMailAccountId: string;
  sendConfirmationOnSave: boolean;
};

function getSelectedMailAccountIdFromSettings(settings: unknown) {
  const root = safeObj(settings);
  const inrcalendar = safeObj(root.inrcalendar);
  const value = inrcalendar.selected_mail_account_id;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getSendConfirmationOnSaveFromSettings(settings: unknown) {
  const root = safeObj(settings);
  const inrcalendar = safeObj(root.inrcalendar);
  return inrcalendar.send_confirmation_on_save === true;
}

function getSelectedMailAccountIdFromMeta(metaInput: unknown) {
  const meta = safeObj(metaInput);
  const reminders = safeObj(meta.reminders);
  const value = reminders.mailAccountId ?? reminders.mail_account_id;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

async function getCalendarMailSettings(userId: string): Promise<CalendarMailSettings> {
  const { data } = await supabaseAdmin
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    selectedMailAccountId: getSelectedMailAccountIdFromSettings(data?.settings),
    sendConfirmationOnSave: getSendConfirmationOnSaveFromSettings(data?.settings),
  };
}

async function getProMailDetails(userId: string): Promise<ProMailDetails> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("contact_email, first_name, company_legal_name, phone")
    .eq("user_id", userId)
    .maybeSingle();

  const row = safeObj(profile);
  const adminUser = await supabaseAdmin.auth.admin.getUserById(userId).catch(() => null);

  return {
    email: normalizeEmail(row.contact_email) || normalizeEmail(adminUser?.data?.user?.email),
    firstName: typeof row.first_name === "string" ? row.first_name : null,
    companyName: typeof row.company_legal_name === "string" ? row.company_legal_name : null,
    phone: typeof row.phone === "string" ? row.phone : null,
  };
}

async function getClientExchangePreferences(userId: string): Promise<ClientExchangePreferences> {
  const { data } = await supabaseAdmin
    .from("business_profiles")
    .select("client_language, timezone, date_format, currency, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return buildClientExchangePreferences(data);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lineBreaksToHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function subjectSafe(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^ -~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtDateOnly(iso: string | null | undefined) {
  const d = new Date(String(iso || ""));
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: AGENDA_TIMEZONE,
      }).format(d)
    : "-";
}

function fmtTimeOnly(iso: string | null | undefined) {
  const d = new Date(String(iso || ""));
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: AGENDA_TIMEZONE,
      }).format(d)
    : "-";
}

function buildDisplayName(args: {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  companyName?: string | null;
  fallback?: string;
}) {
  const displayName = cleanString(args.displayName);
  if (displayName) return displayName;
  const fullName = [cleanString(args.firstName), cleanString(args.lastName)].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  const company = cleanString(args.companyName);
  if (company) return company;
  return args.fallback || "";
}

function getContactDetailsFromMeta(metaInput: unknown): ConfirmationRecipient & {
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  notes?: string | null;
} {
  const meta = safeObj(metaInput);
  const contact = safeObj(meta.contact);
  return {
    email: normalizeEmail(contact.email),
    firstName: typeof contact.first_name === "string" ? contact.first_name : null,
    lastName: typeof contact.last_name === "string" ? contact.last_name : null,
    companyName: typeof contact.company_name === "string" ? contact.company_name : null,
    displayName: typeof contact.display_name === "string" ? contact.display_name : null,
    phone: typeof contact.phone === "string" ? contact.phone : null,
    address: typeof contact.address === "string" ? contact.address : null,
    city: typeof contact.city === "string" ? contact.city : null,
    postalCode: typeof contact.postal_code === "string" ? contact.postal_code : null,
    notes: typeof contact.notes === "string" ? contact.notes : null,
  };
}

function getConfirmationRecipients(metaInput: unknown) {
  const meta = safeObj(metaInput);
  const contact = getContactDetailsFromMeta(meta);
  const guests = Array.isArray(meta.guests) ? meta.guests : [];
  const unique = new Map<string, ConfirmationRecipient>();

  if (contact.email) unique.set(contact.email, { ...contact, kind: "contact" });

  for (const item of guests) {
    const guest = safeObj(item);
    const email = normalizeEmail(guest.email);
    if (!email || unique.has(email)) continue;
    unique.set(email, {
      kind: "contact",
      email,
      firstName: typeof guest.first_name === "string" ? guest.first_name : null,
      lastName: typeof guest.last_name === "string" ? guest.last_name : null,
      companyName: typeof guest.company_name === "string" ? guest.company_name : null,
      displayName: typeof guest.display_name === "string" ? guest.display_name : null,
      phone: typeof guest.phone === "string" ? guest.phone : null,
    });
  }

  return Array.from(unique.values());
}

function addProToConfirmationRecipients(recipients: ConfirmationRecipient[], pro: ProMailDetails) {
  const unique = new Map<string, ConfirmationRecipient>();

  for (const recipient of recipients) {
    if (!recipient.email) continue;
    unique.set(recipient.email, recipient);
  }

  const proEmail = normalizeEmail(pro.email);
  if (proEmail && !unique.has(proEmail)) {
    unique.set(proEmail, {
      kind: "pro",
      email: proEmail,
      firstName: pro.firstName ?? null,
      displayName: pro.firstName ?? null,
      companyName: pro.companyName ?? null,
      phone: pro.phone ?? null,
    });
  }

  return Array.from(unique.values());
}

function buildConfirmationMail(args: {
  row: ConfirmationMailRow;
  meta: unknown;
  recipient: ConfirmationRecipient;
  pro: ProMailDetails;
  mode: "created" | "updated";
  clientPreferences?: ClientExchangePreferences;
}) {
  const { row, meta, recipient, pro, mode } = args;
  const contact = getContactDetailsFromMeta(meta);
  const isProRecipient = recipient.kind === "pro";
  const clientPreferences = args.clientPreferences || DEFAULT_CLIENT_EXCHANGE_PREFERENCES;
  const clientTexts = getCalendarClientTexts(clientPreferences.clientLanguage);
  const eventTitle = cleanString(row.title) || (isProRecipient ? "Rendez-vous" : clientTexts.generic.appointment);
  const companyName = cleanString(pro.companyName) || (isProRecipient ? "Votre professionnel" : clientTexts.generic.professional);
  const proName = buildDisplayName({ firstName: pro.firstName, companyName: pro.companyName, fallback: companyName });
  const recipientName = buildDisplayName({
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    displayName: recipient.displayName,
    companyName: recipient.companyName,
    fallback: "",
  });
  const greeting = isProRecipient ? (recipientName ? `Bonjour ${recipientName},` : "Bonjour,") : clientTexts.generic.greeting(recipientName);
  const dateLabel = isProRecipient ? fmtDateOnly(row.start_at) : formatClientDateOnly(row.start_at, clientPreferences);
  const startTime = isProRecipient ? fmtTimeOnly(row.start_at) : formatClientTimeOnly(row.start_at, clientPreferences);
  const endTime = isProRecipient ? fmtTimeOnly(row.end_at) : formatClientTimeOnly(row.end_at, clientPreferences);
  const phonePro = cleanString(pro.phone);
  const address = cleanString(row.location)
    || [cleanString(contact.address), [cleanString(contact.postalCode), cleanString(contact.city)].filter(Boolean).join(" ").trim()].filter(Boolean).join(", ");
  const notes = cleanString(row.description);

  const clientName = buildDisplayName({
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    companyName: contact.companyName,
    fallback: "Client",
  });
  const phoneClient = cleanString(contact.phone);
  const emailClient = cleanString(contact.email);

  const subjectBase = isProRecipient
    ? mode === "updated"
      ? `Mise à jour RDV iNr'Calendar - ${clientName}`
      : `Nouveau rendez-vous enregistré - ${clientName}`
    : mode === "updated"
      ? clientTexts.confirmation.subjectUpdated(eventTitle)
      : clientTexts.confirmation.subjectCreated(eventTitle);
  const subject = subjectSafe(subjectBase) || (isProRecipient ? "Confirmation de rendez-vous" : clientTexts.confirmation.subjectCreated(eventTitle));

  const title = isProRecipient
    ? mode === "updated"
      ? "Rendez-vous mis à jour"
      : "Nouveau rendez-vous enregistré"
    : mode === "updated"
      ? clientTexts.confirmation.titleUpdated
      : clientTexts.confirmation.titleCreated;
  const intro = isProRecipient
    ? mode === "updated"
      ? "Le rendez-vous a été mis à jour dans votre agenda."
      : "Le rendez-vous est bien enregistré dans votre agenda."
    : mode === "updated"
      ? clientTexts.confirmation.introUpdated(companyName)
      : clientTexts.confirmation.introCreated(companyName);

  const rows = isProRecipient
    ? [
        ["Client", clientName],
        ["Date", dateLabel],
        ["Horaire", `${startTime}${endTime !== "-" ? ` → ${endTime}` : ""}`],
        ["Motif", eventTitle],
        address ? ["Lieu", address] : null,
        emailClient ? ["Email client", emailClient] : null,
        phoneClient ? ["Téléphone client", phoneClient] : null,
        notes ? ["Notes / précisions", notes] : null,
      ].filter(Boolean) as string[][]
    : [
        [clientTexts.labels.date, dateLabel],
        [clientTexts.labels.time, `${startTime}${endTime !== "-" ? ` → ${endTime}` : ""}`],
        [clientTexts.labels.reason, eventTitle],
        address ? [clientTexts.labels.location, address] : null,
        [clientTexts.labels.professional, proName],
        phonePro ? [clientTexts.labels.phone, phonePro] : null,
        notes ? [clientTexts.labels.usefulInfo, notes] : null,
      ].filter(Boolean) as string[][];

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:0 0 14px 0;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8fa4ca;">${escapeHtml(label)}</div>
        <div style="height:5px;line-height:5px;font-size:0;">&nbsp;</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#e7eefc;">${lineBreaksToHtml(value)}</div>
      </td>
    </tr>`).join("");

  const statusLabel = isProRecipient
    ? mode === "updated"
      ? "RDV MIS À JOUR"
      : "RDV CONFIRMÉ"
    : mode === "updated"
      ? clientTexts.confirmation.statusUpdated
      : clientTexts.confirmation.statusCreated;
  const detailsTitle = isProRecipient ? "Détails du rendez-vous" : clientTexts.confirmation.detailsTitle;
  const footerText = isProRecipient ? "Mail automatique envoyé par iNr’Calendar." : clientTexts.generic.automaticMail;

  const html = `<!doctype html>
<html lang="${isProRecipient ? "fr" : clientTexts.htmlLang}">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#041126;background-color:#041126;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#041126" style="width:100%;background:#041126;">
      <tr>
        <td align="center" style="padding:26px 12px 34px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;">
            <tr>
              <td style="border-radius:28px;overflow:hidden;background:#071736;background-image:linear-gradient(135deg,#0b2450 0%,#071736 56%,#2c1f6a 100%);border:1px solid rgba(120,143,190,.22);box-shadow:0 24px 60px rgba(2,8,23,.45);">
                <div style="padding:24px 24px 18px 24px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;letter-spacing:.04em;color:#93c5fd;">iNr’Calendar</div>
                  <div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
                  <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:#20345f;color:#dbeafe;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">${escapeHtml(statusLabel)}</div>
                  <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.15;color:#ffffff;font-weight:900;">${escapeHtml(title)}</div>
                  <div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#eef4ff;">${escapeHtml(greeting)}<br />${escapeHtml(intro)}</div>
                </div>
                <div style="padding:0 24px 24px 24px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0d1630" style="width:100%;border-radius:22px;background:#0d1630;border:1px solid rgba(148,163,184,.14);">
                    <tr>
                      <td style="padding:22px 22px 8px 22px;">
                        <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;color:#ffffff;font-weight:800;">${escapeHtml(detailsTitle)}</div>
                        <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${htmlRows}</table>
                      </td>
                    </tr>
                  </table>
                </div>
                <div style="padding:0 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.75;color:#97a6c5;">
                  ${escapeHtml(footerText)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    greeting,
    "",
    title,
    intro,
    "",
    ...rows.map(([label, value]) => `${label} : ${value}`),
    "",
    footerText,
  ].join("\n");

  return { subject, text, html };
}

async function sendAgendaConfirmationEmails(args: {
  userId: string;
  row: ConfirmationMailRow;
  meta: unknown;
  mode: "created" | "updated";
}) {
  const settings = await getCalendarMailSettings(args.userId);
  if (!settings.sendConfirmationOnSave) return;

  const pro = await getProMailDetails(args.userId);
  const clientPreferences = await getClientExchangePreferences(args.userId);
  const recipients = addProToConfirmationRecipients(getConfirmationRecipients(args.meta), pro);
  if (!recipients.length) return;
  const selectedMailAccountId = settings.selectedMailAccountId || getSelectedMailAccountIdFromMeta(args.meta);
  const smtpConfigured = Boolean(
    optionalEnv("TX_SMTP_HOST") &&
    optionalEnv("TX_SMTP_PORT") &&
    optionalEnv("TX_SMTP_USER") &&
    optionalEnv("TX_SMTP_PASS")
  );

  for (const recipient of recipients) {
    const mail = buildConfirmationMail({ row: args.row, meta: args.meta, recipient, pro, mode: args.mode, clientPreferences });

    try {
      let sent = false;

      if (selectedMailAccountId) {
        try {
          await sendMailFromIntegration({
            userId: args.userId,
            accountId: selectedMailAccountId,
            to: recipient.email,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            includeAutoSignature: false,
            preserveHtml: true,
          });
          sent = true;
        } catch (integrationError) {
          console.error("[calendar-events] confirmation integration delivery failed, fallback to iNrCy", {
            recipient: recipient.email,
            accountId: selectedMailAccountId,
            error: integrationError,
          });
        }
      }

      if (!sent && smtpConfigured) {
        await sendTxMail({ to: recipient.email, subject: mail.subject, text: mail.text, html: mail.html });
      }
    } catch (mailError) {
      console.error("[calendar-events] confirmation send failed", {
        recipient: recipient.email,
        mode: args.mode,
        error: mailError,
      });
    }
  }
}

async function getCalendarEventsHandler(req: Request) {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(req.url);
  const qTimeMin = searchParams.get("timeMin");
  const qTimeMax = searchParams.get("timeMax");

  if (!qTimeMin || !qTimeMax) return bad("timeMin et timeMax sont requis");
  if (!assertIsoDateTime(qTimeMin) || !assertIsoDateTime(qTimeMax)) return bad("Range invalide");

  const timeMin = new Date(qTimeMin);
  const timeMax = new Date(qTimeMax);
  if (timeMax <= timeMin) return bad("Range invalide");

  const { data, error } = await supabase
    .from("agenda_events")
    .select("id,title,description,location,start_at,end_at,all_day,meta")
    .eq("user_id", activeUserId)
    .lt("start_at", timeMax.toISOString())
    .gt("end_at", timeMin.toISOString())
    .order("start_at", { ascending: true })
    .limit(500);

  if (error) return jsonUserFacingError(error, { status: 500, extra: { ok: false } });

  const events = (data ?? [])
    .filter((e: Record<string, unknown>) => !isPendingAppointmentRequest(e.meta) && !isRejectedAppointmentRequest(e.meta))
    .map(mapAgendaRowToClientEvent);

  const { data: pendingRequests, error: pendingRequestsError } = await supabase
    .from("agenda_events")
    .select("id,title,description,location,start_at,end_at,all_day,meta")
    .eq("user_id", activeUserId)
    .contains("meta", { source: "inrbadge", status: "pending" })
    .order("start_at", { ascending: true })
    .limit(100);

  if (pendingRequestsError) {
    console.warn("[calendar-events] appointment requests load failed", pendingRequestsError);
  }

  const appointmentRequests = (pendingRequests ?? []).map(mapAgendaRowToClientEvent);

  return NextResponse.json({
    ok: true,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    events,
    appointmentRequests,
  });
}

async function createCalendarEventHandler(req: Request) {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = (await req.json().catch(() => ({}))) as CreateEventBody;
  const allDay = Boolean(body.allDay);

  let startAt: string;
  let endAt: string;

  if (allDay) {
    const date = body.date;
    if (!date) return bad("date (YYYY-MM-DD) requis pour allDay");
    if (!assertDateOnly(date)) return bad("date (YYYY-MM-DD) requis pour allDay");

    const r = normalizeAllDayRange(date);
    startAt = r.start;
    endAt = r.end;
  } else {
    if (!assertIsoDateTime(body.start) || !assertIsoDateTime(body.end)) return bad("start/end ISO requis");
    if (new Date(body.end!) <= new Date(body.start!)) return bad("end doit être > start");

    startAt = new Date(body.start!).toISOString();
    endAt = new Date(body.end!).toISOString();
  }

  const meta = buildAgendaMeta(body.inrcy, undefined, body.contact);

  const { data, error } = await supabase
    .from("agenda_events")
    .insert({
      user_id: activeUserId,
      title: body.summary ?? "(Sans titre)",
      description: body.description ?? null,
      location: body.location ?? null,
      start_at: startAt,
      end_at: endAt,
      all_day: allDay,
      meta,
    })
    .select("id")
    .single();

  if (error) return jsonUserFacingError(error, { status: 500, extra: { ok: false } });
  if (!isDraftAgendaEvent(meta)) {
    await createAgendaConfirmationNotification(activeUserId, String(body.summary ?? "(Sans titre)"), startAt, safeObj(meta.reminders).enabled !== false).catch(() => null);
    await sendAgendaConfirmationEmails({
      userId: activeUserId,
      row: {
        title: String(body.summary ?? "(Sans titre)"),
        description: body.description ?? null,
        location: body.location ?? null,
        start_at: startAt,
        end_at: endAt,
      },
      meta,
      mode: "created",
    }).catch(() => null);
  }
  return NextResponse.json({ ok: true, id: data?.id });
}

async function updateCalendarEventHandler(req: Request) {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return bad("id requis");

  const body = (await req.json().catch(() => ({}))) as CreateEventBody;
  const allDay = Boolean(body.allDay);

  const { data: current, error: currentError } = await supabase
    .from("agenda_events")
    .select("meta,start_at,end_at,title,description,location,all_day")
    .eq("id", id)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (currentError) return jsonUserFacingError(currentError, { status: 500, extra: { ok: false } });
  if (!current) return bad("Rendez-vous introuvable", 404);

  let startAt: string;
  let endAt: string;

  if (allDay) {
    const date = body.date;
    if (!date || !assertDateOnly(date)) return bad("date (YYYY-MM-DD) requis pour allDay");
    const r = normalizeAllDayRange(date);
    startAt = r.start;
    endAt = r.end;
  } else {
    if (!assertIsoDateTime(body.start) || !assertIsoDateTime(body.end)) return bad("start/end ISO requis");
    if (new Date(body.end!) <= new Date(body.start!)) return bad("end doit être > start");
    startAt = new Date(body.start!).toISOString();
    endAt = new Date(body.end!).toISOString();
  }

  const nextTitle = body.summary ?? current.title ?? "(Sans titre)";
  const nextDescription = body.description ?? current.description ?? null;
  const nextLocation = body.location ?? current.location ?? null;
  const nextMetaRaw = buildAgendaMeta(body.inrcy, current.meta, body.contact);
  const currentWasPendingRequest = isPendingAppointmentRequest(current.meta);
  const nextMetaStatus = String(safeObj(nextMetaRaw).status || "").toLowerCase();
  const validatesPendingRequest = currentWasPendingRequest && nextMetaStatus === "confirmed";

  const scheduleChanged =
    toComparableIso(current.start_at) !== toComparableIso(startAt) ||
    toComparableIso(current.end_at) !== toComparableIso(endAt) ||
    Boolean(current.all_day) !== allDay;
  const recipientsChanged = getContactEmailsFromMeta(current.meta) !== getContactEmailsFromMeta(nextMetaRaw);
  const nextMeta = scheduleChanged || recipientsChanged ? resetReminderDelivery(nextMetaRaw) : nextMetaRaw;

  const beforeComparable = buildEventComparable({
    title: current.title,
    description: current.description,
    location: current.location,
    allDay: current.all_day,
    startAt: current.start_at,
    endAt: current.end_at,
    meta: current.meta,
  });
  const afterComparable = buildEventComparable({
    title: nextTitle,
    description: nextDescription,
    location: nextLocation,
    allDay,
    startAt,
    endAt,
    meta: nextMeta,
  });
  const eventChanged = beforeComparable !== afterComparable;

  if (!eventChanged) {
    return NextResponse.json({ ok: true, unchanged: true, message: "Aucune modification détectée." });
  }

  const patch: Record<string, unknown> = {
    title: nextTitle,
    description: nextDescription,
    location: nextLocation,
    all_day: allDay,
    start_at: startAt,
    end_at: endAt,
    meta: nextMeta,
  };

  const { error } = await supabase.from("agenda_events").update(patch).eq("id", id).eq("user_id", activeUserId);

  if (error) return jsonUserFacingError(error, { status: 500, extra: { ok: false } });
  if (!isDraftAgendaEvent(nextMeta)) {
    await createAgendaConfirmationNotification(activeUserId, String(nextTitle), startAt, safeObj(nextMeta.reminders).enabled !== false).catch(() => null);
    if (eventChanged) {
      await sendAgendaConfirmationEmails({
        userId: activeUserId,
        row: {
          title: String(nextTitle),
          description: typeof nextDescription === "string" ? nextDescription : null,
          location: typeof nextLocation === "string" ? nextLocation : null,
          start_at: startAt,
          end_at: endAt,
        },
        meta: nextMeta,
        mode: validatesPendingRequest ? "created" : "updated",
      }).catch(() => null);
    }
  }
  return NextResponse.json({ ok: true });
}

async function deleteCalendarEventHandler(req: Request) {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return bad("id requis");

  const { error } = await supabase.from("agenda_events").delete().eq("id", id).eq("user_id", activeUserId);
  if (error) return jsonUserFacingError(error, { status: 500, extra: { ok: false } });
  return NextResponse.json({ ok: true });
}

export const GET = withApi(getCalendarEventsHandler, { route: "/api/calendar/events" });
export const POST = withApi(createCalendarEventHandler, { route: "/api/calendar/events" });
export const PATCH = withApi(updateCalendarEventHandler, { route: "/api/calendar/events" });
export const DELETE = withApi(deleteCalendarEventHandler, { route: "/api/calendar/events" });

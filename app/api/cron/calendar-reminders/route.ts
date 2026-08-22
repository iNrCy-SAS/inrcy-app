import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";
import { isTxSmtpCircuitOpenError } from "@/lib/txSmtpCircuit";
import { optionalEnv } from "@/lib/env";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { sendMailFromIntegration } from "@/lib/inrsend/sendMailFromIntegration";
import { getConnectionDisplayStatus, mailConnectionKind } from "@/lib/connectionVersions";
import {
  buildClientExchangePreferences,
  DEFAULT_CLIENT_EXCHANGE_PREFERENCES,
  formatClientDateOnly,
  formatClientDateTime,
  formatClientTimeOnly,
  getCalendarClientTexts,
  type ClientExchangePreferences,
} from "@/lib/clientCommunication";

export const runtime = "nodejs";

const DEFAULT_EMAIL_REMINDER_OFFSETS_MINUTES = [1440, 120];
const ALLOWED_EMAIL_REMINDER_OFFSETS_MINUTES = [2880, 1440, 120];

type RecipientKind = "pro" | "contact";

type RecipientInfo = {
  kind: RecipientKind;
  sentKey: string;
  email: string;
  label: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  companyName?: string | null;
  phone?: string | null;
};

type CalendarReminderSettings = {
  selectedMailAccountId: string;
  reminderOffsetsMinutes: number[];
};

type ReminderRow = {
  title: string | null;
  description: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
};

type ReminderMailAccountRow = {
  id: string;
  provider: string | null;
  status: string | null;
  settings: unknown;
};

function isAuthorizedCron(req: Request) {
  const cronSecret = process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!cronSecret) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  const querySecret = new URL(req.url).searchParams.get("secret") || "";
  return bearer === cronSecret || headerSecret === cronSecret || querySecret === cronSecret;
}

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isInactiveAppointmentRequest(metaInput: unknown) {
  const meta = safeObj(metaInput);
  const source = String(meta.source || "").toLowerCase();
  const status = String(meta.status || "").toLowerCase();
  return source === "inrbadge" && (status === "pending" || status === "rejected");
}

function asNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const AGENDA_TIMEZONE = "Europe/Paris";
const APP_ORIGIN = optionalEnv("NEXT_PUBLIC_SITE_URL", optionalEnv("NEXT_PUBLIC_APP_URL", "https://app.inrcy.com")).replace(/\/$/, "");
const AGENDA_DASHBOARD_URL = `${APP_ORIGIN}/dashboard/agenda`;
const INR_CALENDAR_LOGO_CID = "inrcalendar-logo@inrcy";
const INRCY_LOGO_CID = "inrcy-logo@inrcy";

type InlineMailAttachment = {
  filename: string;
  mimeType?: string;
  content: Buffer;
  inline?: boolean;
  cid?: string;
};

const EMAIL_LOGO_DIMENSIONS = {
  calendar: { width: 188, height: 71 },
  inrcy: { width: 108, height: 41 },
} as const;

const REMINDER_INLINE_ATTACHMENT_SPECS = [
  {
    filename: "inrcalendar-logo-email.png",
    mimeType: "image/png",
    cid: INR_CALENDAR_LOGO_CID,
  },
  {
    filename: "inrcy-logo-email.png",
    mimeType: "image/png",
    cid: INRCY_LOGO_CID,
  },
] as const;

let reminderInlineAttachmentsPromise: Promise<InlineMailAttachment[]> | null = null;

function getReminderInlineAttachments() {
  if (!reminderInlineAttachmentsPromise) {
    reminderInlineAttachmentsPromise = Promise.all([
      readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "public/email/inrcalendar-logo-email.png")),
      readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "public/email/inrcy-logo-email.png")),
    ]).then(([calendarLogo, inrcyLogo]) => [
      {
        ...REMINDER_INLINE_ATTACHMENT_SPECS[0],
        content: calendarLogo,
        inline: true,
      },
      {
        ...REMINDER_INLINE_ATTACHMENT_SPECS[1],
        content: inrcyLogo,
        inline: true,
      },
    ]);
  }

  return reminderInlineAttachmentsPromise.then((attachments) =>
    attachments.map((attachment) => ({
      ...attachment,
      content: Buffer.from(attachment.content),
    }))
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: AGENDA_TIMEZONE,
      }).format(d)
    : iso;
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

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanString(value: unknown) {
  const str = String(value || "").trim();
  return str || "";
}

function offsetLabel(minutes: number) {
  if (minutes === 2880) return "48h avant";
  if (minutes === 1440) return "24h avant";
  if (minutes === 120) return "2h avant";
  if (minutes % 60 === 0) return `${minutes / 60}h avant`;
  return `${minutes} min avant`;
}

function subjectSafe(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^ -~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getProRecipient(userId: string): Promise<RecipientInfo | null> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("contact_email, first_name, company_legal_name, phone")
    .eq("user_id", userId)
    .maybeSingle();

  const row = safeObj(profile);
  const profileEmail = normalizeEmail(row.contact_email);
  if (profileEmail) {
    return {
      kind: "pro",
      sentKey: "pro",
      email: profileEmail,
      label: "pro",
      firstName: typeof row.first_name === "string" ? row.first_name : null,
      companyName: typeof row.company_legal_name === "string" ? row.company_legal_name : null,
      phone: typeof row.phone === "string" ? row.phone : null,
    };
  }

  const adminUser = await supabaseAdmin.auth.admin.getUserById(userId).catch(() => null);
  const authEmail = normalizeEmail(adminUser?.data?.user?.email);
  if (!authEmail) return null;

  return {
    kind: "pro",
    sentKey: "pro",
    email: authEmail,
    label: "pro",
    firstName: typeof row.first_name === "string" ? row.first_name : null,
    companyName: typeof row.company_legal_name === "string" ? row.company_legal_name : null,
    phone: typeof row.phone === "string" ? row.phone : null,
  };
}

function getContactDetails(meta: Record<string, unknown>) {
  const rootContact = safeObj(meta.contact);
  const nestedContact = safeObj(safeObj(meta.inrcy).contact);
  const contact = Object.keys(nestedContact).length ? nestedContact : rootContact;
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

function getContactRecipient(meta: Record<string, unknown>): RecipientInfo | null {
  const contact = getContactDetails(meta);
  if (!contact.email) return null;
  return {
    kind: "contact",
    sentKey: `contact:${contact.email}`,
    email: contact.email,
    label: "client",
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    companyName: contact.companyName,
    phone: contact.phone,
  };
}

function getGuestRecipients(meta: Record<string, unknown>): RecipientInfo[] {
  const rootGuests = Array.isArray(meta.guests) ? meta.guests : [];
  const nestedGuests = Array.isArray(safeObj(meta.inrcy).guests) ? (safeObj(meta.inrcy).guests as unknown[]) : [];
  const guests = rootGuests.length ? rootGuests : nestedGuests;

  return guests
    .map((item, index) => {
      const guest = safeObj(item);
      const email = normalizeEmail(guest.email);
      if (!email) return null;
      return {
        kind: "contact" as const,
        sentKey: `guest:${email}`,
        email,
        label: `invité ${index + 1}`,
        firstName: typeof guest.first_name === "string" ? guest.first_name : null,
        lastName: typeof guest.last_name === "string" ? guest.last_name : null,
        displayName: typeof guest.display_name === "string" ? guest.display_name : null,
        companyName: typeof guest.company_name === "string" ? guest.company_name : null,
        phone: typeof guest.phone === "string" ? guest.phone : null,
      };
    })
    .filter(Boolean) as RecipientInfo[];
}

function getReminderMailAccountId(meta: Record<string, unknown>) {
  const rootReminders = safeObj(meta.reminders);
  const nestedReminders = safeObj(safeObj(meta.inrcy).reminders);
  const reminders = Object.keys(rootReminders).length ? rootReminders : nestedReminders;
  const value = reminders.mailAccountId;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getSelectedMailAccountIdFromSettings(settings: unknown) {
  const root = safeObj(settings);
  const inrcalendar = safeObj(root.inrcalendar);
  const value = inrcalendar.selected_mail_account_id;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeReminderOffsets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_EMAIL_REMINDER_OFFSETS_MINUTES;
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => ALLOWED_EMAIL_REMINDER_OFFSETS_MINUTES.includes(item))
    )
  );
}

function getCalendarReminderSettingsFromSettings(settings: unknown): CalendarReminderSettings {
  const root = safeObj(settings);
  const inrcalendar = safeObj(root.inrcalendar);
  return {
    selectedMailAccountId: getSelectedMailAccountIdFromSettings(settings),
    reminderOffsetsMinutes: normalizeReminderOffsets(inrcalendar.reminder_offsets_minutes),
  };
}

async function resolveUsableReminderMailAccountId(userId: string, accountId: string) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedAccountId = String(accountId || "").trim();
  if (!normalizedUserId || !normalizedAccountId) return "";

  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id,provider,status,settings")
    .eq("id", normalizedAccountId)
    .eq("user_id", normalizedUserId)
    .eq("category", "mail")
    .maybeSingle();

  if (error) throw error;

  const account = (data || null) as ReminderMailAccountRow | null;
  if (!account?.id || account.status !== "connected") return "";

  const connectionKind = mailConnectionKind(account.provider || "");
  if (!connectionKind) return "";

  const displayStatus = getConnectionDisplayStatus(
    true,
    connectionKind,
    account.settings,
  );

  return displayStatus === "connected" ? account.id : "";
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

function buildRecipients(...groups: Array<RecipientInfo | RecipientInfo[] | null>) {
  const unique = new Map<string, RecipientInfo>();
  for (const group of groups) {
    const recipients = Array.isArray(group) ? group : [group];
    for (const recipient of recipients) {
      if (!recipient?.email) continue;
      if (unique.has(recipient.email)) continue;
      unique.set(recipient.email, recipient);
    }
  }
  return Array.from(unique.values());
}

function getRecipientSentAt(reminders: Record<string, unknown>, recipient: RecipientInfo, offsetMinutes: number) {
  const sentAtByRecipient = safeObj(reminders.emailSentAtByRecipient);
  const candidateKeys = [recipient.sentKey];

  // Compatibilité avec les anciens rappels stockés sous "pro" / "contact".
  if (recipient.kind === "pro") candidateKeys.push("pro");
  if (recipient.kind === "contact" && recipient.sentKey.startsWith("contact:")) candidateKeys.push("contact");

  for (const key of candidateKeys) {
    const sentAtByOffset = safeObj(sentAtByRecipient[key]);
    const current = sentAtByOffset[String(offsetMinutes)];
    if (typeof current === "string" && current.trim()) return current;
  }

  if (
    recipient.kind === "pro" &&
    offsetMinutes === 1440 &&
    typeof reminders.lastEmailReminderAt === "string" &&
    reminders.lastEmailReminderAt.trim()
  ) {
    return reminders.lastEmailReminderAt;
  }

  return null;
}

function markRecipientSent(
  reminders: Record<string, unknown>,
  recipient: RecipientInfo,
  offsetMinutes: number,
  sentAtIso: string,
) {
  const sentAtByRecipient = safeObj(reminders.emailSentAtByRecipient);
  const sentAtByOffset = safeObj(sentAtByRecipient[recipient.sentKey]);

  return {
    ...reminders,
    emailSentAtByRecipient: {
      ...sentAtByRecipient,
      [recipient.sentKey]: {
        ...sentAtByOffset,
        [String(offsetMinutes)]: sentAtIso,
      },
    },
    lastEmailReminderAt: offsetMinutes === 1440 ? sentAtIso : reminders.lastEmailReminderAt ?? null,
  };
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

function buildDisplayName(args: { firstName?: string | null; lastName?: string | null; displayName?: string | null; companyName?: string | null; fallback?: string }) {
  const displayName = cleanString(args.displayName);
  if (displayName) return displayName;
  const fullName = [cleanString(args.firstName), cleanString(args.lastName)].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  const company = cleanString(args.companyName);
  if (company) return company;
  return args.fallback || "-";
}

function buildAddress(args: { location?: string | null; address?: string | null; city?: string | null; postalCode?: string | null }) {
  const direct = cleanString(args.location);
  if (direct) return direct;
  const parts = [cleanString(args.address), [cleanString(args.postalCode), cleanString(args.city)].filter(Boolean).join(" ").trim()].filter(Boolean);
  return parts.join(", ");
}

function buildMapsUrl(address: string) {
  const clean = cleanString(address);
  return clean ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}` : "";
}

function infoRow(label: string, value: string) {
  const safeLabel = escapeHtml(label);
  const safeValue = lineBreaksToHtml(value);
  return `
    <tr>
      <td style="padding:0 0 16px 0;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8fa4ca;">${safeLabel}</div>
        <div style="height:6px;line-height:6px;font-size:0;">&nbsp;</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#e7eefc;">${safeValue}</div>
      </td>
    </tr>`;
}

function ctaButton(label: string, href: string, variant: "primary" | "secondary" = "primary") {
  const backgroundColor = variant === "primary" ? "#5b74ff" : "#16223f";
  const backgroundImage = variant === "primary" ? "linear-gradient(135deg,#38bdf8 0%,#8b5cf6 52%,#ec4899 100%)" : "none";
  const color = "#ffffff";
  return `
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 18px;border-radius:12px;background-color:${backgroundColor};background-image:${backgroundImage};color:${color};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;margin:0 10px 10px 0;border:1px solid #d8e4f1;">
      ${escapeHtml(label)}
    </a>`;
}

function buildReminderMail(row: ReminderRow, meta: Record<string, unknown>, offsetMinutes: number, recipient: RecipientInfo, proRecipient: RecipientInfo | null, clientPreferences: ClientExchangePreferences = DEFAULT_CLIENT_EXCHANGE_PREFERENCES) {
  const isProRecipient = recipient.kind === "pro";
  const texts = getCalendarClientTexts(clientPreferences.clientLanguage);
  const reminderLabel = isProRecipient ? offsetLabel(offsetMinutes) : texts.reminder.offsetLabel(offsetMinutes);
  const eventTitle = cleanString(row.title) || (isProRecipient ? "Rendez-vous" : texts.generic.appointment);
  const contact = getContactDetails(meta);
  const companyName = cleanString(proRecipient?.companyName) || (isProRecipient ? "iNrCy" : texts.generic.professional);
  const proName = buildDisplayName({ firstName: proRecipient?.firstName, companyName: proRecipient?.companyName, fallback: isProRecipient ? "Votre professionnel" : texts.generic.professional });
  const clientName = buildDisplayName({
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    companyName: contact.companyName,
    fallback: "Client",
  });
  const greetingName = isProRecipient
    ? buildDisplayName({ firstName: recipient.firstName, displayName: recipient.displayName, companyName: recipient.companyName, fallback: "" })
    : buildDisplayName({ firstName: recipient.firstName, lastName: recipient.lastName, displayName: recipient.displayName, companyName: recipient.companyName, fallback: "" });
  const greeting = isProRecipient ? (greetingName && greetingName !== "-" ? `Bonjour ${greetingName},` : "Bonjour,") : texts.generic.greeting(greetingName && greetingName !== "-" ? greetingName : "");
  const dateLabel = isProRecipient ? fmtDateOnly(row.start_at) : formatClientDateOnly(row.start_at, clientPreferences);
  const startTime = isProRecipient ? fmtTimeOnly(row.start_at) : formatClientTimeOnly(row.start_at, clientPreferences);
  const endTime = isProRecipient ? fmtTimeOnly(row.end_at) : formatClientTimeOnly(row.end_at, clientPreferences);
  const formattedDateTime = isProRecipient ? fmtDate(String(row.start_at || "")) : formatClientDateTime(row.start_at, clientPreferences);
  const address = buildAddress({ location: row.location, address: contact.address, city: contact.city, postalCode: contact.postalCode });
  const notes = cleanString(row.description) || cleanString(contact.notes);
  const phonePro = cleanString(proRecipient?.phone);
  const phoneClient = cleanString(contact.phone);
  const emailClient = cleanString(contact.email);
  const mapsUrl = buildMapsUrl(address);

  const subjectBase = isProRecipient
    ? `Rappel pro iNr'Calendar ${reminderLabel} - ${clientName}`
    : texts.reminder.subject(reminderLabel, eventTitle);
  const subject = subjectSafe(subjectBase) || "Rappel iNr'Calendar";

  const intro = isProRecipient
    ? `Voici le rappel de votre rendez-vous prévu le ${formattedDateTime}.`
    : texts.reminder.intro(formattedDateTime, companyName);

  const preheader = isProRecipient
    ? `${clientName} · ${dateLabel} · ${startTime}${endTime !== "-" ? ` - ${endTime}` : ""}`
    : `${companyName} · ${dateLabel} · ${startTime}${endTime !== "-" ? ` - ${endTime}` : ""}`;

  const title = isProRecipient ? "Rendez-vous à venir" : texts.reminder.title;
  const badgeLabel = `${isProRecipient ? "RAPPEL" : texts.reminder.badgePrefix} ${reminderLabel.toUpperCase()}`;
  const sectionTitle = isProRecipient ? "Vue terrain" : texts.reminder.sectionTitle;

  const rowsMain = isProRecipient
    ? [
        infoRow("Client", clientName),
        infoRow("Date", dateLabel),
        infoRow("Horaire", `${startTime}${endTime !== "-" ? ` → ${endTime}` : ""}`),
        address ? infoRow("Adresse", address) : "",
        infoRow("Intitulé", eventTitle),
      ].join("")
    : [
        infoRow(texts.labels.date, dateLabel),
        infoRow(texts.labels.time, `${startTime}${endTime !== "-" ? ` → ${endTime}` : ""}`),
        address ? infoRow(texts.labels.address, address) : "",
        infoRow(texts.labels.provider, companyName),
        phonePro ? infoRow(texts.labels.phone, phonePro) : "",
      ].join("");

  const rowsSecondary = isProRecipient
    ? [
        emailClient ? infoRow("Email client", emailClient) : "",
        phoneClient ? infoRow("Téléphone client", phoneClient) : "",
        notes ? infoRow("Notes / précisions", notes) : "",
      ].join("")
    : [
        infoRow(texts.labels.appointmentReason, eventTitle),
        notes ? infoRow(texts.labels.usefulInfo, notes) : infoRow(texts.labels.usefulInfo, texts.reminder.defaultUsefulInfo),
      ].join("");

  const buttons = isProRecipient
    ? [
        emailClient ? ctaButton("Contacter le client", `mailto:${emailClient}`) : "",
        phoneClient ? ctaButton("Appeler le client", `tel:${phoneClient}`, "secondary") : "",
        mapsUrl ? ctaButton("Ouvrir l’adresse", mapsUrl, "secondary") : "",
      ].join("")
    : [
        phonePro ? ctaButton(texts.reminder.contactPro(proName), `tel:${phonePro}`) : "",
        mapsUrl ? ctaButton(texts.reminder.openAddress, mapsUrl, "secondary") : "",
      ].join("");

  const footerText = isProRecipient
    ? "Rappel automatique envoyé par iNr'Calendar, produit iNrCy. Retrouvez vos rendez-vous dans votre agenda."
    : texts.reminder.footer;

  const html = `<!doctype html>
<html lang="${isProRecipient ? "fr" : texts.htmlLang}" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(subject)}</title>
    <style>
      body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
      table { border-collapse: collapse; }
      @media screen and (max-width: 640px) {
        .email-shell { width: 100% !important; }
        .email-card { border-radius: 22px !important; }
        .email-pad { padding: 20px !important; }
        .hero-title { font-size: 28px !important; line-height: 1.18 !important; }
        .logo-cell-left,
        .logo-cell-right {
          display: block !important;
          width: 100% !important;
          text-align: left !important;
        }
        .logo-cell-right { padding-top: 10px !important; }
      }
    </style>
  </head>
  <body class="body" style="margin:0;padding:0;background:#041126;background-color:#041126;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#041126" style="width:100%;background:#041126;background-color:#041126;">
      <tr>
        <td align="center" style="padding:26px 12px 34px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="email-shell" style="width:100%;max-width:680px;">
            <tr>
              <td style="padding:0 0 14px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#071736" class="email-card" style="width:100%;border-collapse:separate;border-spacing:0;border-radius:28px;overflow:hidden;background:#071736;background-color:#071736;border:1px solid rgba(120,143,190,.22);box-shadow:0 24px 60px rgba(2,8,23,.45);">
                  <tr>
                    <td class="email-pad" style="padding:24px 24px 20px 24px;background:#071736;background-color:#071736;background-image:linear-gradient(135deg,#0b2450 0%, #071736 52%, #2c1f6a 100%);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                        <tr>
                          <td class="logo-cell-left" align="left" valign="middle" style="padding:0 0 18px 0;">
                            <img src="cid:${escapeHtml(INR_CALENDAR_LOGO_CID)}" alt="iNr'Calendar" width="${EMAIL_LOGO_DIMENSIONS.calendar.width}" height="${EMAIL_LOGO_DIMENSIONS.calendar.height}" style="display:block;width:${EMAIL_LOGO_DIMENSIONS.calendar.width}px;max-width:100%;height:auto;border:0;outline:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.2;" />
                          </td>
                          <td class="logo-cell-right" align="right" valign="middle" style="padding:0 0 18px 0;">
                            <img src="cid:${escapeHtml(INRCY_LOGO_CID)}" alt="iNrCy" width="${EMAIL_LOGO_DIMENSIONS.inrcy.width}" height="${EMAIL_LOGO_DIMENSIONS.inrcy.height}" style="display:block;width:${EMAIL_LOGO_DIMENSIONS.inrcy.width}px;max-width:100%;height:auto;border:0;outline:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.2;" />
                          </td>
                        </tr>
                      </table>
                      <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:#20345f;background-color:#20345f;color:#dbeafe;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:.05em;">${escapeHtml(badgeLabel)}</div>
                      <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>
                      <div class="hero-title" style="font-family:Arial,Helvetica,sans-serif;font-size:32px;line-height:1.15;color:#ffffff;font-weight:900;">${escapeHtml(title)}</div>
                      <div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#eef4ff;max-width:560px;">${escapeHtml(greeting)}<br />${escapeHtml(intro)}</div>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:0 24px 24px 24px;background:#071736;background-color:#071736;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0d1630" style="width:100%;border-collapse:separate;border-spacing:0;background:#0d1630;background-color:#0d1630;border:1px solid rgba(148,163,184,.14);border-radius:22px;overflow:hidden;">
                        <tr>
                          <td style="padding:22px 22px 10px 22px;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;color:#ffffff;font-weight:800;">${escapeHtml(sectionTitle)}</div>
                            <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                              ${rowsMain}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:0 24px 24px 24px;background:#071736;background-color:#071736;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#101b38" style="width:100%;border-collapse:separate;border-spacing:0;background:#101b38;background-color:#101b38;border:1px solid rgba(148,163,184,.12);border-radius:22px;overflow:hidden;">
                        <tr>
                          <td style="padding:20px 22px 10px 22px;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.3;color:#ffffff;font-weight:800;">${isProRecipient ? "Coordonnées & détails" : texts.reminder.secondaryTitle}</div>
                            <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                              ${rowsSecondary}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:0 24px 16px 24px;background:#071736;background-color:#071736;">
                      ${buttons || ""}
                      ${isProRecipient ? ctaButton("Ouvrir iNr'Calendar", AGENDA_DASHBOARD_URL, "secondary") : ""}
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:0 24px 24px 24px;background:#071736;background-color:#071736;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.75;color:#97a6c5;">
                      ${escapeHtml(footerText)}
                    </td>
                  </tr>
                </table>
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
    isProRecipient ? `Client : ${clientName}` : `${texts.labels.provider} : ${companyName}`,
    `${isProRecipient ? "Date" : texts.labels.date} : ${dateLabel}`,
    `${isProRecipient ? "Horaire" : texts.labels.time} : ${startTime}${endTime !== "-" ? ` -> ${endTime}` : ""}`,
    address ? `${isProRecipient ? "Adresse" : texts.labels.address} : ${address}` : "",
    `${isProRecipient ? "Intitulé" : texts.labels.appointmentReason} : ${eventTitle}`,
    isProRecipient && emailClient ? `Email client : ${emailClient}` : "",
    isProRecipient && phoneClient ? `Téléphone client : ${phoneClient}` : "",
    !isProRecipient && phonePro ? `${texts.labels.phone} : ${phonePro}` : "",
    notes ? `${isProRecipient ? "Informations" : texts.labels.usefulInfo} : ${notes}` : "",
    "",
    footerText,
  ].filter(Boolean).join("\n");

  return { subject, text, html };
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });

  const now = new Date();
  const horizon = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
  const smtpConfigured = Boolean(optionalEnv("TX_SMTP_HOST") && optionalEnv("TX_SMTP_PORT") && optionalEnv("TX_SMTP_USER") && optionalEnv("TX_SMTP_PASS"));
  const reminderInlineAttachments = await getReminderInlineAttachments();

  const { data, error } = await supabaseAdmin
    .from("agenda_events")
    .select("id, user_id, title, description, location, start_at, end_at, all_day, meta")
    .gte("start_at", now.toISOString())
    .lte("start_at", horizon)
    .order("start_at", { ascending: true })
    .limit(500);

  if (error) return jsonUserFacingError(error, { status: 500 });

  let inAppSent = 0;
  let emailSent = 0;
  const userSettingsCache = new Map<string, CalendarReminderSettings>();
  const userClientPreferencesCache = new Map<string, ClientExchangePreferences>();
  const usableMailAccountCache = new Map<string, Promise<string>>();

  for (const row of data ?? []) {
    const meta = safeObj(row.meta);
    if (isInactiveAppointmentRequest(meta)) continue;
    const reminders = safeObj(meta.reminders);
    if (reminders.enabled === false) continue;
    const startAt = new Date(String(row.start_at));
    if (!Number.isFinite(startAt.getTime())) continue;
    const minutesUntil = Math.round((startAt.getTime() - now.getTime()) / 60000);
    if (minutesUntil < 0) continue;

    const inAppMinutesBefore = asNumber(reminders.inAppMinutesBefore, 120);
    const lastInAppReminderAt = typeof reminders.lastInAppReminderAt === "string" ? reminders.lastInAppReminderAt : null;

    let nextMeta: Record<string, unknown> = meta;
    let nextReminders: Record<string, unknown> = reminders;
    let dirty = false;

    if (!lastInAppReminderAt && minutesUntil <= inAppMinutesBefore) {
      const { error: notificationError } = await supabaseAdmin.from("notifications").insert({
        user_id: row.user_id,
        category: "action",
        kind: "agenda_rappel",
        title: `Rappel rendez-vous : ${row.title || "Rendez-vous"}`,
        body: `Votre rendez-vous est prévu le ${fmtDate(String(row.start_at))}${row.location ? ` à ${row.location}` : ""}.`,
        cta_label: "Ouvrir l’agenda",
        cta_url: "/dashboard/agenda",
        dedupe_key: `agenda:inapp:${row.id}:${String(row.start_at)}`,
        meta: { source: "agenda", event_id: row.id },
      });
      if (!notificationError) {
        inAppSent += 1;
        nextReminders = { ...nextReminders, lastInAppReminderAt: now.toISOString() };
        nextMeta = { ...nextMeta, reminders: nextReminders };
        dirty = true;
      }
    }

    const proRecipient = await getProRecipient(String(row.user_id));
    const contactRecipient = getContactRecipient(meta);
    const guestRecipients = getGuestRecipients(meta);
    const recipients = buildRecipients(proRecipient, contactRecipient, guestRecipients);

    let userSettings = userSettingsCache.get(String(row.user_id));
    if (!userSettings) {
      const { data: cfg } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", String(row.user_id)).maybeSingle();
      userSettings = getCalendarReminderSettingsFromSettings(cfg?.settings);
      userSettingsCache.set(String(row.user_id), userSettings);
    }

    let clientPreferences = userClientPreferencesCache.get(String(row.user_id));
    if (!clientPreferences) {
      clientPreferences = await getClientExchangePreferences(String(row.user_id));
      userClientPreferencesCache.set(String(row.user_id), clientPreferences);
    }

    const configuredMailAccountId = userSettings.selectedMailAccountId || getReminderMailAccountId(meta);
    let selectedMailAccountId = "";

    if (configuredMailAccountId) {
      const accountCacheKey = `${String(row.user_id)}:${configuredMailAccountId}`;
      let accountPromise = usableMailAccountCache.get(accountCacheKey);
      if (!accountPromise) {
        accountPromise = resolveUsableReminderMailAccountId(
          String(row.user_id),
          configuredMailAccountId,
        );
        usableMailAccountCache.set(accountCacheKey, accountPromise);
      }

      try {
        selectedMailAccountId = await accountPromise;
      } catch (accountResolutionError) {
        console.error("[calendar-reminders] mail account resolution failed", {
          eventId: row.id,
          accountId: configuredMailAccountId,
          error: accountResolutionError,
        });
      }
    }

    for (const offsetMinutes of userSettings.reminderOffsetsMinutes) {
      if (minutesUntil > offsetMinutes) continue;

      for (const recipient of recipients) {
        const alreadySentAt = getRecipientSentAt(nextReminders, recipient, offsetMinutes);
        if (alreadySentAt) continue;

        const mail = buildReminderMail(row, meta, offsetMinutes, recipient, proRecipient, clientPreferences);
        try {
          let sent = false;

          if (selectedMailAccountId) {
            try {
              await sendMailFromIntegration({
                userId: String(row.user_id),
                accountId: selectedMailAccountId,
                to: recipient.email,
                subject: mail.subject,
                text: mail.text,
                html: mail.html,
                includeAutoSignature: false,
                preserveHtml: true,
                attachments: reminderInlineAttachments,
              });
              sent = true;
            } catch (integrationError) {
              console.error("[calendar-reminders] integration delivery failed, fallback to iNrCy", {
                eventId: row.id,
                recipient: recipient.email,
                kind: recipient.kind,
                offsetMinutes,
                accountId: selectedMailAccountId,
                error: integrationError,
              });
            }
          }

          if (!sent) {
            if (!smtpConfigured) continue;
            await sendTxMail({ to: recipient.email, subject: mail.subject, text: mail.text, html: mail.html, attachments: reminderInlineAttachments });
            sent = true;
          }

          if (!sent) continue;

          emailSent += 1;
          nextReminders = markRecipientSent(nextReminders, recipient, offsetMinutes, now.toISOString());
          nextMeta = { ...nextMeta, reminders: nextReminders };
          dirty = true;
        } catch (mailError) {
          const logReminderFailure = isTxSmtpCircuitOpenError(mailError)
            ? console.info
            : console.error;
          logReminderFailure("[calendar-reminders] reminder send failed", {
            eventId: row.id,
            recipient: recipient.email,
            kind: recipient.kind,
            offsetMinutes,
            via: selectedMailAccountId ? "integration-or-fallback" : "inrcy",
            error: mailError,
          });
        }
      }
    }

    if (dirty) {
      await supabaseAdmin.from("agenda_events").update({ meta: nextMeta }).eq("id", row.id);
    }
  }

  return NextResponse.json({ ok: true, scanned: (data ?? []).length, inAppSent, emailSent });
}

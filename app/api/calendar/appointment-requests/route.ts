import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { optionalEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";
import { sendMailFromIntegration } from "@/lib/inrsend/sendMailFromIntegration";
import {
  buildClientExchangePreferences,
  formatClientDateOnly,
  formatClientTimeOnly,
  getCalendarClientTexts,
  type ClientExchangePreferences,
} from "@/lib/clientCommunication";

type AppointmentRequestRow = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  meta?: unknown;
};

type ProMailDetails = {
  email?: string | null;
  firstName?: string | null;
  companyName?: string | null;
  phone?: string | null;
};

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return cleanString(value).toLowerCase();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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

function isPendingInrBadgeRequest(metaInput: unknown) {
  const meta = safeObj(metaInput);
  return String(meta.source || "").toLowerCase() === "inrbadge" && String(meta.status || "").toLowerCase() === "pending";
}

function getSelectedMailAccountIdFromSettings(settings: unknown) {
  const root = safeObj(settings);
  const inrcalendar = safeObj(root.inrcalendar);
  const value = inrcalendar.selected_mail_account_id;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getSelectedMailAccountIdFromMeta(metaInput: unknown) {
  const meta = safeObj(metaInput);
  const reminders = safeObj(meta.reminders);
  const value = reminders.mailAccountId ?? reminders.mail_account_id;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getContactDetailsFromMeta(metaInput: unknown) {
  const meta = safeObj(metaInput);
  const contact = safeObj(meta.contact);
  const request = safeObj(meta.inrBadgeAppointmentRequest);
  const email = normalizeEmail(contact.email) || normalizeEmail(request.clientEmail);
  return {
    email,
    firstName: typeof contact.first_name === "string" ? contact.first_name : null,
    lastName: typeof contact.last_name === "string" ? contact.last_name : null,
    displayName: typeof contact.display_name === "string" ? contact.display_name : typeof request.clientName === "string" ? request.clientName : null,
    companyName: typeof contact.company_name === "string" ? contact.company_name : typeof request.clientCompany === "string" ? request.clientCompany : null,
    phone: typeof contact.phone === "string" ? contact.phone : typeof request.clientPhone === "string" ? request.clientPhone : null,
    notes: typeof request.message === "string" ? request.message : null,
  };
}

async function getCalendarSelectedMailAccountId(userId: string) {
  const { data } = await supabaseAdmin
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();

  return getSelectedMailAccountIdFromSettings(data?.settings);
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

function buildRejectionMail(args: { row: AppointmentRequestRow; meta: unknown; pro: ProMailDetails; clientPreferences: ClientExchangePreferences }) {
  const { row, meta, pro, clientPreferences } = args;
  const texts = getCalendarClientTexts(clientPreferences.clientLanguage);
  const contact = getContactDetailsFromMeta(meta);
  const companyName = cleanString(pro.companyName) || texts.generic.professional;
  const proName = buildDisplayName({ firstName: pro.firstName, companyName: pro.companyName, fallback: companyName });
  const recipientName = buildDisplayName({
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    companyName: contact.companyName,
    fallback: "",
  });
  const greeting = texts.generic.greeting(recipientName);
  const dateLabel = formatClientDateOnly(row.start_at, clientPreferences);
  const startTime = formatClientTimeOnly(row.start_at, clientPreferences);
  const endTime = formatClientTimeOnly(row.end_at, clientPreferences);
  const eventTitle = cleanString(row.title).replace(/^RDV iNr'Badge\s*-\s*/i, "") || texts.generic.appointment;
  const phonePro = cleanString(pro.phone);
  const proEmail = cleanString(pro.email);
  const notes = cleanString(contact.notes || row.description);

  const subject = subjectSafe(texts.rejection.subject(companyName)) || texts.rejection.subject(companyName);
  const rows = [
    [texts.labels.requestedDate, dateLabel],
    [texts.labels.requestedTime, `${startTime}${endTime !== "-" ? ` → ${endTime}` : ""}`],
    [texts.labels.reason, eventTitle],
    notes ? [texts.labels.yourMessage, notes.replace(/^Demande depuis iNr'Badge\s*/i, "").trim()] : null,
    [texts.labels.professional, proName],
    phonePro ? [texts.labels.phone, phonePro] : null,
    proEmail ? [texts.labels.email, proEmail] : null,
  ].filter(Boolean) as string[][];

  const intro = texts.rejection.intro(companyName);
  const action = texts.rejection.action;
  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:0 0 14px 0;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8fa4ca;">${escapeHtml(label)}</div>
        <div style="height:5px;line-height:5px;font-size:0;">&nbsp;</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#e7eefc;">${lineBreaksToHtml(value)}</div>
      </td>
    </tr>`).join("");

  const html = `<!doctype html>
<html lang="${texts.htmlLang}">
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
                  <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:#3a1b3f;color:#fce7f3;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">${escapeHtml(texts.rejection.status)}</div>
                  <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.15;color:#ffffff;font-weight:900;">${escapeHtml(texts.rejection.title)}</div>
                  <div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#eef4ff;">${escapeHtml(greeting)}<br />${escapeHtml(intro)}<br />${escapeHtml(action)}</div>
                </div>
                <div style="padding:0 24px 24px 24px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0d1630" style="width:100%;border-radius:22px;background:#0d1630;border:1px solid rgba(148,163,184,.14);">
                    <tr>
                      <td style="padding:22px 22px 8px 22px;">
                        <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;color:#ffffff;font-weight:800;">${escapeHtml(texts.rejection.detailsTitle)}</div>
                        <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${htmlRows}</table>
                      </td>
                    </tr>
                  </table>
                </div>
                <div style="padding:0 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.75;color:#97a6c5;">
                  ${escapeHtml(texts.generic.automaticMail)}
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
    texts.rejection.textTitle,
    intro,
    action,
    "",
    ...rows.map(([label, value]) => `${label} : ${value}`),
    "",
    texts.generic.automaticMail,
  ].join("\n");

  return { to: contact.email, subject, text, html };
}

async function sendAppointmentRejectionEmail(args: { userId: string; row: AppointmentRequestRow; meta: unknown }) {
  const pro = await getProMailDetails(args.userId);
  const clientPreferences = await getClientExchangePreferences(args.userId);
  const mail = buildRejectionMail({ row: args.row, meta: args.meta, pro, clientPreferences });
  if (!mail.to) return false;

  const selectedMailAccountId = (await getCalendarSelectedMailAccountId(args.userId)) || getSelectedMailAccountIdFromMeta(args.meta);
  const smtpConfigured = Boolean(
    optionalEnv("TX_SMTP_HOST") &&
    optionalEnv("TX_SMTP_PORT") &&
    optionalEnv("TX_SMTP_USER") &&
    optionalEnv("TX_SMTP_PASS")
  );

  let sent = false;

  if (selectedMailAccountId) {
    try {
      await sendMailFromIntegration({
        userId: args.userId,
        accountId: selectedMailAccountId,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        includeAutoSignature: false,
        preserveHtml: true,
      });
      sent = true;
    } catch (integrationError) {
      console.error("[calendar-appointment-requests] rejection integration delivery failed, fallback to iNrCy", {
        recipient: mail.to,
        accountId: selectedMailAccountId,
        error: integrationError,
      });
    }
  }

  if (!sent && smtpConfigured) {
    await sendTxMail({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    sent = true;
  }

  return sent;
}

export async function PATCH(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return bad("id requis");

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = String(body.action || "").toLowerCase();
  if (action !== "reject") return bad("Action invalide");

  const { data: current, error: currentError } = await supabase
    .from("agenda_events")
    .select("id,title,description,location,start_at,end_at,meta")
    .eq("id", id)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (currentError) return jsonUserFacingError(currentError, { status: 500, extra: { ok: false } });
  if (!current) return bad("Demande introuvable", 404);
  if (!isPendingInrBadgeRequest(current.meta)) return bad("Cette demande n'est plus à valider", 409);

  const rejectedAt = new Date().toISOString();
  const nextMeta = {
    ...safeObj(current.meta),
    status: "rejected",
    rejectedAt,
  };

  const { error } = await supabase
    .from("agenda_events")
    .update({ meta: nextMeta })
    .eq("id", id)
    .eq("user_id", activeUserId);

  if (error) return jsonUserFacingError(error, { status: 500, extra: { ok: false } });

  let rejectionMailSent = false;
  try {
    rejectionMailSent = await sendAppointmentRejectionEmail({ userId: activeUserId, row: current, meta: nextMeta });
  } catch (mailError) {
    console.error("[calendar-appointment-requests] rejection mail failed", {
      userId: activeUserId,
      requestId: id,
      error: mailError,
    });
  }

  if (rejectionMailSent) {
    const { error: metaUpdateError } = await supabase
      .from("agenda_events")
      .update({ meta: { ...nextMeta, rejectionMailSent: true, rejectionMailSentAt: new Date().toISOString() } })
      .eq("id", id)
      .eq("user_id", activeUserId);

    if (metaUpdateError) {
      console.warn("[calendar-appointment-requests] rejection mail meta update failed", metaUpdateError);
    }
  }

  return NextResponse.json({ ok: true, rejectionMailSent });
}

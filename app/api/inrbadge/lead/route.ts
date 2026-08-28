import { NextResponse } from "next/server";
import { optionalEnv } from "@/lib/env";
import { extractInrBadgeUserIdFromSlug } from "@/lib/inrBadge";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";
import { upsertCrmContactWithoutDuplicate } from "@/lib/crmContactDedupe";
import { recordInrBadgeEvent } from "@/lib/inrBadgeAnalytics";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getInrBadgeLeadPresentation } from "@/lib/inrBadgeEditionPolicy";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { insertNotificationOnce } from "@/lib/notificationWriter";

function cleanString(value: unknown, max = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanText(value: unknown, max = 1200) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function normalizeEmail(value: unknown) {
  return cleanString(value, 254).toLowerCase();
}

function isValidEmail(value: string) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePhone(value: unknown) {
  return cleanString(value, 40).replace(/[^+0-9 .()-]/g, "");
}


function parseDisplayName(value: unknown) {
  const raw = cleanString(value, 180);
  if (!raw) return { firstName: "", lastName: "", companyName: "" };
  const parts = raw.split("/");
  const left = cleanString(parts[0], 120);
  const right = cleanString(parts.slice(1).join("/"), 120);
  return {
    firstName: "",
    lastName: left,
    companyName: right,
  };
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function smtpConfigured() {
  return Boolean(
    optionalEnv("TX_SMTP_HOST") &&
    optionalEnv("TX_SMTP_PORT") &&
    optionalEnv("TX_SMTP_USER") &&
    optionalEnv("TX_SMTP_PASS")
  );
}

function buildLeadNotificationMail(input: {
  proCompany: string;
  displayName: string;
  email: string;
  phone: string;
  companyName: string;
  message: string;
  sourceUrl: string;
  actionUrl: string;
  actionLabel: string;
  footerText: string;
}) {
  const rows = [
    ["Contact", input.displayName],
    ["Raison sociale", input.companyName],
    ["Téléphone", input.phone],
    ["Email", input.email],
    ["Message", input.message],
    ["Source", input.sourceUrl],
  ].filter(([, value]) => cleanString(value));

  const subject = "Nouveau contact reçu via iNr’Badge";
  const text = [
    "Bonjour,",
    "",
    "Un nouveau contact a transmis ses coordonnées depuis votre iNr’Badge.",
    "",
    ...rows.map(([label, value]) => `${label} : ${value}`),
    "",
    `${input.actionLabel} : ${input.actionUrl}`,
  ].join("\n");

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;width:120px;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:#0f172a;font-size:13px;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");

  const html = `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 14px 40px rgba(15,23,42,.10);">
          <tr><td style="padding:24px 24px 10px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0ea5e9;">iNr’Badge</div>
            <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;color:#0f172a;">Nouveau contact reçu</h1>
            <p style="margin:8px 0 0;color:#64748b;font-size:14px;line-height:1.55;">Un visiteur a transmis ses coordonnées depuis votre fiche publique.</p>
          </td></tr>
          <tr><td style="padding:8px 24px 4px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${htmlRows}</table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 10px;"><tr><td style="border-radius:12px;background:#0f172a;">
              <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">${escapeHtml(input.actionLabel)}</a>
            </td></tr></table>
            <p style="margin:12px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">${escapeHtml(input.footerText)}</p>
          </td></tr>
          <tr><td style="padding:18px 24px 22px;color:#94a3b8;font-size:12px;border-top:1px solid #eef2f7;">Email automatique envoyé par iNrCy.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = cleanString(body?.slug, 180);
  const userId = extractInrBadgeUserIdFromSlug(slug);
  if (!userId) {
    return NextResponse.json({ error: "Fiche iNr'Badge introuvable." }, { status: 404 });
  }
  const dashboardEdition = await getDashboardEditionForAccountId(userId);
  const leadPresentation = getInrBadgeLeadPresentation(dashboardEdition);

  // Honeypot anti-spam discret : les vrais utilisateurs ne voient jamais ce champ.
  if (cleanString(body?.website)) {
    return NextResponse.json({ ok: true });
  }

  const rateLimited = await enforceRateLimit({
    name: "inrbadge_public_lead",
    identifier: `${getClientIp(req)}:${userId}`,
    limit: 8,
    fallbackLimit: 3,
    window: "1 h",
  });
  if (rateLimited) return rateLimited;

  const parsedDisplayName = parseDisplayName(body?.displayName ?? body?.display_name ?? body?.name);
  const firstName = cleanString(body?.firstName ?? body?.first_name, 80) || parsedDisplayName.firstName;
  const lastName = cleanString(body?.lastName ?? body?.last_name, 80) || parsedDisplayName.lastName;
  const companyName = cleanString(body?.companyName ?? body?.company_name, 120) || parsedDisplayName.companyName;
  const email = normalizeEmail(body?.email);
  const phone = normalizePhone(body?.phone);
  const message = cleanText(body?.message, 1000);
  const consent = body?.consent === true;

  if (!consent) {
    return NextResponse.json({ error: "Consentement nécessaire pour transmettre vos coordonnées." }, { status: 400 });
  }

  if (!firstName && !lastName && !companyName && !email && !phone) {
    return NextResponse.json({ error: "Renseignez au moins un nom, un mail ou un téléphone." }, { status: 400 });
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Adresse email invalide." }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("user_id,company_legal_name,contact_email,first_name,last_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Fiche iNr'Badge introuvable." }, { status: 404 });
  }

  const sourceUrl = `/badge/${slug}`;
  const notes = [
    "Source : iNr'Badge",
    "Canal : QR Code / fiche publique",
    `Fiche scannée : ${sourceUrl}`,
    message ? `Message : ${message}` : "",
  ].filter(Boolean).join("\n");

  let crmResult;
  try {
    crmResult = await upsertCrmContactWithoutDuplicate(supabaseAdmin, {
      userId,
      firstName,
      lastName,
      companyName,
      email,
      phone,
      notes,
      category: companyName ? "professionnel" : "particulier",
      contactType: "prospect",
      important: true,
      source: "inrbadge",
    });
  } catch (upsertError) {
    console.error("[inrbadge-lead] crm upsert failed", upsertError);
    return NextResponse.json({ error: "Impossible d'enregistrer vos coordonnées pour le moment." }, { status: 500 });
  }

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || companyName || email || phone || "Nouveau contact";

  await recordInrBadgeEvent(supabaseAdmin, {
    userId,
    slug,
    eventType: "lead_submit",
    actionKey: "lead_form",
    source: body?.source || "badge",
    referrer: req.headers.get("referer") || "",
    visitorId: body?.visitorId,
    metadata: { contactId: crmResult.id || null, created: Boolean(crmResult.created) },
  });

  if (crmResult.created) {
    try {
      await insertNotificationOnce({
        user_id: userId,
        category: "information",
        kind: "inrbadge_lead",
        title: "Nouveau contact iNr'Badge",
        body: `${displayName} a transmis ses coordonnées depuis votre iNr'Badge.`,
        cta_label: leadPresentation.ctaLabel,
        cta_url: leadPresentation.ctaPath,
        dedupe_key: `inrbadge_lead:${crmResult.id || Date.now()}`,
        meta: { source: "inrbadge", contactId: crmResult.id || null, slug, displayName, email, phone, companyName },
      });
    } catch (notificationError) {
      console.warn("[inrbadge-lead] notification insert failed", notificationError);
    }

    const proEmail = normalizeEmail((profile as Record<string, unknown>).contact_email);
    if (proEmail && smtpConfigured()) {
      try {
        const origin = new URL(req.url).origin;
        const absoluteSourceUrl = new URL(sourceUrl, origin).toString();
        const actionUrl = new URL(leadPresentation.ctaPath, origin).toString();
        const mail = buildLeadNotificationMail({
          proCompany: cleanString((profile as Record<string, unknown>).company_legal_name) || "Votre entreprise",
          displayName,
          email,
          phone,
          companyName,
          message,
          sourceUrl: absoluteSourceUrl,
          actionUrl,
          actionLabel: leadPresentation.emailActionLabel,
          footerText: leadPresentation.emailFooter,
        });
        await sendTxMail({ to: proEmail, subject: mail.subject, text: mail.text, html: mail.html });
      } catch (mailError) {
        console.warn("[inrbadge-lead] pro email notification failed", mailError);
      }
    }
  }

  return NextResponse.json({ ok: true, id: crmResult.id || null });
}

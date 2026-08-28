import { NextResponse } from "next/server";

import { optionalEnv } from "@/lib/env";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { recordInrSearchEvent, resolvePublishedInrSearchOwner } from "@/lib/inrSearchAnalytics";
import { upsertCrmContactWithoutDuplicate } from "@/lib/crmContactDedupe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";
import { insertNotificationOnce } from "@/lib/notificationWriter";

const MAX_BODY_BYTES = 16_384;

function cleanString(value: unknown, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanText(value: unknown, max = 1600) {
  return String(value ?? "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function normalizeEmail(value: unknown) {
  return cleanString(value, 254).toLowerCase();
}

function normalizePhone(value: unknown) {
  return cleanString(value, 40).replace(/[^+0-9 .()-]/g, "");
}

function isValidEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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
    optionalEnv("TX_SMTP_PASS"),
  );
}

function buildNotificationMail(input: {
  company: string;
  displayName: string;
  visitorCompany: string;
  email: string;
  phone: string;
  message: string;
  pageUrl: string;
  crmUrl: string;
}) {
  const rows = [
    ["Contact", input.displayName],
    ["Entreprise", input.visitorCompany],
    ["Téléphone", input.phone],
    ["Email", input.email],
    ["Demande", input.message],
    ["Page iNr’Search", input.pageUrl],
  ].filter(([, value]) => cleanString(value));

  const subject = `Nouvelle demande reçue via iNr’Search — ${input.company}`;
  const text = [
    "Bonjour,",
    "",
    "Un visiteur vient de transmettre une demande depuis votre page iNr’Search.",
    "",
    ...rows.map(([label, value]) => `${label} : ${value}`),
    "",
    `Voir le contact dans iNrCRM : ${input.crmUrl}`,
  ].join("\n");

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;width:125px;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:#0f172a;font-size:13px;font-weight:700;vertical-align:top;white-space:pre-line;">${escapeHtml(value)}</td>
    </tr>`).join("");

  const html = `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 16px 44px rgba(15,23,42,.11);">
          <tr><td style="padding:26px 26px 12px;background:linear-gradient(135deg,#101d43,#54308f);">
            <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8befff;">iNr’Search</div>
            <h1 style="margin:8px 0 0;font-size:23px;line-height:1.25;color:#ffffff;">Nouvelle demande reçue</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,.72);font-size:14px;line-height:1.55;">Un visiteur souhaite être recontacté par ${escapeHtml(input.company)}.</p>
          </td></tr>
          <tr><td style="padding:16px 26px 8px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${htmlRows}</table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 12px;"><tr><td style="border-radius:12px;background:#111c3f;">
              <a href="${escapeHtml(input.crmUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Ouvrir iNrCRM</a>
            </td></tr></table>
            <p style="margin:12px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">Le contact a été ajouté ou actualisé automatiquement dans votre CRM iNrCy.</p>
          </td></tr>
          <tr><td style="padding:18px 26px 22px;color:#94a3b8;font-size:12px;border-top:1px solid #eef2f7;">Email automatique envoyé par iNrCy.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) {
    return NextResponse.json({ ok: false, error: "Origine refusée." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Requête trop volumineuse." }, { status: 413 });
  }

  const rawBody = await request.text().catch(() => "");
  if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Requête invalide." }, { status: rawBody.length > MAX_BODY_BYTES ? 413 : 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const slug = cleanString(body.slug, 160);
  const owner = await resolvePublishedInrSearchOwner(slug);
  if (!owner) {
    return NextResponse.json({ ok: false, error: "Page iNr’Search introuvable." }, { status: 404 });
  }

  if (cleanString(body.website, 200)) {
    return NextResponse.json({ ok: true });
  }

  const ip = getClientIp(request);
  const rateLimited = await enforceRateLimit({
    name: "inr_search_public_lead",
    identifier: `${ip}:${owner.slug}`,
    limit: 8,
    window: "1 h",
  });
  if (rateLimited) return rateLimited;

  const displayName = cleanString(body.displayName ?? body.name, 180);
  const visitorCompany = cleanString(body.companyName, 140);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const message = cleanText(body.message, 1400);
  const consent = body.consent === true;

  if (!consent) {
    return NextResponse.json({ ok: false, error: "Votre accord est nécessaire pour transmettre la demande." }, { status: 400 });
  }
  if (!displayName && !visitorCompany && !email && !phone) {
    return NextResponse.json({ ok: false, error: "Renseignez au moins votre nom, votre email ou votre téléphone." }, { status: 400 });
  }
  if (!email && !phone) {
    return NextResponse.json({ ok: false, error: "Renseignez un email ou un téléphone pour être recontacté." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "Adresse email invalide." }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("user_id,company_legal_name,contact_email")
    .eq("user_id", owner.userId)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json({ ok: false, error: "Entreprise indisponible pour le moment." }, { status: 404 });
  }

  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const firstName = nameParts.length > 1 ? nameParts.shift() || "" : "";
  const lastName = nameParts.join(" ") || displayName;
  const sourcePath = `/entreprises/${owner.slug}`;
  const notes = [
    "Source : iNr'Search",
    `Page consultée : ${sourcePath}`,
    visitorCompany ? `Entreprise du prospect : ${visitorCompany}` : "",
    message ? `Demande : ${message}` : "",
  ].filter(Boolean).join("\n");

  let crmResult;
  try {
    crmResult = await upsertCrmContactWithoutDuplicate(supabaseAdmin, {
      userId: owner.userId,
      firstName,
      lastName,
      companyName: visitorCompany,
      email,
      phone,
      notes,
      category: visitorCompany ? "professionnel" : "particulier",
      contactType: "prospect",
      important: true,
      source: "inr_search",
    });
  } catch (error) {
    console.error("[inr-search-lead] crm upsert failed", error);
    return NextResponse.json({ ok: false, error: "Impossible d’enregistrer votre demande pour le moment." }, { status: 500 });
  }

  await recordInrSearchEvent(supabaseAdmin, {
    userId: owner.userId,
    slug: owner.slug,
    eventType: "action_click",
    actionKey: "lead_form",
    targetUrl: sourcePath,
    source: body.source,
    referrer: request.headers.get("referer") || "",
    visitorId: body.visitorId,
    pathname: sourcePath,
  });

  const contactLabel = displayName || visitorCompany || email || phone || "Nouveau prospect";
  const notificationKey = `inrsearch_lead:${crmResult.id || Date.now()}:${Date.now()}`;
  try {
    await insertNotificationOnce({
      user_id: owner.userId,
      category: "information",
      kind: "inrsearch_lead",
      title: "Nouvelle demande iNr’Search",
      body: `${contactLabel} souhaite être recontacté depuis votre page publique.`,
      cta_label: "Ouvrir le CRM",
      cta_url: "/dashboard/crm",
      dedupe_key: notificationKey,
      meta: {
        source: "inr_search",
        contactId: crmResult.id || null,
        slug: owner.slug,
        displayName,
        visitorCompany,
        email,
        phone,
        message,
        created: Boolean(crmResult.created),
      },
    });
  } catch (notificationError) {
    console.warn("[inr-search-lead] notification insert failed", notificationError);
  }

  const proEmail = normalizeEmail((profile as Record<string, unknown>).contact_email);
  if (proEmail && smtpConfigured()) {
    try {
      const origin = new URL(request.url).origin;
      const pageUrl = new URL(sourcePath, origin).toString();
      const crmUrl = new URL("/dashboard/crm", origin).toString();
      const mail = buildNotificationMail({
        company: cleanString((profile as Record<string, unknown>).company_legal_name, 180) || "votre entreprise",
        displayName: contactLabel,
        visitorCompany,
        email,
        phone,
        message,
        pageUrl,
        crmUrl,
      });
      await sendTxMail({ to: proEmail, subject: mail.subject, text: mail.text, html: mail.html });
    } catch (error) {
      console.warn("[inr-search-lead] email notification failed", error);
    }
  }

  return NextResponse.json({ ok: true, id: crmResult.id || null }, { headers: { "Cache-Control": "no-store" } });
}

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireSecretHeader } from "@/lib/adminSecurity";

export const runtime = "nodejs";

type SupabaseAuthWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: {
    id?: string;
    user_id?: string;
    auth_user_id?: string;
    email?: string;
    phone?: string | null;
    created_at?: string;
    email_confirmed_at?: string | null;
    raw_user_meta_data?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  };
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDisplayName(record: SupabaseAuthWebhookPayload["record"]) {
  const meta = record?.raw_user_meta_data || record?.metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    meta.display_name ||
    meta.first_name ||
    "-"
  );
}

export async function POST(req: NextRequest) {
  try {
    const secret = requireSecretHeader(req, "x-inrcy-webhook-secret", process.env.SUPABASE_NEW_USER_WEBHOOK_SECRET);
    if (!secret.ok) return secret.response;

    const payload = (await req.json()) as SupabaseAuthWebhookPayload;
    const record = payload.record || {};

    const isAuthUserInsert =
      payload.type === "INSERT" &&
      payload.schema === "auth" &&
      payload.table === "users";

    const isSignupAlertInsert =
      payload.type === "INSERT" &&
      payload.schema === "public" &&
      payload.table === "signup_alerts";

    const userId = isAuthUserInsert
      ? record?.id
      : record?.user_id || record?.auth_user_id;

    if ((!isAuthUserInsert && !isSignupAlertInsert) || !userId) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Not a supported signup INSERT event",
      });
    }

    const alertTo = (
      process.env.INRCY_NEW_USER_ALERT_EMAIL || "compte@inrcy.com"
    ).trim();
    const smtpHost = process.env.TX_SMTP_HOST;
    const smtpPort = Number(process.env.TX_SMTP_PORT || 587);
    const smtpUser = process.env.TX_SMTP_USER;
    const smtpPass = process.env.TX_SMTP_PASS;
    const mailFrom = process.env.TX_MAIL_FROM || smtpUser;

    if (!alertTo || !smtpHost || !smtpUser || !smtpPass || !mailFrom) {
      return NextResponse.json(
        { ok: false, error: "Missing email environment variables" },
        { status: 500 }
      );
    }

    const email = record.email || "-";
    const displayName = getDisplayName(record);
    const createdAt = record.created_at
      ? new Date(record.created_at).toLocaleString("fr-FR", {
          timeZone: "Europe/Paris",
        })
      : "-";

    const provider =
      Array.isArray(record.app_metadata?.providers) &&
      record.app_metadata?.providers.length
        ? record.app_metadata.providers.join(", ")
        : record.app_metadata?.provider || "email";

    const emailConfirmed = record.email_confirmed_at ? "Oui" : "Non";

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: mailFrom,
      to: alertTo,
      subject: "Nouvelle inscription iNrCy",
      text: [
        "Nouvelle inscription iNrCy",
        "",
        `Email : ${email}`,
        `Nom : ${String(displayName)}`,
        `User ID : ${userId}`,
        `Date : ${createdAt}`,
        `Provider : ${String(provider)}`,
        `Email confirmé : ${emailConfirmed}`,
      ].join("\n"),
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;padding:24px;">
          <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px;border:1px solid #e5e7eb;">
            <h1 style="margin:0 0 16px;font-size:22px;color:#0f172a;">
              Nouvelle inscription iNrCy
            </h1>

            <p style="margin:0 0 20px;color:#475569;font-size:15px;">
              Un nouveau compte vient d’être créé depuis le formulaire d’inscription.
            </p>

            <table style="width:100%;border-collapse:collapse;font-size:14px;color:#0f172a;">
              <tr>
                <td style="padding:8px 0;color:#64748b;">Email</td>
                <td style="padding:8px 0;font-weight:700;">${escapeHtml(email)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#64748b;">Nom</td>
                <td style="padding:8px 0;font-weight:700;">${escapeHtml(displayName)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#64748b;">User ID</td>
                <td style="padding:8px 0;">${escapeHtml(userId)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#64748b;">Date</td>
                <td style="padding:8px 0;">${escapeHtml(createdAt)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#64748b;">Provider</td>
                <td style="padding:8px 0;">${escapeHtml(provider)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#64748b;">Email confirmé</td>
                <td style="padding:8px 0;">${escapeHtml(emailConfirmed)}</td>
              </tr>
            </table>
          </div>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[new-user-alert]", error);

    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

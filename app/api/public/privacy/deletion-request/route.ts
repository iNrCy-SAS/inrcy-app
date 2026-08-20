import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_TO = process.env.INRCY_PRIVACY_REQUEST_TO || "contact@inrcy.com";

type DeletionRequestBody = {
  requestType?: unknown;
  fullName?: unknown;
  email?: unknown;
  accountReference?: unknown;
  details?: unknown;
  website?: unknown;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export async function POST(request: NextRequest) {
  let body: DeletionRequestBody;
  try {
    body = (await request.json()) as DeletionRequestBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Requête invalide." }, { status: 400 });
  }

  // Champ leurre anti-robots : on répond normalement sans créer de demande.
  if (text(body.website, 200)) return NextResponse.json({ ok: true }, { status: 202 });

  const requestType = body.requestType === "partial" ? "partial" : body.requestType === "account" ? "account" : "";
  const fullName = text(body.fullName, 160);
  const email = text(body.email, 254).toLowerCase();
  const accountReference = text(body.accountReference, 200);
  const details = text(body.details, 3000);
  const userAgent = text(request.headers.get("user-agent"), 1000);

  if (!requestType || !fullName || !isEmail(email) || (requestType === "partial" && !details)) {
    return NextResponse.json({ ok: false, message: "Merci de compléter correctement les champs obligatoires." }, { status: 400 });
  }

  let persisted = false;
  let mailed = false;

  try {
    const { error } = await supabaseAdmin.from("privacy_deletion_requests").insert({
      request_type: requestType,
      email,
      full_name: fullName,
      account_reference: accountReference || null,
      details: details || null,
      status: "pending_verification",
      source: "public_web_form",
      user_agent: userAgent || null,
    });
    if (error) throw error;
    persisted = true;
  } catch (error) {
    console.error("[privacy/deletion-request] persist failed", error instanceof Error ? error.message : String(error));
  }

  const typeLabel = requestType === "account" ? "Suppression complète du compte" : "Suppression partielle de données";
  const plainText = [
    "Nouvelle demande de confidentialité iNrCy",
    "",
    `Type : ${typeLabel}`,
    `Nom : ${fullName}`,
    `E-mail du compte : ${email}`,
    `Société / référence : ${accountReference || "-"}`,
    `Précisions : ${details || "-"}`,
    `Date : ${new Date().toISOString()}`,
    "",
    "IMPORTANT : vérifier l'identité du demandeur avant toute suppression.",
  ].join("\n");

  try {
    await sendTxMail({
      to: REQUEST_TO,
      subject: `[Confidentialité iNrCy] ${typeLabel} · ${email}`.slice(0, 160),
      text: plainText,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><h1>Demande de confidentialité iNrCy</h1><p><strong>${escapeHtml(typeLabel)}</strong></p><table style="border-collapse:collapse;width:100%"><tr><td style="padding:8px;border-bottom:1px solid #ddd">Nom</td><td style="padding:8px;border-bottom:1px solid #ddd"><strong>${escapeHtml(fullName)}</strong></td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">E-mail</td><td style="padding:8px;border-bottom:1px solid #ddd"><strong>${escapeHtml(email)}</strong></td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Société / référence</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(accountReference || "-")}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Précisions</td><td style="padding:8px;border-bottom:1px solid #ddd;white-space:pre-wrap">${escapeHtml(details || "-")}</td></tr></table><p style="margin-top:22px;padding:12px;background:#fff4d6"><strong>Vérifier l’identité du demandeur avant toute suppression.</strong></p></div>`,
    });
    mailed = true;
  } catch (error) {
    console.error("[privacy/deletion-request] mail failed", error instanceof Error ? error.message : String(error));
  }

  if (!persisted && !mailed) {
    return NextResponse.json({ ok: false, message: "Le service est momentanément indisponible. Merci de réessayer." }, { status: 503 });
  }

  return NextResponse.json({ ok: true }, { status: 202, headers: { "cache-control": "no-store" } });
}

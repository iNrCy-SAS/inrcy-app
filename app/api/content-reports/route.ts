import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_TO = process.env.INRCY_CONTENT_REPORT_TO || "contact@inrcy.com";
const ALLOWED_REASONS = new Set(["unsafe", "offensive", "false_information", "copyright", "other"]);

type ReportBody = {
  surface?: unknown;
  reason?: unknown;
  comment?: unknown;
  contentExcerpt?: unknown;
  sourceUrl?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;

  let body: ReportBody;
  try {
    body = (await request.json()) as ReportBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Requête invalide." }, { status: 400 });
  }

  const surface = cleanText(body.surface, 160);
  const reason = cleanText(body.reason, 80);
  const comment = cleanText(body.comment, 2000);
  const contentExcerpt = cleanText(body.contentExcerpt, 4000);
  const sourceUrl = cleanText(body.sourceUrl, 1000);

  if (!surface || !ALLOWED_REASONS.has(reason)) {
    return NextResponse.json({ ok: false, message: "Merci de sélectionner un motif valide." }, { status: 400 });
  }

  let persisted = false;
  let mailed = false;

  try {
    const { error } = await supabaseAdmin.from("ai_content_reports").insert({
      auth_user_id: auth.authUserId || null,
      active_user_id: auth.activeUserId || null,
      reporter_email: auth.user?.email || null,
      surface,
      reason,
      comment: comment || null,
      content_excerpt: contentExcerpt || null,
      source_url: sourceUrl || null,
      status: "open",
    });
    if (error) throw error;
    persisted = true;
  } catch (error) {
    console.error("[content-reports] persist failed", error instanceof Error ? error.message : String(error));
  }

  const reporterEmail = auth.user?.email || "-";
  const plainText = [
    "Nouveau signalement de contenu généré dans iNrCy",
    "",
    `Motif : ${reason}`,
    `Zone : ${surface}`,
    `Utilisateur : ${reporterEmail}`,
    `Compte actif : ${auth.activeUserId || "-"}`,
    `Page : ${sourceUrl || "-"}`,
    `Commentaire : ${comment || "-"}`,
    "",
    "Extrait signalé :",
    contentExcerpt || "-",
    "",
    `Date : ${new Date().toISOString()}`,
  ].join("\n");

  try {
    await sendTxMail({
      to: REPORT_TO,
      subject: `[Signalement IA iNrCy] ${reason} · ${surface}`.slice(0, 160),
      text: plainText,
      html: `<div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#172033"><h1>Signalement de contenu généré</h1><table style="border-collapse:collapse;width:100%"><tr><td style="padding:8px;border-bottom:1px solid #ddd">Motif</td><td style="padding:8px;border-bottom:1px solid #ddd"><strong>${escapeHtml(reason)}</strong></td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Zone</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(surface)}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Utilisateur</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(reporterEmail)}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Page</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(sourceUrl || "-")}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Commentaire</td><td style="padding:8px;border-bottom:1px solid #ddd;white-space:pre-wrap">${escapeHtml(comment || "-")}</td></tr></table><h2 style="font-size:18px;margin-top:22px">Extrait signalé</h2><pre style="white-space:pre-wrap;padding:14px;background:#f5f7fb;border-radius:10px">${escapeHtml(contentExcerpt || "-")}</pre></div>`,
    });
    mailed = true;
  } catch (error) {
    console.error("[content-reports] mail failed", error instanceof Error ? error.message : String(error));
  }

  if (!persisted && !mailed) {
    return NextResponse.json(
      { ok: false, message: "Le signalement n’a pas pu être envoyé. Merci de réessayer." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 202, headers: { "cache-control": "no-store" } });
}

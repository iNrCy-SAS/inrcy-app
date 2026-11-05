
import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { sendTxMail } from "@/lib/txMailer";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { acquireExecutionIdempotencyLock, completeExecutionIdempotencyLockOrThrow } from "@/lib/executionIdempotency";
import { escapeHtml } from "@/lib/boosterFormatting";
import { parseReferralRequest, referralRequestKey } from "@/lib/referralRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  phone?: string;
  email?: string;
  from?: string;
  idempotencyKey?: string;
};

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  const { user, activeUserId, authUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("Body JSON invalide.");
  }

  let details: ReturnType<typeof parseReferralRequest>;
  try { details = parseReferralRequest(body); } catch { return badRequest("Merci de vérifier tous les champs et les coordonnées du parrainage."); }
  const { name, phone, email, from } = details;
  const key = body.idempotencyKey;
  let lockId: string | null = null;
  if (key !== undefined) {
    if (typeof key !== "string" || key !== referralRequestKey(activeUserId, authUserId, details)) return badRequest("Clé de parrainage invalide.");
    // SMTP has no provider idempotency token. Never auto-recover an uncertain
    // external send: this stable-content lock intentionally does not expire soon.
    const receipt = await acquireExecutionIdempotencyLock({ supabase: supabaseAdmin, userId: activeUserId, scope: `assistant_referral:${authUserId}`, idempotencyKey: key,
      ttlMs: 100 * 366 * 86400_000, metadata: { operation: "referral", actorUserId: authUserId } });
    if (receipt.state === "unavailable" || !receipt.lock) return NextResponse.json({ ok: false, status: "unavailable", error: "Le reçu de parrainage est indisponible. Aucun email envoyé." }, { status: 503 });
    lockId = receipt.lock.id;
    if (receipt.state === "completed") return NextResponse.json({ ok: true, status: "accepted", idempotent: true, receiptId: lockId });
    if (receipt.state !== "acquired") return NextResponse.json({ ok: false, status: "unknown", receiptId: lockId, error: "Cette recommandation a déjà une tentative en cours ou incertaine. Aucun nouvel email envoyé." }, { status: 202 });
  }
  const escaped = { name: escapeHtml(name), phone: escapeHtml(phone), email: escapeHtml(email), from: escapeHtml(from), userEmail: escapeHtml(user.email ?? "(non disponible)") };

  const subject = `Nouveau parrainage iNrCy — ${name}`;
  const text = [
    "Bonjour,",
    "",
    "Une nouvelle recommandation a été envoyée depuis l'application iNrCy.",
    "",
    `Nom / raison sociale : ${name}`,
    `Téléphone : ${phone}`,
    `Mail : ${email}`,
    `De la part de : ${from}`,
    `Compte connecté : ${user.email ?? "(non disponible)"}`,
    `User ID : ${user.id}`,
    "",
    "Rappel programme : 50 € de chèque cadeau pour tout parrainage d’un client qui reste engagé au minimum 3 mois.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
      <h1 style="margin:0 0 12px 0;font-size:22px;">Nouveau parrainage iNrCy</h1>
      <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#475569;">
        Une nouvelle recommandation a été envoyée depuis l'application iNrCy.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Nom / raison sociale</strong><br />${escaped.name}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Téléphone</strong><br />${escaped.phone}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Mail</strong><br />${escaped.email}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>De la part de</strong><br />${escaped.from}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Compte connecté</strong><br />${escaped.userEmail}</td></tr>
      </table>
      <p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:#64748b;">
        Rappel programme : 50 € de chèque cadeau pour tout parrainage d’un client qui reste engagé au minimum 3 mois.
      </p>
    </div>
  </body>
</html>`;

  try {
    await sendTxMail({
      to: "parrainage@inrcy.com",
      subject,
      text,
      html,
      ...(key ? { messageId: `<${key.slice("assistant-referral:".length)}@inrcy.com>` } : {}),
    });
    if (lockId) await completeExecutionIdempotencyLockOrThrow({ supabase: supabaseAdmin, lockId, result: { ok: true, status: "accepted" }, metadata: { operation: "referral", actorUserId: authUserId } });
    return NextResponse.json({ ok: true, status: "accepted", ...(lockId ? { receiptId: lockId } : {}) });
  } catch (e: unknown) {
    console.error("[referrals] sendTxMail failed:", e);
    return jsonUserFacingError(e, { status: 500, fallback: "Impossible d'envoyer l'email pour le moment.", extra: { ok: false } });
  }
}

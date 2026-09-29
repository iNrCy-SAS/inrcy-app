
import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { sendTxMail } from "@/lib/txMailer";
import { requireUser } from "@/lib/requireUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  phone?: string;
  email?: string;
  from?: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  const { user, errorResponse } = await requireUser();
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

  const name = asString(body?.name);
  const phone = asString(body?.phone);
  const email = asString(body?.email);
  const from = asString(body?.from);

  if (!name || !phone || !email || !from) {
    return badRequest("Merci de remplir tous les champs.");
  }

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
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Nom / raison sociale</strong><br />${name}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Téléphone</strong><br />${phone}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Mail</strong><br />${email}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>De la part de</strong><br />${from}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;"><strong>Compte connecté</strong><br />${user.email ?? "(non disponible)"}</td></tr>
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
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("[referrals] sendTxMail failed:", e);
    return jsonUserFacingError(e, { status: 500, fallback: "Impossible d'envoyer l'email pour le moment.", extra: { ok: false } });
  }
}

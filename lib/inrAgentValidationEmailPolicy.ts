import { createHash } from "node:crypto";

export const INR_AGENT_VALIDATION_EMAIL_SCOPE =
  "inr_agent_validation_ready_email_v1";
export const INR_AGENT_VALIDATION_EMAIL_LOCK_TTL_MS = 15 * 60 * 1000;

type InrAgentValidationEmailInput = {
  firstName?: string | null;
  companyName?: string | null;
  publicationCount: number;
  horizonDays: number;
  firstScheduledAt?: string | null;
  lastScheduledAt?: string | null;
  dashboardUrl: string;
};

function clean(value: unknown, maxLength = 300) {
  return String(value || "").trim().slice(0, maxLength);
}

function escapeHtml(value: unknown) {
  return clean(value, 2_000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function greeting(firstName?: string | null, companyName?: string | null) {
  const first = clean(firstName, 80);
  if (first) return `Bonjour ${first},`;
  const company = clean(companyName, 140);
  if (company) return `Bonjour ${company},`;
  return "Bonjour,";
}

function formatScheduledDate(value?: string | null) {
  const parsed = Date.parse(clean(value, 100));
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function safeDashboardUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error("invalid_protocol");
    return url.toString();
  } catch {
    return "https://app.inrcy.com/dashboard/agent";
  }
}

export function buildInrAgentValidationEmailDeliveryKey(args: {
  userId: string;
  batchSignature: string;
}) {
  const digest = createHash("sha256")
    .update(
      `${clean(args.userId, 160)}\n${clean(args.batchSignature, 160)}`,
      "utf8",
    )
    .digest("hex");
  return `v1:${digest}`;
}

export function buildInrAgentValidationEmailMessageId(batchSignature: string) {
  const digest = createHash("sha256")
    .update(clean(batchSignature, 200), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `<inr-agent-validation-${digest}@inrcy.com>`;
}

export function buildInrAgentValidationEmail(
  input: InrAgentValidationEmailInput,
) {
  const count = Math.max(1, Math.round(Number(input.publicationCount) || 1));
  const horizonDays = Math.max(1, Math.round(Number(input.horizonDays) || 15));
  const plural = count > 1;
  const salutation = greeting(input.firstName, input.companyName);
  const firstDate = formatScheduledDate(input.firstScheduledAt);
  const lastDate = formatScheduledDate(input.lastScheduledAt);
  const scheduleText = firstDate
    ? lastDate && lastDate !== firstDate
      ? `Première diffusion prévue ${firstDate}, dernière diffusion ${lastDate}.`
      : `Diffusion prévue ${firstDate}.`
    : `Programmation préparée pour les ${horizonDays} prochains jours.`;
  const dashboardUrl = safeDashboardUrl(input.dashboardUrl);
  const subject = plural
    ? `iNrCy — ${count} publications iNrAgent attendent votre validation`
    : "iNrCy — 1 publication iNrAgent attend votre validation";
  const headline = plural
    ? `${count} publications sont prêtes`
    : "Votre publication est prête";
  const instruction = plural
    ? "Contrôlez les textes, les médias et les canaux, puis validez les publications que vous souhaitez programmer."
    : "Contrôlez le texte, le média et les canaux, puis validez la publication que vous souhaitez programmer.";
  const escapedDashboardUrl = escapeHtml(dashboardUrl);

  const text = [
    salutation,
    "",
    `${headline} dans iNrAgent.`,
    instruction,
    scheduleText,
    "",
    "Aucune diffusion ne partira sans votre validation.",
    `Valider mes publications : ${dashboardUrl}`,
    "",
    "L’équipe iNrCy",
  ].join("\n");

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#071126;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#071126" style="width:100%;background:#071126;background-color:#071126;">
      <tr>
        <td align="center" style="padding:30px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;border-collapse:separate;border-spacing:0;background:#0d1b3d;background-color:#0d1b3d;border:1px solid #263c70;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="height:7px;background:linear-gradient(90deg,#35d9ff 0%,#755cff 52%,#f637c8 100%);font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:34px 38px 14px 38px;">
                <img src="cid:inrcy-logo@inrcy" width="126" alt="iNrCy" style="display:block;width:126px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                <div style="margin-top:22px;display:inline-block;padding:7px 12px;border-radius:999px;background:#173b63;color:#68e5ff;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Validation iNrAgent</div>
                <h1 style="margin:18px 0 12px 0;font-size:30px;line-height:1.15;color:#ffffff;">${escapeHtml(headline)}</h1>
                <p style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#d7e3ff;">${escapeHtml(salutation)}</p>
                <p style="margin:0 0 14px 0;font-size:16px;line-height:1.65;color:#d7e3ff;">${escapeHtml(instruction)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 24px 38px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#091632;border:1px solid #27477d;border-radius:16px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <div style="font-size:14px;line-height:1.55;color:#9fb6df;">${escapeHtml(scheduleText)}</div>
                      <div style="margin-top:9px;font-size:14px;line-height:1.55;color:#67e8f9;font-weight:700;">Aucune diffusion ne partira sans votre validation.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 26px 38px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td width="33.33%" valign="top" style="padding:0 8px 0 0;">
                      <div style="font-size:12px;font-weight:800;color:#67e8f9;letter-spacing:.06em;text-transform:uppercase;">01 · Contrôlez</div>
                      <div style="margin-top:6px;font-size:13px;line-height:1.45;color:#aebfe1;">Textes et messages</div>
                    </td>
                    <td width="33.33%" valign="top" style="padding:0 8px;">
                      <div style="font-size:12px;font-weight:800;color:#a78bfa;letter-spacing:.06em;text-transform:uppercase;">02 · Vérifiez</div>
                      <div style="margin-top:6px;font-size:13px;line-height:1.45;color:#aebfe1;">Médias et canaux</div>
                    </td>
                    <td width="33.33%" valign="top" style="padding:0 0 0 8px;">
                      <div style="font-size:12px;font-weight:800;color:#f472d0;letter-spacing:.06em;text-transform:uppercase;">03 · Validez</div>
                      <div style="margin-top:6px;font-size:13px;line-height:1.45;color:#aebfe1;">Diffusion programmée</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 36px 38px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;">
                  <tr>
                    <td bgcolor="#6d5dfc" style="border-radius:14px;background:#6d5dfc;background-color:#6d5dfc;">
                      <a href="${escapedDashboardUrl}" style="display:inline-block;padding:15px 23px;border-radius:14px;font-size:15px;font-weight:800;line-height:1.2;color:#ffffff;text-decoration:none;">Valider mes publications →</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0 0;font-size:13px;line-height:1.6;color:#8194bd;">Cet e-mail est envoyé lorsqu’un nouveau lot iNrAgent est prêt à être contrôlé.</p>
                <p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:#b9c8e7;">L’équipe iNrCy</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

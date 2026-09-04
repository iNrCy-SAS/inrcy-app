import "server-only";

import { INRCY_EMAIL_LOGO_CID, INRCY_SIGNATURE_CID } from "@/lib/txEmailAssets";

export type InrAgentCampaignValidationEmailInput = {
  firstName?: string | null;
  companyName?: string | null;
  automationLabel: string;
  missionLabel: string;
  campaignSubject: string;
  campaignBody: string;
  recipientCount: number;
  accountLabel?: string | null;
  ctaUrl: string;
  movedPreviousDrafts?: number;
};

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function greeting(firstName?: string | null, companyName?: string | null) {
  const name = cleanText(firstName, 80);
  if (name) return `Bonjour ${name},`;
  const company = cleanText(companyName, 140);
  if (company) return `Bonjour ${company},`;
  return "Bonjour,";
}

function formatPlural(count: number, singular: string, plural: string) {
  return `${count} ${count > 1 ? plural : singular}`;
}

function buildButton(href: string, label: string) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;">
      <tr>
        <td bgcolor="#111827" style="border-radius:999px;background-color:#111827;box-shadow:0 14px 28px rgba(15,23,42,.18);">
          <a href="${safeHref}" style="display:inline-block;padding:14px 22px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;line-height:1.2;color:#ffffff;text-decoration:none;">${safeLabel}</a>
        </td>
      </tr>
    </table>`;
}

function buildMetric(label: string, value: string, background: string, color = "#0f172a") {
  return `
    <td width="33.333%" valign="top" style="padding:0 5px 10px 5px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${background}" style="width:100%;border-collapse:separate;border-spacing:0;background:${background};background-color:${background};border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:14px 13px 13px 13px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:18px;line-height:1.25;font-weight:900;color:${color};word-break:break-word;">${escapeHtml(value)}</div>
            <div style="height:5px;line-height:5px;font-size:0;">&nbsp;</div>
            <div style="font-size:12px;line-height:1.35;color:#64748b;font-weight:700;">${escapeHtml(label)}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

export function buildInrAgentCampaignValidationEmail(input: InrAgentCampaignValidationEmailInput) {
  const automationLabel = cleanText(input.automationLabel, 80) || "Campagne";
  const missionLabel = cleanText(input.missionLabel, 80) || "Campagne";
  const campaignSubject = cleanText(input.campaignSubject, 220) || "Campagne iNr’Agent à valider";
  const campaignBody = cleanText(input.campaignBody, 1800);
  const accountLabel = cleanText(input.accountLabel, 140) || "Boîte mail connectée";
  const recipientCount = Math.max(0, Math.round(Number(input.recipientCount) || 0));
  const previousDrafts = Math.max(0, Math.round(Number(input.movedPreviousDrafts) || 0));
  const safeGreeting = escapeHtml(greeting(input.firstName, input.companyName));
  const safeSubject = escapeHtml(campaignSubject);
  const safeBody = escapeHtml(campaignBody || "Aperçu disponible dans iNrCy.").replace(/\n/g, "<br />");
  const safeCtaUrl = escapeHtml(input.ctaUrl);
  const recipientLabel = formatPlural(recipientCount, "destinataire", "destinataires");
  const draftSentence = previousDrafts > 0
    ? `L’ancienne proposition a été conservée automatiquement en brouillon dans iNrSend, pour ne rien perdre.`
    : `Vous gardez la main : iNr’Agent prépare, vous validez avant l’envoi.`;

  const html = `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
  <body style="margin:0;padding:0;background:#f3f6fb;background-color:#f3f6fb;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f3f6fb" style="width:100%;background:#f3f6fb;background-color:#f3f6fb;">
      <tr>
        <td align="center" style="padding:28px 14px 42px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;border-collapse:separate;border-spacing:0;">
            <tr>
              <td style="padding:0 0 16px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0b1734" style="width:100%;border-collapse:separate;border-spacing:0;background:#0b1734;background-color:#0b1734;border-radius:28px;overflow:hidden;box-shadow:0 26px 70px rgba(15,23,42,.20);">
                  <tr>
                    <td style="padding:28px 28px 30px 28px;background:linear-gradient(135deg,#081226 0%,#172554 46%,#312e81 100%);">
                      <img src="cid:${escapeHtml(INRCY_EMAIL_LOGO_CID)}" alt="iNrCy" width="108" height="41" style="display:block;width:108px;max-width:100%;height:auto;border:0;outline:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.2;" />
                      <div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>
                      <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#fef3c7;background-color:#fef3c7;color:#92400e;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:900;letter-spacing:.02em;">À VALIDER DANS iNr’Agent</div>
                      <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#dbeafe;">${safeGreeting}</div>
                      <div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:31px;line-height:1.18;color:#ffffff;font-weight:900;max-width:560px;">iNr’Agent a préparé une campagne ${escapeHtml(automationLabel)}.</div>
                      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#e2e8f0;max-width:590px;">Elle est prête à être relue, modifiée si besoin, puis validée depuis votre espace iNrCy. ${escapeHtml(draftSentence)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 16px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;border-collapse:separate;border-spacing:0;background:#ffffff;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
                  <tr>
                    <td style="padding:24px 24px 8px 24px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.3;color:#0f172a;font-weight:900;">Aperçu de la campagne</div>
                      <div style="height:13px;line-height:13px;font-size:0;">&nbsp;</div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;">
                        <tr>
                          ${buildMetric("Type", automationLabel, "#eef2ff", "#3730a3")}
                          ${buildMetric("Rubrique", missionLabel, "#ecfeff", "#0e7490")}
                          ${buildMetric("CRM", recipientLabel, "#f0fdf4", "#15803d")}
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:4px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="padding:16px 18px;border-radius:18px;background:#f8fafc;background-color:#f8fafc;border:1px solid #e2e8f0;">
                        <div style="font-size:12px;line-height:1.4;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Objet du mail</div>
                        <div style="height:7px;line-height:7px;font-size:0;">&nbsp;</div>
                        <div style="font-size:18px;line-height:1.4;color:#0f172a;font-weight:900;">${safeSubject}</div>
                      </div>
                      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
                      <div style="padding:16px 18px;border-radius:18px;background:#ffffff;background-color:#ffffff;border:1px solid #e2e8f0;">
                        <div style="font-size:12px;line-height:1.4;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Début du message</div>
                        <div style="height:9px;line-height:9px;font-size:0;">&nbsp;</div>
                        <div style="font-size:14px;line-height:1.72;color:#334155;max-height:220px;overflow:hidden;">${safeBody}</div>
                      </div>
                      <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
                      <div style="font-size:13px;line-height:1.7;color:#64748b;">Boîte utilisée : <strong style="color:#0f172a;">${escapeHtml(accountLabel)}</strong></div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 16px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;border-collapse:separate;border-spacing:0;background:#ffffff;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
                  <tr>
                    <td style="padding:24px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="font-size:19px;line-height:1.35;color:#0f172a;font-weight:900;">Que faire maintenant ?</div>
                      <div style="height:9px;line-height:9px;font-size:0;">&nbsp;</div>
                      <div style="font-size:14px;line-height:1.75;color:#475569;">Ouvrez iNr’Agent pour consulter la campagne complète. Vous pourrez la modifier, la valider ou la refuser. Aucun envoi ne part sans validation.</div>
                      <div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
                      ${buildButton(input.ctaUrl, "Voir et valider dans iNrCy")}
                      <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
                      <div style="font-size:12px;line-height:1.6;color:#94a3b8;">Si le bouton ne fonctionne pas, copiez ce lien :<br /><a href="${safeCtaUrl}" style="color:#2563eb;text-decoration:underline;word-break:break-all;">${safeCtaUrl}</a></div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:2px 0 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;border-collapse:separate;border-spacing:0;background:#ffffff;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:22px;overflow:hidden;">
                  <tr>
                    <td style="padding:18px 22px 20px 22px;">
                      <img src="cid:${escapeHtml(INRCY_SIGNATURE_CID)}" alt="iNrCy — Service client" width="512" style="width:100%;max-width:512px;height:auto;display:block;border:0;" />
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 0 0 0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;line-height:1.7;">
                iNrCy — notification automatique iNr’Agent<br />
                iNr’Agent prépare vos actions. Vous gardez toujours la validation finale.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    greeting(input.firstName, input.companyName),
    "",
    `iNr’Agent a préparé une campagne ${automationLabel} à valider.`,
    `Rubrique : ${missionLabel}`,
    `Objet : ${campaignSubject}`,
    `Destinataires : ${recipientLabel}`,
    `Boîte utilisée : ${accountLabel}`,
    "",
    "Aperçu :",
    campaignBody || "Aperçu disponible dans iNrCy.",
    "",
    draftSentence,
    "",
    `Voir et valider dans iNrCy : ${input.ctaUrl}`,
  ].join("\n");

  return {
    subject: `iNr’Agent — campagne ${automationLabel} à valider`,
    html,
    text,
  };
}

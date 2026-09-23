import "server-only";

import { optionalEnv } from "@/lib/env";
import { sendTxMail } from "@/lib/txMailer";
import { getInrcyBrandInlineAttachments, INRCY_EMAIL_LOGO_CID, INRCY_SIGNATURE_CID } from "@/lib/txEmailAssets";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { MailCampaignStatus } from "@/lib/crmCampaigns";
import { hasPremiumDashboardAccess } from "@/lib/dashboardEdition";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";

type CampaignRow = Record<string, unknown>;

type CampaignCounters = {
  queuedCount: number;
  processingCount: number;
  sentCount: number;
  failedCount: number;
  status: MailCampaignStatus;
};

type ProfileRow = {
  admin_email?: string | null;
  contact_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_legal_name?: string | null;
};

const FINAL_CAMPAIGN_STATUSES = new Set<MailCampaignStatus>(["completed", "partial", "failed"]);

const ALLOWED_FOLDERS = new Set([
  "mails",
  "factures",
  "devis",
  "publications",
  "recoltes",
  "offres",
  "informations",
  "suivis",
  "enquetes",
  "propulsions",
  "fidelisations",
]);

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanEmail(value: unknown) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

function escapeHtml(input: unknown) {
  return cleanText(input, 4000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hasTransactionalSmtpConfig() {
  return Boolean(
    optionalEnv("TX_SMTP_HOST") &&
      optionalEnv("TX_SMTP_PORT") &&
      optionalEnv("TX_SMTP_USER") &&
      optionalEnv("TX_SMTP_PASS"),
  );
}

function getAppOrigin() {
  return optionalEnv(
    "NEXT_PUBLIC_APP_URL",
    optionalEnv("NEXT_PUBLIC_SITE_URL", "https://app.inrcy.com"),
  ).replace(/\/$/, "");
}

function getProfileContactEmail(profile: ProfileRow | null, fallback?: string | null) {
  return (
    cleanEmail(profile?.contact_email) ||
    cleanEmail(profile?.admin_email) ||
    cleanEmail(fallback)
  );
}

function greeting(profile: ProfileRow | null) {
  const firstName = cleanText(profile?.first_name, 80);
  if (firstName) return `Bonjour ${firstName},`;
  const company = cleanText(profile?.company_legal_name, 140);
  if (company) return `Bonjour ${company},`;
  return "Bonjour,";
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count > 1 ? plural : singular}`;
}

function formatDate(value: unknown) {
  const raw = cleanText(value, 80);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
}

function resolveCampaignFolder(row: CampaignRow) {
  const explicit = cleanText(row.folder, 40).toLowerCase();
  if (ALLOWED_FOLDERS.has(explicit)) return explicit;
  const trackKind = cleanText(row.track_kind, 40).toLowerCase();
  if (trackKind === "fideliser") return "fidelisations";
  if (trackKind === "propulser" || trackKind === "booster") return "propulsions";
  return "mails";
}

function resolveCampaignToolLabel(row: CampaignRow) {
  const folder = resolveCampaignFolder(row);
  const trackKind = cleanText(row.track_kind, 40).toLowerCase();
  if (folder === "recoltes") return "Propulser · Récolter";
  if (folder === "offres") return "Propulser · Offrir";
  if (folder === "informations") return "Fidéliser · Informer";
  if (folder === "suivis") return "Fidéliser · Suivre";
  if (folder === "enquetes") return "Fidéliser · Enquêter";
  if (folder === "fidelisations" || trackKind === "fideliser") return "Fidéliser";
  if (folder === "propulsions" || trackKind === "propulser" || trackKind === "booster") return "Propulser";
  return "iNrSend";
}

function resolveStatusInfo(status: MailCampaignStatus, sentCount: number, failedCount: number) {
  if (status === "completed") {
    return {
      label: "Campagne terminée",
      badge: "TERMINÉE",
      color: "#15803d",
      background: "#dcfce7",
      border: "#bbf7d0",
      intro: "Tous les emails ont été acceptés par les messageries d’envoi. La réception finale dépend ensuite des serveurs destinataires.",
    };
  }
  if (status === "partial" || (sentCount > 0 && failedCount > 0)) {
    return {
      label: "Campagne terminée avec des erreurs",
      badge: "À VÉRIFIER",
      color: "#b45309",
      background: "#fef3c7",
      border: "#fde68a",
      intro: "Une partie des emails a été acceptée par les messageries d’envoi, tandis que certains destinataires ont rencontré une erreur.",
    };
  }
  return {
    label: "Campagne en échec",
    badge: "ÉCHEC",
    color: "#b91c1c",
    background: "#fee2e2",
    border: "#fecaca",
    intro: "La campagne n’a pas pu être envoyée. Le détail est disponible dans iNrSend.",
  };
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
            <div style="font-size:20px;line-height:1.2;font-weight:900;color:${color};word-break:break-word;">${escapeHtml(value)}</div>
            <div style="height:5px;line-height:5px;font-size:0;">&nbsp;</div>
            <div style="font-size:12px;line-height:1.35;color:#64748b;font-weight:700;">${escapeHtml(label)}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

function buildCampaignCompletionMail(args: {
  profile: ProfileRow | null;
  campaign: CampaignRow;
  status: MailCampaignStatus;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  ctaUrl: string;
}) {
  const subject = cleanText(args.campaign.subject, 220) || "Campagne iNrCy";
  const toolLabel = resolveCampaignToolLabel(args.campaign);
  const finishedAt = formatDate(args.campaign.finished_at);
  const startedAt = formatDate(args.campaign.started_at || args.campaign.created_at);
  const lastError = cleanText(args.campaign.last_error, 500);
  const statusInfo = resolveStatusInfo(args.status, args.sentCount, args.failedCount);
  const safeGreeting = escapeHtml(greeting(args.profile));
  const safeCtaUrl = escapeHtml(args.ctaUrl);
  const successRate = args.totalCount > 0 ? Math.round((args.sentCount / args.totalCount) * 100) : 0;
  const statusLabel = statusInfo.label;

  const errorBlock = lastError
    ? `
      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
      <div style="padding:14px 16px;border-radius:16px;background:#fff7ed;background-color:#fff7ed;border:1px solid #fed7aa;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:12px;line-height:1.4;color:#9a3412;font-weight:900;text-transform:uppercase;letter-spacing:.06em;">Information importante</div>
        <div style="height:6px;line-height:6px;font-size:0;">&nbsp;</div>
        <div style="font-size:13px;line-height:1.65;color:#7c2d12;">${escapeHtml(lastError)}</div>
      </div>`
    : "";

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
                      <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:${statusInfo.background};background-color:${statusInfo.background};color:${statusInfo.color};border:1px solid ${statusInfo.border};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:900;letter-spacing:.04em;">${escapeHtml(statusInfo.badge)}</div>
                      <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#dbeafe;">${safeGreeting}</div>
                      <div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:31px;line-height:1.18;color:#ffffff;font-weight:900;max-width:560px;">Bilan de votre campagne iNrCy</div>
                      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#e2e8f0;max-width:590px;">${escapeHtml(statusInfo.intro)}</div>
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
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.3;color:#0f172a;font-weight:900;">Résultat de la campagne</div>
                      <div style="height:13px;line-height:13px;font-size:0;">&nbsp;</div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;">
                        <tr>
                          ${buildMetric("Statut", statusLabel, statusInfo.background, statusInfo.color)}
                          ${buildMetric("Emails envoyés", String(args.sentCount), "#ecfeff", "#0e7490")}
                          ${buildMetric("Taux accepté", `${successRate}%`, "#eef2ff", "#3730a3")}
                        </tr>
                        <tr>
                          ${buildMetric("Destinataires", String(args.totalCount), "#f8fafc", "#0f172a")}
                          ${buildMetric("Échecs", String(args.failedCount), "#fff7ed", "#c2410c")}
                          ${buildMetric("Terminée le", finishedAt, "#f0fdf4", "#15803d")}
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:4px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="padding:16px 18px;border-radius:18px;background:#f8fafc;background-color:#f8fafc;border:1px solid #e2e8f0;">
                        <div style="font-size:12px;line-height:1.4;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Objet de la campagne</div>
                        <div style="height:7px;line-height:7px;font-size:0;">&nbsp;</div>
                        <div style="font-size:18px;line-height:1.4;color:#0f172a;font-weight:900;">${escapeHtml(subject)}</div>
                      </div>
                      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
                      <div style="font-size:13px;line-height:1.7;color:#64748b;">Outil : <strong style="color:#0f172a;">${escapeHtml(toolLabel)}</strong><br />Démarrage : <strong style="color:#0f172a;">${escapeHtml(startedAt)}</strong></div>
                      ${errorBlock}
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
                      <div style="font-size:19px;line-height:1.35;color:#0f172a;font-weight:900;">Voir le détail</div>
                      <div style="height:9px;line-height:9px;font-size:0;">&nbsp;</div>
                      <div style="font-size:14px;line-height:1.75;color:#475569;">Retrouvez la campagne dans iNrSend pour consulter les destinataires envoyés, les éventuels échecs et relancer les adresses corrigeables.</div>
                      <div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
                      ${buildButton(args.ctaUrl, "Voir dans iNrSend")}
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
                iNrCy — bilan automatique de campagne<br />
                Ce message confirme la fin du traitement de votre campagne email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    greeting(args.profile),
    "",
    `Bilan de votre campagne iNrCy : ${statusLabel}.`,
    `Outil : ${toolLabel}`,
    `Objet : ${subject}`,
    `Destinataires : ${args.totalCount}`,
    `Emails envoyés : ${args.sentCount}`,
    `Échecs : ${args.failedCount}`,
    `Taux accepté par les messageries : ${successRate}%`,
    `Démarrage : ${startedAt}`,
    `Fin : ${finishedAt}`,
    lastError ? `Information : ${lastError}` : "",
    "",
    `Voir dans iNrSend : ${args.ctaUrl}`,
  ].filter(Boolean).join("\n");

  return {
    subject: `iNrCy — bilan de campagne : ${statusLabel}`,
    html,
    text,
  };
}

async function fetchProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("admin_email,contact_email,first_name,last_name,company_legal_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[mail-campaign-completion] profile fetch failed", error);
    return null;
  }
  return (data || null) as ProfileRow | null;
}


function isMissingCompletionClaimRpc(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code || "");
  const message = String((error as { message?: unknown } | null)?.message || "").toLowerCase();
  return code === "PGRST202" || code === "42883" || message.includes("claim_mail_campaign_completion_email");
}

async function claimCompletionEmail(campaignId: string, force: boolean) {
  const { data, error } = await supabaseAdmin.rpc("claim_mail_campaign_completion_email", {
    p_campaign_id: campaignId,
    p_force: force,
  });
  if (!error) return Boolean(data);
  if (!isMissingCompletionClaimRpc(error)) throw error;

  const { data: current, error: currentError } = await supabaseAdmin
    .from("mail_campaigns")
    .select("id,status,completion_email_status,completion_email_attempts")
    .eq("id", campaignId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current?.id || !["completed", "partial", "failed"].includes(String(current.status || "").toLowerCase())) return false;
  const emailStatus = String((current as any).completion_email_status || "pending").toLowerCase();
  if (!force && !["pending", "failed"].includes(emailStatus)) return false;
  const { error: updateError } = await supabaseAdmin
    .from("mail_campaigns")
    .update({
      completion_email_status: "sending",
      completion_email_attempts: Math.max(0, Number((current as any).completion_email_attempts || 0)) + 1,
      completion_email_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  if (updateError) {
    const message = String((updateError as any)?.message || "").toLowerCase();
    if (String((updateError as any)?.code || "") === "42703" || message.includes("completion_email_status")) return true;
    throw updateError;
  }
  return true;
}

async function updateCompletionEmailTracking(campaignId: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("mail_campaigns")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (!error) return;
  const message = String((error as any)?.message || "").toLowerCase();
  if (String((error as any)?.code || "") === "42703" || message.includes("completion_email_")) return;
  throw error;
}

export async function sendMailCampaignCompletionSummary(campaignId: string, counters?: CampaignCounters) {
  const safeCampaignId = cleanText(campaignId, 120);
  if (!safeCampaignId) return { sent: false, skippedReason: "missing_campaign_id" };
  if (counters && !FINAL_CAMPAIGN_STATUSES.has(counters.status)) {
    return { sent: false, skippedReason: "campaign_not_finished" };
  }
  if (!hasTransactionalSmtpConfig()) {
    return { sent: false, skippedReason: "tx_smtp_not_configured" };
  }

  const { data: campaignData, error: campaignError } = await supabaseAdmin
    .from("mail_campaigns")
    .select("id,user_id,subject,status,total_count,queued_count,processing_count,sent_count,failed_count,last_error,folder,track_kind,track_type,created_at,started_at,finished_at,provider")
    .eq("id", safeCampaignId)
    .maybeSingle();

  if (campaignError) throw campaignError;
  const campaign = (campaignData || null) as CampaignRow | null;
  if (!campaign?.id) return { sent: false, skippedReason: "campaign_not_found" };

  const status = cleanText(campaign.status, 40) as MailCampaignStatus;
  if (!FINAL_CAMPAIGN_STATUSES.has(status)) {
    return { sent: false, skippedReason: "campaign_not_finished" };
  }

  const userId = cleanText(campaign.user_id, 120);
  if (!userId) return { sent: false, skippedReason: "missing_user_id" };
  const edition = await getDashboardEditionForAccountId(userId);
  if (!hasPremiumDashboardAccess(edition)) {
    return { sent: false, skippedReason: "premium_required" };
  }

  const [profile, authUserResult] = await Promise.all([
    fetchProfile(userId),
    supabaseAdmin.auth.admin.getUserById(userId).catch(() => null),
  ]);

  const fallbackEmail = authUserResult?.data?.user?.email || null;
  const to = getProfileContactEmail(profile, fallbackEmail);
  if (!to) return { sent: false, skippedReason: "missing_pro_email" };

  const sentCount = asNumber(campaign.sent_count, counters?.sentCount ?? 0);
  const failedCount = asNumber(campaign.failed_count, counters?.failedCount ?? 0);
  const totalCount = Math.max(
    sentCount + failedCount,
    asNumber(campaign.total_count, sentCount + failedCount),
  );
  const folder = resolveCampaignFolder(campaign);
  const ctaUrl = `${getAppOrigin()}/dashboard/mails?folder=${encodeURIComponent(folder)}`;
  const mail = buildCampaignCompletionMail({
    profile,
    campaign,
    status,
    totalCount,
    sentCount,
    failedCount,
    ctaUrl,
  });

  await sendTxMail({
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: await getInrcyBrandInlineAttachments(),
  });

  return { sent: true, skippedReason: null };
}


export async function sendTrackedMailCampaignCompletionSummary(
  campaignId: string,
  counters?: CampaignCounters,
  options?: { force?: boolean },
) {
  const safeCampaignId = cleanText(campaignId, 120);
  if (!safeCampaignId) return { sent: false, skippedReason: "missing_campaign_id" };

  const { data: campaignOwner, error: campaignOwnerError } = await supabaseAdmin
    .from("mail_campaigns")
    .select("user_id")
    .eq("id", safeCampaignId)
    .maybeSingle();
  if (campaignOwnerError) throw campaignOwnerError;
  const userId = cleanText(campaignOwner?.user_id, 120);
  if (!userId) return { sent: false, skippedReason: "campaign_not_found" };
  const edition = await getDashboardEditionForAccountId(userId);
  if (!hasPremiumDashboardAccess(edition)) {
    return { sent: false, skippedReason: "premium_required" };
  }

  const claimed = await claimCompletionEmail(safeCampaignId, Boolean(options?.force));
  if (!claimed) return { sent: false, skippedReason: "completion_email_already_handled" };

  try {
    const result = await sendMailCampaignCompletionSummary(safeCampaignId, counters);
    if (result.sent) {
      await updateCompletionEmailTracking(safeCampaignId, {
        completion_email_status: "sent",
        completion_email_sent_at: new Date().toISOString(),
        completion_email_last_error: null,
      });
    } else {
      await updateCompletionEmailTracking(safeCampaignId, {
        completion_email_status: "skipped",
        completion_email_last_error: result.skippedReason || "Bilan non envoyé.",
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Bilan non envoyé.");
    await updateCompletionEmailTracking(safeCampaignId, {
      completion_email_status: "failed",
      completion_email_last_error: message.slice(0, 1000),
    });
    throw error;
  }
}

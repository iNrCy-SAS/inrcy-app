import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { isAuthorizedCronRequest, getCronUserIdFromRequest } from "@/lib/cronAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getActionFromLegacyFolder,
  getActionFromTrack,
  getWorkflowToolForAction,
  type InrcyWorkflowAction,
} from "@/lib/inrcyWorkflow";
import { getConnectionDisplayStatus, mailConnectionKind } from "@/lib/connectionVersions";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import {
  estimateMailCapturedDemands,
  MAIL_CAPTURED_MODEL_VERSION,
} from "@/lib/inrstats/mailCapturedDemandEstimate";

export const runtime = "nodejs";

type MailStatsBreakdown = {
  fideliser: {
    total: number;
    informer: number;
    suivre: number;
    enqueter: number;
  };
  propulser: {
    total: number;
    valoriser: number;
    recolter: number;
    offrir: number;
  };
  mailsSimples: number;
};

const MAX_MAIL_ACCOUNTS = 4;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function safeNum(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function countRecipientsFromString(value: unknown) {
  return cleanString(value)
    .split(/[;,\n\r]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => EMAIL_RE.test(entry)).length;
}

function campaignRecipientCount(row: Record<string, unknown>) {
  const sent = Math.max(0, Math.round(safeNum(row.sent_count)));
  if (sent > 0) return sent;
  const status = cleanString(row.status).toLowerCase();
  if (status !== "completed") return 0;
  const total = Math.max(0, Math.round(safeNum(row.total_count)));
  return total;
}

function isSentMailItem(row: Record<string, unknown>) {
  return cleanString(row.status).toLowerCase() === "sent";
}

function getFolder(row: Record<string, unknown>) {
  return cleanString(row.folder).toLowerCase();
}

function getAction(row: Record<string, unknown>): InrcyWorkflowAction | null {
  return getActionFromTrack(cleanString(row.track_kind), cleanString(row.track_type))
    || getActionFromLegacyFolder(getFolder(row));
}

function incrementBreakdown(breakdown: MailStatsBreakdown, row: Record<string, unknown>) {
  const action = getAction(row);
  if (!action) {
    const folder = getFolder(row);
    if (folder === "fidelisations") {
      breakdown.fideliser.total += 1;
      return;
    }
    if (folder === "propulsions") {
      breakdown.propulser.total += 1;
      return;
    }
    breakdown.mailsSimples += 1;
    return;
  }

  const tool = getWorkflowToolForAction(action);
  if (tool === "fideliser") {
    breakdown.fideliser.total += 1;
    if (action === "informer") breakdown.fideliser.informer += 1;
    else if (action === "suivre") breakdown.fideliser.suivre += 1;
    else if (action === "enqueter") breakdown.fideliser.enqueter += 1;
    return;
  }

  if (tool === "propulser") {
    breakdown.propulser.total += 1;
    if (action === "valoriser") breakdown.propulser.valoriser += 1;
    else if (action === "recolter") breakdown.propulser.recolter += 1;
    else if (action === "offrir") breakdown.propulser.offrir += 1;
    return;
  }

  breakdown.mailsSimples += 1;
}

function countAgendaReminderEmails(metaInput: unknown, cutoffTime = 0) {
  const meta = safeObj(metaInput);
  const reminders = safeObj(meta.reminders);
  const sentAtByRecipient = safeObj(reminders.emailSentAtByRecipient);
  let total = 0;

  for (const sentAtByOffsetRaw of Object.values(sentAtByRecipient)) {
    const sentAtByOffset = safeObj(sentAtByOffsetRaw);
    for (const sentAtRaw of Object.values(sentAtByOffset)) {
      const sentAt = typeof sentAtRaw === "string" ? Date.parse(sentAtRaw) : NaN;
      if (Number.isFinite(sentAt) && sentAt >= cutoffTime) total += 1;
    }
  }

  // Compatibilité avec l'ancien format : un seul rappel pro 24h stocké ici.
  const legacy = typeof reminders.lastEmailReminderAt === "string" ? Date.parse(reminders.lastEmailReminderAt) : NaN;
  if (Number.isFinite(legacy) && legacy >= cutoffTime && total === 0) total += 1;

  return total;
}

function isSentBusinessDocument(row: Record<string, unknown>, type: "facture" | "devis") {
  const status = cleanString(row.status).toLowerCase();
  return status === "sent" && cleanString(row.type).toLowerCase() === type;
}

async function inrStatsMailsHandler(req: Request) {
  const cronUserId = isAuthorizedCronRequest(req) ? getCronUserIdFromRequest(req) : "";
  const supabase = cronUserId ? supabaseAdmin : await createSupabaseServer();
  let userId = cronUserId;

  if (!userId) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonUserFacingError("Non authentifié.", { status: 401 });
    }
    userId = await resolveActiveInrcyAccountId(supabase, userData.user.id);
  }
  const now = Date.now();
  const cutoff7Time = now - 7 * 24 * 60 * 60 * 1000;
  const cutoffTime = now - 30 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffTime).toISOString();
  const agendaHorizonIso = new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [accountsResult, contactCountResult, campaignResult, campaignAllResult, sendItemsResult, sendItemsAllResult, docItemsResult, docItemsAllResult, agendaResult, agendaAllResult, profileResult] = await Promise.all([
      supabase
        .from("integrations")
        .select("id, provider, settings, status, created_at")
        .eq("user_id", userId)
        .eq("category", "mail")
        .order("created_at", { ascending: true }),
      supabase
        .from("crm_contacts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("email", "is", null)
        .neq("email", ""),
      supabase
        .from("mail_campaigns")
        .select("id, folder, track_kind, track_type, template_key, status, total_count, sent_count, created_at, finished_at")
        .eq("user_id", userId)
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("mail_campaigns")
        .select("id, folder, track_kind, track_type, template_key, status, total_count, sent_count, created_at, finished_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("send_items")
        .select("id, folder, track_kind, track_type, status, type, to_emails, created_at")
        .eq("user_id", userId)
        .eq("type", "mail")
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("send_items")
        .select("id, folder, track_kind, track_type, status, type, to_emails, created_at")
        .eq("user_id", userId)
        .eq("type", "mail")
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("send_items")
        .select("id, status, type, created_at")
        .eq("user_id", userId)
        .in("type", ["facture", "devis"])
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("send_items")
        .select("id, status, type, created_at")
        .eq("user_id", userId)
        .in("type", ["facture", "devis"])
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("agenda_events")
        .select("id, start_at, meta")
        .eq("user_id", userId)
        .gte("start_at", cutoffIso)
        .lte("start_at", agendaHorizonIso)
        .order("start_at", { ascending: false })
        .limit(1000),
      supabase
        .from("agenda_events")
        .select("id, start_at, meta")
        .eq("user_id", userId)
        .lte("start_at", agendaHorizonIso)
        .order("start_at", { ascending: false })
        .limit(5000),
      supabase
        .from("profiles")
        .select("lead_conversion_rate")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (accountsResult.error) throw accountsResult.error;
    if (contactCountResult.error) throw contactCountResult.error;
    if (campaignResult.error) throw campaignResult.error;
    if (campaignAllResult.error) throw campaignAllResult.error;
    if (sendItemsResult.error) throw sendItemsResult.error;
    if (sendItemsAllResult.error) throw sendItemsAllResult.error;
    if (docItemsResult.error) throw docItemsResult.error;
    if (docItemsAllResult.error) throw docItemsAllResult.error;
    if (agendaResult.error) throw agendaResult.error;
    if (agendaAllResult.error) throw agendaAllResult.error;
    if (profileResult.error) throw profileResult.error;

    const mailAccounts = Array.isArray(accountsResult.data) ? accountsResult.data : [];
    const connectedCount = Math.max(0, Math.min(MAX_MAIL_ACCOUNTS, mailAccounts.filter((account: Record<string, unknown>) => {
      const provider = cleanString(account.provider);
      const settings = safeObj(account.settings);
      const kind = mailConnectionKind(provider);
      const isConnected = cleanString(account.status).toLowerCase() === "connected";
      const connectionStatus = String(kind ? getConnectionDisplayStatus(isConnected, kind, settings) : isConnected ? "connected" : "disconnected");
      return connectionStatus === "connected" || connectionStatus === "ok";
    }).length));

    const breakdown: MailStatsBreakdown = {
      fideliser: { total: 0, informer: 0, suivre: 0, enqueter: 0 },
      propulser: { total: 0, valoriser: 0, recolter: 0, offrir: 0 },
      mailsSimples: 0,
    };

    let destinataires30 = 0;
    let destinataires7 = 0;
    let destinatairesTotal = 0;
    let campagnes30 = 0;
    let campagnes7 = 0;
    let campagnesTotal = 0;

    for (const campaign of campaignResult.data ?? []) {
      const recipientCount = campaignRecipientCount(campaign as Record<string, unknown>);
      if (recipientCount <= 0) continue;
      campagnes30 += 1;
      destinataires30 += recipientCount;
      const createdAt = Date.parse(cleanString((campaign as any).created_at));
      if (Number.isFinite(createdAt) && createdAt >= cutoff7Time) {
        campagnes7 += 1;
        destinataires7 += recipientCount;
      }
      incrementBreakdown(breakdown, campaign as Record<string, unknown>);
    }

    for (const item of sendItemsResult.data ?? []) {
      if (!isSentMailItem(item as Record<string, unknown>)) continue;
      const recipientCount = countRecipientsFromString((item as any).to_emails) || 1;
      campagnes30 += 1;
      destinataires30 += recipientCount;
      const createdAt = Date.parse(cleanString((item as any).created_at));
      if (Number.isFinite(createdAt) && createdAt >= cutoff7Time) {
        campagnes7 += 1;
        destinataires7 += recipientCount;
      }
      incrementBreakdown(breakdown, item as Record<string, unknown>);
    }

    for (const campaign of campaignAllResult.data ?? []) {
      const recipientCount = campaignRecipientCount(campaign as Record<string, unknown>);
      if (recipientCount <= 0) continue;
      campagnesTotal += 1;
      destinatairesTotal += recipientCount;
    }

    for (const item of sendItemsAllResult.data ?? []) {
      if (!isSentMailItem(item as Record<string, unknown>)) continue;
      campagnesTotal += 1;
      destinatairesTotal += countRecipientsFromString((item as any).to_emails) || 1;
    }

    const factures30 = (docItemsResult.data ?? []).filter((item: any) => isSentBusinessDocument(item, "facture")).length;
    const devis30 = (docItemsResult.data ?? []).filter((item: any) => isSentBusinessDocument(item, "devis")).length;
    const facturesTotal = (docItemsAllResult.data ?? []).filter((item: any) => isSentBusinessDocument(item, "facture")).length;
    const devisTotal = (docItemsAllResult.data ?? []).filter((item: any) => isSentBusinessDocument(item, "devis")).length;

    const agendaReminders30 = (agendaResult.data ?? []).reduce((sum: number, row: any) => {
      return sum + countAgendaReminderEmails(row?.meta, cutoffTime);
    }, 0);
    const agendaRemindersTotal = (agendaAllResult.data ?? []).reduce((sum: number, row: any) => {
      return sum + countAgendaReminderEmails(row?.meta);
    }, 0);

    const contactsEmail = Math.max(0, Math.round(safeNum(contactCountResult.count)));
    const leadConversionRate = Math.max(0, safeNum(profileResult.data?.lead_conversion_rate));
    const capturedLeads = {
      week: estimateMailCapturedDemands({
        campaigns: campagnes7,
        recipients: destinataires7,
        leadConversionRate,
      }),
      month: estimateMailCapturedDemands({
        campaigns: campagnes30,
        recipients: destinataires30,
        leadConversionRate,
      }),
    };

    return NextResponse.json({
      ok: true,
      periodDays: 30,
      connectedCount,
      maxAccounts: MAX_MAIL_ACCOUNTS,
      contactsEmail,
      contactsCrm: contactsEmail,
      campagnes7,
      campagnes30,
      campagnesTotal: Math.max(campagnes30, campagnesTotal),
      destinataires7,
      destinataires30,
      destinatairesTotal: Math.max(destinataires30, destinatairesTotal),
      capturedLeads,
      capturedLeadsEstimated: true,
      capturedLeadsModel: MAIL_CAPTURED_MODEL_VERSION,
      leadConversionRate,
      agendaReminders30,
      agendaRemindersTotal: Math.max(agendaReminders30, agendaRemindersTotal),
      factures30,
      facturesTotal: Math.max(factures30, facturesTotal),
      devis30,
      devisTotal: Math.max(devis30, devisTotal),
      propulsions30: breakdown.propulser.total,
      fidelisations30: breakdown.fideliser.total,
      mailsSimples30: breakdown.mailsSimples,
      // Compatibilité avec l'ancien front : désormais "inrsend30" = mails simples uniquement.
      inrsend30: breakdown.mailsSimples,
      breakdown,
      syncedAt: now,
    });
  } catch (error) {
    captureApiException(req, error, {
      area: "inrstats",
      operation: "GET /api/inrstats/mails",
      statusCode: 500,
    });
    return jsonUserFacingError(error, { status: 500, fallback: "Impossible de charger les statistiques Mails pour le moment." });
  }
}

export const GET = withApi(inrStatsMailsHandler, { route: "/api/inrstats/mails" });

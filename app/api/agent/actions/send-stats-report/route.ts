import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { getCronSecret } from "@/lib/cronAuth";
import { resolveInrAgentActionRequest } from "@/lib/inrAgentRequest";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";
import { getInrcyBrandInlineAttachments } from "@/lib/txEmailAssets";
import { aiGenerateJSON, hasAiGenerationCredentials } from "@/lib/aiGatewayClient";
import { type AiPreferredEngine } from "@/lib/aiEnginePreference";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import {
  commitAiCredits,
  reserveAiCredits,
  rollbackAiCredits,
  isAdminUserForAi,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";
import {
  sanitizeInrAgentAutomationSettings,
  type InrAgentAutomationSettings,
  type InrAgentTheme,
} from "@/lib/inrAgentSettings";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { buildAiLanguageInstruction } from "@/lib/aiWritingProfile";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import type { DashboardEdition } from "@/lib/dashboardEdition";

export const runtime = "nodejs";
export const maxDuration = 180;

type JsonRecord = Record<string, unknown>;

type AutomationDbRow = {
  enabled?: boolean | null;
  frequency?: string | null;
  day_of_week?: number | null;
  time?: string | null;
  validation_mode?: string | null;
  allowed_channels?: string[] | null;
  allowed_themes?: string[] | null;
  use_image_bank?: boolean | null;
  image_required?: boolean | null;
  recipient_scope?: string | null;
  source_strategy?: string | null;
  last_prepared_at?: string | null;
  last_executed_at?: string | null;
  next_run_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ChannelReportLine = {
  key: string;
  label: string;
  connected: boolean;
  statsConnected: boolean;
  statusLabel: string;
  opportunities: number;
  capturedWeek: number;
  capturedMonth: number;
  estimatedValue: number;
  error: string | null;
  recommendation: string;
};

type MailReport = {
  connectedCount: number;
  maxAccounts: number;
  contactsEmail: number;
  campagnes30: number;
  campagnesTotal: number;
  destinataires30: number;
  destinatairesTotal: number;
  propulsions30: number;
  fidelisations30: number;
  mailsSimples30: number;
  agendaReminders30: number;
  factures30: number;
  devis30: number;
};

type BadgeReport = {
  views30: number;
  qrScans30: number;
  actions30: number;
  leads30: number;
  appointments30: number;
  capturedLeads30: number;
  qualityScore: number;
  opportunity30: number;
};

type StatsReportData = {
  edition: DashboardEdition;
  generatedAt: string;
  periodDays: number;
  recipientEmail: string;
  companyName: string;
  proName: string;
  channels: ChannelReportLine[];
  mail: MailReport | null;
  badge: BadgeReport | null;
  totals: {
    connectedChannels: number;
    statsConnectedChannels: number;
    opportunities: number;
    capturedLeadsMonth: number;
    estimatedValue: number;
  };
};

type StatsAiInsights = Record<string, unknown> & {
  globalSummary?: string;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  channelNotes?: Record<string, string>;
};

const ACTION_SELECT =
  "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";

const channelLabels: Record<string, string> = {
  site_inrcy: "Site iNrCy",
  site_web: "Site Web",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

const REPORTS_BUCKET = "inr-agent-reports";
const MAX_STORED_REPORTS = 5;


function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textFromUnknown(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map((item) => textFromUnknown(item)).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = ["globalSummary", "summary", "text", "message", "content", "body", "label", "title", "value"];
    for (const key of preferredKeys) {
      const candidate = textFromUnknown(record[key]);
      if (candidate) return candidate;
    }
    return Object.values(record)
      .map((item) => textFromUnknown(item))
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

function cleanText(value: unknown, maxLength = 1000) {
  return textFromUnknown(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u202f\u00a0]/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function cleanEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email) ? email : "";
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value: number) {
  return Math.max(0, Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatCurrency(value: number) {
  return `${Math.max(0, Math.round(value))} EUR`;
}

function fallbackReportSummary(report: StatsReportData) {
  return `Sur les ${report.periodDays} derniers jours, iNr’Stats a analysé ${report.channels.length} canaux : ${formatNumber(report.totals.opportunities)} opportunités estimées, ${formatNumber(report.totals.capturedLeadsMonth)} demandes captées et ${formatCurrency(report.totals.estimatedValue)} de CA potentiel.`;
}

function cleanNarrativeText(value: unknown, fallback: string, maxLength = 900) {
  const text = cleanText(value, maxLength);
  const hasLetters = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(text);
  const hasEnoughWords = text.split(/\s+/).filter(Boolean).length >= 6;
  return hasLetters && hasEnoughWords ? text : fallback;
}

function formatDateFr(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value: unknown) {
  return cleanText(value, 2000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function rowToAutomationSettings(row: AutomationDbRow | null): InrAgentAutomationSettings {
  return sanitizeInrAgentAutomationSettings("stats", {
    enabled: row?.enabled ?? undefined,
    frequency: row?.frequency as InrAgentAutomationSettings["frequency"],
    dayOfWeek: row?.day_of_week ?? undefined,
    time: row?.time ?? undefined,
    validationMode: row?.validation_mode as InrAgentAutomationSettings["validationMode"],
    allowedChannels: row?.allowed_channels as InrAgentAutomationSettings["allowedChannels"],
    allowedThemes: row?.allowed_themes as InrAgentAutomationSettings["allowedThemes"],
    useImageBank: row?.use_image_bank ?? undefined,
    imageRequired: row?.image_required ?? undefined,
    recipientScope: row?.recipient_scope as InrAgentAutomationSettings["recipientScope"],
    sourceStrategy: row?.source_strategy as InrAgentAutomationSettings["sourceStrategy"],
    lastPreparedAt: row?.last_prepared_at ?? null,
    lastExecutedAt: row?.last_executed_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    metadata: row?.metadata ?? {},
  });
}

async function loadStatsAutomationSettings(userId: string) {
  const { data } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(
      "enabled, frequency, day_of_week, time, validation_mode, allowed_channels, allowed_themes, use_image_bank, image_required, recipient_scope, source_strategy, last_prepared_at, last_executed_at, next_run_at, metadata",
    )
    .eq("user_id", userId)
    .eq("automation_key", "stats")
    .maybeSingle();

  return rowToAutomationSettings((data as AutomationDbRow | null) ?? null);
}

async function fetchJson<T>(url: string, args: { cookie: string; cronUserId?: string }): Promise<{ data: T | null; error: string | null }> {
  try {
    const headers: Record<string, string> = {};
    if (args.cookie) headers.cookie = args.cookie;
    if (args.cronUserId) {
      headers["x-inr-agent-user-id"] = args.cronUserId;
      const cronSecret = getCronSecret();
      if (cronSecret) {
        headers["x-cron-secret"] = cronSecret;
        headers.authorization = `Bearer ${cronSecret}`;
      }
    }

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: Object.keys(headers).length ? headers : undefined,
    });
    const payload = (await response.json().catch(() => null)) as T | JsonRecord | null;
    if (!response.ok) {
      const record = asRecord(payload);
      return { data: null, error: cleanText(record.error || record.message || response.statusText, 400) };
    }
    return { data: payload as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Chargement impossible",
    };
  }
}

function buildChannelRecommendation(line: Omit<ChannelReportLine, "recommendation">) {
  if (!line.connected) return "Canal non connecté : à brancher pour enrichir le bilan.";
  if (!line.statsConnected) return "Compte connecté, mais statistiques à reconnecter ou à actualiser.";
  if (line.error) return "Statistiques partiellement disponibles : vérifier la connexion du canal.";
  if (line.capturedMonth > 0) return "Canal actif : continuer et reproduire les contenus qui déclenchent des demandes.";
  if (line.opportunities >= 10) return "Visibilité présente : ajouter un appel à l'action plus direct pour convertir.";
  return "Canal à nourrir avec plus de régularité cette période.";
}

function statsThemeToChannelKey(theme: InrAgentTheme) {
  if (theme === "youtube") return "youtube_shorts";
  if (theme === "pinterest") return "pinterest";
  return Object.prototype.hasOwnProperty.call(channelLabels, theme) ? theme : "";
}

function normalizeChannelReports(bulk: JsonRecord | null, allowedThemes: InrAgentTheme[]): ChannelReportLine[] {
  const rawBlocks = asRecord(bulk?.blocks);
  const selected = allowedThemes.includes("vue_globale")
    ? Object.keys(channelLabels)
    : allowedThemes.map(statsThemeToChannelKey).filter(Boolean);
  const channelKeys = selected.length ? Array.from(new Set(selected)) : Object.keys(channelLabels);

  return channelKeys.map((key) => {
    const block = asRecord(rawBlocks[key]);
    const connection = asRecord(block.connection);
    const connected = Boolean(connection.connected || connection.accountConnected);
    const statsConnected = Boolean(connection.statsConnected);
    const error = cleanText(block.error, 240) || null;
    const lineWithoutRecommendation = {
      key,
      label: channelLabels[key] || key,
      connected,
      statsConnected,
      statusLabel: statsConnected ? "Stats actives" : connected ? "Connecté sans stats" : "Non connecté",
      opportunities: Math.max(0, Math.round(safeNumber(block.opportunities))),
      capturedWeek: Math.max(0, Math.round(safeNumber(asRecord(block.capturedLeads).week))),
      capturedMonth: Math.max(0, Math.round(safeNumber(asRecord(block.capturedLeads).month))),
      estimatedValue: Math.max(0, Math.round(safeNumber(block.estimatedValue))),
      error,
    };

    return {
      ...lineWithoutRecommendation,
      recommendation: buildChannelRecommendation(lineWithoutRecommendation),
    };
  });
}

function normalizeMailReport(raw: JsonRecord | null): MailReport | null {
  if (!raw) return null;
  return {
    connectedCount: Math.round(safeNumber(raw.connectedCount)),
    maxAccounts: Math.round(safeNumber(raw.maxAccounts, 4)),
    contactsEmail: Math.round(safeNumber(raw.contactsEmail || raw.contactsCrm)),
    campagnes30: Math.round(safeNumber(raw.campagnes30)),
    campagnesTotal: Math.round(safeNumber(raw.campagnesTotal)),
    destinataires30: Math.round(safeNumber(raw.destinataires30)),
    destinatairesTotal: Math.round(safeNumber(raw.destinatairesTotal)),
    propulsions30: Math.round(safeNumber(raw.propulsions30)),
    fidelisations30: Math.round(safeNumber(raw.fidelisations30)),
    mailsSimples30: Math.round(safeNumber(raw.mailsSimples30 || raw.inrsend30)),
    agendaReminders30: Math.round(safeNumber(raw.agendaReminders30)),
    factures30: Math.round(safeNumber(raw.factures30)),
    devis30: Math.round(safeNumber(raw.devis30)),
  };
}

function normalizeBadgeReport(raw: JsonRecord | null): BadgeReport | null {
  if (!raw) return null;
  return {
    views30: Math.round(safeNumber(asRecord(raw.views).month)),
    qrScans30: Math.round(safeNumber(asRecord(raw.qrScans).month)),
    actions30: Math.round(safeNumber(asRecord(raw.actions).month)),
    leads30: Math.round(safeNumber(asRecord(raw.leads).month)),
    appointments30: Math.round(safeNumber(asRecord(raw.appointments).month)),
    capturedLeads30: Math.round(safeNumber(asRecord(raw.capturedLeads).month)),
    qualityScore: Math.round(safeNumber(raw.qualityScore, 52)),
    opportunity30: Math.round(safeNumber(raw.opportunity30)),
  };
}

function buildTotals(channels: ChannelReportLine[]) {
  return channels.reduce(
    (totals, channel) => ({
      connectedChannels: totals.connectedChannels + (channel.connected ? 1 : 0),
      statsConnectedChannels: totals.statsConnectedChannels + (channel.statsConnected ? 1 : 0),
      opportunities: totals.opportunities + channel.opportunities,
      capturedLeadsMonth: totals.capturedLeadsMonth + channel.capturedMonth,
      estimatedValue: totals.estimatedValue + channel.estimatedValue,
    }),
    {
      connectedChannels: 0,
      statsConnectedChannels: 0,
      opportunities: 0,
      capturedLeadsMonth: 0,
      estimatedValue: 0,
    },
  );
}

function fallbackInsights(report: StatsReportData): StatsAiInsights {
  const bestChannels = [...report.channels]
    .filter((channel) => channel.statsConnected)
    .sort((a, b) => b.opportunities + b.capturedMonth * 6 - (a.opportunities + a.capturedMonth * 6))
    .slice(0, 2);

  const disconnected = report.channels.filter((channel) => !channel.connected).slice(0, 2);
  const strengths = bestChannels.length
    ? bestChannels.map((channel) => `${channel.label} ressort comme un canal à suivre en priorité.`)
    : ["Le bilan centralise désormais tous les canaux pour faciliter le pilotage."];

  const weaknesses = disconnected.length
    ? disconnected.map((channel) => `${channel.label} n’est pas encore connecté ou exploitable dans les statistiques.`)
    : ["Les canaux connectés doivent être alimentés régulièrement pour créer plus d’historique."];

  return {
    globalSummary:
      report.totals.statsConnectedChannels > 0
        ? `Sur les ${report.periodDays} derniers jours, ${report.totals.statsConnectedChannels} ${report.totals.statsConnectedChannels > 1 ? "canaux disposent" : "canal dispose"} de statistiques exploitables. iNr’Agent estime ${formatNumber(report.totals.opportunities)} opportunité${report.totals.opportunities > 1 ? "s" : ""} et ${formatNumber(report.totals.capturedLeadsMonth)} demande${report.totals.capturedLeadsMonth > 1 ? "s" : ""} captée${report.totals.capturedLeadsMonth > 1 ? "s" : ""}.`
        : "Les statistiques sont encore limitées : il faut connecter les canaux et laisser iNrCy collecter davantage de données.",
    strengths,
    weaknesses,
    recommendations: [
      "Publier au moins une action utile cette semaine sur les canaux connectés.",
      "Mettre un appel à l’action clair sur les canaux qui génèrent déjà de la visibilité.",
      "Connecter ou réparer les canaux sans statistiques pour obtenir un bilan complet.",
    ],
    channelNotes: Object.fromEntries(report.channels.map((channel) => [channel.key, channel.recommendation])),
  };
}

const STANDARD_PREMIUM_REPORT_PATTERN =
  /\b(?:propulser|fidéliser|crm|agenda|encaisser|factures?|devis|campagnes?\s+mail)\b/i;

function sanitizeStatsInsightsForEdition(
  insights: StatsAiInsights,
  edition: DashboardEdition,
): StatsAiInsights {
  if (edition !== "standard") return insights;

  const safeText = (value: unknown) => {
    const text = cleanText(value, 900);
    return text && !STANDARD_PREMIUM_REPORT_PATTERN.test(text) ? text : "";
  };
  const safeList = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((item) => safeText(item))
      .filter(Boolean)
      .slice(0, 5);
  const safeChannelNotes = Object.fromEntries(
    Object.entries(asRecord(insights.channelNotes))
      .map(([key, value]) => [key, safeText(value)] as const)
      .filter(([, value]) => Boolean(value)),
  );

  return {
    ...insights,
    globalSummary: safeText(insights.globalSummary) || undefined,
    strengths: safeList(insights.strengths),
    weaknesses: safeList(insights.weaknesses),
    recommendations: safeList(insights.recommendations),
    channelNotes: safeChannelNotes,
  };
}

async function generateAiInsights(
  report: StatsReportData,
  aiLanguageInstruction: string,
  preferredEngine: AiPreferredEngine,
  accountId: string,
): Promise<StatsAiInsights> {
  if (!hasAiGenerationCredentials()) return fallbackInsights(report);

  try {
    const compact = {
      periodDays: report.periodDays,
      totals: report.totals,
      channels: report.channels.map((channel) => ({
        key: channel.key,
        label: channel.label,
        status: channel.statusLabel,
        opportunities: channel.opportunities,
        capturedMonth: channel.capturedMonth,
        estimatedValue: channel.estimatedValue,
        error: channel.error,
      })),
      mail: report.mail,
      badge: report.badge,
    };

    const generated = await aiGenerateJSON<StatsAiInsights>({
      feature: "agent.stats-report",
      accountId,
      engine: preferredEngine,
      maxOutputTokens: 1300,
      temperature: 0.25,
      system:
        `Tu es iNr’Agent. Tu rédiges des bilans statistiques courts, utiles et honnêtes pour des professionnels. Tu ne dois jamais inventer des chiffres. Réponds uniquement en JSON.
${report.edition === "standard" ? "Ce compte utilise iNrCy Standard : recommande uniquement les canaux disponibles, Booster, iNrStats, iNrSend Publications, Réputation et iNrBadge. Ne cite jamais Propulser, Fidéliser, CRM, Agenda, Encaisser, devis, factures ni campagnes mails." : ""}
${aiLanguageInstruction}`,
      input: `Analyse ces statistiques iNrCy et retourne un JSON avec les clés globalSummary, strengths, weaknesses, recommendations, channelNotes. Les tableaux doivent contenir 2 à 5 phrases courtes. channelNotes est un objet {cléCanal: phrase courte}. Respecte strictement la langue de sortie obligatoire indiquée. Données : ${JSON.stringify(compact)}`,
    });

    return {
      ...fallbackInsights(report),
      ...generated,
      strengths: Array.isArray(generated.strengths) ? generated.strengths.map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 5) : fallbackInsights(report).strengths,
      weaknesses: Array.isArray(generated.weaknesses) ? generated.weaknesses.map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 5) : fallbackInsights(report).weaknesses,
      recommendations: Array.isArray(generated.recommendations) ? generated.recommendations.map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 5) : fallbackInsights(report).recommendations,
      globalSummary: cleanText(generated.globalSummary, 700) || fallbackInsights(report).globalSummary,
      channelNotes: asRecord(generated.channelNotes) as Record<string, string>,
    };
  } catch (error) {
    console.warn("[inr-agent-stats-report] AI insights fallback", error);
    return fallbackInsights(report);
  }
}

async function buildReportData(args: {
  origin: string;
  cookie: string;
  userEmail: string;
  allowedThemes: InrAgentTheme[];
  cronUserId?: string;
  includeMail: boolean;
}) {
  const fetchArgs = { cookie: args.cookie, cronUserId: args.cronUserId };
  const [bulkResult, mailResult, badgeResult] = await Promise.all([
    fetchJson<JsonRecord>(`${args.origin}/api/stats/dashboard-bulk?days=30&fresh=1`, fetchArgs),
    args.includeMail
      ? fetchJson<JsonRecord>(`${args.origin}/api/inrstats/mails`, fetchArgs)
      : Promise.resolve({ data: null, error: null }),
    fetchJson<JsonRecord>(`${args.origin}/api/inrstats/inrbadge`, fetchArgs),
  ]);

  const channels = normalizeChannelReports(bulkResult.data, args.allowedThemes);
  return {
    channels,
    mail: mailResult.data ? normalizeMailReport(mailResult.data) : null,
    badge: badgeResult.data ? normalizeBadgeReport(badgeResult.data) : null,
    errors: {
      channels: bulkResult.error,
      mail: mailResult.error,
      badge: badgeResult.error,
    },
  };
}


type Rgb = [number, number, number];

const PDF = {
  width: 210,
  height: 297,
  margin: 14,
  dark: [5, 10, 30] as Rgb,
  navy: [8, 21, 49] as Rgb,
  slate: [15, 23, 42] as Rgb,
  muted: [100, 116, 139] as Rgb,
  light: [241, 245, 249] as Rgb,
  white: [255, 255, 255] as Rgb,
  blue: [59, 130, 246] as Rgb,
  cyan: [34, 211, 238] as Rgb,
  purple: [139, 92, 246] as Rgb,
  pink: [236, 72, 153] as Rgb,
  green: [34, 197, 94] as Rgb,
  orange: [249, 115, 22] as Rgb,
  red: [239, 68, 68] as Rgb,
};

function setFill(doc: jsPDF, color: Rgb) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function setDraw(doc: jsPDF, color: Rgb) {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function setText(doc: jsPDF, color: Rgb) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function splitText(doc: jsPDF, text: unknown, width: number): string[] {
  return doc.splitTextToSize(cleanText(text, 4000) || "-", width) as string[];
}

function truncateText(value: unknown, maxLength = 80) {
  const text = cleanText(value, maxLength + 20);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function percentage(value: number, total: number) {
  if (!total || total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function addSoftBackground(doc: jsPDF, pageTitle?: string, pageNumber?: number, reportLabel = "Bilan iNr’Stats") {
  setFill(doc, [247, 250, 255]);
  doc.rect(0, 0, PDF.width, PDF.height, "F");
  setFill(doc, [234, 242, 255]);
  doc.circle(184, 12, 38, "F");
  setFill(doc, [246, 235, 255]);
  doc.circle(18, 278, 44, "F");

  if (pageTitle) {
    setFill(doc, PDF.dark);
    doc.rect(0, 0, PDF.width, 20, "F");
    setFill(doc, PDF.blue);
    doc.roundedRect(14, 6, 5, 5, 1.5, 1.5, "F");
    setText(doc, PDF.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(pageTitle, 23, 11.2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(reportLabel, 164, 11.2);
    if (pageNumber) doc.text(`Page ${pageNumber}`, 194, 11.2, { align: "right" });
  }
}

function addFooter(doc: jsPDF, pageNumber: number, footerLabel = "Bilan généré depuis iNr’Stats") {
  setDraw(doc, [226, 232, 240]);
  doc.setLineWidth(0.2);
  doc.line(14, 282, 196, 282);
  setText(doc, [100, 116, 139]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(footerLabel, 14, 288);
  doc.text(`Page ${pageNumber}`, 196, 288, { align: "right" });
}

function addBrandMark(doc: jsPDF, x: number, y: number, dark = false) {
  setFill(doc, dark ? PDF.white : PDF.dark);
  doc.roundedRect(x, y, 13, 13, 4, 4, "F");
  setFill(doc, dark ? PDF.purple : PDF.blue);
  doc.roundedRect(x + 2.1, y + 8, 2, 3, 0.6, 0.6, "F");
  setFill(doc, dark ? PDF.cyan : PDF.purple);
  doc.roundedRect(x + 5.5, y + 5, 2, 6, 0.6, 0.6, "F");
  setFill(doc, dark ? PDF.pink : PDF.cyan);
  doc.roundedRect(x + 8.9, y + 2, 2, 9, 0.6, 0.6, "F");
  setText(doc, dark ? PDF.white : PDF.dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("iNrCy", x + 17, y + 10.2);
}

function drawGlassCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  options: { fill?: Rgb; border?: Rgb; radius?: number; accent?: Rgb } = {},
) {
  setFill(doc, options.fill || PDF.white);
  setDraw(doc, options.border || [226, 232, 240]);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, options.radius ?? 5, options.radius ?? 5, "FD");
  setDraw(doc, [255, 255, 255]);
  doc.setLineWidth(0.2);
  doc.line(x + 3, y + 1.4, x + w - 3, y + 1.4);
  if (options.accent) {
    setFill(doc, options.accent);
    doc.roundedRect(x, y, 2.6, h, options.radius ?? 5, options.radius ?? 5, "F");
  }
}

function drawSectionTitle(doc: jsPDF, title: string, subtitle: string, x: number, y: number, accent: Rgb = PDF.blue) {
  setFill(doc, accent);
  doc.roundedRect(x, y - 5, 4, 4, 1.2, 1.2, "F");
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, x + 8, y);
  if (subtitle) {
    setText(doc, PDF.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.2);
    doc.text(subtitle, x + 8, y + 6);
  }
}

function drawKpiCard(doc: jsPDF, label: string, value: string, x: number, y: number, w: number, h: number, accent: Rgb) {
  drawGlassCard(doc, x, y, w, h, { fill: [255, 255, 255], border: [219, 234, 254], radius: 5, accent });
  setFill(doc, accent);
  doc.circle(x + 9, y + 9, 3.2, "F");
  setText(doc, PDF.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.text(label.toUpperCase(), x + 5, y + 19);
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(value.length > 10 ? 13 : 16);
  doc.text(value, x + 5, y + 30, { maxWidth: w - 10 });
}

function drawDarkKpiCard(doc: jsPDF, label: string, value: string, x: number, y: number, w: number, h: number, accent: Rgb) {
  drawGlassCard(doc, x, y, w, h, { fill: [12, 28, 64], border: [38, 66, 116], radius: 6, accent });
  setText(doc, [191, 219, 254]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.text(label.toUpperCase(), x + 5, y + 8);
  setText(doc, PDF.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(value.length > 9 ? 13 : 18);
  doc.text(value, x + 5, y + 22, { maxWidth: w - 10 });
}

function normalizeInsightList(items: unknown, fallback: string[]): string[] {
  if (!Array.isArray(items)) return fallback;
  const cleaned = items.map((item) => cleanText(item, 240)).filter(Boolean);
  return cleaned.length ? cleaned.slice(0, 5) : fallback;
}

function addBulletList(doc: jsPDF, items: unknown, x: number, y: number, width: number, color: Rgb = [30, 41, 59]) {
  const list = Array.isArray(items) ? items.map((item) => cleanText(item, 240)).filter(Boolean) : [];
  let cursor = y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.4);
  setText(doc, color);
  for (const item of list.slice(0, 5)) {
    const lines = splitText(doc, `- ${item}`, width);
    doc.text(lines, x, cursor);
    cursor += Math.max(6.4, lines.length * 4.6 + 2.4);
  }
  return cursor;
}

function addWrappedText(doc: jsPDF, text: unknown, x: number, y: number, width: number, lineHeight = 4.8) {
  const lines = splitText(doc, text, width);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function getChannelHealth(channel: ChannelReportLine) {
  if (!channel.connected) return { label: "À connecter", color: PDF.red, score: 0 };
  if (!channel.statsConnected || channel.error) return { label: "À vérifier", color: PDF.orange, score: 30 };
  if (channel.capturedMonth > 20) return { label: "Très actif", color: PDF.green, score: 92 };
  if (channel.capturedMonth > 0) return { label: "Actif", color: PDF.blue, score: 68 };
  if (channel.opportunities > 0) return { label: "À convertir", color: PDF.purple, score: 48 };
  return { label: "À nourrir", color: PDF.orange, score: 38 };
}

function drawStatusBadge(doc: jsPDF, label: string, x: number, y: number, color: Rgb) {
  setFill(doc, [241, 245, 249]);
  setDraw(doc, [226, 232, 240]);
  doc.roundedRect(x, y, 34, 8, 4, 4, "FD");
  setFill(doc, color);
  doc.circle(x + 4.5, y + 4, 1.4, "F");
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.4);
  doc.text(label.toUpperCase(), x + 7.5, y + 5.5, { maxWidth: 24 });
}

function drawInsightCard(doc: jsPDF, title: string, items: string[], x: number, y: number, w: number, h: number, accent: Rgb) {
  drawGlassCard(doc, x, y, w, h, { fill: PDF.white, border: [226, 232, 240], radius: 6, accent });
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, x + 7, y + 12);
  addBulletList(doc, items, x + 7, y + 23, w - 14, [51, 65, 85]);
}

function drawChannelCard(doc: jsPDF, channel: ChannelReportLine, note: string, x: number, y: number, w: number, h: number) {
  const health = getChannelHealth(channel);
  drawGlassCard(doc, x, y, w, h, { fill: PDF.white, border: [226, 232, 240], radius: 6, accent: health.color });
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.2);
  doc.text(channel.label, x + 7, y + 10, { maxWidth: w - 48 });
  drawStatusBadge(doc, health.label, x + w - 42, y + 5, health.color);

  const metricY = y + 22;
  const colW = (w - 15) / 3;
  const metrics = [
    ["Opp.", formatNumber(channel.opportunities)],
    ["Demandes", formatNumber(channel.capturedMonth)],
    ["CA", formatCurrency(channel.estimatedValue)],
  ];
  metrics.forEach(([label, value], index) => {
    const mx = x + 7 + index * colW;
    setText(doc, PDF.muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.text(label.toUpperCase(), mx, metricY);
    setText(doc, PDF.slate);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(value.length > 8 ? 8.6 : 10.5);
    doc.text(value, mx, metricY + 7, { maxWidth: colW - 2 });
  });

  setDraw(doc, [226, 232, 240]);
  doc.line(x + 7, y + 36, x + w - 7, y + 36);
  setText(doc, [71, 85, 105]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  const lines = splitText(doc, note || channel.recommendation, w - 14).slice(0, 2);
  doc.text(lines, x + 7, y + 43);
}

function drawMailBadgeMetric(doc: jsPDF, label: string, value: string, x: number, y: number, w: number, accent: Rgb) {
  drawGlassCard(doc, x, y, w, 28, { fill: PDF.white, border: [226, 232, 240], radius: 5 });
  setFill(doc, accent);
  doc.roundedRect(x + 5, y + 7, 4, 14, 1.2, 1.2, "F");
  setText(doc, PDF.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(label.toUpperCase(), x + 13, y + 10);
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(value, x + 13, y + 21, { maxWidth: w - 17 });
}

function createStatsPdf(report: StatsReportData, insights: StatsAiInsights, options: { automatic: boolean }) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let page = 1;
  const standardReport = report.edition === "standard";
  const reportLabel = "Bilan iNr’Stats";
  const reportModeLabel = options.automatic ? "RAPPORT AUTOMATIQUE INR’AGENT" : "BILAN MANUEL INR’STATS";
  const footerLabel = options.automatic ? "Rapport automatique généré par iNr’Agent" : "Bilan manuel généré depuis iNr’Stats";

  const summary = cleanNarrativeText(
    insights.globalSummary,
    fallbackReportSummary(report),
    900,
  );
  const strengths = normalizeInsightList(insights.strengths, [
    `${report.totals.statsConnectedChannels} ${report.totals.statsConnectedChannels > 1 ? "canaux disposent" : "canal dispose"} de statistiques actives.`,
    `${formatNumber(report.totals.capturedLeadsMonth)} demande${report.totals.capturedLeadsMonth > 1 ? "s" : ""} captée${report.totals.capturedLeadsMonth > 1 ? "s" : ""} sur 30 jours.`,
  ]);
  const weaknesses = normalizeInsightList(insights.weaknesses, [
    "Les canaux sans demandes captées doivent être retravaillés avec des appels à l'action plus directs.",
    standardReport
      ? "Les canaux peu actifs doivent être alimentés avec des publications plus régulières."
      : "Les campagnes mails peuvent être intensifiées pour relancer les contacts CRM.",
  ]);
  const recommendations = normalizeInsightList(insights.recommendations, [
    "Publier un contenu orienté conversion sur les canaux connectés cette semaine.",
    standardReport
      ? "Consulter le Bilan Booster et iNrStats pour préparer la prochaine publication."
      : "Relancer les contacts CRM avec une campagne courte et ciblée.",
    "Suivre les canaux sans demandes pour identifier les freins.",
  ]);
  const channelNotes = asRecord(insights.channelNotes);
  const bestChannels = [...report.channels]
    .filter((channel) => channel.statsConnected)
    .sort((a, b) => b.capturedMonth + b.opportunities - (a.capturedMonth + a.opportunities))
    .slice(0, 3);

  // Page 1 - cover
  setFill(doc, PDF.dark);
  doc.rect(0, 0, PDF.width, PDF.height, "F");
  setFill(doc, [12, 35, 81]);
  doc.circle(172, 30, 58, "F");
  setFill(doc, [58, 27, 93]);
  doc.circle(16, 262, 70, "F");
  setFill(doc, [8, 28, 65]);
  doc.roundedRect(14, 16, 182, 54, 8, 8, "F");
  setDraw(doc, [56, 86, 148]);
  doc.roundedRect(14, 16, 182, 54, 8, 8, "S");
  addBrandMark(doc, 22, 26, true);
  setText(doc, [191, 219, 254]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.6);
  doc.text(reportModeLabel, 22, 55);
  setText(doc, PDF.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.text(reportLabel, 18, 96);
  doc.setFontSize(15);
  doc.text(truncateText(report.companyName || "Votre activité", 64), 18, 109);
  setText(doc, [203, 213, 225]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(`Période analysée : ${report.periodDays} derniers jours`, 18, 121);
  doc.text(`Généré le ${formatDateFr(report.generatedAt)}`, 18, 128);

  drawGlassCard(doc, 18, 140, 174, 42, { fill: [10, 30, 68], border: [49, 80, 137], radius: 7 });
  setText(doc, [147, 197, 253]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("SYNTHÈSE", 26, 153);
  setText(doc, PDF.white);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(splitText(doc, summary, 158).slice(0, 4), 26, 164);

  const darkKpis = [
    ["Canaux", `${report.totals.connectedChannels}/${report.channels.length}`, PDF.cyan],
    ["Stats actives", `${report.totals.statsConnectedChannels}`, PDF.green],
    ["Opportunités", formatNumber(report.totals.opportunities), PDF.purple],
    ["Demandes 30j", formatNumber(report.totals.capturedLeadsMonth), PDF.pink],
    ["CA potentiel", formatCurrency(report.totals.estimatedValue), PDF.blue],
    ["iNrBadge", report.badge ? `${report.badge.qualityScore}/100` : "-", PDF.orange],
  ] as [string, string, Rgb][];
  darkKpis.forEach(([label, value, accent], index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawDarkKpiCard(doc, label, value, 18 + col * 60, 198 + row * 34, 54, 27, accent);
  });
  setText(doc, [148, 163, 184]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.text(options.automatic ? "Ce bilan est généré automatiquement à partir des données disponibles dans iNr’Stats." : "Ce bilan manuel est généré à partir des données disponibles dans iNr’Stats.", 18, 276);

  // Page 2 - executive summary
  doc.addPage();
  page += 1;
  addSoftBackground(doc, "Synthèse dirigeant", page, reportLabel);
  drawSectionTitle(doc, "Ce qu'il faut retenir", "Vue claire des performances et priorités d'action.", 14, 34, PDF.purple);
  drawGlassCard(doc, 14, 48, 182, 42, { fill: PDF.white, border: [219, 234, 254], radius: 7, accent: PDF.blue });
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.2);
  doc.text(splitText(doc, summary, 164).slice(0, 5), 24, 62);

  drawInsightCard(doc, "Points forts", strengths, 14, 104, 56, 86, PDF.green);
  drawInsightCard(doc, "À surveiller", weaknesses, 77, 104, 56, 86, PDF.orange);
  drawInsightCard(doc, "Actions", recommendations, 140, 104, 56, 86, PDF.purple);

  drawSectionTitle(doc, options.automatic ? "Priorités iNr’Agent" : "Priorités recommandées", "Les canaux à suivre en premier dans les prochains jours.", 14, 212, PDF.cyan);
  const priorityY = 225;
  if (bestChannels.length) {
    bestChannels.forEach((channel, index) => {
      const health = getChannelHealth(channel);
      drawGlassCard(doc, 14 + index * 61, priorityY, 56, 34, { fill: PDF.white, border: [226, 232, 240], radius: 5, accent: health.color });
      setText(doc, PDF.slate);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.2);
      doc.text(channel.label, 19 + index * 61, priorityY + 9, { maxWidth: 46 });
      setText(doc, PDF.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.6);
      doc.text(`${formatNumber(channel.capturedMonth)} demandes · ${formatNumber(channel.opportunities)} opp.`, 19 + index * 61, priorityY + 19, { maxWidth: 46 });
      setText(doc, health.color);
      doc.setFont("helvetica", "bold");
      doc.text(health.label, 19 + index * 61, priorityY + 28, { maxWidth: 46 });
    });
  } else {
    setText(doc, PDF.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Aucun canal prioritaire disponible pour le moment.", 14, priorityY + 10);
  }
  addFooter(doc, page, footerLabel);

  // Page 3 - channels
  doc.addPage();
  page += 1;
  addSoftBackground(doc, "Analyse par canal", page, reportLabel);
  drawSectionTitle(doc, "Performance des canaux", "Demandes, opportunités et recommandations par source.", 14, 34, PDF.blue);
  const channelW = 87;
  const channelH = 50;
  let channelIndex = 0;
  for (const channel of report.channels) {
    if (channelIndex > 0 && channelIndex % 8 === 0) {
      addFooter(doc, page, footerLabel);
      doc.addPage();
      page += 1;
      addSoftBackground(doc, "Analyse par canal", page, reportLabel);
      drawSectionTitle(doc, "Performance des canaux", "Suite des canaux analysés.", 14, 34, PDF.blue);
    }
    const local = channelIndex % 8;
    const col = local % 2;
    const row = Math.floor(local / 2);
    const x = 14 + col * 95;
    const y = 50 + row * 55;
    const note = cleanText(channelNotes[channel.key], 260) || channel.recommendation;
    drawChannelCard(doc, channel, note, x, y, channelW, channelH);
    channelIndex += 1;
  }
  addFooter(doc, page, footerLabel);

  // Page 4 - iNrBadge, avec les données mails uniquement en Premium.
  doc.addPage();
  page += 1;
  addSoftBackground(doc, standardReport ? "iNrBadge" : "Mails et iNrBadge", page, reportLabel);
  if (!standardReport) {
    drawSectionTitle(doc, "Mails / Propulser / Fidéliser", "Activité de contact et campagnes sur 30 jours.", 14, 34, PDF.pink);
    if (report.mail) {
      drawMailBadgeMetric(doc, "Boîtes", `${report.mail.connectedCount}/${report.mail.maxAccounts}`, 14, 50, 42, PDF.green);
      drawMailBadgeMetric(doc, "Contacts email", formatNumber(report.mail.contactsEmail), 61, 50, 42, PDF.blue);
      drawMailBadgeMetric(doc, "Campagnes 30j", formatNumber(report.mail.campagnes30), 108, 50, 42, PDF.purple);
      drawMailBadgeMetric(doc, "Destinataires", formatNumber(report.mail.destinataires30), 155, 50, 42, PDF.pink);
      drawGlassCard(doc, 14, 88, 182, 40, { fill: PDF.white, border: [226, 232, 240], radius: 7, accent: PDF.pink });
      setText(doc, PDF.slate);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Répartition des envois", 23, 102);
      setText(doc, [51, 65, 85]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.4);
      doc.text(`Propulser : ${formatNumber(report.mail.propulsions30)}   Fidéliser : ${formatNumber(report.mail.fidelisations30)}   Mails simples : ${formatNumber(report.mail.mailsSimples30)}`, 23, 114);
      doc.text(`Rappels agenda : ${formatNumber(report.mail.agendaReminders30)}   Factures : ${formatNumber(report.mail.factures30)}   Devis : ${formatNumber(report.mail.devis30)}`, 23, 122);
    } else {
      setText(doc, PDF.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Statistiques mails indisponibles au moment du bilan.", 14, 52);
    }
  }

  const badgeTitleY = standardReport ? 34 : 153;
  const badgeMetricsY = standardReport ? 50 : 169;
  const badgeQualityY = standardReport ? 88 : 207;
  drawSectionTitle(doc, "iNrBadge", "Utilisation de la carte de visite numérique et conversion.", 14, badgeTitleY, PDF.cyan);
  if (report.badge) {
    drawMailBadgeMetric(doc, "Vues 30j", formatNumber(report.badge.views30), 14, badgeMetricsY, 42, PDF.blue);
    drawMailBadgeMetric(doc, "Scans QR", formatNumber(report.badge.qrScans30), 61, badgeMetricsY, 42, PDF.purple);
    drawMailBadgeMetric(doc, "Actions", formatNumber(report.badge.actions30), 108, badgeMetricsY, 42, PDF.pink);
    drawMailBadgeMetric(doc, "Demandes", formatNumber(report.badge.capturedLeads30), 155, badgeMetricsY, 42, PDF.green);
    drawGlassCard(doc, 14, badgeQualityY, 88, 42, { fill: PDF.white, border: [226, 232, 240], radius: 7, accent: PDF.cyan });
    setText(doc, PDF.muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("SCORE QUALITÉ", 23, badgeQualityY + 14);
    setText(doc, PDF.slate);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(`${report.badge.qualityScore}/100`, 23, badgeQualityY + 31);
    drawGlassCard(doc, 108, badgeQualityY, 88, 42, { fill: PDF.white, border: [226, 232, 240], radius: 7, accent: PDF.green });
    setText(doc, PDF.muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("TAUX ACTIONS / VUES", 117, badgeQualityY + 14);
    setText(doc, PDF.slate);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(percentage(report.badge.actions30, report.badge.views30), 117, badgeQualityY + 31);
  } else {
    setText(doc, PDF.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Statistiques iNrBadge indisponibles au moment du bilan.", 14, badgeMetricsY + 2);
  }
  addFooter(doc, page, footerLabel);

  // Page 5 - action plan
  doc.addPage();
  page += 1;
  addSoftBackground(doc, "Plan d'action", page, reportLabel);
  drawSectionTitle(doc, "Recommandations concrètes", "Une feuille de route simple pour transformer les statistiques en actions.", 14, 34, PDF.purple);
  const actionCards = recommendations.slice(0, 5);
  let actionY = 54;
  actionCards.forEach((item, index) => {
    const accent = [PDF.blue, PDF.purple, PDF.green, PDF.orange, PDF.pink][index % 5];
    drawGlassCard(doc, 18, actionY, 174, 33, { fill: PDF.white, border: [226, 232, 240], radius: 7, accent });
    setFill(doc, accent);
    doc.circle(30, actionY + 16, 7, "F");
    setText(doc, PDF.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(String(index + 1), 30, actionY + 19.5, { align: "center" });
    setText(doc, PDF.slate);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(splitText(doc, item, 138).slice(0, 2), 44, actionY + 14);
    actionY += 41;
  });
  drawGlassCard(doc, 18, 236, 174, 26, { fill: [239, 246, 255], border: [191, 219, 254], radius: 7, accent: PDF.blue });
  setText(doc, PDF.slate);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("À retenir", 26, 248);
  setText(doc, [51, 65, 85]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    standardReport
      ? "Ce rapport doit servir à décider les prochaines publications et améliorations de vos canaux."
      : "Ce rapport doit servir à décider les prochaines publications, campagnes et relances.",
    52,
    248,
    { maxWidth: 132 },
  );
  addFooter(doc, page, footerLabel);

  const buffer = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
  return buffer;
}

function buildStatsEmail(args: { report: StatsReportData; insights: StatsAiInsights; filename: string; automatic: boolean }) {
  const company = cleanText(args.report.companyName || "votre activité", 120);
  const safeCompany = escapeHtml(company);
  const safeProName = escapeHtml(args.report.proName);
  const summary = cleanNarrativeText(
    args.insights.globalSummary,
    fallbackReportSummary(args.report),
    900,
  );
  const safeSummary = escapeHtml(summary);
  const safeFilename = escapeHtml(args.filename);
  const sourceSentence = args.automatic ? "Mail automatique envoyé par iNr’Agent." : "Bilan manuel généré depuis iNr’Stats.";
  const analysisScope = args.report.edition === "standard"
    ? "Il analyse vos canaux, vos demandes captées et vos opportunités de publication."
    : "Il analyse vos canaux, vos demandes captées, vos opportunités et vos actions mails.";
  const subtitle = args.automatic ? `Analyse automatique iNr’Agent pour ${safeCompany}` : `Bilan manuel iNr’Stats pour ${safeCompany}`;
  const text = [
    `Bonjour${args.report.proName ? ` ${args.report.proName}` : ""},`,
    "",
    `Votre bilan iNr’Stats est disponible en pièce jointe : ${args.filename}.`,
    "",
    summary,
    "",
    `Canaux connectés : ${args.report.totals.connectedChannels}/${args.report.channels.length}`,
    `Opportunités estimées : ${formatNumber(args.report.totals.opportunities)}`,
    `Demandes captées sur 30 jours : ${formatNumber(args.report.totals.capturedLeadsMonth)}`,
    "",
    sourceSentence,
  ].join("\n");

  const html = `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
  <body style="margin:0;padding:0;background:#f4f7fb;background-color:#f4f7fb;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f7fb" style="background:#f4f7fb;background-color:#f4f7fb;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="max-width:640px;background:#ffffff;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.08);overflow:hidden;">
          <tr><td style="padding:24px 24px 8px 24px;">
            <img src="cid:inrcy-logo@inrcy" alt="iNrCy" width="108" height="41" style="display:block;width:108px;max-width:100%;height:auto;border:0;" />
            <h1 style="margin:18px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;color:#0f172a;line-height:1.25;">Votre bilan iNr’Stats est prêt</h1>
            <p style="margin:8px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#64748b;line-height:1.5;">${subtitle}</p>
          </td></tr>
          <tr><td style="padding:8px 24px 6px 24px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
            <p style="margin:12px 0 0 0;font-size:14px;line-height:1.65;">Bonjour${safeProName ? ` ${safeProName}` : ""},</p>
            <p style="margin:12px 0 0 0;font-size:14px;line-height:1.65;">Votre bilan iNr’Stats est disponible en pièce jointe. ${analysisScope}</p>
            <div style="margin:18px 0;padding:16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
              <p style="margin:0;font-size:14px;line-height:1.65;color:#334155;">${safeSummary}</p>
            </div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0;border-collapse:separate;border-spacing:8px;">
              <tr>
                <td style="padding:12px;border-radius:12px;background:#eff6ff;font-family:Arial,Helvetica,sans-serif;"><strong style="display:block;font-size:18px;color:#0f172a;">${args.report.totals.connectedChannels}/${args.report.channels.length}</strong><span style="font-size:12px;color:#64748b;">Canaux connectés</span></td>
                <td style="padding:12px;border-radius:12px;background:#f5f3ff;font-family:Arial,Helvetica,sans-serif;"><strong style="display:block;font-size:18px;color:#0f172a;">${formatNumber(args.report.totals.opportunities)}</strong><span style="font-size:12px;color:#64748b;">Opportunités</span></td>
                <td style="padding:12px;border-radius:12px;background:#ecfdf5;font-family:Arial,Helvetica,sans-serif;"><strong style="display:block;font-size:18px;color:#0f172a;">${formatNumber(args.report.totals.capturedLeadsMonth)}</strong><span style="font-size:12px;color:#64748b;">Demandes 30j</span></td>
              </tr>
            </table>
            <p style="margin:12px 0 0 0;font-size:12px;color:#64748b;line-height:1.6;">Fichier joint : ${safeFilename}</p>
          </td></tr>
          <tr><td style="padding:18px 24px 22px 24px;">
            <div style="border-top:1px solid #eef2f7;height:1px;line-height:1px;font-size:0;">&nbsp;</div>
            <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>
            <img src="cid:inrcy-signature@inrcy" alt="iNrCy — Service client" width="512" style="width:100%;max-width:512px;height:auto;display:block;border:0;" />
          </td></tr>
        </table>
        <p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;text-align:center;">${sourceSentence}</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject: `Votre bilan iNr’Stats - ${company}`, text, html };
}



type StoredReportDocument = {
  bucket: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
};

function extractStoredReportDocument(value: unknown): StoredReportDocument | null {
  const record = asRecord(value);
  const bucket = cleanText(record.bucket, 120);
  const storagePath = cleanText(record.storagePath || record.storage_path || record.path, 260);
  const filename = cleanText(record.filename, 180);
  const mimeType = cleanText(record.mimeType || record.mime_type, 120) || "application/pdf";
  const bytes = Math.max(0, Math.round(safeNumber(record.bytes)));
  const createdAt = cleanText(record.createdAt || record.created_at, 80);
  if (!bucket || !storagePath || !filename) return null;
  return { bucket, storagePath, filename, mimeType, bytes, createdAt };
}

async function ensureReportsBucket(bucket: string) {
  const exists = await supabaseAdmin.storage.getBucket(bucket).catch(() => null);
  if (exists?.data) return;
  await supabaseAdmin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 8 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  }).catch(() => null);
}

async function uploadStoredReport(args: { userId: string; now: string; filename: string; pdfBuffer: Buffer }) {
  const date = new Date(args.now);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  const storagePath = `${args.userId}/stats/${yyyy}/${mm}/${dd}/bilan-inrstats-${yyyy}${mm}${dd}-${hh}${min}${ss}.pdf`;

  await ensureReportsBucket(REPORTS_BUCKET);
  const upload = await supabaseAdmin.storage.from(REPORTS_BUCKET).upload(storagePath, args.pdfBuffer, {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: true,
  });
  if (upload.error) throw upload.error;

  return {
    bucket: REPORTS_BUCKET,
    storagePath,
    filename: args.filename,
    mimeType: "application/pdf",
    bytes: args.pdfBuffer.byteLength,
    createdAt: args.now,
  } satisfies StoredReportDocument;
}

function normalizeActionPayload(value: unknown) {
  return asRecord(value);
}

function normalizeActionRow(value: unknown) {
  return asRecord(value);
}

function normalizeTimestampForSort(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value, 80);
    if (text) return text;
  }
  return "";
}

function reportRunModeFromPayload(payload: JsonRecord) {
  const mode = cleanText(payload.runMode || payload.reportRunMode || payload.executionMode, 40).toLowerCase();
  return mode === "manual" ? "manual" : "automatic";
}

async function pruneStoredReports(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .select("id, payload, completed_at, created_at")
    .eq("user_id", userId)
    .eq("automation_key", "stats")
    .eq("action_type", "stats_report")
    .eq("status", "completed")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(40);

  if (error || !Array.isArray(data)) return;

  const withReport = data
    .map((row) => {
      const payload = normalizeActionPayload((row as Record<string, unknown>).payload);
      const reportDocument = extractStoredReportDocument(payload.reportDocument);
      return {
        id: String((row as Record<string, unknown>).id || ""),
        payload,
        reportDocument,
        runMode: reportRunModeFromPayload(payload),
        sortAt: normalizeTimestampForSort((row as Record<string, unknown>).completed_at, (row as Record<string, unknown>).created_at),
      };
    })
    .filter((row) => row.id && row.reportDocument)
    .sort((a, b) => String(b.sortAt).localeCompare(String(a.sortAt)));

  const automaticReports = withReport.filter((row) => row.runMode !== "manual");
  const manualReports = withReport.filter((row) => row.runMode === "manual");

  const toPrune = [
    ...automaticReports.slice(MAX_STORED_REPORTS),
    ...manualReports.slice(1),
  ];

  if (!toPrune.length) return;

  const grouped = new Map<string, string[]>();
  for (const row of toPrune) {
    const doc = row.reportDocument;
    if (!doc) continue;
    const existing = grouped.get(doc.bucket) || [];
    existing.push(doc.storagePath);
    grouped.set(doc.bucket, existing);
  }

  for (const [bucket, paths] of grouped.entries()) {
    if (paths.length) {
      await supabaseAdmin.storage.from(bucket).remove(paths).catch(() => null);
    }
  }

  await Promise.all(
    toPrune.map((row) => {
      const nextPayload = {
        ...row.payload,
        reportDocument: null,
        reportDocumentPrunedAt: new Date().toISOString(),
      };
      return supabaseAdmin
        .from("inr_agent_actions")
        .update({ payload: nextPayload, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("user_id", userId);
    }),
  );
}

function normalizeFrequency(value: unknown): InrAgentAutomationSettings["frequency"] {
  const frequency = String(value || "weekly") as InrAgentAutomationSettings["frequency"];
  return ["weekly", "twice_weekly", "three_times_weekly", "biweekly", "three_times_monthly", "monthly", "quarterly", "one_off"].includes(frequency)
    ? frequency
    : "weekly";
}

function normalizeTimeLabel(value: unknown) {
  const text = String(value || "09:00").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "09:00";
}

function normalizeDayOfWeek(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 6 ? Math.round(n) : 1;
}

function computeNextScheduledRun(automation: InrAgentAutomationSettings, after: Date) {
  const frequency = normalizeFrequency(automation.frequency);
  if (frequency === "one_off") return null;

  const scheduleTime = normalizeTimeLabel(automation.time);
  const primaryDay = normalizeDayOfWeek(automation.dayOfWeek);
  const slotCount = frequency === "three_times_weekly" ? 3 : frequency === "twice_weekly" ? 2 : 1;
  const offsets = slotCount === 3 ? [0, 2, 4] : slotCount === 2 ? [0, 3] : [0];
  const fallbackSlots = offsets.map((offset) => ({
    dayOfWeek: (primaryDay + offset) % 7,
    time: scheduleTime,
  }));
  const rawSlots = Array.isArray(automation.metadata?.scheduleSlots)
    ? automation.metadata.scheduleSlots
    : [];
  const configuredSlots = rawSlots
    .map((entry) => {
      const source = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      return {
        dayOfWeek: normalizeDayOfWeek(source.dayOfWeek),
        time: normalizeTimeLabel(source.time),
      };
    })
    .slice(0, slotCount);
  const scheduleSlots = slotCount > 1 && configuredSlots.length >= slotCount
    ? configuredSlots
    : fallbackSlots;

  const isFirstOfMonth = (date: Date, dayOfWeek: number) => date.getDay() === dayOfWeek && date.getDate() <= 7;
  const isSecondOfMonth = (date: Date, dayOfWeek: number) => date.getDay() === dayOfWeek && date.getDate() >= 8 && date.getDate() <= 14;
  const isThirdOfMonth = (date: Date, dayOfWeek: number) => date.getDay() === dayOfWeek && date.getDate() >= 15 && date.getDate() <= 21;
  const isScheduledDate = (date: Date, dayOfWeek: number) => {
    if (frequency === "twice_weekly" || frequency === "three_times_weekly") return date.getDay() === dayOfWeek;
    if (frequency === "biweekly") return isFirstOfMonth(date, dayOfWeek) || isThirdOfMonth(date, dayOfWeek);
    if (frequency === "three_times_monthly") return isFirstOfMonth(date, dayOfWeek) || isSecondOfMonth(date, dayOfWeek) || isThirdOfMonth(date, dayOfWeek);
    if (frequency === "monthly") return isFirstOfMonth(date, dayOfWeek);
    if (frequency === "quarterly") return [0, 3, 6, 9].includes(date.getMonth()) && isFirstOfMonth(date, dayOfWeek);
    return date.getDay() === dayOfWeek;
  };

  for (let offset = 0; offset <= 120; offset += 1) {
    const candidates = scheduleSlots
      .map((slot) => {
        const [hours, minutes] = slot.time.split(":").map((item) => Number(item));
        const candidate = new Date(after.getTime());
        candidate.setSeconds(0, 0);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(hours, minutes, 0, 0);
        if (candidate.getTime() <= after.getTime()) return null;
        return isScheduledDate(candidate, slot.dayOfWeek) ? candidate : null;
      })
      .filter((candidate): candidate is Date => Boolean(candidate))
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates[0]) return candidates[0].toISOString();
  }
  return null;
}

export async function POST(request: Request) {
  const context = await resolveInrAgentActionRequest(request);
  if (context.errorResponse) return context.errorResponse;

  const { supabase, user, userId, authUserId, isCron, body } = context;
  let quotaReservation: AiCreditReservation | null = null;
  const rl = await enforceRateLimit({
    name: "inr_agent_stats_report",
    identifier: userId,
    limit: 2,
    window: "1 m",
  });
  if (rl) return rl;

  const manualOrigin = String(body?.origin || body?.source || "").trim().toLowerCase();
  const triggeredFromInrStats = !isCron && manualOrigin === "inrstats";
  const automation = await loadStatsAutomationSettings(userId);

  const { origin } = new URL(request.url);
  const cookie = request.headers.get("cookie") || "";
  const now = new Date().toISOString();

  const [profileResult, businessResult, dashboardEdition] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("admin_email, contact_email, first_name, last_name, company_legal_name")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getDashboardEditionForAccountId(userId),
  ]);

  const profile = asRecord(profileResult.data);
  const business = asRecord(businessResult.data);
  const generationProfile = buildNormalizedAiGenerationProfile({
    profile,
    business,
    idea: "Analyser les statistiques de l'activité et produire un bilan utile",
    theme: "inrstats-report",
    style: "analysis",
  });
  const aiLanguageInstruction = buildAiLanguageInstruction(generationProfile);
  const preferredEngine = generationProfile.preferences.engine;
  const recipientEmail = cleanEmail(profile.contact_email) || cleanEmail(profile.admin_email) || cleanEmail((user as { email?: string | null }).email);
  if (!recipientEmail) {
    return NextResponse.json(
      { error: "Aucune adresse email pro n’est disponible pour envoyer le bilan." },
      { status: 400 },
    );
  }

  const proName = [cleanText(profile.first_name, 80), cleanText(profile.last_name, 100)].filter(Boolean).join(" ").trim();
  const companyName = cleanText(profile.company_legal_name, 140) || proName || "Votre activité";
  const stats = await buildReportData({
    origin,
    cookie,
    userEmail: recipientEmail,
    allowedThemes: automation.allowedThemes,
    cronUserId: isCron ? userId : undefined,
    includeMail: dashboardEdition !== "standard",
  });

  const report: StatsReportData = {
    edition: dashboardEdition,
    generatedAt: now,
    periodDays: 30,
    recipientEmail,
    companyName,
    proName,
    channels: stats.channels,
    mail:
      dashboardEdition !== "standard" &&
      (automation.allowedThemes.includes("mails") || automation.allowedThemes.includes("vue_globale"))
        ? stats.mail
        : null,
    badge: automation.allowedThemes.includes("inrbadge") || automation.allowedThemes.includes("vue_globale") ? stats.badge : null,
    totals: buildTotals(stats.channels),
  };

  if (hasAiGenerationCredentials()) {
    const actorUserId = isCron ? userId : authUserId;
    const isAdmin = await isAdminUserForAi(supabase, actorUserId);
    if (!isAdmin) {
      const quota = await reserveAiCredits({
        supabase,
        userId,
        action: "agent_stats",
        credits: 1,
      });
      if (quota.errorResponse) return quota.errorResponse;
      quotaReservation = quota.reservation;
    }
  }

  const generatedInsights = await generateAiInsights(report, aiLanguageInstruction, preferredEngine, userId);
  const rawInsights = sanitizeStatsInsightsForEdition(generatedInsights, report.edition);
  const reportSummary = cleanNarrativeText(
    rawInsights.globalSummary,
    fallbackReportSummary(report),
    1200,
  );
  const insights: StatsAiInsights = {
    ...rawInsights,
    globalSummary: reportSummary,
  };
  const pdfBuffer = createStatsPdf(report, insights, { automatic: isCron });
  const dateKey = now.slice(0, 10);
  const filename = `bilan-inrstats-${dateKey}.pdf`;
  const mail = buildStatsEmail({ report, insights, filename, automatic: isCron });

  let storedReportDocument: StoredReportDocument | null = null;
  try {
    storedReportDocument = await uploadStoredReport({
      userId,
      now,
      filename,
      pdfBuffer,
    });
  } catch (error) {
    console.warn("[inr-agent-stats-report] report storage failed", error);
  }

  const runMode = isCron ? "automatic" : "manual";

  const actionPayload = {
    version: 1,
    source: isCron ? "inr_agent_stats_report" : triggeredFromInrStats ? "inrstats_manual_report" : "manual_stats_report",
    runMode,
    generatedAt: now,
    periodDays: report.periodDays,
    report,
    insights,
    pdf: {
      filename,
      mimeType: "application/pdf",
      bytes: pdfBuffer.byteLength,
    },
    reportDocument: storedReportDocument,
    delivery: {
      to: recipientEmail,
      subject: mail.subject,
      sentAt: now,
    },
    partialErrors: stats.errors,
  };

  let insertedAction: unknown = null;
  try {
    const { data, error } = await supabaseAdmin
      .from("inr_agent_actions")
      .insert({
        user_id: userId,
        automation_key: "stats",
        action_type: "stats_report",
        target_tool: "inrstats",
        title: isCron ? "Bilan iNr’Stats automatique envoyé" : "Bilan iNr’Stats manuel envoyé",
        summary: isCron ? `Bilan automatique envoyé à ${recipientEmail}` : `Bilan manuel envoyé à ${recipientEmail}`,
        preview_text: reportSummary,
        target_channels: [],
        target_themes: automation.allowedThemes,
        recipients: [{ email: recipientEmail, type: "pro" }],
        image_assets: [],
        payload: actionPayload,
        validation_required: false,
        execution_policy: "automatic_after_settings",
        status: "executing",
        scheduled_for: null,
        prepared_at: now,
        validated_at: now,
        metadata: { preparedManually: !isCron, preparedByCron: isCron, triggeredFromInrStats, runMode, automationFrequency: automation.frequency, reportStored: Boolean(storedReportDocument) },
        created_at: now,
        updated_at: now,
      })
      .select(ACTION_SELECT)
      .single();

    if (error) throw error;
    insertedAction = data;
  } catch (error) {
    console.warn("[inr-agent-stats-report] action insert failed", error);
  }

  try {
    const inlineAttachments = await getInrcyBrandInlineAttachments();
    await sendTxMail({
      to: recipientEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        ...inlineAttachments,
        {
          filename,
          mimeType: "application/pdf",
          content: pdfBuffer,
        },
      ],
    });
  } catch (error) {
    const errorMessage = getSimpleFrenchErrorMessage(error, "Envoi du rapport par mail impossible.");
    if (insertedAction && asRecord(insertedAction).id) {
      const { data } = await supabaseAdmin
        .from("inr_agent_actions")
        .update({
          status: "failed",
          last_error: errorMessage,
          payload: { ...actionPayload, delivery: { ...actionPayload.delivery, error: errorMessage } },
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(asRecord(insertedAction).id))
        .eq("user_id", userId)
        .select(ACTION_SELECT)
        .maybeSingle();

      await rollbackAiCredits(quotaReservation);
      return NextResponse.json(
        {
          error: "Le PDF a été généré, mais l’envoi du mail a échoué.",
          action: data ? rowToInrAgentAction(data as any) : null,
        },
        { status: 500 },
      );
    }

    await rollbackAiCredits(quotaReservation);
    return NextResponse.json(
      { error: "Le PDF a été généré, mais l’envoi du mail a échoué." },
      { status: 500 },
    );
  }

  const completedAt = new Date().toISOString();
  let action = insertedAction ? rowToInrAgentAction(insertedAction as any) : null;
  if (insertedAction && asRecord(insertedAction).id) {
    const { data } = await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        status: "completed",
        completed_at: completedAt,
        payload: { ...actionPayload, delivery: { ...actionPayload.delivery, sentAt: completedAt } },
        updated_at: completedAt,
      })
      .eq("id", String(asRecord(insertedAction).id))
      .eq("user_id", userId)
      .select(ACTION_SELECT)
      .maybeSingle();

    if (data) action = rowToInrAgentAction(data as any);
  }

  if (isCron) {
    await supabaseAdmin
      .from("inr_agent_automation_settings")
      .update({ last_prepared_at: now, last_executed_at: completedAt, updated_at: completedAt })
      .eq("user_id", userId)
      .eq("automation_key", "stats");
  } else {
    const nextRunAt = automation.nextRunAt || computeNextScheduledRun(automation, new Date(completedAt));
    await supabaseAdmin
      .from("inr_agent_automation_settings")
      .update({ last_prepared_at: now, next_run_at: nextRunAt, updated_at: completedAt })
      .eq("user_id", userId)
      .eq("automation_key", "stats");
  }

  // Les bilans iNr’Stats sont maintenant historisés dans iNr’Send :
  // on conserve les PDF complets au lieu de limiter le stockage aux 5 derniers.

  await commitAiCredits(quotaReservation);
  return NextResponse.json({
    action,
    sent: true,
    recipientEmail,
    filename,
    pdfBytes: pdfBuffer.byteLength,
  });
}

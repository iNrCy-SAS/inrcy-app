import type {
  AgentPreparedAction,
  AgentReportDocument,
  AgentStatsReport,
  AutomationConfig,
  AutomationKey,
} from "./agent.types";
import { asRecord, firstSafeString } from "./agent.utils";

export function formatActionDate(
  value: string | null,
  fallback: AutomationConfig,
  locale = "fr-FR",
): string {
  const fallbackLabel = `${fallback.day} ${fallback.time}`.trim();
  if (!value) return fallbackLabel || "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallbackLabel || "—";

  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
    date,
  );
  const dayAndMonth = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  const localizedTime = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  const french = locale.toLowerCase().startsWith("fr");
  const time = french
    ? localizedTime.replace(/\s*h\s*/i, "h").replace(":", "h")
    : localizedTime;
  const separator = french ? "à" : "·";
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${dayAndMonth} ${separator} ${time}`;
}

export function extractReportDocument(
  action: AgentPreparedAction,
): AgentReportDocument | null {
  const payload = action.payload || {};
  const report = asRecord(payload.reportDocument);
  if (!report) return null;

  const storagePath = firstSafeString(
    report.storagePath,
    report.storage_path,
    report.path,
  );
  const downloadUrl = firstSafeString(
    report.downloadUrl,
    report.url,
    report.signedUrl,
  );

  if (!storagePath && !downloadUrl) return null;

  return {
    bucket: firstSafeString(report.bucket),
    storagePath,
    filename: firstSafeString(report.filename) || "bilan-inrstats.pdf",
    mimeType:
      firstSafeString(report.mimeType, report.mime_type) || "application/pdf",
    bytes: Number(report.bytes || 0) || 0,
    createdAt:
      firstSafeString(report.createdAt, report.created_at) ||
      action.createdAt ||
      undefined,
    downloadUrl,
  };
}

export function reportRunMode(action: AgentPreparedAction): "automatic" | "manual" {
  const payload = action.payload || {};
  const mode = firstSafeString(
    payload.runMode,
    payload.reportRunMode,
    payload.executionMode,
  ).toLowerCase();
  return mode === "manual" ? "manual" : "automatic";
}

export function extractStatsReportRecommendations(
  action: AgentPreparedAction,
): string[] {
  const payload = action.payload || {};
  const insights =
    asRecord(payload.insights) ||
    asRecord(payload.reportInsights) ||
    asRecord(payload.aiInsights);
  const rawRecommendations = insights?.recommendations;
  if (!Array.isArray(rawRecommendations)) return [];

  return rawRecommendations
    .map((item) => firstSafeString(item))
    .filter(Boolean)
    .slice(0, 5);
}

export function statsReportsFromActions(
  actions: AgentPreparedAction[],
  options: { automaticOnly?: boolean; limit?: number } = {},
): AgentStatsReport[] {
  const limit = options.limit ?? 5;

  return actions
    .filter((action) => {
      if (action.actionType !== "stats_report" || action.status !== "completed")
        return false;
      if (options.automaticOnly && reportRunMode(action) === "manual")
        return false;
      return true;
    })
    .map((action): AgentStatsReport | null => {
      const document = extractReportDocument(action);
      if (!document) return null;
      return {
        id: action.id,
        title: action.title,
        summary: action.summary,
        recommendations: extractStatsReportRecommendations(action),
        createdAt: action.createdAt,
        completedAt: action.completedAt ?? null,
        document,
        runMode: reportRunMode(action),
      } satisfies AgentStatsReport;
    })
    .filter((report): report is AgentStatsReport => Boolean(report))
    .slice(0, limit);
}

export function statsProgressLabel(percent: number) {
  if (percent >= 100) return "Bilan envoyé";
  if (percent >= 80) return "Finalisation + envoi mail";
  if (percent >= 70) return "Stockage du bilan";
  if (percent >= 45) return "Création du PDF";
  if (percent >= 20) return "Analyse iNr’Agent";
  return "Stats";
}

export function prepareProgressLabel(
  key: Exclude<AutomationKey, "stats">,
  percent: number,
) {
  if (percent >= 100) return "Publication prête";
  if (percent >= 86) return "Enregistrement dans iNr’Agent";
  if (percent >= 66)
    return key === "publish"
      ? "Adaptation par canal"
      : "Préparation de la campagne";
  if (percent >= 38) return "Génération IA";
  if (percent >= 16) return "Analyse de l’activité";
  return "Initialisation";
}

export function formatDateTimeLabel(value: string | null | undefined, fallback = "—", locale = "fr-FR") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatMiniDateLabel(value: string | null | undefined, locale = "fr-FR") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function formatReportDateLabel(value: string | null | undefined, locale = "fr-FR") {
  if (!value) return { date: "—", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "—", time: "" };
  return {
    date: new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  };
}

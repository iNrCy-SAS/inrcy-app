import {
  hasAgentAutomationAccess,
  hasPremiumDashboardAccess,
  isDashboardDestinationAllowedForEdition,
  type DashboardEdition,
} from "./dashboardEdition.ts";

export type NotificationEditionContent = {
  kind: string;
  title: string;
  body: string;
  cta_label?: string | null;
  cta_url?: string | null;
  meta?: Record<string, unknown> | null;
};

type ChannelConnection = {
  provider: string | null;
  product: string | null;
  category: string | null;
  status: string | null;
};

const MAIL_LABEL = "Mails (Gmail, Microsoft ou IMAP)";
const CORE_CHANNELS = [
  { key: "gmb", label: "Google Business" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
] as const;
const PREMIUM_RECOMMENDATIONS = new Set(["crm_refresh", "cross_sell_mail"]);
const AGENT_RECOMMENDATIONS = new Set([
  "inr_agent_editorial_batch_ready",
  "inr_agent_editorial_validation_reminder",
]);
const BUSINESS_EVENTS = new Set([
  "inrbadge_lead", "inrsearch_lead", "inr_search_lead",
  "inrbadge_appointment_request", "agenda_event_saved", "agenda_event_confirmation",
]);

function isMailLabel(label: string) {
  return /gmail|microsoft|outlook|imap|\bmails?\b|bo[iî]te.*mail/i.test(label);
}

/** A mailbox is one optional channel, whichever provider the professional uses. */
export function listMissingNotificationChannels(
  integrations: readonly ChannelConnection[],
  edition: DashboardEdition,
): string[] {
  const connectedRows = integrations.filter((row) => (row.status || "connected") === "connected");
  const connected = new Set(connectedRows.map((row) => String(row.product || row.provider || "").toLowerCase()));
  const missing: string[] = CORE_CHANNELS.filter((channel) => !connected.has(channel.key)).map((channel) => channel.label);
  const hasMail = connectedRows.some((row) => row.category === "mail" || ["gmail", "microsoft", "imap"].includes(String(row.product || row.provider || "").toLowerCase()));
  if (hasPremiumDashboardAccess(edition) && !hasMail) missing.push(MAIL_LABEL);
  return missing;
}

function eligibleMissingChannels(value: unknown, edition: DashboardEdition): string[] | null {
  if (!Array.isArray(value)) return null;
  const allowedLabels = new Set<string>(CORE_CHANNELS.map((channel) => channel.label));
  const labels = value.filter((label): label is string => typeof label === "string");
  const missing = [...new Set(labels.filter((label) => allowedLabels.has(label)))];
  if (hasPremiumDashboardAccess(edition) && labels.some(isMailLabel)) missing.push(MAIL_LABEL);
  return missing;
}

/** Used before a digest is sent and when historical notifications are read. */
export function projectNotificationForEdition<T extends NotificationEditionContent>(
  notification: T,
  edition: DashboardEdition,
): T | null {
  if (!hasPremiumDashboardAccess(edition) && PREMIUM_RECOMMENDATIONS.has(notification.kind)) return null;
  if (!hasAgentAutomationAccess(edition) && AGENT_RECOMMENDATIONS.has(notification.kind)) return null;
  if (!hasPremiumDashboardAccess(edition) && ["agenda_rappel", "calendar_reminder"].includes(notification.kind)) return null;

  let result = notification;
  if (notification.kind === "connect_channels") {
    const missing = eligibleMissingChannels(notification.meta?.missing_channels, edition);
    // Legacy recommendations without structured channel data cannot prove eligibility.
    if (!missing?.length) return null;
    const plural = missing.length > 1;
    result = {
      ...result,
      title: `${missing.length} ${plural ? "canaux" : "canal"} encore activable${plural ? "s" : ""}`,
      body: `Votre générateur peut encore monter en puissance. Commencez par ${missing.slice(0, 2).join(" + ")} pour capter plus d’opportunités dans les 48 prochaines heures.`,
      cta_label: "Configurer mes canaux",
      cta_url: "/dashboard",
      meta: { ...notification.meta, missing_channels: missing },
    };
  }

  const target = String(result.meta?.targetTool || "").toLowerCase();
  const action = String(result.meta?.actionType || "").toLowerCase();
  const automation = String(result.meta?.automationKey || "").toLowerCase();
  const premiumAction = ["mails", "propulser", "fideliser", "crm", "agenda", "ads"].includes(target)
    || ["mailing", "campaign"].includes(action) || ["grow", "loyalty"].includes(automation);
  const agentEventUnavailable = result.kind.startsWith("inragent_scheduled_action_")
    && (!hasAgentAutomationAccess(edition) || !hasPremiumDashboardAccess(edition) && premiumAction);
  // A business event stays visible after a downgrade; its button must remain usable.
  if (agentEventUnavailable || result.cta_url && !isDashboardDestinationAllowedForEdition(result.cta_url, edition)) {
    if (!BUSINESS_EVENTS.has(result.kind) && !result.kind.startsWith("inragent_scheduled_action_")) return null;
    result = { ...result, cta_label: "Ouvrir mon tableau de bord", cta_url: "/dashboard" };
  }
  return result;
}

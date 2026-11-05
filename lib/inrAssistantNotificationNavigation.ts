import { inrAssistantClauseIsAdvice, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

export const INR_ASSISTANT_NOTIFICATION_TARGETS = ["home", "stats", "booster", "dna_profile", "dna_activity", "google_business", "facebook", "instagram", "help", "agents", "website"] as const;
export type InrAssistantNotificationTarget = typeof INR_ASSISTANT_NOTIFICATION_TARGETS[number];
const destinations: Record<InrAssistantNotificationTarget, { href: string; label: string }> = {
  home: { href: "/dashboard", label: "Accueil" }, stats: { href: "/dashboard/stats", label: "iNr’Stats" }, booster: { href: "/dashboard?action=publish", label: "Booster" },
  dna_profile: { href: "/dashboard/adn-entreprise?tab=profile", label: "Mon profil d’entreprise" }, dna_activity: { href: "/dashboard/adn-entreprise?tab=activity", label: "Mon activité" },
  google_business: { href: "/dashboard?panel=gmb", label: "Google Business" }, facebook: { href: "/dashboard?panel=facebook", label: "Facebook" }, instagram: { href: "/dashboard?panel=instagram", label: "Instagram" },
  help: { href: "/dashboard?help=1", label: "Aide iNrCy" }, agents: { href: "/dashboard/agent/publications", label: "Publications" }, website: { href: "/dashboard?panel=site_web", label: "Site web" },
};
export type InrAssistantNotificationNavigation = { destination: "notification"; notificationId: string; notificationTarget: InrAssistantNotificationTarget; href: string; label: string; notificationMenuRevision?: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, REVISION = /^[a-zA-Z0-9_-]{1,100}$/;
export function getInrAssistantNotificationNavigation(notificationId: unknown, notificationTarget: unknown, notificationMenuRevision?: unknown): InrAssistantNotificationNavigation | null {
  if (typeof notificationId !== "string" || !UUID.test(notificationId) || !INR_ASSISTANT_NOTIFICATION_TARGETS.includes(notificationTarget as never) || notificationMenuRevision !== undefined && (typeof notificationMenuRevision !== "string" || !REVISION.test(notificationMenuRevision))) return null;
  return { destination: "notification", notificationId, notificationTarget: notificationTarget as InrAssistantNotificationTarget, ...destinations[notificationTarget as InrAssistantNotificationTarget], ...(typeof notificationMenuRevision === "string" ? { notificationMenuRevision } : {}) };
}
export function parseInrAssistantNotificationNavigation(value: unknown): InrAssistantNotificationNavigation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, keys = ["destination", "notificationId", "notificationTarget", "href", "label", ...(row.notificationMenuRevision === undefined ? [] : ["notificationMenuRevision"])];
  if (row.destination !== "notification" || Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return null;
  const expected = getInrAssistantNotificationNavigation(row.notificationId, row.notificationTarget, row.notificationMenuRevision);
  return expected && row.href === expected.href && row.label === expected.label ? expected : null;
}
/** Only native notification producer destinations, never an arbitrary link. */
export function getInrAssistantNotificationTargetForHref(value: unknown): InrAssistantNotificationTarget | null {
  if (typeof value !== "string" || !value || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  let url: URL; try { url = new URL(value, "https://app.inrcy.com"); } catch { return null; }
  if (url.origin !== "https://app.inrcy.com" || url.hash || url.username || url.password || !/^\/dashboard(?:\/|$)/.test(url.pathname)) return null;
  const href = `${url.pathname}${url.search}`;
  const source: Record<string, InrAssistantNotificationTarget> = {
    "/dashboard": "home", "/dashboard/stats": "stats", "/dashboard?action=publish": "booster",
    "/dashboard/mon-profil": "dna_profile", "/dashboard/mon-profil?section=activity": "dna_activity",
    "/dashboard/adn-entreprise?tab=profile": "dna_profile", "/dashboard/adn-entreprise?tab=activity": "dna_activity",
    "/dashboard?panel=gmb": "google_business", "/dashboard?panel=facebook": "facebook", "/dashboard?panel=instagram": "instagram",
    "/dashboard/gps": "help", "/dashboard?help=1": "help", "/dashboard/agent": "agents", "/dashboard/agent/publications": "agents", "/dashboard?panel=site_web": "website",
  };
  return Object.hasOwn(source, href) ? source[href] : null;
}
export function isInrAssistantNotificationActionRequest(message: string): boolean {
  const text = inrAssistantUnquotedRequest(message);
  if (inrAssistantClauseIsAdvice(text) || /\b(?:si|quand|lorsque|apres|avant|demain|plus tard|jamais|sans|sauf|except|if|when|not|never)\b|\bne\b.{0,60}\bpas\b|\bn['’]/.test(text)
    || !/^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:ouvre\w*|ouvrir|affiche\w*|montre\w*|consulte\w*|clique\w*|open|show)\b/.test(text) || !/\bnotification\b/.test(text)) return false;
  // Opening the bell/list is a separate native menu action, with no selected
  // notification and no implied read marker.
  if (/\b(?:bouton|lien|action)\b.{0,35}\bnotification\b|\bnotification\b.{0,35}\b(?:bouton|lien|action)\b/.test(text) || /\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/i.test(text)) return true;
  if (/(?:«[^»\r\n]+»|"[^"\r\n]+"|“[^”\r\n]+”)/.test(message)) return true;
  const title = text.match(/\bnotification\s+(.+?)[.!?]*$/)?.[1]?.trim();
  return Boolean(title && !/^(?:suivante|precedente|premiere|derniere|actuelle|courante|selectionnee|choisie|du compte|de mon compte|dans|sur)\b/.test(title));
}

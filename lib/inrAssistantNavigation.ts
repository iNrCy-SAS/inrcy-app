/** Public tool names shared by assistant links, including older saved replies. */
export const INR_ASSISTANT_APP_ORIGIN = "https://app.inrcy.com";

const TOOL_ROUTES: Readonly<Record<string, string>> = {
  "/dashboard/adn-entreprise": "ADN de l’entreprise",
  "/dashboard/mon-profil": "ADN de l’entreprise",
  "/dashboard/configuration-ia": "Configuration IA",
  "/dashboard/generer-media": "iNrStudio",
  "/dashboard/mediatheque": "Mes médias",
  "/dashboard/booster": "Booster",
  "/dashboard/booster/publier": "Booster",
  "/dashboard/ads": "iNr’ADS",
  "/dashboard/e-reputation": "Réputation",
  "/dashboard/propulser": "Propulser",
  "/dashboard/fideliser": "Fidéliser",
  "/dashboard/stats": "iNr’Stats",
  "/dashboard/mails": "iNr’Send",
  "/dashboard/crm": "iNr’CRM",
  "/dashboard/agenda": "iNr’Calendar",
  "/dashboard/interventions": "iNr’Calendar",
  "/dashboard/devis": "Mes devis",
  "/dashboard/devis/new": "Créer un devis",
  "/dashboard/factures": "Mes factures",
  "/dashboard/factures/new": "Créer une facture",
  "/dashboard/agent/publications": "Agent Publications",
  "/dashboard/agent/campagnes-mails": "Agent Emailings",
  "/dashboard/agent/stats": "Agent Stats",
  "/dashboard/agent": "Agents IA",
  "/dashboard/boutique/recharges": "Crédits médias",
  "/dashboard/gps": "Aide iNrCy",
  "/dashboard/settings/profil": "ADN de l’entreprise",
  "/dashboard/settings/activite": "ADN de l’entreprise",
  "/dashboard/settings/abonnement": "Mon abonnement",
  "/dashboard/settings/contact": "Nous contacter",
  "/dashboard/settings/ia": "Configuration IA",
  "/dashboard/settings/preferences": "Préférences",
  "/dashboard/settings": "Réglages",
};

const PANEL_NAMES: Readonly<Record<string, string>> = {
  compte: "Mon compte", abonnement: "Mon abonnement", factures: "Factures d’abonnement",
  parrainage: "Parrainage", preferences: "Préférences", legal: "Infos légales", rgpd: "Données RGPD",
  boutique: "Boutique", inertie: "Mon inertie", contact: "Nous contacter", documents: "Documents",
  profil: "ADN de l’entreprise", activite: "ADN de l’entreprise", ai_memory: "ADN de l’entreprise",
  ia: "Configuration IA", agenda: "iNr’Calendar", mails: "Messagerie",
  site_web: "Site web", site_inrcy: "Site web", gmb: "Google Business", facebook: "Facebook",
  instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn", tiktok: "TikTok",
  youtube_shorts: "YouTube", pinterest: "Pinterest", x: "X", inr_search: "iNr’Search",
  trustpilot: "iNr’Search", inrbadge: "iNr’Badge",
};

function isAppUrl(url: URL): boolean {
  return url.origin === INR_ASSISTANT_APP_ORIGIN || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Recognize saved production/development URLs without changing the active host. */
export function getAssistantAppPath(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) return undefined;
  try {
    const url = new URL(value, `${INR_ASSISTANT_APP_ORIGIN}/dashboard`);
    if (!["http:", "https:"].includes(url.protocol) || !isAppUrl(url)) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

/** Keep model-generated links limited to web URLs and app-relative navigation. */
export function getSafeAssistantHref(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) return undefined;
  const isWebUrl = /^https?:\/\//iu.test(value);
  const isRelative = /^(?:\/(?!\/)|[?#])/u.test(value);
  if (!isWebUrl && !isRelative) return undefined;
  try {
    const url = new URL(value, INR_ASSISTANT_APP_ORIGIN);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (isAppUrl(url) && /^\/(?:api|auth)(?:\/|$)/u.test(url.pathname)) return undefined;
    if (isWebUrl) return url.href;
    if (url.origin !== INR_ASSISTANT_APP_ORIGIN) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** Only real dashboard destinations use the in-app navigation callback. */
export function getAssistantInternalDestination(value: string | undefined): { href: string; label: string } | undefined {
  const safeHref = getSafeAssistantHref(value);
  if (!safeHref) return undefined;
  const appPath = getAssistantAppPath(safeHref);
  if (!appPath) return undefined;
  const url = new URL(appPath, INR_ASSISTANT_APP_ORIGIN);
  if (!/^\/dashboard(?:\/|$)/u.test(url.pathname)) return undefined;
  const path = url.pathname.replace(/\/+$/u, "");
  let label: string | undefined;
  if (path === "/dashboard") {
    const action = url.searchParams.get("action");
    label = ({ channels: "Mes canaux", publish: "Booster", campaigns: "Campagnes mails", cash: "Encaisser" } as Record<string, string>)[action || ""];
    if (action && !label) return undefined;
    if (!label && url.searchParams.get("helpAction") === "channels") {
      label = "Mes canaux";
      url.searchParams.delete("helpAction");
      url.searchParams.set("action", "channels");
    } else if (url.searchParams.has("helpAction")) return undefined;
    if (!label && url.searchParams.get("help") === "1") label = "Aide iNrCy";
    if (!label && url.searchParams.get("generator") === "1") label = "Générateur de visibilité";
    if (!label && url.searchParams.get("stats") === "1") label = "iNr’Stats";
    if (!label) label = PANEL_NAMES[url.searchParams.get("panel") || ""];
    if (!label && url.searchParams.has("panel")) return undefined;
    label ||= "Accueil";
  } else {
    label = TOOL_ROUTES[path];
    if (!label) return undefined;
  }
  return { href: `${url.pathname}${url.search}${url.hash}`, label };
}

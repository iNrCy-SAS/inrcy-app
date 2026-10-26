import {
  isDashboardDestinationAllowedForEdition,
  hasPremiumDashboardAccess,
  isStandardDashboardEdition,
  type DashboardEdition,
} from "../../../lib/dashboardEdition.ts";
import { INR_AGENT_WORKSPACES, type InrAgentWorkspace } from "../../../lib/inrAgentWorkspaces.ts";
import { getGpsSectionsForEdition } from "../gps/gpsEditionPolicy.ts";
import type { GpsArticleSource } from "../gps/noticeContent.ts";

export const HELP_GOALS = ["publish", "media", "grow", "reviews", "contacts", "stats"] as const;
export type HelpGoal = (typeof HELP_GOALS)[number];

export const HELP_SETUP = ["channels", "dna", "ai"] as const;
export type HelpSetup = (typeof HELP_SETUP)[number];

export type HelpArticle = { sectionId: string; article: GpsArticleSource };
export type HelpTool = { label: string; href: string; premium: boolean; agentImage?: string };

const GOAL_ARTICLES: Record<HelpGoal, readonly string[]> = {
  publish: ["booster-express", "booster-medias", "booster-bilan", "inragent-express"],
  media: ["booster-medias"],
  grow: ["propulser-express", "fideliser-express", "crm-express", "inragent-express"],
  reviews: ["conseils-express", "canaux-express"],
  contacts: ["inrsend-express", "crm-express", "agenda-express"],
  stats: ["inrstats-express", "booster-bilan", "generateur-express", "inragent-express"],
};

const SETUP_ARTICLES: Record<HelpSetup, readonly string[]> = {
  channels: ["canaux-express", "canaux-threads"],
  dna: ["demarrer-express", "demarrer-rangement"],
  ai: ["demarrer-express", "booster-express"],
};

/** Keep the existing edition overrides and pilot articles as the source of truth. */
export function getHelpArticles(edition: DashboardEdition, metaPilotEnabled = false): HelpArticle[] {
  return getGpsSectionsForEdition(edition, metaPilotEnabled).flatMap((section) =>
    section.articles.map((article) => {
      const seen = new Set<string>();
      const links = article.links?.map((link) => {
        // The old GPS used the homepage for both channels and Generator.
        // Resolve this ambiguous link while the article context is available.
        if (article.id === "generateur-express" && link.href === "/dashboard") {
          return { ...link, href: "/dashboard?helpAction=generator-settings" };
        }
        if (article.id === "agenda-express" && link.label === "nouvel_evenement_4b838182") {
          return { ...link, href: "/dashboard/agenda?action=new" };
        }
        return link;
      }).filter((link) => {
        if (seen.has(link.href)) return false;
        seen.add(link.href);
        return true;
      });
      return { sectionId: section.id, article: links ? { ...article, links } : article };
    }),
  );
}

export function getHelpGoalArticleIds(goal: HelpGoal): readonly string[] {
  return [...GOAL_ARTICLES[goal]];
}

export function getHelpSetupArticleIds(setup: HelpSetup): readonly string[] {
  return [...SETUP_ARTICLES[setup]];
}

export function getHelpGoalTools(goal: HelpGoal, edition: DashboardEdition, inrAgentEnabled: boolean): HelpTool[] {
  const tool = (label: string, href: string, agentImage?: string): HelpTool => ({
    label,
    href,
    premium: !isDashboardDestinationAllowedForEdition(href, edition),
    ...(agentImage ? { agentImage } : {}),
  });
  const agent = (workspace: InrAgentWorkspace, label: string) => {
    const definition = INR_AGENT_WORKSPACES[workspace];
    return tool(label, definition.href, definition.icon);
  };

  switch (goal) {
    case "publish": return [
      tool("Booster", "/dashboard?action=publish"),
      ...(inrAgentEnabled ? [agent("publications", "iNr’Agent Publications")] : []),
    ];
    case "media": return [
      tool("iNr’Studio", "/dashboard/generer-media"),
      tool("Médiathèque", "/dashboard/mediatheque"),
    ];
    case "grow": return [
      tool("iNr’ADS", "/dashboard/ads"),
      tool("Propulser", "/dashboard/propulser"),
      tool("Fidéliser", "/dashboard/fideliser"),
      ...(inrAgentEnabled && hasPremiumDashboardAccess(edition) ? [agent("campaigns", "iNr’Agent Campagnes mails")] : []),
    ];
    case "reviews": return [tool("Réputation", "/dashboard/e-reputation")];
    case "contacts": return [
      tool("iNr’Send", isStandardDashboardEdition(edition) ? "/dashboard/mails?folder=publications&boxView=sent" : "/dashboard/mails"),
      tool("iNr’CRM", "/dashboard/crm"),
      tool("iNr’Calendar", "/dashboard/agenda"),
    ];
    case "stats": return [
      tool("iNr’Stats", "/dashboard/stats"),
      ...(inrAgentEnabled ? [agent("stats", "iNr’Agent Stats")] : []),
    ];
  }
}

export function normalizeHelpSearch(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Adapt old guide links without changing explicit panel, tool or external links. */
export function getHelpArticleDestination(href: string): string {
  if (href === "/dashboard" || href === "/dashboard/") return "/dashboard?helpAction=channels";
  return href.replace(/^\/dashboard\/profil-entreprise(?=\/?(?:[?#]|$))\/?/, "/dashboard/adn-entreprise");
}

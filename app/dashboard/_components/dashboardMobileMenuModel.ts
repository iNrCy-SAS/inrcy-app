import { isDashboardDestinationAllowedForEdition, type DashboardEdition } from "../../../lib/dashboardEdition.ts";

export type DashboardMobileToolId = "publish" | "studio" | "media" | "ads" | "campaigns" | "reputation" | "stats" | "send" | "calendar" | "crm" | "cash";
export type DashboardMobileTool = {
  id: DashboardMobileToolId;
  href: string;
  tone: "blue" | "violet" | "pink" | "amber" | "cyan" | "mint";
  iconSrc?: string;
};

const CREATE_TOOLS: readonly DashboardMobileTool[] = [
  { id: "publish", href: "/dashboard?action=publish", tone: "blue" },
  { id: "studio", href: "/dashboard/generer-media", tone: "blue" },
  { id: "media", href: "/dashboard/mediatheque", tone: "blue" },
  { id: "ads", href: "/dashboard/ads", tone: "pink" },
  { id: "campaigns", href: "/dashboard?action=campaigns", tone: "amber" },
  { id: "reputation", href: "/dashboard/e-reputation", tone: "pink" },
];

const MANAGE_TOOLS: readonly DashboardMobileTool[] = [
  { id: "stats", href: "/dashboard/stats", tone: "violet", iconSrc: "/mobile-shortcuts/optimized/inrstats-shortcut.png" },
  { id: "send", href: "/dashboard/mails", tone: "blue", iconSrc: "/mobile-shortcuts/optimized/inrsend-shortcut.png" },
  { id: "calendar", href: "/dashboard/agenda", tone: "amber", iconSrc: "/mobile-shortcuts/optimized/inrcalendar-shortcut.png" },
  { id: "crm", href: "/dashboard/crm", tone: "cyan", iconSrc: "/mobile-shortcuts/optimized/inrcrm-shortcut.png" },
  { id: "cash", href: "/dashboard?action=cash", tone: "mint" },
];

/** The compact menu mirrors the dashboard tools. Its groups never depend on
 * retired personal shortcuts and every destination retains its product gate. */
export function getDashboardMobileMenu(edition: DashboardEdition) {
  const allowed = (tool: DashboardMobileTool) => isDashboardDestinationAllowedForEdition(
    tool.id === "campaigns" ? "/dashboard/propulser" : tool.href,
    edition,
  );
  return [
    { id: "create" as const, tools: CREATE_TOOLS.filter(allowed) },
    { id: "manage" as const, tools: MANAGE_TOOLS.filter(allowed) },
  ];
}

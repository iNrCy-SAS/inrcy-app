export type DashboardEdition = "standard" | "premium" | "founder";

const STANDARD_PLAN_VALUES = new Set([
  "standard",
  "inrcy standard",
  "inrcy-standard",
  "inrcy_standard",
]);

const STANDARD_BLOCKED_DASHBOARD_PREFIXES = [
  "/dashboard/agenda",
  "/dashboard/crm",
  "/dashboard/devis",
  "/dashboard/factures",
  "/dashboard/fideliser",
  "/dashboard/interventions",
  "/dashboard/propulser",
] as const;

const STANDARD_BLOCKED_DASHBOARD_PANELS = new Set([
  "agenda",
  "documents",
  "mails",
]);

const STANDARD_BLOCKED_API_PREFIXES = [
  "/api/calendar",
  "/api/crm",
  "/api/documents",
  "/api/factures",
  "/api/fideliser",
  "/api/inbox",
  "/api/inrstats/mails",
  "/api/mails",
  "/api/propulser",
  "/api/templates",
] as const;

const STANDARD_ALLOWED_AGENT_API_PATHS = [
  "/api/agent/settings",
  "/api/agent/actions",
  "/api/agent/actions/pending-count",
  "/api/agent/actions/prepare-publish",
  "/api/agent/actions/send-stats-report",
  "/api/agent/actions/schedule",
  "/api/agent/actions/execute",
  "/api/agent/scheduled-actions",
] as const;

function isStandardAgentApiPathAllowed(pathname: string): boolean {
  if (pathMatches(pathname, "/api/agent/scheduled-actions")) return true;
  return STANDARD_ALLOWED_AGENT_API_PATHS.some(
    (candidate) => pathname === candidate,
  );
}

export const STANDARD_PUBLICATION_CHANNEL_KEYS = [
  "site_inrcy",
  "site_web",
  "gmb",
  "inr_search",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
] as const;

export const STANDARD_BONUS_CHANNEL_KEYS = ["inrbadge"] as const;

function normalizePlan(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function pathMatches(pathname: string, candidate: string): boolean {
  const normalizedCandidate = candidate.endsWith("/")
    ? candidate.slice(0, -1)
    : candidate;
  return pathname === normalizedCandidate || pathname.startsWith(`${normalizedCandidate}/`);
}

/**
 * Fail-safe commercial mapping: only an explicit Standard value enables the
 * reduced edition. Every historic, empty or unknown value remains Premium.
 */
export function resolveDashboardEditionFromPlan(plan: unknown): DashboardEdition {
  return STANDARD_PLAN_VALUES.has(normalizePlan(plan)) ? "standard" : "premium";
}

export function resolveDashboardEditionFromEdition(edition: unknown): DashboardEdition {
  const normalizedEdition = normalizePlan(edition);
  if (normalizedEdition === "standard") return "standard";
  if (normalizedEdition === "founder") return "founder";
  return "premium";
}

export function isStandardDashboardEdition(edition: DashboardEdition): boolean {
  return edition === "standard";
}

/**
 * Founder est l'edition historique la plus complete. Elle doit toujours
 * beneficier des fonctionnalites commerciales Premium, y compris celles
 * ajoutees plus tard, sans pour autant accorder un role administrateur.
 */
export function hasPremiumDashboardAccess(edition: DashboardEdition): boolean {
  return edition === "premium" || edition === "founder";
}

export function resolveDashboardEdition({
  edition,
  plan,
  developmentOverride,
  production = process.env.NODE_ENV === "production",
}: {
  edition?: unknown;
  plan?: unknown;
  developmentOverride?: unknown;
  production?: boolean;
}): DashboardEdition {
  if (!production) {
    const override = normalizePlan(developmentOverride);
    if (override === "standard" || override === "premium" || override === "founder") return override;
  }

  // app_edition est la source officielle. Le fallback sur plan sécurise la
  // transition avant migration et les anciennes sauvegardes de développement.
  if (normalizePlan(edition)) return resolveDashboardEditionFromEdition(edition);
  return resolveDashboardEditionFromPlan(plan);
}

export function isStandardDashboardRouteAllowed(
  pathname: string,
  searchParams?: URLSearchParams,
): boolean {
  if (STANDARD_BLOCKED_DASHBOARD_PREFIXES.some((candidate) => pathMatches(pathname, candidate))) {
    return false;
  }

  if (pathname !== "/dashboard") return true;

  const panel = normalizePlan(searchParams?.get("panel"));
  if (STANDARD_BLOCKED_DASHBOARD_PANELS.has(panel)) return false;

  return normalizePlan(searchParams?.get("action")) !== "cash";
}

export function isDashboardDestinationAllowedForEdition(
  destination: string,
  edition: DashboardEdition,
): boolean {
  if (edition !== "standard") return true;

  const href = String(destination || "").trim();
  if (!href) return false;

  try {
    const url = new URL(href, "https://app.inrcy.local");
    if (!url.pathname.startsWith("/dashboard")) return true;
    return isStandardDashboardRouteAllowed(url.pathname, url.searchParams);
  } catch {
    return false;
  }
}

export function isPotentialStandardRestrictedApiPath(pathname: string): boolean {
  return (
    pathname === "/api/billing/checkout" ||
    pathMatches(pathname, "/api/agent") ||
    pathname === "/api/inrsend" ||
    pathname.startsWith("/api/inrsend/") ||
    STANDARD_BLOCKED_API_PREFIXES.some((candidate) => pathMatches(pathname, candidate))
  );
}

export function isStandardApiRouteAllowed(
  pathname: string,
  searchParams?: URLSearchParams,
): boolean {
  if (pathname === "/api/billing/checkout") return true;

  if (pathMatches(pathname, "/api/agent")) {
    return isStandardAgentApiPathAllowed(pathname);
  }

  if (STANDARD_BLOCKED_API_PREFIXES.some((candidate) => pathMatches(pathname, candidate))) {
    return false;
  }

  if (pathname === "/api/inrsend" || pathname.startsWith("/api/inrsend/")) {
    if (pathname === "/api/inrsend/history") {
      const folder = normalizePlan(searchParams?.get("folder"));
      const boxView = normalizePlan(searchParams?.get("boxView"));
      return folder === "publications" && (!boxView || boxView === "sent");
    }

    if (pathMatches(pathname, "/api/inrsend/history/files")) return true;
    if (pathMatches(pathname, "/api/inrsend/publications")) return true;
    return false;
  }

  return true;
}

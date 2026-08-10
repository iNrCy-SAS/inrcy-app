export type DashboardEdition = "standard" | "premium";

const STANDARD_PLAN_VALUES = new Set([
  "standard",
  "inrcy standard",
  "inrcy-standard",
  "inrcy_standard",
]);

const STANDARD_BLOCKED_DASHBOARD_PREFIXES = [
  "/dashboard/agent",
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
  "/api/agent",
  "/api/calendar",
  "/api/crm",
  "/api/documents",
  "/api/factures",
  "/api/fideliser",
  "/api/inbox",
  "/api/mails",
  "/api/propulser",
] as const;

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
  return normalizePlan(edition) === "standard" ? "standard" : "premium";
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
    if (override === "standard" || override === "premium") return override;
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

export function isPotentialStandardRestrictedApiPath(pathname: string): boolean {
  return (
    pathname === "/api/billing/checkout" ||
    pathname === "/api/inrsend" ||
    pathname.startsWith("/api/inrsend/") ||
    STANDARD_BLOCKED_API_PREFIXES.some((candidate) => pathMatches(pathname, candidate))
  );
}

export function isStandardApiRouteAllowed(
  pathname: string,
  searchParams?: URLSearchParams,
): boolean {
  if (pathname === "/api/billing/checkout") return false;

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

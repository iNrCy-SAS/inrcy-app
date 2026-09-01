export const DASHBOARD_REQUIRED_SETUP_BLOCKED_PREFIXES = [
  "/dashboard/agent",
  "/dashboard/mails",
  "/dashboard/propulser",
  "/dashboard/fideliser",
  "/dashboard/booster",
  "/dashboard/generer-media",
  "/dashboard/factures",
  "/dashboard/devis",
  "/dashboard/e-reputation",
] as const;

function isBlockedPathname(pathname: string) {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return DASHBOARD_REQUIRED_SETUP_BLOCKED_PREFIXES.some(
    (prefix) => normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`),
  );
}

function isBlockedDashboardQuery(searchParams: URLSearchParams) {
  const action = String(searchParams.get("action") || "").trim().toLowerCase();
  if (action === "publish" || action === "cash") return true;
  if (searchParams.get("stats") === "1") return true;
  if (searchParams.has("draftId")) return true;

  const panel = String(searchParams.get("panel") || "").trim().toLowerCase();
  if (panel === "inrbadge" || panel === "inr_search" || panel === "trustpilot") return true;

  return false;
}

export function isDashboardRequiredSetupProtectedLocation(
  pathname: string,
  searchParams?: URLSearchParams | ReadonlyURLSearchParamsLike | null,
) {
  if (isBlockedPathname(pathname)) return true;
  if (pathname !== "/dashboard") return false;

  const normalizedSearchParams = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams?.toString() || "");

  return isBlockedDashboardQuery(normalizedSearchParams);
}

export function isDashboardRequiredSetupProtectedDestination(href: string) {
  const value = String(href || "").trim();
  if (!value || value.startsWith("#")) return false;

  let url: URL;
  try {
    url = new URL(value, "https://app.inrcy.local");
  } catch {
    return false;
  }

  return isDashboardRequiredSetupProtectedLocation(url.pathname, url.searchParams);
}

export type ReadonlyURLSearchParamsLike = {
  toString(): string;
};

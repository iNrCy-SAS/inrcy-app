// proxy.ts
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { enforceQuota, enforceRateLimit } from "./lib/rateLimit";
import {
  isApiRouteAllowedForEdition,
  isDashboardRouteAllowedForEdition,
  isPotentialEditionRestrictedApiPath,
  resolveDashboardEdition,
} from "./lib/dashboardEdition";
import {
  APP_LOCALE_COOKIE,
  APP_LOCALE_COOKIE_MAX_AGE,
  APP_LOCALE_QUERY_PARAMS,
  APP_LOCALE_REQUEST_HEADER,
  APP_LOCALE_SHARED_DOMAIN,
  LEGACY_APP_LOCALE_COOKIE,
  tryNormalizeAppLocale,
  type AppLocale,
} from "./i18n/config";

const ADMIN_USER_IDS = ["670b527d-5e08-42b4-ba95-e58e812339eb"] as const;

type MaintenanceRow = {
  maintenance_mode?: boolean;
  maintenance_title?: string | null;
  maintenance_message?: string | null;
  updated_at?: string | null;
};

type SubscriptionGateRow = {
  status?: string | null;
  trial_end_at?: string | null;
  start_date?: string | null;
  app_edition?: string | null;
  plan?: string | null;
};

function isAuthorizedInternalPublishWorker(req: NextRequest, pathname: string) {
  if (pathname !== "/api/booster/publish-now") return false;
  const secret = String(
    process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "",
  ).trim();
  if (!secret) return false;

  const authorization = String(req.headers.get("authorization") || "");
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
  const userId = String(
    req.headers.get("x-inr-agent-user-id") ||
      req.headers.get("x-cron-user-id") ||
      "",
  ).trim();

  return (
    (bearer === secret || headerSecret === secret) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
    )
  );
}

const TRIAL_DURATION_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeSubscriptionStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isTrialStillValid(subscription?: SubscriptionGateRow | null): boolean {
  if (normalizeSubscriptionStatus(subscription?.status) !== "trialing") return false;

  const trialEndMs = parseDateMs(subscription?.trial_end_at);
  if (trialEndMs !== null) return trialEndMs > Date.now();

  const startMs = parseDateMs(subscription?.start_date);
  if (startMs !== null) return startMs + TRIAL_DURATION_DAYS * DAY_MS > Date.now();

  return false;
}

function isAllowedSubscription(subscription?: SubscriptionGateRow | null): boolean {
  const status = normalizeSubscriptionStatus(subscription?.status);
  return status === "active" || isTrialStillValid(subscription);
}

function getEffectiveSubscriptionStatus(subscription?: SubscriptionGateRow | null): string {
  const status = normalizeSubscriptionStatus(subscription?.status);
  if (status === "trialing" && !isTrialStillValid(subscription)) return "trial_expired";
  return status;
}

const SENSITIVE_API_PREFIXES = [
  "/api/account",
  "/api/agent",
  "/api/billing",
  "/api/booster",
  "/api/bubble-access",
  "/api/calendar",
  "/api/crm",
  "/api/dashboard",
  "/api/documents",
  "/api/factures",
  "/api/fideliser",
  "/api/generator",
  "/api/inbox",
  "/api/inrbadge/settings",
  "/api/inr-search",
  "/api/inrsend",
  "/api/inrstats",
  "/api/integrations",
  "/api/loyalty",
  "/api/media",
  "/api/metrics",
  "/api/notifications",
  "/api/profile",
  "/api/propulser",
  "/api/referrals",
  "/api/stats",
  "/api/templates",
] as const;

const API_BLOCK_BYPASS_PREFIXES = [
  "/api/auth/",
  // The owner must be able to finish or retry account deletion even after a
  // cancellation has made the subscription status non-active.
  "/api/account/deletion",
  "/api/billing/checkout",
  "/api/boutique/order",
  "/api/cron/",
  "/api/csp-report",
  "/api/health",
  "/api/inrbadge/appointment-request",
  "/api/inrbadge/lead",
  "/api/inrsend/unsubscribe",
  "/api/inrsend/webhooks/",
  "/api/public/",
  "/api/security/google/risc",
  "/api/stripe/webhook",
  "/api/widgets/",
] as const;

function pathMatches(pathname: string, candidate: string): boolean {
  const normalizedCandidate = candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
  return pathname === normalizedCandidate || pathname.startsWith(`${normalizedCandidate}/`);
}

function isApiBlockBypassPath(pathname: string): boolean {
  return API_BLOCK_BYPASS_PREFIXES.some((candidate) => pathMatches(pathname, candidate));
}

function isSensitiveApiPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/") || isApiBlockBypassPath(pathname)) return false;
  return SENSITIVE_API_PREFIXES.some((candidate) => pathMatches(pathname, candidate));
}

function blockedAccountApiResponse(subscription?: SubscriptionGateRow | null): NextResponse {
  return NextResponse.json(
    {
      error: "ACCOUNT_BLOCKED",
      code: "ACCOUNT_BLOCKED",
      status: getEffectiveSubscriptionStatus(subscription),
      redirectTo: "/compte-bloque",
      message: "Compte bloqué : contactez iNrCy pour réactiver votre générateur.",
    },
    { status: 403 }
  );
}

function premiumRequiredApiResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "PREMIUM_REQUIRED",
      code: "PREMIUM_REQUIRED",
      redirectTo: "/dashboard?panel=contact",
      message: "Cette fonctionnalité est réservée à iNrCy Premium. Contactez-nous pour en parler.",
    },
    { status: 403 },
  );
}

function founderRequiredApiResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "FOUNDER_REQUIRED",
      code: "FOUNDER_REQUIRED",
      redirectTo: "/dashboard",
      message: "Factures et devis sont réservés à l’offre partenaire historique.",
    },
    { status: 403 },
  );
}

function getIp(req: NextRequest): string {
  // Vercel provides req.ip, but keep fallbacks for local/dev/proxies.
  const direct = (req as unknown as { ip?: string }).ip;
  if (direct) return direct;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";

  const xrip = req.headers.get("x-real-ip");
  if (xrip) return xrip;

  return "unknown";
}

function isOauthCallback(pathname: string): boolean {
  // These routes already have per-route rate limits (Step A).
  return pathname.startsWith("/api/integrations/") && pathname.endsWith("/callback");
}

function createProxySupabaseClient(
  request: NextRequest,
  requestHeaders: Headers,
) {
  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          requestHeaders.set("cookie", request.cookies.toString());
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  return {
    supabase,
    getResponse: () => supabaseResponse,
  };
}

function getSupabaseHeaders(): HeadersInit | null {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = serviceRoleKey || anonKey;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !token) return null;

  return {
    apikey: token,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function getSubscriptionGateRow(userId: string): Promise<SubscriptionGateRow | null> {
  try {
    const headers = getSupabaseHeaders();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!headers || !supabaseUrl) return null;

    const url = new URL(`${supabaseUrl}/rest/v1/subscriptions`);
    url.searchParams.set("select", "status,trial_end_at,start_date,app_edition,plan");
    url.searchParams.set("user_id", `eq.${userId}`);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers,
      cache: "no-store",
    });

    if (!res.ok) return null;
    const rows = (await res.json()) as SubscriptionGateRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function getMaintenanceRow(): Promise<MaintenanceRow | null> {
  try {
    const headers = getSupabaseHeaders();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!headers || !supabaseUrl) return null;

    const url = new URL(`${supabaseUrl}/rest/v1/app_settings`);
    url.searchParams.set(
      "select",
      "maintenance_mode,maintenance_title,maintenance_message,updated_at"
    );
    url.searchParams.set("id", "eq.1");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers,
      cache: "no-store",
    });

    if (!res.ok) return null;
    const rows = (await res.json()) as MaintenanceRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function isAdminUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  if (ADMIN_USER_IDS.includes(userId as (typeof ADMIN_USER_IDS)[number])) return true;

  try {
    const headers = getSupabaseHeaders();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!headers || !supabaseUrl) return false;

    const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
    url.searchParams.set("select", "role");
    url.searchParams.set("user_id", `eq.${userId}`);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers,
      cache: "no-store",
    });

    if (!res.ok) return false;
    const rows = (await res.json()) as Array<{ role?: string | null }>;
    const role = rows[0]?.role;
    return role === "admin" || role === "staff";
  } catch {
    return false;
  }
}

function isPublicBypassPath(pathname: string): boolean {
  return (
    pathname === "/maintenance" ||
    pathname === "/favicon.ico" ||
    pathname === "/site.webmanifest" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/widgets/") ||
    pathname.startsWith("/api/health")
  );
}

function isAuthRecoveryPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/set-password" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/switch-account" ||
    pathname.startsWith("/auth/finish-invite") ||
    pathname.startsWith("/auth/finish-reset") ||
    pathname === "/api/auth/finish-password" ||
    pathname === "/api/auth/resend-link" ||
    pathname === "/api/auth/sign-out"
  );
}

function isAnonymousPublicPagePath(pathname: string): boolean {
  return pathname === "/suppression-compte";
}

function isAnonymousPublicApiPath(pathname: string): boolean {
  return pathname === "/api/public/privacy/deletion-request";
}

type LimitPlan = {
  tokens: number;
  windowSeconds: number;
  name: string;
  /** block when KV/rate limiter is unavailable */
  failClosed?: boolean;
  /** lower emergency limit used while Redis is unavailable */
  fallbackTokens?: number;
  /** optional daily quota (requests per day) */
  dailyQuota?: number;
  /** lower emergency daily quota used while Redis is unavailable */
  fallbackDailyQuota?: number;
};

function pickLimit(pathname: string, method: string): LimitPlan {
  const m = method.toUpperCase();
  const isWrite = m !== "GET" && m !== "HEAD" && m !== "OPTIONS";

  // --- EXPENSIVE / COST-SENSITIVE endpoints (protect OpenAI + external publish costs)
  // Fail-CLOSED here to avoid getting billed/spammed if KV is down.
  if (pathname === "/api/booster/generate") {
    return isWrite
      ? {
          tokens: Number(process.env.RL_BOOSTER_GENERATE_PER_MIN || 8),
          windowSeconds: 60,
          name: "booster-generate-write",
          failClosed: true,
        }
      : { tokens: 30, windowSeconds: 60, name: "booster-generate-read" };
  }

  if (pathname === "/api/booster/transcribe") {
    return isWrite
      ? {
          tokens: Number(process.env.RL_BOOSTER_TRANSCRIBE_PER_MIN || 6),
          windowSeconds: 60,
          name: "booster-transcribe-write",
          // Keep vocal usable if KV / rate limiting is unavailable.
          failClosed: false,
          dailyQuota: Number(process.env.QUOTA_BOOSTER_TRANSCRIBE_PER_DAY || 120),
        }
      : { tokens: 30, windowSeconds: 60, name: "booster-transcribe-read" };
  }

  if (pathname === "/api/templates/render") {
    return isWrite
      ? {
          tokens: Number(process.env.RL_TEMPLATES_RENDER_PER_MIN || 20),
          windowSeconds: 60,
          name: "templates-render-write",
          // Keep template autofill available even if KV / rate limiting is unavailable.
          failClosed: false,
          dailyQuota: Number(process.env.QUOTA_TEMPLATES_RENDER_PER_DAY || 500),
        }
      : { tokens: 60, windowSeconds: 60, name: "templates-render-read" };
  }

  if (pathname === "/api/booster/publish-now") {
    return {
      tokens: Number(process.env.RL_PUBLISH_NOW_PER_MIN || 6),
      windowSeconds: 60,
      name: "publish-now",
      failClosed: false,
      fallbackTokens: 3,
      // Publication safety cap: five successful publish-now actions per account/day.
      // AI generation credits remain governed separately by weekly/monthly quotas.
      dailyQuota: Number(process.env.QUOTA_PUBLISH_NOW_PER_DAY || 5),
      fallbackDailyQuota: 5,
    };
  }

  // Public-ish widget token issuance should be tight per IP.
  if (pathname === "/api/widgets/issue-token") {
    return {
      tokens: Number(process.env.RL_WIDGET_ISSUE_TOKEN_PER_MIN || 30),
      windowSeconds: 60,
      name: "widget-issue-token",
      // Allow fail-open here to avoid breaking embeds if KV is down.
      failClosed: false,
      dailyQuota: Number(process.env.QUOTA_WIDGET_ISSUE_TOKEN_PER_DAY || 2000),
    };
  }

  // Default limits
  return isWrite
    ? { tokens: 30, windowSeconds: 60, name: "write" }
    : { tokens: 120, windowSeconds: 60, name: "read" };
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Light security hardening (safe defaults)
  // 1) Block weird HTTP methods early.
  const method = req.method.toUpperCase();
  const allowed = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
  if (!allowed.has(method)) {
    return new NextResponse("Method Not Allowed", {
      status: 405,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  // 2) Enforce https in production when possible (Vercel sets x-forwarded-proto).
  // This should not trigger on normal Vercel traffic.
  if (process.env.NODE_ENV === "production") {
    const proto = req.headers.get("x-forwarded-proto");
    if (proto && proto !== "https") {
      const url = req.nextUrl.clone();
      url.protocol = "https:";
      return NextResponse.redirect(url, 308);
    }
  }

  // Correlation ID (visible to client + used in server logs)
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);

  let explicitlyRequestedLocale: AppLocale | null = null;
  for (const parameter of APP_LOCALE_QUERY_PARAMS) {
    explicitlyRequestedLocale = tryNormalizeAppLocale(req.nextUrl.searchParams.get(parameter));
    if (explicitlyRequestedLocale) break;
  }

  // Supabase appends its token query to RedirectTo. The locale is therefore
  // carried in a path segment (`/auth/finish-invite/fr`) so it cannot corrupt
  // `?token_hash=...`. Treat that segment exactly like an explicit locale.
  if (!explicitlyRequestedLocale) {
    const authEmailLocale = pathname.match(
      /^\/auth\/finish-(?:invite|reset)\/([^/]+)\/?$/,
    )?.[1];
    explicitlyRequestedLocale = tryNormalizeAppLocale(authEmailLocale);
  }

  const legacyLocale = tryNormalizeAppLocale(
    req.cookies.get(LEGACY_APP_LOCALE_COOKIE)?.value,
  );
  const localeToPersist = explicitlyRequestedLocale || (
    !req.cookies.get(APP_LOCALE_COOKIE)?.value ? legacyLocale : null
  );

  if (localeToPersist) {
    req.cookies.set(APP_LOCALE_COOKIE, localeToPersist);
    requestHeaders.set("cookie", req.cookies.toString());
  }
  if (explicitlyRequestedLocale) {
    requestHeaders.set(APP_LOCALE_REQUEST_HEADER, explicitlyRequestedLocale);
  }

  // TikTok downloads photos anonymously from this signed public endpoint.
  // Do not run session refresh, subscription checks or rate limiting on the
  // media transfer itself: any 401/403/429 or rewritten cache header leaves
  // TikTok indefinitely in PROCESSING_DOWNLOAD. The route still validates
  // the HMAC signature and expiry before returning a byte.
  if (pathname === "/api/media/tiktok") {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const { supabase, getResponse: getSupabaseResponse } = createProxySupabaseClient(
    req,
    requestHeaders,
  );

  // Refresh/validate the Supabase session before any other proxy logic.
  // The SSR client also writes refreshed or cleared cookies to the response.
  const supabaseAuthCookiePattern = /^sb-.+-auth-token(?:\.\d+)?$/;
  const requestCookies = req.cookies.getAll();
  const hasSupabaseAuthCookie = requestCookies.some(({ name }) =>
    supabaseAuthCookiePattern.test(name),
  );

  let authenticatedUserId: string | null = null;
  let invalidAuthSession = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claimSub = data?.claims?.sub;

    if (!error && typeof claimSub === "string" && claimSub) {
      authenticatedUserId = claimSub;
    } else if (error && hasSupabaseAuthCookie) {
      invalidAuthSession = true;
    }
  } catch {
    authenticatedUserId = null;
    invalidAuthSession = hasSupabaseAuthCookie;
  }

  const applyResponseHeaders = (res: NextResponse) => {
    for (const cookie of getSupabaseResponse().cookies.getAll()) {
      res.cookies.set(cookie);
    }

    if (invalidAuthSession) {
      for (const { name } of requestCookies) {
        if (supabaseAuthCookiePattern.test(name)) {
          res.cookies.set(name, "", { path: "/", maxAge: 0 });
        }
      }
    }

    if (localeToPersist) {
      const hostname = req.nextUrl.hostname.toLowerCase();
      const isInrcyDomain = hostname === "inrcy.com" || hostname.endsWith(".inrcy.com");
      res.cookies.set(APP_LOCALE_COOKIE, localeToPersist, {
        path: "/",
        maxAge: APP_LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
        ...(isInrcyDomain ? { domain: APP_LOCALE_SHARED_DOMAIN } : {}),
      });
    }

    // Correlate request/response across Vercel logs + Sentry
    res.headers.set("x-request-id", requestId);

    // Avoid serving stale documents from browser/edge cache.
    // This is important for maintenance mode toggles to take effect on a simple refresh.
    const isDocumentRequest =
      !pathname.startsWith("/api/") &&
      (req.headers.get("sec-fetch-dest") === "document" ||
        req.headers.get("accept")?.includes("text/html"));

    const isIndexablePublicDocument = pathname === "/entreprises" || pathname.startsWith("/entreprises/");
    const isInrSearchCompanyDocument = pathname.startsWith("/entreprises/");

    if (pathname === "/api/public/logo") {
      // Keep the immutable-ish logo response cache configured by the route.
      res.headers.set("x-robots-tag", "noindex, nofollow");
    } else if (pathname.startsWith("/api/")) {
      res.headers.set("cache-control", "no-store");
      res.headers.set("x-robots-tag", "noindex, nofollow");
    } else if (isDocumentRequest && isInrSearchCompanyDocument) {
      // A newly provisioned iNr’Search page must never inherit a cached 404.
      res.headers.set("cache-control", "no-store, max-age=0");
      res.headers.delete("pragma");
      res.headers.delete("expires");
    } else if (isDocumentRequest && isIndexablePublicDocument) {
      res.headers.set("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
      res.headers.delete("pragma");
      res.headers.delete("expires");
    } else if (isDocumentRequest) {
      res.headers.set("cache-control", "private, no-store, no-cache, max-age=0, must-revalidate");
      res.headers.set("pragma", "no-cache");
      res.headers.set("expires", "0");
    }

    return res;
  };

  if (invalidAuthSession) {
    if (
      isAuthRecoveryPath(pathname)
      || isAnonymousPublicPagePath(pathname)
      || isAnonymousPublicApiPath(pathname)
    ) {
      // Un compte supprimé ou une ancienne session ne doit jamais empêcher
      // l’ouverture d’un nouveau lien d’invitation/récupération. On transmet
      // la requête sans les cookies Supabase invalides et on les expire dans
      // la réponse, tout en conservant intégralement l’URL à usage unique.
      const cleanRequestHeaders = new Headers(requestHeaders);
      const cleanCookie = String(cleanRequestHeaders.get("cookie") || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => {
          const separator = part.indexOf("=");
          const name = separator >= 0 ? part.slice(0, separator).trim() : part;
          return !supabaseAuthCookiePattern.test(name);
        })
        .join("; ");
      if (cleanCookie) cleanRequestHeaders.set("cookie", cleanCookie);
      else cleanRequestHeaders.delete("cookie");

      return applyResponseHeaders(
        NextResponse.next({ request: { headers: cleanRequestHeaders } }),
      );
    }

    if (pathname.startsWith("/api/")) {
      return applyResponseHeaders(NextResponse.json(
        { error: "SESSION_EXPIRED", code: "SESSION_EXPIRED", redirectTo: "/login" },
        { status: 401 },
      ));
    }

    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("reason", "session-expired");
    return applyResponseHeaders(NextResponse.redirect(loginUrl));
  }

  // L’annuaire public est hébergé sur inrcy.com. Les routes de classement
  // de l’application restent internes et ne doivent pas devenir une seconde
  // interface publique concurrente.
  if (
    pathname === "/entreprises"
    || pathname.startsWith("/metiers")
    || pathname.startsWith("/secteurs")
  ) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = "inrcy.com";
    url.pathname = "/annuaire/";
    return applyResponseHeaders(NextResponse.redirect(url, 308));
  }

  let subscriptionGate: SubscriptionGateRow | null | undefined;

  const getCurrentUserId = async () => authenticatedUserId;

  const getCurrentSubscriptionGate = async () => {
    const currentUserId = await getCurrentUserId();
    if (!currentUserId) return null;
    if (subscriptionGate !== undefined) return subscriptionGate;
    subscriptionGate = await getSubscriptionGateRow(currentUserId);
    return subscriptionGate;
  };

  const isDashboardPath = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  if (isDashboardPath && !isPublicBypassPath(pathname)) {
    const maintenance = await getMaintenanceRow();
    const maintenanceEnabled = Boolean(maintenance?.maintenance_mode);

    if (maintenanceEnabled) {
      const currentUserId = await getCurrentUserId();
      const admin = currentUserId ? await isAdminUser(currentUserId) : false;

      if (!admin) {
        const url = req.nextUrl.clone();
        url.pathname = "/maintenance";
        url.search = "";
        const out = NextResponse.redirect(url, 307);
        return applyResponseHeaders(out);
      }
    }

    if (await getCurrentUserId()) {
      const currentSubscriptionGate = await getCurrentSubscriptionGate();

      if (!isAllowedSubscription(currentSubscriptionGate)) {
        const url = req.nextUrl.clone();
        url.pathname = "/compte-bloque";
        url.search = "";
        const out = NextResponse.redirect(url, 307);
        return applyResponseHeaders(out);
      }

      const edition = resolveDashboardEdition({
        edition: currentSubscriptionGate?.app_edition,
        plan: currentSubscriptionGate?.plan,
        developmentOverride: process.env.INRCY_DEV_DASHBOARD_EDITION,
      });
      if (!isDashboardRouteAllowedForEdition(pathname, req.nextUrl.searchParams, edition)) {
        const url = req.nextUrl.clone();
        url.pathname = "/dashboard";
        url.search = "";
        if (edition === "standard") {
          url.searchParams.set("panel", "contact");
          url.searchParams.set("premium", "required");
        }
        return applyResponseHeaders(NextResponse.redirect(url, 307));
      }
    }
  }

  if (!pathname.startsWith("/api/")) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    return applyResponseHeaders(res);
  }

  const isSensitiveApi = isSensitiveApiPath(pathname);

  if (req.method.toUpperCase() !== "OPTIONS" && isSensitiveApi) {
    const currentUserId = await getCurrentUserId();
    const currentSubscriptionGate = currentUserId ? await getCurrentSubscriptionGate() : null;

    if (currentUserId && !isAllowedSubscription(currentSubscriptionGate)) {
      return applyResponseHeaders(blockedAccountApiResponse(currentSubscriptionGate));
    }
  }

  if (
    req.method.toUpperCase() !== "OPTIONS" &&
    isPotentialEditionRestrictedApiPath(pathname)
  ) {
    const currentUserId = await getCurrentUserId();
    const currentSubscriptionGate = currentUserId ? await getCurrentSubscriptionGate() : null;
    const edition = resolveDashboardEdition({
      edition: currentSubscriptionGate?.app_edition,
      plan: currentSubscriptionGate?.plan,
      developmentOverride: process.env.INRCY_DEV_DASHBOARD_EDITION,
    });

    if (
      currentUserId &&
      !isApiRouteAllowedForEdition(pathname, req.nextUrl.searchParams, edition)
    ) {
      const accountingRoute =
        pathname === "/api/documents" ||
        pathname.startsWith("/api/documents/") ||
        pathname === "/api/factures" ||
        pathname.startsWith("/api/factures/") ||
        (pathname === "/api/inrsend/history" &&
          ["factures", "devis"].includes(
            String(req.nextUrl.searchParams.get("folder") || "").toLowerCase(),
          ));
      return applyResponseHeaders(
        accountingRoute ? founderRequiredApiResponse() : premiumRequiredApiResponse(),
      );
    }
  }

  // OAuth callbacks bypass rate limiting, but not the blocked-account guard above.
  if (isOauthCallback(pathname)) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    return applyResponseHeaders(res);
  }

  // A single publication fans out into one authenticated durable worker per
  // channel. Those internal callbacks must not consume the user's six-request
  // burst limit or daily publication quota; the original user request already
  // passed both controls. The route verifies the same secret again.
  if (isAuthorizedInternalPublishWorker(req, pathname)) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    return applyResponseHeaders(res);
  }

  const ip = getIp(req);
  const lim = pickLimit(pathname, req.method);
  const currentUserId = await getCurrentUserId();
  const identifier = currentUserId ? `u:${currentUserId}` : `ip:${ip}`;

  // Optional: quota enforcement (per-day). Only enabled for specific endpoints.
  if (lim.dailyQuota && lim.dailyQuota > 0) {
    const q = await enforceQuota({
      name: `mw:${lim.name}:day`,
      identifier,
      limit: lim.dailyQuota,
      periodSeconds: 60 * 60 * 24,
      failClosed: !!lim.failClosed,
      fallbackLimit: lim.fallbackDailyQuota,
    });
    if (q) return applyResponseHeaders(q);
  }

  // NOTE: enforceRateLimit() takes a single config object.
  // We keep a stable identifier per IP + path so users don't share buckets.
  try {
    const res = await enforceRateLimit({
      name: `mw:${lim.name}`,
      identifier: `${pathname}:${identifier}`,
      limit: lim.tokens,
      window: `${lim.windowSeconds} s`,
      failClosed: !!lim.failClosed,
      fallbackLimit: lim.fallbackTokens,
    });
    if (res) {
      return applyResponseHeaders(res);
    }
  } catch (err) {
    // Fallback.
    if (lim.failClosed) {
      const out = NextResponse.json({ error: "Rate limiting unavailable" }, { status: 503 });
      out.headers.set("Retry-After", "5");
      return applyResponseHeaders(out);
    }
    console.warn("[rateLimit] proxy disabled (fail-open)", err);
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  return applyResponseHeaders(res);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

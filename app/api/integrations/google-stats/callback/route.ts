import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { encryptToken as _encryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { oauthCallbackEvent, oauthCallbackException } from "@/lib/observability/oauth";
import { syncSitePresenceIntegrations } from '@/lib/sitePresenceSync';
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import {
  findExplicitlyMissingGoogleScopes,
  GOOGLE_OAUTH_PERMISSION_ERROR_CODE,
  GOOGLE_OAUTH_PERMISSION_MESSAGE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
} from "@/lib/googleOAuthConsent";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
};

const ALLOWED_SOURCES = ["site_inrcy", "site_web"] as const;
const ALLOWED_PRODUCTS = ["ga4", "gsc"] as const;

type AllowedSource = (typeof ALLOWED_SOURCES)[number];
type AllowedProduct = (typeof ALLOWED_PRODUCTS)[number];

const REQUIRED_SCOPE_BY_PRODUCT: Record<AllowedProduct, string> = {
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
};

function isAllowedSource(v: string): v is AllowedSource {
  return (ALLOWED_SOURCES as readonly string[]).includes(v);
}

function isAllowedProduct(v: string): v is AllowedProduct {
  return (ALLOWED_PRODUCTS as readonly string[]).includes(v);
}

function safeJsonParse<T>(s: unknown, fallback: T): T {
  if (!s) return fallback;
  try {
    if (typeof s === "string") return JSON.parse(s) as T;
    return s as T;
  } catch {
    return fallback;
  }
}

function normalizeDomainFromUrl(raw: string): string | null {
  try {
    const input = /^(https?:\/\/)/i.test(String(raw || "")) ? String(raw) : `https://${String(raw || "")}`;
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = (u.hostname || "").toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

function normalizeComparableDomain(raw: string): string | null {
  const host = normalizeDomainFromUrl(raw);
  return host ? host.replace(/^www\./, "") : null;
}

function domainsLooselyMatch(left: string, right: string) {
  const a = normalizeComparableDomain(left);
  const b = normalizeComparableDomain(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function buildReturnUrl(origin: string, returnTo: string, params: Record<string, string | null | undefined>) {
  const finalUrl = new URL(returnTo, origin);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    finalUrl.searchParams.set(k, v);
  }
  return finalUrl;
}

async function gaAdminFetch<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = (await res.json()) as unknown;
  if (!res.ok) {
    const rec = asRecord(data);
    const err = asRecord(rec["error"]);
    throw new Error(`GA4 Admin request failed: ${asString(err["message"]) || "unknown"}`);
  }
  return data as T;
}

type GaAccount = { name: string; displayName?: string };
type _GaProperty = { name: string; displayName?: string };

async function fetchAllGa4Properties(accessToken: string) {
  const accountsData = await gaAdminFetch<{ accounts?: GaAccount[] }>(
    accessToken,
    "https://analyticsadmin.googleapis.com/v1beta/accounts?pageSize=200"
  );

  const accounts = accountsData.accounts ?? [];
  if (accounts.length === 0) return [];

  const props: Array<{ name: string; displayName?: string }> = [];
  // List properties per account because `properties.list` requires a `filter=parent:accounts/XXXX`.
  for (const acc of accounts) {
    let pageToken: string | undefined = undefined;
    for (let i = 0; i < 50; i++) {
      const url = new URL("https://analyticsadmin.googleapis.com/v1beta/properties");
      url.searchParams.set("pageSize", "200");
      url.searchParams.set("filter", `parent:${acc.name}`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const data = await gaAdminFetch<unknown>(accessToken, url.toString());
      const rec = asRecord(data);
      const rawProps = Array.isArray(rec["properties"]) ? rec["properties"] : [];
      for (const p of rawProps) {
        const pr = asRecord(p);
        const name = asString(pr["name"]);
        if (!name) continue;
        props.push({ name, displayName: asString(pr["displayName"]) ?? undefined });
      }
      pageToken = asString(rec["nextPageToken"]) ?? undefined;
      if (!pageToken) break;
    }
  }

  // De-duplicate by property name
  const seen = new Set<string>();
  return props.filter((p) => {
    if (!p?.name) return false;
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

async function fetchDataStreams(accessToken: string, propertyName: string) {
  // propertyName is usually "properties/123"
  const url = new URL(`https://analyticsadmin.googleapis.com/v1beta/${propertyName}/dataStreams`);
  url.searchParams.set("pageSize", "200");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await res.json()) as unknown;
  if (!res.ok) {
    // Do not fail the whole activation on a single property; just ignore.
    return [];
  }

  const rec = asRecord(data);
  const raw = Array.isArray(rec["dataStreams"]) ? rec["dataStreams"] : [];
  return raw;
}

function extractPropertyId(propertyName: string): string | null {
  const m = /^properties\/(\d+)$/.exec(propertyName);
  return m?.[1] ?? null;
}

function pickGa4Match(domain: string, candidates: Array<{ propertyId: string; measurementId?: string; defaultUri?: string }>) {
  if (candidates.length === 0) return { ok: false as const, reason: "Aucune propriété GA4 ne correspond à ce domaine." };

  const exactMatches = candidates.filter((c) => c.defaultUri && normalizeComparableDomain(c.defaultUri) === normalizeComparableDomain(domain));
  const narrowed = exactMatches.length > 0 ? exactMatches : candidates;

  const uniq = new Map<string, { propertyId: string; measurementId?: string; defaultUri?: string }>();
  for (const c of narrowed) {
    if (!c.propertyId) continue;
    if (!uniq.has(c.propertyId)) uniq.set(c.propertyId, c);
  }
  const uniqueCandidates = Array.from(uniq.values());

  if (uniqueCandidates.length > 1) {
    return {
      ok: false as const,
      reason:
        "Plusieurs propriétés GA4 correspondent à ce domaine. Pour éviter une incohérence, l'application bloque la connexion. (Nettoyez / unifiez les propriétés GA4 ou contactez le support.)",
    };
  }
  const c = uniqueCandidates[0]!;
  if (!c?.propertyId) return { ok: false as const, reason: "Impossible d'extraire le Property ID GA4." };
  return { ok: true as const, propertyId: c.propertyId, measurementId: c.measurementId ?? null };
}

async function resolveGa4FromDomain(accessToken: string, domain: string) {
  const properties = await fetchAllGa4Properties(accessToken);

  const matches: Array<{ propertyId: string; measurementId?: string; defaultUri?: string }> = [];

  for (const p of properties) {
    const pid = extractPropertyId(p.name);
    if (!pid) continue;

    const streams = await fetchDataStreams(accessToken, p.name);
    for (const s of streams) {
      const sr = asRecord(s);
      if (String(asString(sr["type"]) || "").toUpperCase() !== "WEB_DATA_STREAM") continue;

      const web = asRecord(sr["webStreamData"]);
      const defaultUri = asString(web["defaultUri"]);
      const measurementId = asString(web["measurementId"]) ?? undefined;

      const comparableDefaultUri = defaultUri ? normalizeComparableDomain(String(defaultUri)) : null;
      const comparableDisplayName = p.displayName ? normalizeComparableDomain(String(p.displayName)) : null;
      const comparableTarget = normalizeComparableDomain(domain);
      if (!comparableTarget) continue;

      if (
        (comparableDefaultUri && domainsLooselyMatch(comparableDefaultUri, comparableTarget)) ||
        (comparableDisplayName && domainsLooselyMatch(comparableDisplayName, comparableTarget))
      ) {
        matches.push({ propertyId: pid, measurementId, defaultUri: defaultUri ?? undefined });
      }
    }
  }

  const picked = pickGa4Match(domain, matches);
  if (!picked.ok) throw new Error(picked.reason);

  return { propertyId: picked.propertyId, measurementId: picked.measurementId };
}

async function resolveGscFromDomain(accessToken: string, domain: string, siteUrlHint?: string | null) {
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await res.json()) as unknown;
  const rec = asRecord(data);
  if (!res.ok) {
    const err = asRecord(rec["error"]);
    throw new Error(`GSC sites.list failed: ${asString(err["message"]) || "unknown"}`);
  }

  const rawEntries = Array.isArray(rec["siteEntry"]) ? rec["siteEntry"] : [];
  const entries: Array<{ siteUrl: string; permissionLevel?: string }> = rawEntries
    .map((e) => asRecord(e))
    .map((e) => {
      const siteUrl = asString(e["siteUrl"]) || "";
      const perm = asString(e["permissionLevel"]);
      return perm ? { siteUrl, permissionLevel: perm } : { siteUrl };
    })
    .filter((e) => Boolean(e.siteUrl));

  const wantedScDomain = `sc-domain:${domain}`;
  const exactScDomain = entries.find((e) => String(e.siteUrl).toLowerCase() === wantedScDomain.toLowerCase());
  if (exactScDomain) return exactScDomain.siteUrl;

  // Try URL-prefix properties
  const normalizedTarget = normalizeComparableDomain(domain);
  if (!normalizedTarget) {
    throw new Error("Le domaine du site est invalide pour Search Console.");
  }
  const urlCandidates = entries
    .map((e) => String(e.siteUrl))
    .filter((u) => u.startsWith("http://") || u.startsWith("https://"));

  // Prefer the saved site URL if it matches
  if (siteUrlHint) {
    const hint = siteUrlHint.endsWith("/") ? siteUrlHint : `${siteUrlHint}/`;
    const hit = urlCandidates.find((u) => (u.endsWith("/") ? u : `${u}/`) === hint);
    if (hit) return hit;
  }

  // Otherwise match by hostname
  for (const u of urlCandidates) {
    try {
      const host = normalizeComparableDomain(u);
      if (host && domainsLooselyMatch(host, normalizedTarget)) return u;
    } catch {}
  }

  throw new Error(
    "Aucune propriété Search Console ne correspond à ce domaine sur ce compte Google. Veuillez ajouter le domaine dans Search Console, ou donner accès à ce compte, puis relancer l’activation."
  );
}


async function validateGa4Binding(accessToken: string, domain: string, propertyId: string, measurementId?: string | null) {
  const propertyName = `properties/${propertyId}`;
  const streams = await fetchDataStreams(accessToken, propertyName);
  const target = normalizeComparableDomain(domain);
  if (!target) return { ok: false as const };
  for (const s of streams) {
    const sr = asRecord(s);
    if (String(asString(sr["type"]) || "").toUpperCase() !== "WEB_DATA_STREAM") continue;
    const web = asRecord(sr["webStreamData"]);
    const mid = asString(web["measurementId"]);
    const defaultUri = asString(web["defaultUri"]);
    const d = defaultUri ? normalizeComparableDomain(String(defaultUri)) : null;
    if (!d || !domainsLooselyMatch(d, target)) continue;
    if (measurementId && String(mid || "").trim() !== String(measurementId).trim()) continue;
    return { ok: true as const, measurementId: mid ?? null };
  }
  return { ok: false as const };
}

function validateGscPropertyAgainstDomain(domain: string, property: string) {
  const d = normalizeComparableDomain(domain);
  const p = String(property || "").trim().toLowerCase();
  if (!p) return false;
  if (!d) return false;
  if (p === `sc-domain:${d}`) return true;
  if (p.startsWith("http://") || p.startsWith("https://")) {
    try {
      const host = normalizeComparableDomain(p);
      return !!host && domainsLooselyMatch(host, d);
    } catch {
      return false;
    }
  }
  return false;
}
type SiteSettings = {
  ga4?: { property_id?: string; measurement_id?: string; verified_at?: string };
  gsc?: { property?: string; verified_at?: string };
  site_web?: {
    url?: string;
    ga4?: { property_id?: string; measurement_id?: string; verified_at?: string };
    gsc?: { property?: string; verified_at?: string };
  };
};

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServer>>;

async function upsertGoogleIntegration(opts: {
  supabase: SupabaseServerClient;
  userId: string;
  source: "site_inrcy" | "site_web";
  product: "ga4" | "gsc";
  tokenData: TokenResponse;
  userInfo: GoogleUserInfo;
}) {
  const { supabase, userId, source, product, tokenData, userInfo } = opts;

  const { data: existing } = await supabase
    .from("integrations")
    .select("id,refresh_token_enc")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", source)
    .eq("product", product)
    .maybeSingle();

  const refreshTokenToStore = tokenData.refresh_token
    ? _encryptToken(tokenData.refresh_token)
    : asString(asRecord(existing)["refresh_token_enc"]) ?? null;

  const expiresAt =
    tokenData.expires_in != null
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;

  const payload: Record<string, unknown> = {
    user_id: userId,
    provider: "google",
    category: "stats",
    source,
    product,
    status: "connected",
    email_address: userInfo.email,
    display_name: userInfo.name ?? null,
    provider_account_id: userInfo.id ?? null,
    scopes: tokenData.scope ?? null,
    access_token_enc: tokenData.access_token ? _encryptToken(tokenData.access_token) : null,
    refresh_token_enc: refreshTokenToStore,
    expires_at: expiresAt,
    meta: { picture: userInfo.picture ?? null },
  };

  // IMPORTANT: OAuth callbacks may be called multiple times (retries / reconnect).
  // Use UPSERT against the unique key to avoid duplicate key errors.
  // NOTE: `integrations_unique` enforces uniqueness on (user_id, provider, source, product).
  const { error: upsertErr } = await supabase
    .from("integrations")
    .upsert(payload, { onConflict: "user_id,provider,source,product" });

  if (upsertErr) {
    const msg = upsertErr.message || JSON.stringify(upsertErr);
    if (msg.includes("no unique or exclusion constraint matching the ON CONFLICT specification")) {
      throw new Error(
        "DB upsert failed: l'index UNIQUE n'est pas aligné. " +
          "Crée/remplace l'index integrations_unique sur (user_id, provider, source, product). Détail: " +
          msg
      );
    }
    throw new Error(`DB upsert failed: ${msg}`);
  }
}

export async function GET(req: Request) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const urlObj = new URL(req.url);
  const stateRaw = urlObj.searchParams.get("state");
  const stateCheck = verifyOAuthState<{ source?: string; product?: string; mode?: string; domain?: string; siteUrl?: string; accountId?: string }>(req, "google_stats", stateRaw);
  const returnTo = safeInternalPath(stateCheck.returnTo || "/dashboard?panel=stats", "/dashboard?panel=stats");
  const clearStateCookie = (res: NextResponse) => {
    if (stateCheck.cookieName) {
      res.cookies.set(stateCheck.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    }
    return res;
  };
  const redirectBack = (params: Record<string, string | null | undefined>) => clearStateCookie(NextResponse.redirect(buildReturnUrl(origin, returnTo, params)));

  try {
    const code = urlObj.searchParams.get("code");
    const oauthError = urlObj.searchParams.get("error");
    const oauthErrorDescription = urlObj.searchParams.get("error_description");

    if (!stateCheck.ok) {
      oauthCallbackEvent(req, { provider: "google_stats", outcome: "state_invalid", error: stateCheck.reason, return_to: returnTo, capture_in_sentry: true });
      return redirectBack({ linked: "stats", ok: "0", error: "oauth_state" });
    }

    const state = stateCheck.state;
    const sourceRaw = asString(state["source"]) ?? "";
    const productRaw = asString(state["product"]) ?? "";
    const domainFromState = asString(state["domain"]);
    const siteUrlFromState = asString(state["siteUrl"]);

    oauthCallbackEvent(req, { provider: "google_stats", outcome: "started", return_to: returnTo });

    const fail = (error: string, message?: string) => {
      oauthCallbackEvent(req, { provider: "google_stats", outcome: "failed", error, message, return_to: returnTo, capture_in_sentry: true });
      return redirectBack({
        linked: productRaw || "stats",
        ok: "0",
        error,
        message: message ? getSimpleFrenchErrorMessage(message, "La connexion n'a pas pu être finalisée.").slice(0, 200) : undefined,
      });
    };

    if (!sourceRaw || !isAllowedSource(sourceRaw) || !productRaw || !isAllowedProduct(productRaw)) {
      return fail("invalid_state");
    }

    const source: AllowedSource = sourceRaw;
    const product: AllowedProduct = productRaw;

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectFromEnv = process.env.GOOGLE_STATS_REDIRECT_URI;
    const redirectUri = redirectFromEnv || `${origin}/api/integrations/google-stats/callback`;

    if (oauthError || !code) {
      oauthCallbackEvent(req, {
        provider: "google_stats",
        outcome: oauthError === "access_denied" ? "cancelled" : "failed",
        error: oauthError || "missing_code",
        message: oauthErrorDescription || undefined,
        return_to: returnTo,
        capture_in_sentry: oauthError !== "access_denied",
      });
      return redirectBack({
        linked: product,
        ok: "0",
        error: oauthError || "missing_code",
        message: oauthErrorDescription ? getSimpleFrenchErrorMessage(oauthErrorDescription, "La connexion n'a pas pu être finalisée.").slice(0, 200) : undefined,
      });
    }

    if (!clientId || !clientSecret) {
      oauthCallbackEvent(req, { provider: "google_stats", outcome: "config_error", error: "oauth_config_missing", return_to: returnTo, capture_in_sentry: true });
      return redirectBack({ linked: product, ok: "0", error: "oauth_config_missing" });
    }

    const sessionSupabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await sessionSupabase.auth.getUser();
    if (authErr || !authData?.user) {
      oauthCallbackEvent(req, { provider: "google_stats", outcome: "not_authenticated", error: "not_authenticated", return_to: returnTo });
      return redirectBack({ linked: product, ok: "0", error: "not_authenticated" });
    }
    const userId = await resolveOAuthBoundInrcyAccountId(sessionSupabase, authData.user.id, state["accountId"]);

    const rlUser = await enforceRateLimit({
      name: `oauth_google_stats_cb_${product}`,
      identifier: userId,
      limit: 10,
      window: "10 m",
    });
    if (rlUser) return rlUser;

    const ip = getClientIp(req);
    const rlIp = await enforceRateLimit({
      name: `oauth_google_stats_cb_ip_${product}`,
      identifier: ip,
      limit: 20,
      window: "10 m",
    });
    if (rlIp) return rlIp;

    const supabase = supabaseAdmin;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = (await tokenRes.json()) as TokenResponse;
    if (!tokenRes.ok || !tokenData.access_token) {
      return fail("token_exchange_failed", "La connexion au compte a échoué. Merci de réessayer.");
    }

    const missingScopes = findExplicitlyMissingGoogleScopes(tokenData.scope, [
      REQUIRED_SCOPE_BY_PRODUCT[product],
      GOOGLE_USERINFO_EMAIL_SCOPE,
    ]);
    if (missingScopes.length) {
      return fail(GOOGLE_OAUTH_PERMISSION_ERROR_CODE, GOOGLE_OAUTH_PERMISSION_MESSAGE);
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = (await userRes.json()) as GoogleUserInfo;

    if (!userRes.ok || !userInfo?.email) {
      return fail("userinfo_failed", "Impossible de récupérer les informations du compte.");
    }

    const domain = normalizeComparableDomain(String(domainFromState || "").trim());
    const siteUrlHint = String(siteUrlFromState || "").trim();

    if (domain && tokenData.access_token) {
      const [inrcyCfgRes, proCfgRes] = await Promise.all([
        supabase.from("inrcy_site_configs").select("settings").eq("user_id", userId).maybeSingle(),
        supabase.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle(),
      ]);

      const nowIso = new Date().toISOString();
      const inrcySettings = safeJsonParse<SiteSettings>(asRecord(inrcyCfgRes.data)["settings"], {});
      const proSettings = safeJsonParse<Record<string, unknown>>(asRecord(proCfgRes.data)["settings"], {});

      if (source === "site_web") {
        const nextPro: Record<string, unknown> = { ...(proSettings ?? {}) };
        const siteWebNext: Record<string, unknown> = { ...asRecord(nextPro["site_web"]) };
        if (siteUrlHint) siteWebNext["url"] = siteUrlHint;
        nextPro["site_web"] = siteWebNext;

        if (product === "ga4") {
          const existingGa4 = asRecord(siteWebNext["ga4"]);
          const existingPid = (asString(existingGa4["property_id"]) ?? "").trim();
          const existingMid = (asString(existingGa4["measurement_id"]) ?? "").trim();

          if (existingPid) {
            const v = await validateGa4Binding(tokenData.access_token, domain, existingPid, existingMid || null);
            if (!v.ok) {
              const resolved = await resolveGa4FromDomain(tokenData.access_token, domain);
              siteWebNext["ga4"] = {
                ...existingGa4,
                property_id: resolved.propertyId,
                measurement_id: resolved.measurementId ?? undefined,
                verified_at: nowIso,
              };
            } else if (!existingMid && v.measurementId) {
              siteWebNext["ga4"] = { ...existingGa4, measurement_id: v.measurementId, verified_at: nowIso };
            }
          } else {
            const resolved = await resolveGa4FromDomain(tokenData.access_token, domain);
            siteWebNext["ga4"] = {
              ...existingGa4,
              property_id: resolved.propertyId,
              measurement_id: resolved.measurementId ?? undefined,
              verified_at: nowIso,
            };
          }
        } else {
          const existingGsc = asRecord(siteWebNext["gsc"]);
          const existingProp = (asString(existingGsc["property"]) ?? "").trim();

          if (existingProp) {
            if (!validateGscPropertyAgainstDomain(domain, existingProp)) {
              const resolvedProp = await resolveGscFromDomain(tokenData.access_token, domain, siteUrlHint || null);
              siteWebNext["gsc"] = { ...existingGsc, property: resolvedProp, verified_at: nowIso };
            } else {
              const gscOk = await resolveGscFromDomain(tokenData.access_token, domain, siteUrlHint || null).catch(() => null);
              if (!gscOk) return fail("gsc_not_accessible", "La propriété Search Console de ce domaine n'est pas accessible avec ce compte Google.");
            }
          } else {
            const resolvedProp = await resolveGscFromDomain(tokenData.access_token, domain, siteUrlHint || null);
            siteWebNext["gsc"] = { ...existingGsc, property: resolvedProp, verified_at: nowIso };
          }
        }

        const { error: upErr } = await supabase
          .from("pro_tools_configs")
          .upsert({ user_id: userId, settings: nextPro }, { onConflict: "user_id" });
        if (upErr) return fail("db_update_settings", "Impossible d'enregistrer la configuration du site web.");
      } else {
        const next: SiteSettings = { ...(inrcySettings ?? {}) };

        if (product === "ga4") {
          const existingGa4 = next.ga4 ?? {};
          const existingPid = String(existingGa4?.property_id || "").trim();
          const existingMid = String(existingGa4?.measurement_id || "").trim();

          if (existingPid) {
            const v = await validateGa4Binding(tokenData.access_token, domain, existingPid, existingMid || null);
            if (!v.ok) {
              const resolved = await resolveGa4FromDomain(tokenData.access_token, domain);
              next.ga4 = {
                ...(next.ga4 ?? {}),
                property_id: resolved.propertyId,
                measurement_id: resolved.measurementId ?? undefined,
                verified_at: nowIso,
              };
            } else if (!existingMid && v.measurementId) {
              next.ga4 = { ...(next.ga4 ?? {}), measurement_id: v.measurementId, verified_at: nowIso };
            }
          } else {
            const resolved = await resolveGa4FromDomain(tokenData.access_token, domain);
            next.ga4 = {
              ...(next.ga4 ?? {}),
              property_id: resolved.propertyId,
              measurement_id: resolved.measurementId ?? undefined,
              verified_at: nowIso,
            };
          }
        } else {
          const existingGsc = next.gsc ?? {};
          const existingProp = String(existingGsc?.property || "").trim();

          if (existingProp) {
            if (!validateGscPropertyAgainstDomain(domain, existingProp)) {
              const resolvedProp = await resolveGscFromDomain(tokenData.access_token, domain, siteUrlHint || null);
              next.gsc = { ...(next.gsc ?? {}), property: resolvedProp, verified_at: nowIso };
            } else {
              const gscOk = await resolveGscFromDomain(tokenData.access_token, domain, siteUrlHint || null).catch(() => null);
              if (!gscOk) return fail("gsc_not_accessible", "La propriété Search Console de ce domaine n'est pas accessible avec ce compte Google.");
            }
          } else {
            const resolvedProp = await resolveGscFromDomain(tokenData.access_token, domain, siteUrlHint || null);
            next.gsc = { ...(next.gsc ?? {}), property: resolvedProp, verified_at: nowIso };
          }
        }

        const { error: upErr } = await supabase
          .from("inrcy_site_configs")
          .upsert({ user_id: userId, settings: next }, { onConflict: "user_id" });
        if (upErr) return fail("db_update_settings", "Impossible d'enregistrer la configuration du site iNrCy.");
      }
    }

    await upsertGoogleIntegration({ supabase, userId, source, product, tokenData, userInfo });
    await syncSitePresenceIntegrations(userId);

    oauthCallbackEvent(req, { provider: "google_stats", outcome: "success", user_id: userId, return_to: returnTo, product });
    return redirectBack({ linked: product, ok: "1" });
  } catch (e: unknown) {
    oauthCallbackException(req, "google_stats", e, { error: "oauth_callback_failed", return_to: returnTo });
    const message = getSimpleFrenchErrorMessage(e).slice(0, 200);
    return redirectBack({ linked: "stats", ok: "0", error: "oauth_callback_failed", message: message || undefined });
  }
}

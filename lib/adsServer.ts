import "server-only";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { isMetaAuthorizationError } from "@/lib/metaGraphErrorClassification";
import { listAccessibleFacebookPagesDetailed } from "@/lib/metaBusinessAssets";
import { GoogleAdsApiError, googleAdsApiErrorMessage } from "@/lib/adsGoogleApiError";
import { ADMIN_USER_IDS, isAdminRole } from "@/lib/roles";
import type { AdsAccount, AdsProvider } from "@/lib/adsValidation";

export const GOOGLE_ADS_API_VERSION = "v25";

export type AdsIntegration = {
  id: string;
  provider: string;
  source: string;
  display_name: string | null;
  email_address: string | null;
  provider_account_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string | null;
  resource_id: string | null;
  resource_label: string | null;
  meta: unknown;
};

export type AdsConnectionStatus = "connected" | "needs_update" | "disconnected";

/** Temporary launch guard: iNr’ADS stays available only to the Admin test account. */
export async function isAdsPilotAdmin(authUserId: string): Promise<boolean> {
  if (ADMIN_USER_IDS.some((adminUserId) => adminUserId === authUserId)) return true;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", authUserId)
    .maybeSingle();

  return !error && isAdminRole(data?.role);
}

export function adsPilotOnlyResponse() {
  return NextResponse.json(
    {
      error: "iNr’ADS est actuellement en préparation. L’accès est temporairement réservé au compte Admin.",
      code: "INRCY_ADS_COMING_SOON",
    },
    { status: 403 },
  );
}

/** @deprecated Name kept while all Ads routes move through the temporary Admin-only launch guard. */
export async function requirePremiumAdsUser() {
  const user = await requireUser();
  if (user.errorResponse) return { user: null, errorResponse: user.errorResponse };
  if (!(await isAdsPilotAdmin(user.authUserId))) return { user: null, errorResponse: adsPilotOnlyResponse() };
  return { user, errorResponse: null };
}

export function adsRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  const canonicalOrigin = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin : requestOrigin;
  return origin === requestOrigin || origin === canonicalOrigin;
}

export function adsBadOriginResponse() {
  return NextResponse.json({ error: "Origine de requête non autorisée." }, { status: 403 });
}

export function adsConnectionStatus(integration: AdsIntegration | null): AdsConnectionStatus {
  if (!integration) return "disconnected";
  if (integration.status === "needs_update" || integration.status === "expired" || integration.status === "error") {
    return "needs_update";
  }
  return integration.status === "connected" ? "connected" : "disconnected";
}

export async function readAdsIntegration(userId: string, provider: AdsProvider): Promise<AdsIntegration | null> {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id,provider,source,display_name,email_address,provider_account_id,access_token_enc,refresh_token_enc,expires_at,status,resource_id,resource_label,meta")
    .eq("user_id", userId)
    .eq("source", provider === "meta" ? "meta_ads" : "google_ads")
    .eq("product", "ads")
    .maybeSingle();
  if (error) throw new Error("Impossible de charger la connexion publicitaire.");
  return data as AdsIntegration | null;
}

async function markAdsConnectionForReconnect(userId: string, integrationId: string) {
  await supabaseAdmin
    .from("integrations")
    .update({ status: "needs_update", updated_at: new Date().toISOString() })
    .eq("id", integrationId)
    .eq("user_id", userId);
}

class MetaAdsApiError extends Error {
  readonly httpStatus: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly type: string;

  constructor(input: { message: string; httpStatus: number; code?: unknown; subcode?: unknown; type?: unknown }) {
    super(input.message);
    this.name = "MetaAdsApiError";
    this.httpStatus = input.httpStatus;
    this.code = Number.isFinite(Number(input.code)) ? Number(input.code) : null;
    this.subcode = Number.isFinite(Number(input.subcode)) ? Number(input.subcode) : null;
    this.type = String(input.type || "");
  }
}

export async function accessTokenForAds(userId: string, provider: AdsProvider): Promise<string> {
  const integration = await readAdsIntegration(userId, provider);
  if (!integration?.access_token_enc || integration.status !== "connected") {
    if (adsConnectionStatus(integration) === "needs_update") {
      throw new Error(`La connexion ${provider === "meta" ? "Meta Ads" : "Google Ads"} doit être actualisée.`);
    }
    throw new Error(`Connectez d’abord ${provider === "meta" ? "Meta Ads" : "Google Ads"}.`);
  }
  if (provider === "meta") {
    if (integration.expires_at && Date.parse(integration.expires_at) < Date.now() + 60_000) {
      await markAdsConnectionForReconnect(userId, integration.id);
      throw new Error("La connexion Meta Ads a expiré. Reconnectez votre compte.");
    }
    return decryptToken(integration.access_token_enc);
  }

  // An absent or malformed expiry cannot prove that the access token is still
  // valid. Refresh it rather than leaving an apparently connected account on
  // an old token forever.
  if (integration.expires_at && Date.parse(integration.expires_at) > Date.now() + 120_000) {
    return decryptToken(integration.access_token_enc);
  }
  if (!integration.refresh_token_enc) {
    await markAdsConnectionForReconnect(userId, integration.id);
    throw new Error("La connexion Google Ads a expiré. Reconnectez votre compte.");
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("La configuration Google Ads est incomplète côté serveur.");
  }
  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptToken(integration.refresh_token_enc),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    cache: "no-store",
  });
  const refreshed = await refreshResponse.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!refreshResponse.ok || !refreshed.access_token) {
    if (refreshResponse.status === 400 || refreshResponse.status === 401 || refreshed.error === "invalid_grant") {
      await markAdsConnectionForReconnect(userId, integration.id);
      throw new Error("La connexion Google Ads a expiré. Reconnectez votre compte.");
    }
    throw new Error("Le renouvellement de la connexion Google Ads est momentanément indisponible. Réessayez dans un instant.");
  }
  const { error } = await supabaseAdmin.from("integrations").update({
    access_token_enc: encryptToken(refreshed.access_token),
    expires_at: new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString(),
  }).eq("id", integration.id).eq("user_id", userId);
  if (error) throw new Error("Le renouvellement de la connexion Google Ads n’a pas pu être conservé.");
  return refreshed.access_token;
}

async function externalJson(url: string, init: RequestInit, provider?: AdsProvider): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (provider === "google") {
      throw new GoogleAdsApiError(googleAdsApiErrorMessage(payload, response.statusText || "Erreur Google Ads"), response.status);
    }
    const nested = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : {};
    const message = String(nested.message || payload.message || response.statusText || "Erreur de la plateforme publicitaire");
    if (provider === "meta") {
      throw new MetaAdsApiError({
        message: message.slice(0, 300),
        httpStatus: response.status,
        code: nested.code,
        subcode: nested.error_subcode,
        type: nested.type,
      });
    }
    throw new Error(message.slice(0, 300));
  }
  return payload;
}

export async function metaAdsJson(userId: string, path: string, body?: URLSearchParams) {
  const token = await accessTokenForAds(userId, "meta");
  try {
    return await externalJson(buildMetaGraphUrl(path), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body,
    }, "meta");
  } catch (error) {
    if (error instanceof MetaAdsApiError && isMetaAuthorizationError(error)) {
      const integration = await readAdsIntegration(userId, "meta").catch(() => null);
      if (integration) await markAdsConnectionForReconnect(userId, integration.id);
      throw new Error("La connexion Meta Ads doit être actualisée. Reconnectez votre compte Facebook.");
    }
    throw error;
  }
}

export async function googleAdsJson(userId: string, path: string, body?: Record<string, unknown>, loginCustomerId?: string) {
  // Since Google sunset developer tokens on 2026-09-09, API access is granted
  // to the Google Cloud project that owns this OAuth client. The connected
  // advertiser's OAuth token remains the only credential needed here.
  const token = await accessTokenForAds(userId, "google");
  return externalJson(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }, "google");
}

export async function listAdsAccounts(userId: string, provider: AdsProvider): Promise<AdsAccount[]> {
  if (provider === "meta") {
    const accounts = new Map<string, AdsAccount>();
    let after = "";
    for (let page = 0; page < 10; page += 1) {
      const params = new URLSearchParams({ fields: "id,name,currency,account_status", limit: "100" });
      if (after) params.set("after", after);
      const response = await metaAdsJson(userId, `me/adaccounts?${params.toString()}`);
      const data = Array.isArray(response.data) ? response.data : [];
      for (const row of data) {
        const item = row as Record<string, unknown>;
        const id = String(item.id || "").replace(/^act_/, "");
        if (!/^\d+$/.test(id)) continue;
        accounts.set(id, {
          id,
          name: String(item.name || `Compte ${id}`),
          currency: String(item.currency || ""),
          provider,
          status: String(item.account_status ?? ""),
        });
      }
      const paging = response.paging && typeof response.paging === "object" ? response.paging as Record<string, unknown> : {};
      const cursors = paging.cursors && typeof paging.cursors === "object" ? paging.cursors as Record<string, unknown> : {};
      const nextAfter = String(cursors.after || "");
      if (!paging.next || !nextAfter || nextAfter === after) break;
      after = nextAfter;
    }
    return [...accounts.values()];
  }

  const accessible = await googleAdsJson(userId, "customers:listAccessibleCustomers");
  const resourceNames = Array.isArray(accessible.resourceNames) ? accessible.resourceNames : [];
  const accounts = new Map<string, AdsAccount>();
  for (const resourceName of resourceNames.slice(0, 50)) {
    const id = String(resourceName || "").replace("customers/", "");
    if (!/^\d+$/.test(id)) continue;
    const direct = await googleAdsJson(userId, `customers/${id}/googleAds:search`, {
      query: "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.status FROM customer LIMIT 1",
    });
    const row = (Array.isArray(direct.results) ? direct.results[0] : null) as Record<string, unknown> | null;
    const customer = row?.customer && typeof row.customer === "object" ? row.customer as Record<string, unknown> : {};
    if (customer.manager === true) {
      const children = await googleAdsJson(userId, `customers/${id}/googleAds:search`, {
        query: "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level > 0 LIMIT 1000",
      }, id);
      for (const child of Array.isArray(children.results) ? children.results : []) {
        const client = (child as Record<string, unknown>).customerClient as Record<string, unknown> | undefined;
        if (!client || client.manager === true || client.status !== "ENABLED") continue;
        const childId = String(client.id || "");
        if (/^\d+$/.test(childId) && !accounts.has(childId)) {
          accounts.set(childId, {
            id: childId,
            name: String(client.descriptiveName || `Compte ${childId}`),
            currency: String(client.currencyCode || ""),
            provider,
            status: String(client.status || ""),
            loginCustomerId: id,
          });
        }
      }
    } else if (customer.status === "ENABLED") {
      accounts.set(id, { id, name: String(customer.descriptiveName || `Compte ${id}`), currency: String(customer.currencyCode || ""), provider });
    }
  }
  return [...accounts.values()];
}

export async function listMetaPages(userId: string): Promise<{ id: string; name: string; instagramUserId?: string }[]> {
  const token = await accessTokenForAds(userId, "meta");
  const discovery = await listAccessibleFacebookPagesDetailed(token);
  if (!discovery.diagnostics.primary_request_succeeded && discovery.pages.length === 0) {
    const requiredIssue = discovery.diagnostics.issues.find((issue) => !issue.optional);
    if (requiredIssue && isMetaAuthorizationError({
      message: requiredIssue.message,
      type: requiredIssue.type,
      code: requiredIssue.code,
      subcode: requiredIssue.subcode,
      httpStatus: requiredIssue.status,
    })) {
      const integration = await readAdsIntegration(userId, "meta").catch(() => null);
      if (integration) await markAdsConnectionForReconnect(userId, integration.id);
      throw new Error("La connexion Meta Ads doit être actualisée. Reconnectez votre compte Facebook.");
    }
    throw new Error(requiredIssue?.message || "Meta n’a pas permis de charger vos Pages Facebook.");
  }
  return discovery.pages.flatMap((page) => /^\d+$/.test(page.id) ? [{
    id: page.id,
    name: page.name || `Page ${page.id}`,
    ...(page.instagram_business_account?.id ? { instagramUserId: page.instagram_business_account.id } : {}),
  }] : []);
}

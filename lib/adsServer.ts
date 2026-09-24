import "server-only";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { ADMIN_USER_IDS, isAdminRole } from "@/lib/roles";
import type { AdsAccount, AdsProvider } from "@/lib/adsValidation";

export const GOOGLE_ADS_API_VERSION = "v25";

type IntegrationRow = {
  id: string;
  provider: string;
  source: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string | null;
};

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

export async function readAdsIntegration(userId: string, provider: AdsProvider): Promise<IntegrationRow | null> {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id,provider,source,access_token_enc,refresh_token_enc,expires_at,status")
    .eq("user_id", userId)
    .eq("source", provider === "meta" ? "meta_ads" : "google_ads")
    .eq("product", "ads")
    .maybeSingle();
  if (error) throw new Error("Impossible de charger la connexion publicitaire.");
  return data as IntegrationRow | null;
}

export async function accessTokenForAds(userId: string, provider: AdsProvider): Promise<string> {
  const integration = await readAdsIntegration(userId, provider);
  if (!integration?.access_token_enc || integration.status !== "connected") {
    throw new Error(`Connectez d’abord ${provider === "meta" ? "Meta Ads" : "Google Ads"}.`);
  }
  if (provider === "meta") {
    if (integration.expires_at && Date.parse(integration.expires_at) < Date.now() + 60_000) {
      throw new Error("La connexion Meta Ads a expiré. Reconnectez votre compte.");
    }
    return decryptToken(integration.access_token_enc);
  }

  if (!integration.expires_at || Date.parse(integration.expires_at) > Date.now() + 120_000) {
    return decryptToken(integration.access_token_enc);
  }
  if (!integration.refresh_token_enc || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("La connexion Google Ads a expiré. Reconnectez votre compte.");
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
  const refreshed = await refreshResponse.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
  if (!refreshResponse.ok || !refreshed.access_token) throw new Error("La connexion Google Ads a expiré. Reconnectez votre compte.");
  const { error } = await supabaseAdmin.from("integrations").update({
    access_token_enc: encryptToken(refreshed.access_token),
    expires_at: new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString(),
  }).eq("id", integration.id).eq("user_id", userId);
  if (error) throw new Error("Le renouvellement de la connexion Google Ads n’a pas pu être conservé.");
  return refreshed.access_token;
}

async function externalJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const nested = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : {};
    const message = String(nested.message || payload.message || response.statusText || "Erreur de la plateforme publicitaire");
    throw new Error(message.slice(0, 300));
  }
  return payload;
}

export async function metaAdsJson(userId: string, path: string, body?: URLSearchParams) {
  const token = await accessTokenForAds(userId, "meta");
  return externalJson(buildMetaGraphUrl(path), {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body,
  });
}

export async function googleAdsJson(userId: string, path: string, body?: Record<string, unknown>, loginCustomerId?: string) {
  // OAuth identifies the connected advertiser. Google Ads API also requires the
  // application developer token issued from a Google Ads manager account.
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) {
    throw new Error("Configuration Google Ads incomplète : ajoutez le developer token du compte administrateur Google Ads.");
  }
  const token = await accessTokenForAds(userId, "google");
  return externalJson(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": developerToken,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function listAdsAccounts(userId: string, provider: AdsProvider): Promise<AdsAccount[]> {
  if (provider === "meta") {
    const response = await metaAdsJson(userId, "me/adaccounts?fields=id,name,currency,account_status&limit=100");
    const data = Array.isArray(response.data) ? response.data : [];
    return data.flatMap((row) => {
      const item = row as Record<string, unknown>;
      const id = String(item.id || "").replace(/^act_/, "");
      return /^\d+$/.test(id) ? [{ id, name: String(item.name || `Compte ${id}`), currency: String(item.currency || ""), provider, status: String(item.account_status || "") }] : [];
    });
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
  const response = await metaAdsJson(userId, "me/accounts?fields=id,name,instagram_business_account{id}&limit=100");
  return (Array.isArray(response.data) ? response.data : []).flatMap((row) => {
    const item = row as Record<string, unknown>;
    const id = String(item.id || "");
    const instagram = item.instagram_business_account && typeof item.instagram_business_account === "object"
      ? item.instagram_business_account as Record<string, unknown>
      : {};
    const instagramUserId = String(instagram.id || "");
    return /^\d+$/.test(id)
      ? [{ id, name: String(item.name || `Page ${id}`), ...(/^\d+$/.test(instagramUserId) ? { instagramUserId } : {}) }]
      : [];
  });
}

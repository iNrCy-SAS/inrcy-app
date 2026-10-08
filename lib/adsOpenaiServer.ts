import "server-only";

import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assessOpenaiAdsAccount, OpenaiAdsPublishError, resolveOpenaiAdsLocations, searchOpenaiAdsLocations, verifyOpenaiAdsAccount, type OpenaiAdsAccount } from "@/lib/adsOpenaiConnector";
import { openaiNativeDelivery, type OpenaiNativeDraft } from "@/lib/adsOpenaiCampaignSettings";
import { openaiAdsResourcesConsentKey, type OpenaiAdsResources } from "@/lib/adsOpenaiResources";

export const OPENAI_ADS_PROVIDER = "openai";
export const OPENAI_ADS_SOURCE = "openai_ads";
export const OPENAI_ADS_PRODUCT = "ads";

export type OpenaiAdsIntegration = {
  id: string;
  status: string | null;
  resource_id: string | null;
  resource_label: string | null;
  access_token_enc: string | null;
  meta: unknown;
};

export async function readOpenaiAdsIntegration(userId: string): Promise<OpenaiAdsIntegration | null> {
  const { data, error } = await supabaseAdmin.from("integrations")
    .select("id,status,resource_id,resource_label,access_token_enc,meta")
    .eq("user_id", userId)
    .eq("provider", OPENAI_ADS_PROVIDER)
    .eq("source", OPENAI_ADS_SOURCE)
    .eq("product", OPENAI_ADS_PRODUCT)
    .maybeSingle();
  if (error) throw new Error("La connexion ChatGPT Ads est indisponible.");
  return data as OpenaiAdsIntegration | null;
}

/** Only the advertiser's account-scoped Ads API key belongs here. Never use an OpenAI model API key. */
export async function readChatgptAdsApiKey(userId: string): Promise<string | null> {
  const integration = await readOpenaiAdsIntegration(userId);
  if (integration?.status !== "connected" || !integration.resource_id || !integration.access_token_enc) return null;
  try {
    return decryptToken(integration.access_token_enc);
  } catch {
    // A corrupt ciphertext must fail closed. Never treat *_enc as plaintext.
    return null;
  }
}

export async function saveOpenaiAdsIntegration(userId: string, key: string, account: OpenaiAdsAccount): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("integrations").upsert({
    user_id: userId,
    provider: OPENAI_ADS_PROVIDER,
    source: OPENAI_ADS_SOURCE,
    product: OPENAI_ADS_PRODUCT,
    category: "ads",
    status: "connected",
    display_name: account.name || "ChatGPT Ads",
    provider_account_id: account.id,
    resource_id: account.id,
    resource_label: account.name || account.id,
    access_token_enc: encryptToken(key),
    refresh_token_enc: null,
    expires_at: null,
    meta: {
      currency_code: account.currencyCode,
      timezone: account.timezone,
      ad_account_status: account.status,
      brand_review_status: account.brandReviewStatus,
      account_review_status: account.accountReviewStatus,
      verified_at: now,
    },
    updated_at: now,
  }, { onConflict: "user_id,provider,source,product" });
  if (error) throw new Error("La connexion ChatGPT Ads n’a pas pu être enregistrée.");
}

export function openaiAdsStoredAccount(integration: OpenaiAdsIntegration | null): OpenaiAdsAccount | null {
  if (!integration?.resource_id) return null;
  const meta = integration.meta && typeof integration.meta === "object" && !Array.isArray(integration.meta)
    ? integration.meta as Record<string, unknown> : {};
  const value = (key: string) => typeof meta[key] === "string" ? meta[key] as string : "";
  return {
    id: integration.resource_id,
    name: integration.resource_label || integration.resource_id,
    currencyCode: value("currency_code"),
    timezone: value("timezone"),
    status: value("ad_account_status"),
    brandReviewStatus: value("brand_review_status"),
    accountReviewStatus: value("account_review_status") || null,
  };
}

async function verifiedOpenaiConnection(userId: string, expectedAccountId?: string) {
  const integration = await readOpenaiAdsIntegration(userId);
  if (integration?.status !== "connected" || !integration.resource_id || !integration.access_token_enc || (expectedAccountId && integration.resource_id !== expectedAccountId)) throw new OpenaiAdsPublishError("ACCOUNT_MISMATCH", "Reconnectez le compte ChatGPT Ads sélectionné.");
  let key = "";
  try { key = decryptToken(integration.access_token_enc); } catch { /* ciphertext never becomes a plaintext fallback */ }
  if (!key) throw new OpenaiAdsPublishError("NO_API_KEY", "La clé publicitaire ChatGPT Ads doit être actualisée.");
  const account = await verifyOpenaiAdsAccount({ apiKey: key, expectedAccountId: integration.resource_id });
  await assertOpenaiConnectionCurrent(userId, integration);
  return { key, account, integration };
}
/** A reconnect or disconnect while provider GETs are running invalidates the result. */
async function assertOpenaiConnectionCurrent(userId: string, snapshot: OpenaiAdsIntegration) {
  const current = await readOpenaiAdsIntegration(userId);
  if (!current || current.id !== snapshot.id || current.resource_id !== snapshot.resource_id || current.status !== snapshot.status || current.status !== "connected" || current.access_token_enc !== snapshot.access_token_enc) {
    throw new OpenaiAdsPublishError("ACCOUNT_MISMATCH", "La connexion ChatGPT Ads a changé. Relancez le contrôle du compte sélectionné.");
  }
}
/** Server-only read. The returned projection cannot contain the decrypted credential. */
export async function readOpenaiAdsDeliveryResources(userId: string, query = "", expectedAccountId?: string, queries: string[] = []): Promise<OpenaiAdsResources> {
  if (!Array.isArray(queries) || queries.length > 30 || queries.some((item) => typeof item !== "string" || item.trim().length < 2 || item.trim().length > 120 || /[\r\n\u0000-\u001f]/.test(item))) throw new OpenaiAdsPublishError("INVALID_GEO", "La recherche des zones ChatGPT Ads est invalide.");
  const searches = [...new Set([...queries, ...(query ? [query] : [])].map((item) => item.trim()))];
  const { key, account, integration } = await verifiedOpenaiConnection(userId, expectedAccountId);
  const results = await Promise.all(searches.map((query) => searchOpenaiAdsLocations({ apiKey: key, query, countryCode: "FR" })));
  const geographyOptions = [...new Map(results.flat().map((item) => [item.id, item])).values()];
  await assertOpenaiConnectionCurrent(userId, integration);
  return { selectedAccountId: account.id, account, geographyOptions, verifiedAt: new Date().toISOString() };
}
/** Independent publication preflight, with GETs only and no database/provider writes. */
export async function checkOpenaiAdsPublication(userId: string, draft: OpenaiNativeDraft & { adAccountId: string; targetLocations: string[] }) {
  const { key, account, integration } = await verifiedOpenaiConnection(userId, draft.adAccountId);
  const assessment = assessOpenaiAdsAccount(account);
  if (!assessment.ready) throw new OpenaiAdsPublishError(assessment.code || "ACCOUNT_NOT_READY", assessment.message || "Le compte ChatGPT Ads n’est pas prêt.");
  const delivery = openaiNativeDelivery(draft, Date.now(), account.timezone);
  const locations = await resolveOpenaiAdsLocations({ apiKey: key, names: draft.targetLocations, countryCode: "FR" });
  await assertOpenaiConnectionCurrent(userId, integration);
  const resourcesKey = openaiAdsResourcesConsentKey({ selectedAccountId: account.id, account, geographyOptions: [], verifiedAt: "" });
  return { ready: true as const, selectedAccountId: account.id, verifiedLocationCount: locations.length, resourcesKey, account, locations, delivery };
}

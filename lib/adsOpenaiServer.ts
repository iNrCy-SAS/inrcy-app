import "server-only";

import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { OpenaiAdsAccount } from "@/lib/adsOpenaiConnector";

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

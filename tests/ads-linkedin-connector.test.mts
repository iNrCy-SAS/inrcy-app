import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildLinkedInAdsAuthorizationUrl,
  LINKEDIN_ADS_MANAGE_SCOPES,
  linkedInAdsAccessTokenIsFresh,
  linkedInAdsCanRetainAccount,
  linkedInAdsCanManageCampaigns,
  linkedInAdsCanServeCampaigns,
  linkedInAdsHasAccessMode,
  linkedInAdsHasReadAccess,
  linkedInAdsScopes,
  missingLinkedInAdsScopes,
  normalizeLinkedInAdsAccount,
  normalizeLinkedInAdsAccountUser,
  resolveLinkedInAdsRedirectUri,
} from "../lib/adsLinkedInPolicy.ts";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

test("LinkedIn Ads requests its least-privilege read or complete campaign-management scopes", () => {
  const manage = "rw_ads r_ads_reporting r_organization_admin w_organization_social";
  assert.deepEqual([...LINKEDIN_ADS_MANAGE_SCOPES], manage.split(" "));
  for (const [mode, expected] of [["read", "r_ads"], ["manage", manage]] as const) {
    const url = new URL(buildLinkedInAdsAuthorizationUrl("ads-client", "https://example.com/api/ads/linkedin/callback", "opaque-state", mode));
    assert.equal(url.origin, "https://www.linkedin.com");
    assert.equal(url.pathname, "/oauth/v2/authorization");
    assert.equal(url.searchParams.get("scope"), expected);
    assert.equal(url.searchParams.get("state"), "opaque-state");
    assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/api/ads/linkedin/callback");
    assert.equal(url.searchParams.get("scope")?.includes("r_organization_social"), false);
    assert.equal(url.searchParams.get("scope")?.includes("w_member_social"), false);
    assert.equal(url.searchParams.get("scope")?.includes("rw_organization_admin"), false);
  }
});

test("LinkedIn Ads resolves only the exact dedicated callback on the public app origin", () => {
  assert.equal(resolveLinkedInAdsRedirectUri({
    explicit: "https://app.inrcy.com/api/ads/linkedin/callback",
    appUrl: "https://app.inrcy.com",
    siteUrl: "https://inrcy.com",
    requestUrl: "https://preview.example.test/api/ads/linkedin/start",
  }), "https://app.inrcy.com/api/ads/linkedin/callback");
  assert.equal(resolveLinkedInAdsRedirectUri({
    appUrl: "https://app.inrcy.com/dashboard",
    requestUrl: "https://preview.example.test/api/ads/linkedin/start",
  }), "https://app.inrcy.com/api/ads/linkedin/callback");
  assert.equal(resolveLinkedInAdsRedirectUri({
    requestUrl: "http://127.0.0.1:3011/api/ads/linkedin/start",
  }), "http://127.0.0.1:3011/api/ads/linkedin/callback");

  for (const explicit of [
    "https://evil.example/api/ads/linkedin/callback",
    "http://app.inrcy.com/api/ads/linkedin/callback",
    "https://app.inrcy.com/api/integrations/linkedin/callback",
    "https://app.inrcy.com/api/ads/linkedin/callback?next=evil",
  ]) {
    assert.throws(() => resolveLinkedInAdsRedirectUri({
      explicit,
      appUrl: "https://app.inrcy.com",
      requestUrl: "https://app.inrcy.com/api/ads/linkedin/start",
    }));
  }
});

test("scope parsing accepts comma or space separators but refuses organic scopes", () => {
  assert.deepEqual(linkedInAdsScopes("r_ads rw_ads,r_ads"), ["r_ads", "rw_ads"]);
  assert.equal(linkedInAdsHasReadAccess("r_ads"), true);
  assert.equal(linkedInAdsHasReadAccess("rw_ads"), true);
  assert.equal(linkedInAdsHasReadAccess("w_member_social openid"), false);
  assert.equal(linkedInAdsHasAccessMode("rw_ads", "read"), true);
  assert.equal(linkedInAdsHasAccessMode("r_ads", "manage"), false);
  assert.equal(linkedInAdsHasAccessMode("rw_ads", "manage"), false);
  assert.equal(linkedInAdsHasAccessMode(
    "rw_ads r_ads_reporting r_organization_admin w_organization_social", "manage",
  ), true);
  assert.deepEqual(missingLinkedInAdsScopes("rw_ads", "manage"), [
    "r_ads_reporting", "r_organization_admin", "w_organization_social",
  ]);
});

test("ad-account roles and URNs are parsed strictly", () => {
  assert.deepEqual(normalizeLinkedInAdsAccountUser({
    account: "urn:li:sponsoredAccount:516413367",
    role: "CAMPAIGN_MANAGER",
    user: "urn:li:person:Ab_Cd-3",
  }), { id: "516413367", role: "CAMPAIGN_MANAGER", memberUrn: "urn:li:person:Ab_Cd-3" });
  assert.equal(normalizeLinkedInAdsAccountUser({ account: "urn:li:organization:516413367", role: "CAMPAIGN_MANAGER", user: "urn:li:person:abc" }), null);
  assert.equal(normalizeLinkedInAdsAccountUser({ account: "urn:li:sponsoredAccount:516413367", role: "ADMIN", user: "urn:li:person:abc" }), null);
});

test("rw_ads never overrides a read-only LinkedIn account role", () => {
  assert.equal(linkedInAdsCanManageCampaigns("VIEWER", "rw_ads", "ACTIVE", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CREATIVE_MANAGER", "rw_ads", "ACTIVE", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CAMPAIGN_MANAGER", "r_ads", "ACTIVE", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CAMPAIGN_MANAGER", "rw_ads", "PAUSED", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CAMPAIGN_MANAGER", "rw_ads", "ACTIVE", "BUSINESS"), true);
  assert.equal(linkedInAdsCanManageCampaigns("ACCOUNT_MANAGER", "rw_ads", "ACTIVE", "ENTERPRISE", "MARKETING_SOLUTIONS"), true);
  assert.equal(linkedInAdsCanManageCampaigns("ACCOUNT_MANAGER", "rw_ads", "ACTIVE", "ENTERPRISE", "TALENT_SOLUTIONS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("ACCOUNT_MANAGER", "rw_ads", "ACTIVE", "ENTERPRISE"), false);
  assert.equal(linkedInAdsCanManageCampaigns("ACCOUNT_BILLING_ADMIN", "rw_ads", "ACTIVE", "BUSINESS"), true);
  assert.equal(linkedInAdsCanServeCampaigns(true, ["RUNNABLE"], false), true);
  assert.equal(linkedInAdsCanServeCampaigns(true, ["BILLING_HOLD"], false), false);
  assert.equal(linkedInAdsCanServeCampaigns(true, ["RUNNABLE"], true), false);
});

test("account metadata cannot be substituted for a different accessible account", () => {
  const membership = normalizeLinkedInAdsAccountUser({
    account: "urn:li:sponsoredAccount:123456",
    role: "VIEWER",
    user: "urn:li:person:abc",
  });
  assert.ok(membership);
  assert.equal(normalizeLinkedInAdsAccount({ id: 789012, name: "Other", status: "ACTIVE", type: "BUSINESS" }, membership, "rw_ads"), null);
  const account = normalizeLinkedInAdsAccount({
    id: 123456,
    name: " Example ",
    currency: "EUR",
    status: "ACTIVE",
    type: "BUSINESS",
    servingStatuses: ["RUNNABLE"],
    test: false,
  }, membership, "rw_ads");
  assert.equal(account?.name, "Example");
  assert.equal(account?.canManageCampaigns, false);
  assert.equal(account?.canServeCampaigns, false);
  assert.deepEqual(account?.permissions, ["VIEWER"]);
});

test("enterprise advertiser validation rejects non-Marketing-Solutions accounts", () => {
  const membership = normalizeLinkedInAdsAccountUser({
    account: "urn:li:sponsoredAccount:123456",
    role: "ACCOUNT_MANAGER",
    user: "urn:li:person:abc",
  });
  assert.ok(membership);
  const talent = normalizeLinkedInAdsAccount({
    id: 123456,
    name: "Talent",
    status: "ACTIVE",
    type: "ENTERPRISE",
    productType: "TALENT_SOLUTIONS",
    servingStatuses: ["RUNNABLE"],
  }, membership, "rw_ads");
  assert.equal(talent?.canManageCampaigns, false);
  assert.equal(talent?.canServeCampaigns, false);
  const marketing = normalizeLinkedInAdsAccount({
    id: 123456,
    name: "Marketing",
    status: "ACTIVE",
    type: "ENTERPRISE",
    productType: "MARKETING_SOLUTIONS",
    servingStatuses: ["RUNNABLE"],
  }, membership, "rw_ads");
  assert.equal(marketing?.canManageCampaigns, true);
  assert.equal(marketing?.canServeCampaigns, true);
});

test("reauthorization retains only an account still accessible by the same LinkedIn member", () => {
  const membership = normalizeLinkedInAdsAccountUser({
    account: "urn:li:sponsoredAccount:123456", role: "VIEWER", user: "urn:li:person:abc",
  });
  assert.ok(membership);
  assert.equal(linkedInAdsCanRetainAccount("123456", true, [membership]), true);
  assert.equal(linkedInAdsCanRetainAccount("123456", false, [membership]), false);
  assert.equal(linkedInAdsCanRetainAccount("999999", true, [membership]), false);
  assert.equal(linkedInAdsCanRetainAccount("123456", true, []), false);
});

test("LinkedIn connection status cannot rely on missing or malformed access expiry", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  assert.equal(linkedInAdsAccessTokenIsFresh(null, now), false);
  assert.equal(linkedInAdsAccessTokenIsFresh("invalid", now), false);
  assert.equal(linkedInAdsAccessTokenIsFresh("2026-09-27T10:01:00Z", now), false);
  assert.equal(linkedInAdsAccessTokenIsFresh("2026-09-27T10:03:00Z", now), true);
});

test("connector stays separate from organic LinkedIn while the Ads publisher uses the dedicated connection", () => {
  const server = source("lib/adsLinkedInServer.ts");
  const start = source("app/api/ads/linkedin/start/route.ts");
  const accounts = source("app/api/ads/linkedin/accounts/route.ts");
  const status = source("app/api/ads/linkedin/status/route.ts");
  const validation = source("lib/adsValidation.ts");
  const publishRoute = source("app/api/ads/campaigns/[id]/publish/route.ts");
  assert.match(server, /LINKEDIN_ADS_PROVIDER = "linkedin_ads"/);
  assert.match(server, /LINKEDIN_ADS_SOURCE = "linkedin_ads"/);
  assert.match(server, /LINKEDIN_ADS_CLIENT_ID/);
  assert.match(server, /oauth\/v2\/introspectToken/);
  assert.match(server, /payload\.auth_type !== "3L"/);
  assert.doesNotMatch(server, /process\.env\.LINKEDIN_CLIENT_ID/);
  assert.match(start, /"ads_linkedin"/);
  assert.match(accounts, /adsRequestOriginAllowed\(request\)/);
  assert.match(accounts, /ads_linkedin_accounts/);
  assert.match(status, /INRCY_LINKEDIN_ADS_PUBLISH_ENABLED === "true"/);
  assert.match(validation, /ADS_DRAFT_ACCOUNT_CHANNELS = \["meta", "google", "linkedin", "pinterest"\]/);
  assert.match(validation, /isAdsDraftAccountChannel[\s\S]*?value === "linkedin"/);
  assert.match(publishRoute, /publishLinkedInAdsCampaign/);
  assert.match(publishRoute, /isAdsChannelPublishEnabled\(draft\.provider, mode, process\.env\)/);
  assert.match(source("app/api/ads/linkedin/callback/route.ts"), /oauth_linkedin_ads_callback/);
  assert.doesNotMatch(server, /POST https:\/\/api\.linkedin\.com\/rest\/adCampaigns/);
});

test("LinkedIn Ads and organic LinkedIn keep distinct OAuth, callback, storage and disconnect contracts", () => {
  const adsStart = source("app/api/ads/linkedin/start/route.ts");
  const adsDisconnect = source("app/api/ads/linkedin/disconnect/route.ts");
  const organicStart = source("app/api/integrations/linkedin/start/route.ts");
  const organicDisconnect = source("app/api/integrations/linkedin/disconnect-account/route.ts");
  const organicScopes = source("lib/linkedinScopes.ts");
  const server = source("lib/adsLinkedInServer.ts");
  const callback = source("app/api/ads/linkedin/callback/route.ts");
  const policy = source("lib/adsLinkedInPolicy.ts");

  assert.match(adsStart, /makeOAuthState\(\s*"ads_linkedin"/);
  assert.match(adsStart, /getLinkedInAdsRedirectUri\(request\.url\)/);
  assert.match(policy, /\/api\/ads\/linkedin\/callback/);
  assert.match(server, /process\.env\.LINKEDIN_ADS_CLIENT_ID/);
  assert.match(server, /process\.env\.LINKEDIN_ADS_CLIENT_SECRET/);
  assert.match(server, /process\.env\.NEXT_PUBLIC_APP_URL/);
  assert.match(server, /resolveLinkedInAdsRedirectUri/);
  assert.match(server, /linkedInAdsHasAccessMode\(scopes\.join\(" "\), requestedMode\)/);
  assert.match(server, /"missing_scopes", 403/);
  assert.match(callback, /saveLinkedInAdsConnection\(userId, token, state\.state\.mode\)/);
  assert.match(adsDisconnect, /\.eq\("provider", LINKEDIN_ADS_PROVIDER\)/);
  assert.match(adsDisconnect, /\.eq\("source", LINKEDIN_ADS_SOURCE\)/);
  assert.match(adsDisconnect, /\.eq\("product", LINKEDIN_ADS_PRODUCT\)/);

  assert.match(organicStart, /makeOAuthState\("linkedin"/);
  assert.match(organicStart, /process\.env\.LINKEDIN_CLIENT_ID/);
  assert.match(organicStart, /\/api\/integrations\/linkedin\/callback/);
  assert.match(organicDisconnect, /\.eq\("provider", "linkedin"\)/);
  assert.doesNotMatch(organicStart, /LINKEDIN_ADS_/);
  assert.doesNotMatch(organicDisconnect, /LINKEDIN_ADS_/);
  assert.doesNotMatch(organicScopes, /["']r_ads["']/);
  assert.doesNotMatch(organicScopes, /["']rw_ads["']/);
});

test("LinkedIn UI uses the complete Ads management consent and reports the dedicated rollout gate", () => {
  const settings = source("app/dashboard/ads/ExternalAdsConnectionSettings.tsx");
  const client = source("app/dashboard/ads/AdsClient.tsx");
  const start = source("app/api/ads/linkedin/start/route.ts");
  const status = source("app/api/ads/linkedin/status/route.ts");

  assert.match(start, /modeParam[^;]*\|\| "manage"/);
  assert.match(start, /modeParam !== "read" && modeParam !== "manage"/);
  assert.match(settings, /linkedinAccess: "read" \| "manage" = "manage"/);
  assert.match(settings, /channel === "linkedin"[\s\S]*Boolean\(status\.missingScopes\?\.length\)/);
  assert.match(settings, /linkedinManagementMissing[\s\S]*\? "needs_update"/);
  assert.match(settings, /reconnexion requise pour la gestion complète/);
  assert.match(settings, /href=\{oauthHref\(channel, "manage"\)\}>Compléter les autorisations Ads/);
  assert.match(settings, /linkedinRefreshAccess = channel === "linkedin" \? "manage" : "read"/);
  assert.match(client, /scopes = Array\.isArray\(data\.scopes\)/);
  assert.match(client, /missingScopes = Array\.isArray\(data\.missingScopes\)/);
  assert.match(client, /selectedAccountCanManage: data\.selectedAccountCanManage === true/);
  assert.match(client, /selectedAccountCanServe: data\.selectedAccountCanServe === true/);
  assert.match(status, /missingLinkedInAdsScopes\(scopes\.join\(" "\), "manage"\)/);
  assert.match(status, /INRCY_LINKEDIN_ADS_PUBLISH_ENABLED === "true"/);
  assert.match(settings, /Rôle LinkedIn/);
  assert.match(settings, /Servabilité/);
  assert.match(settings, /La publication sur \$\{current\.label\} n’est pas encore activée/);
});

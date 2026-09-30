import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LINKEDIN_ADS_MANAGE_SCOPES,
  LINKEDIN_ADS_READ_SCOPE,
  validateLinkedInAdsEnv,
} from "../scripts/verify-linkedin-ads-env-core.mjs";

type EnvMap = Record<string, string | undefined>;

function env(overrides: EnvMap = {}): EnvMap {
  return {
    LINKEDIN_ADS_CLIENT_ID: "dedicated-linkedin-ads-client",
    LINKEDIN_ADS_CLIENT_SECRET: "server-only-test-secret",
    LINKEDIN_ADS_REDIRECT_URI: "https://app.inrcy.com/api/ads/linkedin/callback",
    LINKEDIN_ADS_API_VERSION: "202609",
    NEXT_PUBLIC_APP_URL: "https://app.inrcy.com",
    INRCY_CREDENTIALS_SECRET: Buffer.alloc(32, 11).toString("base64"),
    LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: "558357276",
    INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: "true",
    LINKEDIN_REDIRECT_URI: "https://app.inrcy.com/api/integrations/linkedin/callback",
    LINKEDIN_CLIENT_ID: "organic-linkedin-client",
    ...overrides,
  };
}

test("LinkedIn Ads env validator accepts the dedicated Development configuration", () => {
  const result = validateLinkedInAdsEnv(env());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.details?.version, "202609");
  assert.equal(result.details?.redirectPath, "/api/ads/linkedin/callback");
  assert.equal(result.details?.readScope, LINKEDIN_ADS_READ_SCOPE);
  assert.deepEqual(result.details?.manageScopes, LINKEDIN_ADS_MANAGE_SCOPES);
  assert.deepEqual(result.details?.developmentAccountIds, ["558357276"]);
  assert.equal(result.details?.publicationEnabled, true);
  assert.deepEqual(LINKEDIN_ADS_MANAGE_SCOPES, [
    "rw_ads", "r_ads_reporting", "r_organization_admin", "w_organization_social",
  ]);
  assert.equal(LINKEDIN_ADS_MANAGE_SCOPES.includes("r_ads"), false);
  assert.equal(LINKEDIN_ADS_MANAGE_SCOPES.includes("r_organization_social"), false);
  assert.equal(result.details?.credentialLabel, "dedicated LinkedIn Ads pair");
});

test("LinkedIn Ads env verifier reports the exact separated scope sets", () => {
  const verifier = readFileSync(new URL("../scripts/verify-linkedin-ads-env.mjs", import.meta.url), "utf8");
  assert.match(verifier, /OAuth read-only scope:/);
  assert.match(verifier, /OAuth manage scopes:/);
  assert.match(verifier, /manageScopes\.join\(" "\)/);
  assert.doesNotMatch(verifier, /r_ads \(lecture\), rw_ads \(gestion\)/);
  assert.match(verifier, /LinkedIn publisher gate:/);
});

test("LinkedIn Ads env validator rejects callback drift from the verified URI", () => {
  for (const overrides of [
    { LINKEDIN_ADS_REDIRECT_URI: "https://evil.example/api/ads/linkedin/callback" },
    { LINKEDIN_ADS_REDIRECT_URI: "https://app.inrcy.com/api/integrations/linkedin/callback" },
    { LINKEDIN_ADS_REDIRECT_URI: "https://app.inrcy.com/api/ads/linkedin/callback?next=evil" },
    { LINKEDIN_ADS_REDIRECT_URI: "http://app.inrcy.com/api/ads/linkedin/callback" },
  ]) {
    const result = validateLinkedInAdsEnv(env(overrides));
    assert.equal(result.ok, false, JSON.stringify(result));
  }
});

test("LinkedIn Ads env validator rejects public secrets and an invalid encryption key", () => {
  const exposed = validateLinkedInAdsEnv(env({ NEXT_PUBLIC_LINKEDIN_ADS_CLIENT_SECRET: "leaked" }));
  assert.equal(exposed.ok, false);
  assert.ok(exposed.errors.some((error) => /Secret exposé au navigateur interdit/.test(error)));
  assert.doesNotMatch(exposed.errors.join("\n"), /leaked/);

  const invalidKey = validateLinkedInAdsEnv(env({ INRCY_CREDENTIALS_SECRET: "not-a-32-byte-key" }));
  assert.equal(invalidKey.ok, false);
  assert.ok(invalidKey.errors.some((error) => /exactement 32 octets/.test(error)));
});

test("LinkedIn Ads env validator keeps organic and Ads callbacks isolated", () => {
  const result = validateLinkedInAdsEnv(env({
    LINKEDIN_REDIRECT_URI: "https://app.inrcy.com/api/ads/linkedin/callback",
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /callbacks LinkedIn organique et LinkedIn Ads doivent être distincts/.test(error)));
});

test("LinkedIn Ads env validator rejects an absent or malformed Development allowlist", () => {
  for (const accountIds of ["", "558357276,not-an-id"]) {
    const result = validateLinkedInAdsEnv(env({ LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: accountIds }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /DEVELOPMENT_ACCOUNT_IDS/.test(error)));
  }
});

test("LinkedIn Ads uses a provider-specific publication gate", () => {
  const locked = validateLinkedInAdsEnv(env({ INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: "false" }));
  assert.equal(locked.ok, true);
  assert.equal(locked.details?.publicationEnabled, false);
  assert.ok(locked.warnings.some((warning) => /publisher LinkedIn Ads reste verrouillé/.test(warning)));
  const malformed = validateLinkedInAdsEnv(env({ INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: "yes" }));
  assert.equal(malformed.ok, false);
});

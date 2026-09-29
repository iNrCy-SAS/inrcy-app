import assert from "node:assert/strict";
import test from "node:test";

import { validateXAdsEnv } from "../../scripts/verify-x-ads-env-core.mjs";

type EnvMap = Record<string, string | undefined>;

function env(overrides: EnvMap = {}): EnvMap {
  return {
    X_ADS_API_KEY: "test-consumer-key",
    X_ADS_API_SECRET: "test-consumer-secret",
    X_ADS_REDIRECT_URI: "https://app.inrcy.com/api/ads/x/callback",
    X_ADS_API_VERSION: "12",
    NEXT_PUBLIC_APP_URL: "https://app.inrcy.com",
    INRCY_CREDENTIALS_SECRET: Buffer.alloc(32, 7).toString("base64"),
    X_REDIRECT_URI: "https://app.inrcy.com/api/integrations/x/callback",
    ...overrides,
  };
}

test("X Ads env validator accepts the isolated production configuration", () => {
  const result = validateXAdsEnv(env());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.details?.version, "12");
  assert.equal(result.details?.redirectPath, "/api/ads/x/callback");
});

test("X Ads env validator rejects the organic callback and unsupported versions", () => {
  const sharedCallback = validateXAdsEnv(env({
    X_REDIRECT_URI: "https://app.inrcy.com/api/ads/x/callback",
  }));
  assert.equal(sharedCallback.ok, false);
  assert.ok(sharedCallback.errors.some((error) => /callbacks X organique et X Ads doivent être distincts/.test(error)));

  const oldVersion = validateXAdsEnv(env({ X_ADS_API_VERSION: "11" }));
  assert.equal(oldVersion.ok, false);
  assert.ok(oldVersion.errors.some((error) => /doit valoir 12/.test(error)));
});

test("X Ads env validator rejects browser-exposed credentials without echoing their values", () => {
  const result = validateXAdsEnv(env({ NEXT_PUBLIC_X_ADS_API_SECRET: "leaked" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /exposé au navigateur interdit/.test(error)));
  assert.doesNotMatch(result.errors.join("\n"), /leaked/);
});

test("X Ads env validator reports a browser leak even when required server variables are missing", () => {
  const result = validateXAdsEnv({ NEXT_PUBLIC_X_ADS_API_SECRET: "must-never-be-printed" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /NEXT_PUBLIC_X_ADS_API_SECRET/.test(error)));
  assert.ok(result.errors.some((error) => /Variable manquante: X_ADS_API_KEY/.test(error)));
  assert.doesNotMatch(result.errors.join("\n"), /must-never-be-printed/);
});

test("X Ads env validator refuses an off-origin callback even from local development", () => {
  const result = validateXAdsEnv(env({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    X_ADS_REDIRECT_URI: "https://evil.example/api/ads/x/callback",
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /partager l'origine/.test(error)));
});

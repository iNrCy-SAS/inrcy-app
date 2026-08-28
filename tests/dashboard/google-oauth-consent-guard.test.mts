import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  findExplicitlyMissingGoogleScopes,
  GOOGLE_OAUTH_PERMISSION_ERROR_CODE,
} from "../../lib/googleOAuthConsent.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Google granular consent reports every explicitly omitted scope", () => {
  const required = ["scope:a", "scope:b"];

  assert.deepEqual(
    findExplicitlyMissingGoogleScopes("scope:a scope:b", required),
    [],
  );
  assert.deepEqual(
    findExplicitlyMissingGoogleScopes("scope:a", required),
    ["scope:b"],
  );
  assert.deepEqual(
    findExplicitlyMissingGoogleScopes(undefined, required),
    [],
    "OAuth may omit scope when the granted set exactly matches the request",
  );
});

test("every active Google OAuth callback rejects partial consent before persistence", () => {
  const callbacks = [
    "app/api/integrations/google/callback/route.ts",
    "app/api/integrations/google-stats/callback/route.ts",
    "app/api/integrations/google-business/callback/route.ts",
    "app/api/integrations/youtube-shorts/callback/route.ts",
  ];

  for (const callback of callbacks) {
    const source = read(callback);
    assert.match(source, /findExplicitlyMissingGoogleScopes\(\s*tokenData\.scope/);
    assert.match(source, /GOOGLE_OAUTH_PERMISSION_ERROR_CODE/);
    assert.match(source, /GOOGLE_OAUTH_PERMISSION_MESSAGE/);
  }

  assert.equal(GOOGLE_OAUTH_PERMISSION_ERROR_CODE, "google_permissions_incomplete");
});

test("the dashboard explains Google consent and offers product-specific retries", () => {
  const drawer = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const banner = read("app/dashboard/_components/GoogleOAuthConsentBanner.tsx");

  assert.match(drawer, /<GoogleOAuthConsentBanner panel=\{panel\} \/>/);
  for (const endpoint of [
    "google-business/start",
    "google/start",
    "google-stats/start",
    "youtube-shorts/start",
  ]) {
    assert.ok(banner.includes(endpoint), `missing retry route ${endpoint}`);
  }
  assert.match(banner, /error === GOOGLE_OAUTH_PERMISSION_ERROR_CODE/);
  assert.match(banner, /error === "access_denied"/);
});

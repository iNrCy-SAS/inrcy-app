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
  const googleBusiness = read("app/dashboard/_components/GoogleBusinessPanel.tsx");
  const siteInrcy = read("app/dashboard/_components/SiteInrcyPanel.tsx");
  const siteWeb = read("app/dashboard/_components/SiteWebPanel.tsx");
  const youtube = read("app/dashboard/settings/_components/YoutubeShortsSettingsContent.tsx");

  const localPanelSet = drawer.match(
    /const PANELS_WITH_LOCAL_GOOGLE_NOTICE = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1] ?? "";
  assert.deepEqual(
    [...localPanelSet.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    ["gmb", "site_inrcy", "site_web", "youtube_shorts"],
  );
  assert.match(
    drawer,
    /<GoogleOAuthConsentBanner panel=\{panel && !PANELS_WITH_LOCAL_GOOGLE_NOTICE\.has\(panel\) \? panel : null\} \/>/,
  );
  assert.match(googleBusiness, /<GoogleOAuthConsentBanner panel="gmb" variant="inline" \/>/);
  assert.match(youtube, /<GoogleOAuthConsentBanner panel="youtube_shorts" variant="inline" \/>/);
  for (const [source, panel] of [
    [siteInrcy, "site_inrcy"],
    [siteWeb, "site_web"],
  ] as const) {
    assert.ok(
      source.includes(`<GoogleOAuthConsentBanner panel="${panel}" product="ga4" variant="inline" />`),
      `missing inline GA4 consent notice for ${panel}`,
    );
    assert.ok(
      source.includes(`<GoogleOAuthConsentBanner panel="${panel}" product="gsc" variant="inline" />`),
      `missing inline GSC consent notice for ${panel}`,
    );
  }
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
  assert.match(banner, /!product \|\| !linked \|\| linked === product/);
  assert.match(banner, /buildRetryHref\(panel, product \?\? linked\)/);
});

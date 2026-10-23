import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { channelNodes, channelRuntime } from "../helpers/channel-bubble-runtime.mts";

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
  const modal = read("app/dashboard/_components/DashboardChannelsModal.tsx");
  assert.match(modal, /<GoogleOAuthConsentBanner panel=\{selected\?\.key \?\? null\} errorsOnly/);
  for (const [panel, product, endpoint] of [
    ["gmb", "gmb", "google-business/start"],
    ["mails", "google", "google/start"],
    ["youtube_shorts", "youtube_shorts", "youtube-shorts/start"],
    ["site_web", "ga4", "google-stats/start"],
    ["site_web", "gsc", "google-stats/start"],
  ]) {
    const query = new URLSearchParams({ panel, linked: product, error: GOOGLE_OAUTH_PERMISSION_ERROR_CODE });
    const runtime = channelRuntime("app/dashboard/_components/GoogleOAuthConsentBanner.tsx", {
      "next/navigation": { useSearchParams: () => query },
      "@/lib/googleOAuthConsent": { GOOGLE_OAUTH_PERMISSION_ERROR_CODE },
    });
    const props = { panel, errorsOnly: true };
    for (const error of [GOOGLE_OAUTH_PERMISSION_ERROR_CODE, "access_denied"]) {
      query.set("error", error);
      const tree = runtime.render(props);
      assert.equal(tree.props.role, "alert");
      channelNodes(tree).find(node => node.type === "button")!.props.onClick();
      const destination = new URL(runtime.browser.location.href, "https://app.example");
      assert.equal(destination.pathname, `/api/integrations/${endpoint}`);
      assert.equal(destination.searchParams.get("returnTo"), `/dashboard?panel=${panel}`);
      if (panel === "site_web") {
        assert.equal(destination.searchParams.get("product"), product);
        assert.equal(destination.searchParams.get("source"), panel);
        const unrelated = runtime.render({ ...props, product: product === "ga4" ? "gsc" : "ga4" });
        assert.equal(unrelated, null, "A product-specific notice cannot display another product's consent error");
      }
    }
    query.delete("error");
    assert.equal(runtime.render(props), null, "Healthy connected bubbles do not repeat a consent notice");
  }
});

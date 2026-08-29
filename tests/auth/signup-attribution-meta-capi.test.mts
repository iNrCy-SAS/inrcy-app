import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createMetaBrowserMatch,
  createSignupAttributionSnapshot,
  getSignupAdLabel,
  getSignupAttributionSourceLabel,
  getSignupCampaignLabel,
  readSignupAttributionSnapshot,
  SIGNUP_ATTRIBUTION_METADATA_KEY,
} from "../../lib/signupAttribution.ts";

const read = (relativePath: string) => readFileSync(relativePath, "utf8");

test("l'instantané d'attribution conserve les identifiants Meta sans conserver le fbclid", () => {
  const snapshot = createSignupAttributionSnapshot({
    formSource: "wordpress-elementor",
    utmSource: "ig",
    utmMedium: "paid_social",
    utmCampaign: "National vidéo",
    utmContent: "Vidéo ultime",
    campaignId: "120253054088840279",
    adsetId: "120253054088850279",
    adId: "120253054088860279",
    placement: "instagram_reels",
    siteSourceName: "ig",
    landingPageUrl: "https://inrcy.com/?utm_source=ig&fbclid=secret-click-id#section",
    eventSourceUrl: "https://inrcy.com/inscription?utm_source=ig&fbclid=secret-click-id",
    eventId: "inrcy-lead-1234",
    capturedAt: "2026-08-29T12:00:00.000Z",
    marketingConsent: "allow",
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.campaignId, "120253054088840279");
  assert.equal(snapshot.adId, "120253054088860279");
  assert.equal(snapshot.marketingConsent, true);
  assert.doesNotMatch(snapshot.landingPageUrl, /fbclid|secret-click-id/);
  assert.doesNotMatch(snapshot.eventSourceUrl, /fbclid|secret-click-id/);
  assert.equal(getSignupAttributionSourceLabel(snapshot), "Instagram · paid_social");
  assert.equal(getSignupCampaignLabel(snapshot), "National vidéo");
  assert.equal(getSignupAdLabel(snapshot), "Vidéo ultime");
  assert.equal("fbclid" in snapshot, false);
  assert.equal("fbp" in snapshot, false);
  assert.equal("fbc" in snapshot, false);
});

test("l'attribution se relit depuis les métadonnées Auth immuables", () => {
  const original = createSignupAttributionSnapshot({
    utmSource: "fb",
    utmMedium: "paid_social",
    campaignName: "France image",
    adName: "Visuel national",
    eventId: "inrcy-lead-auth-metadata",
  });
  const restored = readSignupAttributionSnapshot({
    user_metadata: {
      [SIGNUP_ATTRIBUTION_METADATA_KEY]: original,
    },
  });

  assert.equal(restored.utmSource, "fb");
  assert.equal(restored.campaignName, "France image");
  assert.equal(restored.adName, "Visuel national");
  assert.equal(getSignupAttributionSourceLabel(restored), "Facebook · paid_social");
});

test("les identifiants navigateur Meta restent séparés des données persistées", () => {
  assert.deepEqual(
    createMetaBrowserMatch({
      fbp: "fb.1.123.abc",
      fbc: "fb.1.123.click",
      clientUserAgent: "Browser/1.0",
    }),
    {
      fbp: "fb.1.123.abc",
      fbc: "fb.1.123.click",
      clientUserAgent: "Browser/1.0",
    },
  );

  const sql = read("ops/sql/2026-08-29_signup_attribution_meta_capi.sql");
  assert.doesNotMatch(sql, /\n\s*(?:fbp|fbc|fbclid|client_user_agent)\s+text/i);
  assert.match(sql, /references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /enable row level security/i);
});

test("le webhook enregistre l'attribution et envoie un Lead CAPI sans bloquer l'inscription", () => {
  const route = read("app/api/public/trial-signup/route.ts");
  assert.match(route, /\[SIGNUP_ATTRIBUTION_METADATA_KEY\]: payload\.attribution/);
  assert.match(route, /sendMetaLeadConversion/);
  assert.match(route, /persistSignupAttribution/);
  assert.match(route, /\.catch\(\(error: unknown\) =>/);
  assert.match(route, /meta_tracking_consent/);
  assert.match(route, /event_id/);
});

test("la CAPI partage un event_id avec le Pixel et ne confond pas l'IP WordPress avec l'IP visiteur", () => {
  const capi = read("lib/metaConversionsApi.ts");
  const wordpress = read("ops/wordpress-meta-attribution/inrcy-meta-attribution.js");

  assert.match(capi, /event_name: "Lead"/);
  assert.match(capi, /event_id: input\.attribution\.eventId/);
  assert.match(capi, /action_source: "website"/);
  assert.match(capi, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(capi, /marketing_consent_missing/);
  assert.doesNotMatch(capi, /client_ip_address/);

  assert.match(wordpress, /form_fields\[" \+ fieldId \+ "\]/);
  assert.match(wordpress, /"event_id", newEventId\(\)/);
  assert.match(wordpress, /\{ eventID: eventId \}/);
  assert.match(wordpress, /submit_success\.inrcyMetaAttribution/);
  assert.match(wordpress, /cmplz_marketing/);
});

test("les e-mails et l'administration affichent campagne, publicité et placement", () => {
  const alert = read("app/api/admin/new-user-alert/route.ts");
  const adminApi = read("app/api/admin/users/route.ts");
  const adminUi = read("app/dashboard/admin/users/AdminUsersClient.tsx");

  for (const label of ["Source", "Campagne", "Ensemble", "Publicité", "Placement", "Page d'arrivée"]) {
    assert.match(alert, new RegExp(`emailRow\\(\"${label}`));
  }
  assert.match(adminApi, /readSignupAttributionSnapshot/);
  assert.match(adminApi, /attribution,/);
  assert.match(adminUi, />Acquisition</);
  assert.match(adminUi, /acquisitionCampaign/);
  assert.match(adminUi, /acquisitionAd/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const callback = readFileSync(new URL("../app/api/ads/oauth/[provider]/callback/route.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../lib/adsServer.ts", import.meta.url), "utf8");

test("Google Ads exige une identité OAuth vérifiée avant de mémoriser le compte", () => {
  assert.match(callback, /if \(!meResponse\.ok \|\| !me\.id\) throw new Error\("Impossible de vérifier le compte Google connecté\."\)/);
  assert.match(callback, /existing\.provider_account_id === profileId/);
  assert.match(callback, /keepsSelection \? \{\} : \{ resource_id: null, resource_label: null \}/);
});

test("Google Ads conserve l’association du compte et rafraîchit un jeton sans date d’expiration", () => {
  assert.match(server, /\.eq\("source", provider === "meta" \? "meta_ads" : "google_ads"\)/);
  assert.match(server, /\.eq\("product", "ads"\)/);
  assert.match(server, /if \(integration\.expires_at && Date\.parse\(integration\.expires_at\) > Date\.now\(\) \+ 120_000\)/);
  assert.match(server, /grant_type: "refresh_token"/);
});

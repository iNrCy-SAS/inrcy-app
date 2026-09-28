import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adsAccountAssociationIssue,
  adsAccountCanBeAssociated,
  type AdsAccount,
} from "../lib/adsValidation.ts";
import {
  adsConnectionDisplay,
  adsConnectionSnapshotFromRow,
} from "../lib/adsConnectionSnapshot.ts";
import {
  isMetaAuthorizationError,
  isMetaRateLimitError,
} from "../lib/metaGraphErrorClassification.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("seul un compte Meta actif en EUR peut être associé", () => {
  const active: AdsAccount = { id: "1", name: "Actif", currency: "EUR", provider: "meta", status: "1" };
  const disabled: AdsAccount = { ...active, id: "2", status: "2" };
  const nonEuro: AdsAccount = { ...active, id: "3", currency: "USD" };
  const google: AdsAccount = { id: "4", name: "Google", currency: "EUR", provider: "google" };

  assert.equal(adsAccountCanBeAssociated(active), true);
  assert.equal(adsAccountCanBeAssociated(disabled), false);
  assert.equal(adsAccountAssociationIssue(disabled), "compte Meta inactif ou restreint");
  assert.equal(adsAccountCanBeAssociated(nonEuro), false);
  assert.equal(adsAccountCanBeAssociated(google), true);
});

test("un jeton Meta expiré apparaît à actualiser sans affecter Google", () => {
  const now = Date.parse("2026-09-29T12:00:00.000Z");
  const row = { status: "connected", resource_id: "123", expires_at: "2026-09-29T12:00:30.000Z" };
  assert.equal(adsConnectionSnapshotFromRow({ ...row, source: "meta_ads" }, now).status, "needs_update");
  assert.equal(adsConnectionSnapshotFromRow({ ...row, source: "google_ads" }, now).status, "connected");
});

test("un compte sauvegardé devenu inaccessible n'est plus présenté comme pleinement connecté", () => {
  const snapshot = adsConnectionSnapshotFromRow({ status: "connected", resource_id: "123" });
  snapshot.accountAvailable = false;
  assert.deepEqual(adsConnectionDisplay(snapshot), {
    label: "Accès au compte à vérifier",
    tone: "select-account",
  });
});

test("les erreurs d'autorisation Meta imposent une reconnexion, contrairement aux limites", () => {
  for (const code of [10, 190, 200]) {
    assert.equal(isMetaAuthorizationError({ code, message: "OAuth error" }), true);
  }
  assert.equal(isMetaAuthorizationError({ httpStatus: 401 }), true);
  assert.equal(isMetaRateLimitError({ httpStatus: 429, code: 4 }), true);
  assert.equal(isMetaAuthorizationError({ httpStatus: 429, code: 4 }), false);
});

test("iNr'ADS réutilise la découverte Pages robuste et pagine les comptes Meta", () => {
  const server = source("../lib/adsServer.ts");
  assert.match(server, /listAccessibleFacebookPagesDetailed\(token\)/);
  assert.match(server, /me\/adaccounts\?\$\{params\.toString\(\)\}/);
  assert.match(server, /params\.set\("after", after\)/);
  assert.match(server, /isMetaAuthorizationError\(error\)/);
  assert.match(server, /markAdsConnectionForReconnect/);
});

test("le client consomme la disponibilité distante et nettoie le callback OAuth", () => {
  const client = source("../app/dashboard/ads/AdsClient.tsx");
  const accounts = source("../app/api/ads/accounts/route.ts");
  assert.match(client, /selectedAccountAvailable\?: boolean/);
  assert.match(client, /accountAvailable: result\.selectedAccountAvailable === true/);
  assert.match(client, /params\.delete\("connection"\)/);
  assert.match(accounts, /selectedPageId: storedPageId/);
});

test("un échec d'échange Meta longue durée ne sauvegarde plus silencieusement le jeton court", () => {
  const callback = source("../app/api/ads/oauth/[provider]/callback/route.ts");
  assert.match(callback, /!longResponse\.ok \|\| !longToken\.access_token/);
  assert.match(callback, /Meta n’a pas fourni de connexion Ads longue durée/);
  assert.ok(callback.indexOf("!longResponse.ok || !longToken.access_token") < callback.indexOf("token = longToken"));
});

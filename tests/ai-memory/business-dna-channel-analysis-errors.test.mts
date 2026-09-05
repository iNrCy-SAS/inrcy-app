import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  areAllBusinessDnaRequestsRejected,
  canCollectBusinessDnaSource,
  findBusinessDnaReconnectRejectedReason,
  isBusinessDnaReconnectError,
  pickBusinessDnaRejectedReason,
  shouldBusinessDnaSourceReconnect,
} from "../../lib/businessDnaChannelAnalysisErrors.ts";

const collectorSource = readFileSync(
  new URL("../../lib/businessDnaChannelAnalysis.ts", import.meta.url),
  "utf8",
);

test("Business DNA recognizes OAuth and token failures as reconnect conditions", () => {
  for (const error of [
    new Error("HTTP 401"),
    new Error("Google API (403): Forbidden"),
    new Error("invalid_grant"),
    new Error("Access token has expired"),
    new Error("OAuth authorization revoked"),
    new Error("Please reconnect this account"),
  ]) {
    assert.equal(isBusinessDnaReconnectError(error), true, error.message);
  }
});

test("Business DNA does not ask for reconnection on transient or content failures", () => {
  for (const error of [
    new Error("fetch failed"),
    new Error("Délai maximal de lecture du canal dépassé."),
    new Error("Réponse distante trop volumineuse."),
    new Error("Le site ne contient aucun texte exploitable."),
    new Error("HTTP 500"),
    new Error("OAuth configuration missing on the server"),
  ]) {
    assert.equal(isBusinessDnaReconnectError(error), false, error.message);
  }
});

test("Business DNA rejects a multi-endpoint source only when every request failed", () => {
  const rejected = { status: "rejected", reason: new Error("HTTP 500") } as const;
  const fulfilled = { status: "fulfilled", value: {} } as const;

  assert.equal(areAllBusinessDnaRequestsRejected(rejected, rejected, rejected), true);
  assert.equal(areAllBusinessDnaRequestsRejected(rejected, fulfilled, rejected), false);
  assert.equal(areAllBusinessDnaRequestsRejected(), false);
});

test("Business DNA prioritizes a reconnect error when every endpoint failed", () => {
  const transient = { status: "rejected", reason: new Error("HTTP 500") } as const;
  const expired = { status: "rejected", reason: new Error("HTTP 401: token expired") } as const;

  assert.equal(pickBusinessDnaRejectedReason(transient, expired), expired.reason);
  assert.equal(pickBusinessDnaRejectedReason(transient), transient.reason);
});

test("Business DNA surfaces an authorization failure even when another endpoint succeeded", () => {
  const fulfilled = { status: "fulfilled", value: {} } as const;
  const expired = { status: "rejected", reason: new Error("HTTP 403: invalid token") } as const;
  const transient = { status: "rejected", reason: new Error("HTTP 500") } as const;

  assert.equal(findBusinessDnaReconnectRejectedReason(fulfilled, expired), expired.reason);
  assert.equal(findBusinessDnaReconnectRejectedReason(fulfilled, transient), null);
});

test("HTTP authorization errors only request reconnection for OAuth sources", () => {
  const error = new Error("HTTP 403: Forbidden");

  assert.equal(
    shouldBusinessDnaSourceReconnect({ error, oauthProtected: true }),
    true,
  );
  assert.equal(
    shouldBusinessDnaSourceReconnect({ error, oauthProtected: false }),
    false,
  );
  assert.equal(
    shouldBusinessDnaSourceReconnect({
      error: new Error("fetch failed"),
      oauthProtected: false,
      requiresUpdate: true,
    }),
    true,
  );
});

test("a source already marked for reconnection is not collected with stale credentials", () => {
  assert.equal(canCollectBusinessDnaSource({ connected: true }), true);
  assert.equal(
    canCollectBusinessDnaSource({ connected: true, requiresUpdate: true }),
    false,
  );
  assert.equal(canCollectBusinessDnaSource({ connected: false }), false);
});

test("Meta collectors never put decrypted access tokens in query strings", () => {
  const facebook = collectorSource.slice(
    collectorSource.indexOf("async function collectFacebook"),
    collectorSource.indexOf("async function collectInstagram"),
  );
  const instagram = collectorSource.slice(
    collectorSource.indexOf("async function collectInstagram"),
    collectorSource.indexOf("async function collectLinkedIn"),
  );

  for (const source of [facebook, instagram]) {
    assert.doesNotMatch(source, /access_token\s*:\s*accessToken/);
    assert.match(source, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  }
});

test("optional social feed reads propagate authorization expiry to executeSource", () => {
  for (const collector of ["collectLinkedIn", "collectTiktok", "collectYoutube"] as const) {
    const start = collectorSource.indexOf(`async function ${collector}`);
    const next = collectorSource.indexOf("\nasync function ", start + 1);
    const source = collectorSource.slice(start, next === -1 ? undefined : next);
    assert.match(source, /catch \(error\)[\s\S]*isBusinessDnaReconnectError\(error\)[\s\S]*throw error/);
  }
});

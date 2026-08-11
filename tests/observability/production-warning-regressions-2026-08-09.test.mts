import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("le scanner IMAP utilise des UID pour la recherche et les deux fetch", () => {
  const scanner = read("lib/mailBounceScanner.ts");

  assert.match(scanner, /client\.search\([\s\S]*?\{ uid: true \},\s*\);/);
  assert.equal(
    (scanner.match(/client\.fetch\([\s\S]*?\{ uid: true \},\s*\)/g) || [])
      .length,
    2,
  );
  assert.doesNotMatch(scanner, /fetch\(pendingUids\.join\(","\)/);
});

test("les échecs IMAP répétés mettent en pause le scan sans couper l'envoi", () => {
  const scanner = read("lib/mailBounceScanner.ts");

  assert.match(scanner, /MAILBOX_SCAN_FAILURE_THRESHOLD = 3/);
  assert.match(scanner, /mailbox_feedback_scan_paused_until/);
  assert.match(scanner, /recordMailboxScanFailure/);
  assert.match(scanner, /feedback scan paused after repeated failures/);
  const pauseFunction = scanner.slice(
    scanner.indexOf("async function recordMailboxScanFailure"),
    scanner.indexOf("async function markMailboxReconnectRequired"),
  );
  assert.doesNotMatch(pauseFunction, /status:\s*"disconnected"/);
});

test("les PATCH optimistes observés ne demandent plus une réponse singulière", () => {
  for (const relativePath of [
    "app/api/booster/events/route.ts",
    "lib/boosterAsyncPublication.ts",
    "lib/mediaVideoNormalizationQueue.ts",
    "lib/mediaVideoNormalizationWorker.ts",
    "app/api/media-library/optimization/route.ts",
    "app/api/media-pipeline/workspace/prepare/route.ts",
    "app/api/media-pipeline/upload-event/route.ts",
    "app/api/media-pipeline/upload-intent/route.ts",
    "app/api/media-library/items/route.ts",
  ]) {
    const source = read(relativePath);
    for (const statement of source.split(";")) {
      if (!statement.includes(".update(")) continue;
      assert.doesNotMatch(
        statement,
        /\.select\([\s\S]*?\.(?:maybeSingle|single)\(\)/,
        relativePath,
      );
    }
  }
});

test("les objets Storage absents sont persistés comme références manquantes", () => {
  const route = read("app/api/media-pipeline/workspace/route.ts");
  const signing = read("lib/safeStorageSignedUrl.ts");
  const sql = read("ops/sql/2026-08-09_storage_registry_reconciliation.sql");

  assert.match(route, /probeStorageObject/);
  assert.ok(
    route.indexOf("probeStorageObject(params.bucket") <
      route.indexOf("createSafeStorageSignedUrl(\n      params.bucket"),
  );
  assert.match(signing, /rpc\(\s*"inrcy_storage_object_exists"/);
  assert.match(signing, /probeStorageObjectByListing/);
  assert.match(signing, /\.list\(folder,/);
  assert.doesNotMatch(signing, /storage\/v1\/object\/authenticated/);
  assert.equal((route.match(/if \(probe === "exists"\)/g) || []).length, 2);
  assert.equal((route.match(/if \(probe === "unknown"\) return null/g) || []).length, 2);
  assert.match(route, /STORAGE_OBJECT_MISSING_CODE/);
  assert.match(route, /\.eq\("status", "ready"\)/);
  assert.match(sql, /create or replace function public\.inrcy_storage_object_exists/);
  assert.match(sql, /grant execute[\s\S]*?to service_role/);
  assert.match(sql, /storage_object_missing/);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /drop\s+table\s+public\./i);
});

test("les webhooks Stripe orphelins restent traçables sans faux warning", () => {
  const stripe = read("app/api/stripe/webhook/route.ts");

  assert.match(stripe, /\.ilike\(column, exactIlikePattern\(cleaned\)\)/);
  assert.match(stripe, /eventId: typeof evt\.id === "string"/);
  assert.match(stripe, /Evenement Stripe sans compte iNrCy local/);
  assert.match(stripe, /if \(userId \|\| evt\.type === "checkout\.session\.completed"\)/);
});

test("les refus OAuth LinkedIn récupérables restent hors de Sentry", () => {
  const oauth = read("lib/observability/oauth.ts");

  assert.match(
    oauth,
    /unable to retrieve access token: appid\/redirect uri\/code verifier does not match authorization code/,
  );
  assert.match(oauth, /external member binding exists/);
});

test("les invitations évitent les appels Auth déjà connus comme doublons", () => {
  const helper = read("lib/supabaseAuthBusinessErrors.ts");
  const publicSignup = read("app/api/public/trial-signup/route.ts");
  const adminSignup = read("app/api/admin/create-trial/route.ts");

  assert.match(helper, /hasKnownInrcyAccountForEmail/);
  assert.match(helper, /user_already_exists/);
  assert.match(publicSignup, /hasKnownInrcyAccountForEmail\(payload\.email\)/);
  assert.match(adminSignup, /hasKnownInrcyAccountForEmail\(email\)/);
});

test("les robots recoivent un acces Storage prive frais sans mise en memoire Vercel", () => {
  const route = read("app/api/storage/content/route.ts");
  const urlBuilder = read("lib/storageContentUrl.ts");

  assert.match(urlBuilder, /export function buildAbsoluteStorageContentUrl/);
  assert.match(urlBuilder, /buildStorageContentUrl\(bucket, storagePath\)/);
  assert.match(route, /createSafeStorageSignedUrl\(/);
  assert.match(route, /status: 307/);
  assert.match(route, /Location: signedUrl/);
  assert.match(route, /export const HEAD = redirectToFreshStorageUrl/);
  assert.doesNotMatch(route, /\.download\(/);
  assert.doesNotMatch(route, /new Response\(download\.data/);
});

test("Booster publie des URLs permanentes et ne signe plus son bucket public", () => {
  const preparation = read(
    "app/api/booster/publish-now/publishNow.server-preparation.ts",
  );
  const inrsend = read("lib/inrsend/publicationChannelActions.ts");
  const agentExecute = read("app/api/agent/actions/execute/route.ts");
  const agentSchedule = read("app/api/agent/actions/schedule/route.ts");

  assert.match(preparation, /bucket === "booster" \? nativePublicUrl : null/);
  assert.match(
    preparation,
    /bucket === "booster"\s*\? null\s*:\s*await createSafeStorageSignedUrl/,
  );
  assert.match(preparation, /buildAbsoluteStorageContentUrl\(bucket, path\)/);
  assert.match(
    preparation,
    /\? urls\.deliveryUrl \|\| urls\.publicUrl \|\| publicUrl \|\| ""/,
  );
  assert.match(
    preparation,
    /: urls\.deliveryUrl \|\| publicUrl \|\| urls\.signedUrl \|\| ""/,
  );
  assert.doesNotMatch(inrsend, /createSafeStorageSignedUrl/);
  assert.match(
    inrsend,
    /storage\.from\("booster"\)\.getPublicUrl\(instagramPath\)/,
  );
  assert.match(
    inrsend,
    /storage\.from\("booster"\)\.getPublicUrl\(socialPath\)/,
  );
  assert.match(
    inrsend,
    /storage\.from\("booster"\)\.getPublicUrl\(sitePath\)/,
  );
  for (const agentRoute of [agentExecute, agentSchedule]) {
    assert.doesNotMatch(agentRoute, /createSafeStorageSignedUrl/);
    assert.match(agentRoute, /buildAbsoluteStorageContentUrl\(bucket, storagePath\)/);
    assert.match(agentRoute, /bucket === "booster"/);
    assert.match(agentRoute, /getPublicUrl\(storagePath\)/);
  }
});

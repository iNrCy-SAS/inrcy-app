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
  const sql = read("ops/sql/2026-08-09_storage_registry_reconciliation.sql");

  assert.match(route, /probeStorageObject/);
  assert.match(route, /STORAGE_OBJECT_MISSING_CODE/);
  assert.match(route, /\.eq\("status", "ready"\)/);
  assert.match(sql, /storage_object_missing/);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /drop\s+table\s+public\./i);
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

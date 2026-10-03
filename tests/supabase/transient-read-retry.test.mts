import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  runTransientPostgrestRead,
  shouldRetryPostgrestRead,
} from "../../lib/supabaseTransientRetry.ts";

const storageSource = readFileSync(
  new URL("../../lib/safeStorageSignedUrl.ts", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../../app/api/inrsend/history/route.ts", import.meta.url),
  "utf8",
);
const embedMediaSource = readFileSync(
  new URL("../../app/embed/actus/media/route.ts", import.meta.url),
  "utf8",
);
const crmCampaignsSource = readFileSync(
  new URL("../../lib/crmCampaigns.ts", import.meta.url),
  "utf8",
);

test("only network, 429 and 5xx PostgREST responses are retryable", () => {
  assert.equal(shouldRetryPostgrestRead({ data: null, error: new Error("server"), status: 500 }), true);
  assert.equal(shouldRetryPostgrestRead({ data: null, error: new Error("rate"), status: 429 }), true);
  assert.equal(shouldRetryPostgrestRead({ data: null, error: new Error("bad request"), status: 400 }), false);
  assert.equal(shouldRetryPostgrestRead({ data: null, error: null, status: 200 }), false);
});

test("a transient mail campaign read is retried once then succeeds", async () => {
  let calls = 0;
  const result = await runTransientPostgrestRead(async () => {
    calls += 1;
    if (calls === 1) return { data: null, error: new Error("temporary"), status: 500 };
    return { data: [{ id: "ok" }], error: null, status: 200 };
  }, { retries: 1, delaysMs: [0] });

  assert.equal(calls, 2);
  assert.deepEqual(result.data, [{ id: "ok" }]);
});

test("a deterministic 400 is not retried", async () => {
  let calls = 0;
  const result = await runTransientPostgrestRead(async () => {
    calls += 1;
    return { data: null, error: new Error("bad request"), status: 400 };
  }, { retries: 1, delaysMs: [0] });

  assert.equal(calls, 1);
  assert.equal(result.status, 400);
});

test("mail_campaigns history and worker reads use the bounded transient retry", () => {
  assert.match(historySource, /runTransientPostgrestRead<any\[]>\(\(\) => \{[\s\S]*from\("mail_campaigns"\)/);
  assert.match(crmCampaignsSource, /runTransientPostgrestRead<Record<string, unknown>\[]>\(\(\) => \{[\s\S]*select\("id,user_id,integration_id,provider,type,subject/);
});

test("missing Storage objects are negatively cached to stop repeated signing warnings", () => {
  assert.match(storageSource, /const missingObjectCache = new Map<string, number>\(\);/);
  assert.match(storageSource, /const MISSING_OBJECT_TTL_MS = 10 \* 60_000;/);
  assert.match(storageSource, /if \(isKnownMissingObject\(normalizedBucket, normalizedPath, now\)\) return null;/);
  assert.match(storageSource, /rememberMissingObject\(bucket, path\);/);
  assert.match(embedMediaSource, /status === 404[\s\S]*s-maxage=3600/);
});

test("embed media redirects expire before their signed Storage URLs", () => {
  const signedTtlSeconds = 60 * 60;
  const signingCacheSeconds = Math.min(signedTtlSeconds - 30, Math.floor(signedTtlSeconds * 0.8));
  const redirectCacheSeconds = 300;

  assert.match(embedMediaSource, /createSafeStorageSignedUrl\([\s\S]*?60 \* 60,/);
  assert.match(storageSource, /Math\.min\(ttlSeconds - 30, Math\.floor\(ttlSeconds \* 0\.8\)\)/);
  assert.match(embedMediaSource, /"cache-control": "private, max-age=300, must-revalidate"/);
  assert.ok(
    signingCacheSeconds + redirectCacheSeconds <= signedTtlSeconds - 300,
    "the oldest reused signed URL must retain at least five minutes of validity",
  );
});

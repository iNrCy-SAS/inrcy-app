import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildDeterministicPublicationChildId } from "../../lib/deterministicPublicationId.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const publishRoute = fs.readFileSync(
  path.resolve(testDir, "../../app/api/booster/publish-now/route.ts"),
  "utf8",
);

test("publication child ids are stable UUIDs across worker restarts", () => {
  const input = {
    publicationId: "d37e1497-735e-43dd-86f0-c2ee79c9170f",
    channel: "inrcy_site",
    resource: "site_article",
  };
  const first = buildDeterministicPublicationChildId(input);
  const restarted = buildDeterministicPublicationChildId({ ...input });
  assert.equal(first, restarted);
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("channels and resource kinds have independent idempotency scopes", () => {
  const base = {
    publicationId: "d37e1497-735e-43dd-86f0-c2ee79c9170f",
    channel: "inrcy_site",
    resource: "site_article",
  };
  assert.notEqual(
    buildDeterministicPublicationChildId(base),
    buildDeterministicPublicationChildId({ ...base, channel: "inr_search" }),
  );
  assert.notEqual(
    buildDeterministicPublicationChildId(base),
    buildDeterministicPublicationChildId({ ...base, resource: "history" }),
  );
});

test("empty idempotency dimensions fail closed", () => {
  assert.throws(
    () =>
      buildDeterministicPublicationChildId({
        publicationId: "",
        channel: "inrcy_site",
        resource: "site_article",
      }),
    /input_required/,
  );
});

test("site article creation is replay-safe in the channel worker", () => {
  assert.match(
    publishRoute,
    /buildDeterministicPublicationChildId\(\{[\s\S]*?publicationId,[\s\S]*?channel: ch,[\s\S]*?resource: "site_article"/,
  );
  assert.match(
    publishRoute,
    /\.from\("site_articles"\)[\s\S]*?\.upsert\([\s\S]*?\{ onConflict: "id" \}\)/,
  );
});

test("site article upserts always provide non-null media metadata", () => {
  assert.match(
    publishRoute,
    /media_metadata: Object\.keys\(siteMediaMetadata\)\.length\s*\?\s*siteMediaMetadata\s*:\s*\{\}/,
  );
});

test("Google Business ambiguous POST outcomes never enter a degraded retry", () => {
  assert.match(
    publishRoute,
    /catch \(gmbErr: unknown\) \{[\s\S]*?if \(isGoogleBusinessPostOutcomeUnknown\(gmbErr\)\) \{[\s\S]*?throw gmbErr/,
  );
  assert.match(publishRoute, /outcome_unknown: true, retryable: false/);
});

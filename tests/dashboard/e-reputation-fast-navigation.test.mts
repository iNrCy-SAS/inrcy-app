import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("E-reputation renders its shell without waiting for Google and hydrates from a browser snapshot", () => {
  const page = read("app/dashboard/e-reputation/page.tsx");
  const client = read("app/dashboard/e-reputation/EReputationReviewsClient.tsx");
  const snapshots = read("lib/browserModuleSnapshotCache.ts");

  assert.doesNotMatch(page, /force-dynamic|revalidate\s*=\s*0|getGmbToken|gmbListReviews|createSupabaseServer/);
  assert.match(client, /MODULE_SNAPSHOT_KEYS\.eReputationGoogle/);
  assert.match(client, /readModuleSnapshot/);
  assert.match(client, /backgroundRefreshRef/);
  assert.match(snapshots, /eReputationGoogle:\s*"e-reputation:google"/);
});

test("Google review details expose previous, next, counter and guarded close controls", () => {
  const client = read("app/dashboard/e-reputation/EReputationReviewsClient.tsx");
  const css = read("app/dashboard/e-reputation/eReputation.module.css");

  assert.match(client, /navigateReview\("previous"\)/);
  assert.match(client, /navigateReview\("next"\)/);
  assert.match(client, /detailPosition\.toLocaleString/);
  assert.match(client, /requestCloseDetails/);
  assert.match(client, /replyHasUnsavedChanges/);
  assert.match(client, />\s*×\s*</);
  assert.match(css, /\.reviewSequenceControls/);
  assert.match(css, /touch-action:\s*manipulation/);
});

test("les avis fictifs sont impossibles à confondre avec de vrais avis Google", () => {
  const client = read("app/dashboard/e-reputation/EReputationReviewsClient.tsx");
  const css = read("app/dashboard/e-reputation/eReputation.module.css");

  assert.match(client, /AVIS D’EXEMPLE/);
  assert.match(client, /Les lignes ci-dessous sont fictives/);
  assert.match(client, /Brancher Google/);
  assert.match(client, /!reviewsReady \? <span className=\{styles\.exampleBadge\}>EXEMPLE<\/span>/);
  assert.match(client, /exemples fictifs affichés/);
  assert.match(css, /\.previewNotice/);
  assert.match(css, /\.connectGoogleCta/);
  assert.match(css, /\.exampleBadge/);
});

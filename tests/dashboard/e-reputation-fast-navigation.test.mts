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

  assert.match(client, /i18nT\("avis_d_exemple_aucun_avis_google_a67550e6"\)/);
  assert.match(client, /i18nT\("les_lignes_ci_dessous_sont_fictives_a40db886"\)/);
  assert.match(client, /i18nT\("brancher_google_c497afba"\)/);
  assert.match(client, /!reviewsReady \? <span className=\{styles\.exampleBadge\}>\{i18nT\("exemple_396e7bd8"\)\}<\/span>/);
  assert.match(client, /i18nT\("value_exemples_fictifs_affiches_56447aa0"/);
  assert.match(css, /\.previewNotice/);
  assert.match(css, /\.connectGoogleCta/);
  assert.match(css, /\.exampleBadge/);
});

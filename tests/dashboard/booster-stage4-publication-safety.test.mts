import { withUiCopy } from "../helpers/localized-ui-source.mjs";
import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
const modalLayer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const resultModal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
const bottomNav = read("app/dashboard/_components/ResponsiveBottomNav.tsx");
const bottomNavCss = read("app/dashboard/_components/ResponsiveBottomNav.module.css");
const publishNowFoundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const publicationPolicy = read("lib/boosterPublicationPolicy.ts");
const mediaWorkspaceClient = read("lib/mediaWorkspaceClient.ts");
const publicationRetry = read("lib/publicationStorySequenceRetry.ts");

test("partial publishing retries only retryable failed channels and keeps the workspace", () => {
  assert.match(withUiCopy(submission), /const retryFailedChannels = resultEntries/);
  assert.match(withUiCopy(submission), /isRetryablePublicationEntry\(entry\)/);
  assert.match(withUiCopy(publicationRetry), /entry\.ok === false/);
  assert.match(withUiCopy(publicationRetry), /entry\.retryable === false/);
  assert.match(withUiCopy(submission), /const channels = \(retryPreviousSummary\.entries \|\| \[\]\)/);
  assert.match(withUiCopy(submission), /const retryPreviousSummary = latestPublicationSummaryRef\.current \|\| completedSummary/);
  assert.match(withUiCopy(submission), /filter\(isRetryablePublicationEntry\)/);
  assert.match(withUiCopy(submission), /if \(publicationComplete\) \{[\s\S]*archivePersistentMediaWorkspace/);
  assert.match(withUiCopy(submission), /options\?\.closeOnSuccess !== false && publicationAccepted/);
});

test("the result modal exposes a dedicated retry for failed channels", () => {
  assert.match(withUiCopy(modalLayer), /publishRetryFailedRef/);
  assert.match(withUiCopy(resultModal), /i18nT\("execution_result_retry", \{ count: retryableFailureCount \}\)/);
  const message = JSON.parse(read("messages/fr-FR/booster.json")).execution_result_retry;
  assert.equal(new IntlMessageFormat(message, "fr-FR").format({ count: 1 }), "Retenter 1 canal en échec");
  assert.equal(new IntlMessageFormat(message, "fr-FR").format({ count: 2 }), "Retenter 2 canaux en échec");
  assert.match(withUiCopy(resultModal), /onRetryFailed/);
});

test("manual publishing now goes through the idempotent mobile-safe transport", () => {
  assert.match(withUiCopy(modalLayer), /postBoosterPublication/);
  assert.match(withUiCopy(publishNowFoundations), /isBoosterPublishFailureRetryable/);
  assert.match(withUiCopy(publicationPolicy), /NON_RETRYABLE_BOOSTER_PUBLISH_CODES/);
  assert.match(withUiCopy(publishNowFoundations), /retryable,/);
});

test("the mobile menu publish button is disabled from real modal state, not URL only", () => {
  assert.match(withUiCopy(modalLayer), /inrcy:publish-modal-state/);
  assert.match(withUiCopy(bottomNav), /publishModalOpen \|\|/);
  assert.match(withUiCopy(bottomNav), /inrcy:publish-modal-state/);
  assert.match(withUiCopy(bottomNav), /option\.id === "publish" && \(publishActive \|\| adsWorkspaceActive\)/);
  assert.match(withUiCopy(bottomNav), /disabled=\{publicationUnavailable\}/);
  assert.match(withUiCopy(bottomNavCss), /\.shortcutItem:disabled/);
});


test("transient Pixel workspace reads get one safe retry and a precise user message", () => {
  assert.match(withUiCopy(mediaWorkspaceClient), /fetchWorkspaceSnapshotWithRetry/);
  assert.match(withUiCopy(mediaWorkspaceClient), /isMediaWorkspaceRetryableHttpStatus/);
  assert.match(withUiCopy(mediaWorkspaceClient), /isMediaWorkspaceRetryableFetchError/);
  assert.match(withUiCopy(submission), /Connexion interrompue pendant la préparation des médias/);
  assert.match(withUiCopy(submission), /vérifiez iNr’Send avant de relancer/);
});

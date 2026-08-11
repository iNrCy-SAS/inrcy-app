import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const modalLayer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const resultModal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
const bottomNav = read("app/dashboard/_components/ResponsiveBottomNav.tsx");
const bottomNavCss = read("app/dashboard/_components/ResponsiveBottomNav.module.css");
const publishNowFoundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const publicationPolicy = read("lib/boosterPublicationPolicy.ts");
const mediaWorkspaceClient = read("lib/mediaWorkspaceClient.ts");

test("partial publishing retries only retryable failed channels and keeps the workspace", () => {
  assert.match(publishModal, /const retryFailedChannels = resultEntries/);
  assert.match(publishModal, /entry\?\.ok === false/);
  assert.match(publishModal, /entry\?\.retryable !== false/);
  assert.match(publishModal, /channels: retryFailedChannels/);
  assert.match(publishModal, /if \(publicationComplete\) \{[\s\S]*archivePersistentMediaWorkspace/);
  assert.match(publishModal, /options\?\.closeOnSuccess !== false && publicationAccepted/);
});

test("the result modal exposes a dedicated retry for failed channels", () => {
  assert.match(modalLayer, /publishRetryFailedRef/);
  assert.match(resultModal, /Retenter \$\{retryableFailureCount\}/);
  assert.match(resultModal, /retryableFailureCount > 1 \? "canaux" : "canal"/);
  assert.match(resultModal, /onRetryFailed/);
});

test("manual publishing now goes through the idempotent mobile-safe transport", () => {
  assert.match(modalLayer, /postBoosterPublication/);
  assert.match(publishNowFoundations, /isBoosterPublishFailureRetryable/);
  assert.match(publicationPolicy, /NON_RETRYABLE_BOOSTER_PUBLISH_CODES/);
  assert.match(publishNowFoundations, /retryable,/);
});

test("the Google Pixel bottom publish button is disabled from real modal state, not URL only", () => {
  assert.match(modalLayer, /inrcy:publish-modal-state/);
  assert.match(bottomNav, /publishModalOpen \|\|/);
  assert.match(bottomNav, /inrcy:publish-modal-state/);
  assert.match(bottomNavCss, /\.publishItem:disabled \.publishButton/);
});


test("transient Pixel workspace reads get one safe retry and a precise user message", () => {
  assert.match(mediaWorkspaceClient, /fetchWorkspaceSnapshotWithRetry/);
  assert.match(mediaWorkspaceClient, /isMediaWorkspaceRetryableHttpStatus/);
  assert.match(mediaWorkspaceClient, /isMediaWorkspaceRetryableFetchError/);
  assert.match(publishModal, /Connexion interrompue pendant la préparation des médias/);
  assert.match(publishModal, /vérifiez iNr’Send avant de relancer/);
});

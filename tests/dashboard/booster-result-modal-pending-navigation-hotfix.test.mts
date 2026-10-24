import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const resultModal = read(
  "app/dashboard/_components/PublishExecutionResultModal.tsx",
);
const publicationStatuses = read("lib/boosterPublicationStatus.ts");
const boosterLayer = read(
  "app/dashboard/_components/DashboardBoosterModalLayer.tsx",
);

test("queued and processing channels are displayed as pending before the ok flag is evaluated", () => {
  assert.match(
    publicationStatuses,
    /"queued"[\s\S]*"preparing"[\s\S]*"dispatching"[\s\S]*"processing"[\s\S]*"finalizing"[\s\S]*"pending"/,
  );
  assert.match(resultModal, /return getPublicationDestinationStatus\(entry\) === "pending"/);
  assert.match(
    resultModal,
    /const semanticStatusIcon = entryIsSkipped[\s\S]*?: entryIsPending[\s\S]*?\? "⏳"[\s\S]*?: entryIsFailed/,
  );
  assert.match(
    resultModal,
    /const accessibleStatusLabel = entryIsSkipped[\s\S]*?: entryIsPending[\s\S]*?\? "En attente"[\s\S]*?: entryIsFailed/,
  );
  assert.match(resultModal, /const visibleError = !entryIsPending && entry\.error/);
});

test("opening iNrSend does not call the dashboard close handler that resets the URL", () => {
  const handler = boosterLayer.match(
    /onOpenInrSend: \(\) => \{([\s\S]*?)router\.push\("\/dashboard\/mails\?folder=publications"\);([\s\S]*?)\},/,
  );

  assert.ok(handler, "the iNrSend navigation handler must exist");
  assert.doesNotMatch(handler[1], /closePublishModal\(\)/);
  assert.match(handler[1], /setPublishHasUnsavedChanges\(false\)/);
  assert.match(handler[1], /publishRetryFailedRef\.current = null/);
});

test("the integrated publication result shares the Booster close handler and clears result state", () => {
  assert.match(
    boosterLayer,
    /const closePublishModal = useCallback\(\(\) => \{[\s\S]*?setPublishSuccessOpen\(false\);[\s\S]*?setPublishSummary\(null\);[\s\S]*?setPublishEditorOverlayOpen\(false\);[\s\S]*?setPublishHasUnsavedChanges\(false\);[\s\S]*?publishRetryFailedRef\.current = null;[\s\S]*?onClose\(\);/,
  );
  assert.match(boosterLayer, /<PublishModal[\s\S]*?onClose=\{closePublishModal\}[\s\S]*?publicationResult=\{publishSuccessOpen \? \{\s*summary: publishSummary/);
  assert.doesNotMatch(boosterLayer, /<PublishExecutionResultModal\b/);
});

test("the standalone result X stays outside the scroll surface and handles pointer-down plus keyboard click", () => {
  assert.match(resultModal, /className=\{resultCss\.shell\}[^>]*>\s*\{closeButton\}/);
  assert.match(resultModal, /onPointerDown=\{handleClosePointerDown\}/);
  assert.match(resultModal, /onClick=\{handleCloseClick\}/);
  assert.match(resultModal, /data-testid="publish-result-close"/);
  assert.match(resultModal, /className=\{resultCss\.closeButton\}/);
  assert.match(resultModal, /className=\{resultCss\.scrollSurface\}/);
});

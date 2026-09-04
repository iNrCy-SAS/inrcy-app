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
  assert.match(
    resultModal,
    /isBoosterPublicationPendingStatus\(technicalStatus\)/,
  );
  assert.match(
    resultModal,
    /entry\.status === "skipped"[\s\S]*?: entryIsPending[\s\S]*?\? "⏳"[\s\S]*?: entry\.ok/,
  );
  assert.match(
    resultModal,
    /entryIsPending[\s\S]*?\? "En attente"[\s\S]*?: entry\.ok/,
  );
  assert.match(resultModal, /const visibleError = !entryIsPending && entry\.error/);
});

test("opening iNrSend does not call the dashboard close handler that resets the URL", () => {
  const handler = boosterLayer.match(
    /onOpenInrSend=\{\(\) => \{([\s\S]*?)router\.push\("\/dashboard\/mails\?folder=publications"\);([\s\S]*?)\}\}/,
  );

  assert.ok(handler, "the iNrSend navigation handler must exist");
  assert.doesNotMatch(handler[1], /closePublishModal\(\)/);
  assert.match(handler[1], /setPublishHasUnsavedChanges\(false\)/);
  assert.match(handler[1], /publishRetryFailedRef\.current = null/);
});

test("closing the publication result also clears the Booster publish layer", () => {
  assert.match(
    boosterLayer,
    /const closePublishSuccess = useCallback\(\(\) => \{[\s\S]*?setPublishSuccessOpen\(false\);[\s\S]*?setPublishSummary\(null\);[\s\S]*?setPublishEditorOverlayOpen\(false\);[\s\S]*?setPublishHasUnsavedChanges\(false\);[\s\S]*?closePublishModal\(\);/,
  );
  assert.match(boosterLayer, /summary=\{publishSummary\}[\s\S]*?onClose=\{closePublishSuccess\}/);
});

test("the result X stays outside the scroll surface and handles pointer-down plus keyboard click", () => {
  assert.match(resultModal, /className=\{styles\.publishResultDialogShell\}/);
  assert.match(resultModal, /onPointerDown=\{handleClosePointerDown\}/);
  assert.match(resultModal, /onClick=\{handleCloseClick\}/);
  assert.match(resultModal, /data-testid="publish-result-close"/);
  assert.match(resultModal, /publishResultCloseButton/);
  assert.match(resultModal, /publishResultScrollCard/);
});

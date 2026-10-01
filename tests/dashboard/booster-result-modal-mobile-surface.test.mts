import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const resultModal = read(
  "app/dashboard/_components/PublishExecutionResultModal.tsx",
);
const dashboardStyles = read("app/dashboard/dashboard.module.css");

test("the Booster publication summary keeps an opaque scroll surface through the iNrSend CTA on phone viewports", () => {
  const resultCardStart = resultModal.indexOf(
    "styles.publishResultScrollCard",
  );
  const inrSendCta = resultModal.indexOf(
    'i18nT("voir_dans_inr_send_a74cc9ea")',
    resultCardStart,
  );

  assert.ok(resultCardStart >= 0, "publication result scroll card is missing");
  assert.ok(
    inrSendCta > resultCardStart,
    "the iNrSend CTA must remain inside the publication result surface",
  );
  assert.match(
    resultModal.slice(resultCardStart, inrSendCta),
    /maxHeight:[\s\S]*?100dvh[\s\S]*?overflowY: "auto"[\s\S]*?background:[\s\S]*?linear-gradient/,
  );

  const mobileDocumentScrollRule = dashboardStyles.indexOf(
    ".page,\n  .blockCard {\n    overflow-x: clip !important;\n    overflow-y: visible !important;",
  );
  const mobileResultOverride = dashboardStyles.indexOf(
    ".publishResultScrollCard {",
    mobileDocumentScrollRule,
  );

  assert.ok(
    mobileDocumentScrollRule >= 0,
    "the phone document-scroll rule must stay covered by this regression test",
  );
  assert.ok(
    mobileResultOverride > mobileDocumentScrollRule,
    "the result surface override must follow the generic mobile blockCard rule",
  );

  const resultOverride = dashboardStyles.slice(
    mobileResultOverride,
    dashboardStyles.indexOf("}", mobileResultOverride) + 1,
  );
  assert.match(resultOverride, /overflow-x: hidden !important/);
  assert.match(resultOverride, /overflow-y: auto !important/);
  assert.match(resultOverride, /overscroll-behavior: contain/);
});

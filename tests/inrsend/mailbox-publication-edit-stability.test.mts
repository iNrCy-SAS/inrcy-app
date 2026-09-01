import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mailbox = readFileSync(
  new URL("../../app/dashboard/mails/MailboxClient.tsx", import.meta.url),
  "utf8",
);
const detailsModal = readFileSync(
  new URL(
    "../../app/dashboard/mails/_components/MailboxDetailsModal.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("iNrSend keeps publication edit mode open during background history refreshes", () => {
  const formHydrationMarker = "const parts = activeDetailsChannelEntry?.parts || {};";
  const formHydrationMarkerIndex = mailbox.indexOf(formHydrationMarker);
  assert.notEqual(formHydrationMarkerIndex, -1);

  const formHydrationStart = mailbox.lastIndexOf(
    "useEffect(() => {",
    formHydrationMarkerIndex,
  );
  const formHydrationEnd = mailbox.indexOf(
    "useEffect(() => {",
    formHydrationMarkerIndex + formHydrationMarker.length,
  );
  const formHydrationEffect = mailbox.slice(
    formHydrationStart,
    formHydrationEnd,
  );

  assert.match(formHydrationEffect, /detailsEditMode\s*\)\s*return;/);
  assert.doesNotMatch(formHydrationEffect, /setDetailsEditMode\(false\)/);
  assert.match(
    detailsModal,
    /setPublicationEditDirty\(false\);\s*setDetailsEditMode\(true\)/,
  );
});

test("background refreshes cannot overwrite image or video edits in progress", () => {
  const guardedHydrationEffects = mailbox.match(
    /detailsItem\.source !== "app_events" \|\|\s*detailsEditMode/g,
  );

  assert.ok(
    (guardedHydrationEffects?.length || 0) >= 3,
    "the form, image and video hydration effects must all pause during editing",
  );
});

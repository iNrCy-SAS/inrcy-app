import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/dashboard/mails/_components/MailboxDetailsModal.tsx", import.meta.url),
  "utf8",
);

test("iNrSend details load the account or page URL for the active publication channel", () => {
  assert.match(source, /\/api\/booster\/connected-channels/);
  assert.match(source, /activeChannelAccountHref/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /ouvrir_le_compte_72c79948/);
  assert.match(source, /open_page/);
  assert.match(source, /open_listing/);
  assert.match(source, /open_channel/);
});

test("iNrSend details expose and refresh the live status of each selected channel", () => {
  assert.match(source, /\/api\/booster\/publications\/\$\{encodeURIComponent\(requestedPublicationId\)\}\/status/);
  assert.match(source, /i18nT\("statut_b20e7fc2"\)/);
  assert.match(source, /i18nT\("actualiser_le_statut_47041c70"\)/);
  assert.match(source, /shouldPollPublicationStatus/);
});

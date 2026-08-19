import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

const foundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const publishRoute = read("app/api/booster/publish-now/route.ts");
const mailboxPhase = read("app/dashboard/mails/_lib/mailboxPhase1.tsx");
const mailboxClient = read("app/dashboard/mails/MailboxClient.tsx");
const detailsModal = read(
  "app/dashboard/mails/_components/MailboxDetailsModal.tsx",
);

test("iNrSend image snapshots always resolve the reusable original", () => {
  assert.match(
    foundations,
    /export function buildOriginalImageAttachments\(/,
  );
  assert.match(
    foundations,
    /attachment\.originalPublicUrl\s*\|\|\s*attachment\.originalUrl\s*\|\|\s*attachment\.publicUrl/,
  );
  assert.match(foundations, /renderedUrl:\s*originalUrl/);
  assert.match(foundations, /transform:\s*null/);
  assert.match(foundations, /isCustomized:\s*false/);
});

test("channel history stores the original video and original image attachments", () => {
  assert.match(
    publishRoute,
    /const originalVideo\s*=\s*publicationVideo\s*\|\|\s*channelPersistedVideo\?\.sourceVideo\s*\|\|\s*channelPersistedVideo/,
  );
  assert.match(publishRoute, /attachments:\s*\[originalVideo\]/);
  assert.match(
    publishRoute,
    /const getOriginalImagesForChannel\s*=\s*\(channel: ChannelKey\)\s*=>\s*buildOriginalImageAttachments/,
  );
  assert.match(
    publishRoute,
    /attachments:\s*persistedVideo\s*\?\s*\[persistedVideo\]\s*:\s*originalPublicationImageAttachments/,
  );
});

test("old async payloads with empty image arrays still fall back to the root video", () => {
  assert.match(
    mailboxPhase,
    /if \(Array\.isArray\(value\)\) return value\.length > 0/,
  );
  assert.match(
    mailboxPhase,
    /hasAttachmentFields\(channelPayload\)\s*\|\|\s*channelParts\.mediaMode\s*===\s*"none"/,
  );
  assert.match(
    mailboxPhase,
    /const originalUrl\s*=\s*a\.originalUrl\s*\|\|\s*a\.original_url\s*\|\|\s*a\.originalPublicUrl/,
  );
  assert.match(mailboxPhase, /renderedUrl:\s*hasReusableOriginal \? url/);
  assert.match(mailboxPhase, /transform:\s*hasReusableOriginal \? null/);
});

test("a successful delete updates the visible iNrSend payload immediately", () => {
  assert.match(mailboxClient, /const deletedPayload\s*=/);
  assert.match(mailboxClient, /setItems\(\(current\)\s*=>/);
  assert.match(mailboxClient, /payload:\s*deletedPayload/);
  assert.match(detailsModal, /media_source_original_conserve_pour_value_19606662/);
  assert.match(detailsModal, /ce_detail_affiche_l_original_reutilisable_5ffe24c1/);
});

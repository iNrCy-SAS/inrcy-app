import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function occurrences(source: string, fragment: string) {
  return source.split(fragment).length - 1;
}

const resultModal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
const detailsModal = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
const mailboxClient = read("app/dashboard/mails/MailboxClient.tsx");
const historyController = read("app/dashboard/mails/_hooks/useMailboxHistory.ts");
const tiktokStatusRoute = read(
  "app/api/inrsend/publications/[publicationId]/tiktok/status/route.ts",
);

test("publication result polling sleeps with the tab and resumes immediately", () => {
  assert.equal(
    occurrences(resultModal, 'document.addEventListener("visibilitychange"'),
    2,
  );
  assert.equal(
    occurrences(resultModal, 'document.removeEventListener("visibilitychange"'),
    2,
  );
  assert.ok(occurrences(resultModal, "schedule(0)") >= 2);
  assert.match(resultModal, /if \(cancelled \|\| document\.hidden\) return;/);
  assert.match(resultModal, /if \(document\.hidden\) \{\s*clearTimer\(\);/);
  assert.match(resultModal, /api\/booster\/publications/);
  assert.match(resultModal, /api\/inrsend\/publications/);
});

test("iNrSend publication and TikTok details polling sleeps with the tab", () => {
  assert.equal(
    occurrences(detailsModal, 'document.addEventListener("visibilitychange"'),
    2,
  );
  assert.equal(
    occurrences(detailsModal, 'document.removeEventListener("visibilitychange"'),
    2,
  );
  assert.ok(occurrences(detailsModal, "schedule(0)") >= 2);
  assert.match(detailsModal, /if \(cancelled \|\| document\.hidden\) return;/);
  assert.match(detailsModal, /if \(document\.hidden\) \{\s*clearTimer\(\);/);
  assert.match(detailsModal, /refreshPublicationStatus\(true\)/);
  assert.match(detailsModal, /tiktokAutoPollInFlightRef/);
});

test("iNrSend campaign tracking no longer owns a hidden-tab interval", () => {
  assert.doesNotMatch(mailboxClient, /window\.setInterval/);
  assert.doesNotMatch(historyController, /window\.setInterval/);
  assert.equal(
    occurrences(mailboxClient, 'document.addEventListener("visibilitychange"') +
      occurrences(historyController, 'document.addEventListener("visibilitychange"'),
    2,
  );
  assert.equal(
    occurrences(mailboxClient, 'document.removeEventListener("visibilitychange"') +
      occurrences(historyController, 'document.removeEventListener("visibilitychange"'),
    2,
  );
  assert.match(mailboxClient, /if \(cancelled \|\| document\.hidden\) return;/);
  assert.match(mailboxClient, /if \(document\.hidden\) \{\s*clearTimer\(\);/);
  assert.match(mailboxClient, /schedule\(0\)/);
  assert.match(mailboxClient, /schedule\(120_000\)/);
});

test("visibility only suspends browser reads and preserves durable TikTok finalization", () => {
  assert.match(tiktokStatusRoute, /updateAsyncChannelEvent\(/);
  assert.match(tiktokStatusRoute, /finalizeAsyncPublicationIfReady\(/);
  assert.match(tiktokStatusRoute, /persistTerminalParentTiktokResult/);
  assert.doesNotMatch(resultModal, /cancel_pending/);
  assert.doesNotMatch(mailboxClient, /cancel_pending/);
});

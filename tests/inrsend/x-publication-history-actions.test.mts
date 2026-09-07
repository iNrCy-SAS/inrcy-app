import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("iNrSend recognizes X as a first-class publication channel", () => {
  const foundations = read("app/dashboard/mails/_lib/mailboxPhase1.tsx");
  assert.match(foundations, /case "twitter":\s*return "x"/);
  assert.match(foundations, /case "x":\s*return "X"/);
  assert.match(foundations, /"linkedin", "x", "tiktok"/);
  assert.match(foundations, /x:\s*\{ width: 1200, height: 675/);
});

test("iNrSend exposes a guarded X delete route without pretending to edit posts", () => {
  const actions = read("lib/inrsend/publicationChannelActions.ts");
  const route = read("app/api/inrsend/publications/[publicationId]/x/route.ts");

  assert.match(route, /createPublicationChannelHandlers\("x"\)/);
  assert.match(actions, /getXAccessToken\(\{ userId \}\)/);
  assert.match(actions, /deleteXPost\(\{ accessToken: auth\.accessToken, postId: previousExternalId \}\)/);
  assert.match(actions, /code: "x_edit_unsupported"/);
  assert.match(actions, /Supprimez-la puis republiez-la depuis Booster/);
});

test("iNrSend links X accounts and delivered posts", () => {
  const details = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
  assert.match(details, /channel === "x"[^\n]+https:\/\/x\.com/);
  assert.match(details, /const xDirectPublicationHref = isXPublicationEntry/);
  assert.match(details, /activePublicationResult\?\.external_url/);
  assert.match(details, /title="Ouvrir la publication X"/);
});

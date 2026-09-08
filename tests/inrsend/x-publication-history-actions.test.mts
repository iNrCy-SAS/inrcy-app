import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("iNrSend recognizes X as a first-class publication channel", () => {
  const foundations = read("app/dashboard/mails/_lib/mailboxPhase1.tsx");
  assert.match(foundations, /case "twitter":\s*return "x"/);
  assert.match(foundations, /case "x":\s*return "X"/);
  assert.match(
    foundations,
    /const priority = \[[^\]]*"pinterest", "x"\]/,
  );
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

test("iNrSend refuses X URLs before saving while keeping the error user-facing", () => {
  const actions = read("lib/inrsend/publicationChannelActions.ts");
  const client = read("app/dashboard/mails/MailboxClient.tsx");
  const details = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");

  assert.match(actions, /validateXUrlFreeText/);
  assert.match(actions, /code:\s*xUrlValidation\.code/);
  assert.ok(
    actions.indexOf("validateXUrlFreeText") <
      actions.indexOf('code: "x_edit_unsupported"'),
  );
  assert.match(client, /normalizedChannel === "x"[\s\S]*?containsForbiddenXUrl/);
  assert.match(client, /setDetailsActionError\(X_FORBIDDEN_URL_ERROR\)/);
  assert.match(details, /publicationEditHasForbiddenXUrl/);
  assert.match(details, /role="alert"[\s\S]*?X_FORBIDDEN_URL_ERROR/);
  assert.match(
    details,
    /detailsActionBusy \|\|\s*publicationEditHasForbiddenXUrl/,
  );
});

test("iNrSend links X accounts and delivered posts", () => {
  const details = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
  assert.match(details, /channel === "x"[^\n]+https:\/\/x\.com/);
  assert.match(details, /const xDirectPublicationHref = isXPublicationEntry/);
  assert.match(details, /activePublicationResult\?\.external_url/);
  assert.match(details, /title="Ouvrir la publication X"/);
});

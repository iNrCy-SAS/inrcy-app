import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_DNA_RECENT_NEWS_DAYS,
  buildBusinessDnaRecentWindow,
  businessDnaPublicationTimestamp,
  isBusinessDnaPublicationInWindow,
} from "../../lib/businessDnaRecentNews.ts";

test("the recent-news window covers exactly the latest 30 days", () => {
  const now = new Date("2026-09-07T12:30:00.000Z");
  const window = buildBusinessDnaRecentWindow(now);

  assert.equal(BUSINESS_DNA_RECENT_NEWS_DAYS, 30);
  assert.equal(window.end, "2026-09-07T12:30:00.000Z");
  assert.equal(window.start, "2026-08-08T12:30:00.000Z");
  assert.equal(isBusinessDnaPublicationInWindow(window.start, window), true);
  assert.equal(isBusinessDnaPublicationInWindow(window.end, window), true);
  assert.equal(
    isBusinessDnaPublicationInWindow("2026-08-08T12:29:59.999Z", window),
    false,
  );
});

test("publication timestamps accept API seconds and milliseconds safely", () => {
  const instant = Date.parse("2026-09-01T10:00:00.000Z");

  assert.equal(businessDnaPublicationTimestamp(instant), instant);
  assert.equal(businessDnaPublicationTimestamp(instant / 1_000), instant);
  assert.equal(businessDnaPublicationTimestamp(String(instant / 1_000)), instant);
  assert.equal(businessDnaPublicationTimestamp("not-a-date"), null);
  assert.equal(businessDnaPublicationTimestamp(""), null);
});

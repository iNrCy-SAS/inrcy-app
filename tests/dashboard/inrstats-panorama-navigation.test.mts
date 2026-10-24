import assert from "node:assert/strict";
import test from "node:test";
import { adjacentStatsPage, buildStatsNavigationPages, statsSwipeDirection } from "../../app/dashboard/stats/stats.navigation.ts";

const pages = buildStatsNavigationPages([{ key: "inrbadge", title: "iNr’Badge" }, { key: "site_web", title: "Site Web" }], "Vue globale");

test("global is the first page of the same circular channel journey", () => {
  assert.deepEqual(pages.map(page => page.key), ["all", "inrbadge", "site_web"]);
  assert.equal(adjacentStatsPage(pages, "all", 1).key, "inrbadge");
  assert.equal(adjacentStatsPage(pages, "inrbadge", -1).key, "all");
  assert.equal(adjacentStatsPage(pages, "site_web", 1).key, "all");
  assert.equal(adjacentStatsPage(pages, "all", -1).key, "site_web");
});

test("only available channel pages enter the journey and empty data retains the overview", () => {
  assert.ok(!pages.some(page => page.key === "mails"));
  assert.deepEqual(buildStatsNavigationPages([], "Global"), [{ key: "all", title: "Global" }]);
  assert.equal(adjacentStatsPage([], "all", 1).key, "all");
  assert.equal(adjacentStatsPage(pages, "facebook", 1).key, "inrbadge");
});

test("swipe distinguishes intentional horizontal gestures from scrolling and taps", () => {
  const start = { x: 200, y: 100 };
  assert.equal(statsSwipeDirection(start, { x: 100, y: 112 }), 1);
  assert.equal(statsSwipeDirection(start, { x: 300, y: 80 }), -1);
  assert.equal(statsSwipeDirection(start, { x: 150, y: 100 }), null);
  assert.equal(statsSwipeDirection(start, { x: 100, y: 190 }), null);
  assert.equal(statsSwipeDirection(start, { x: Number.NaN, y: 100 }), null);
});

test("Evolution is a distinct shortcut and carousel page when enabled", () => {
  const journey = buildStatsNavigationPages([{ key: "site_web", title: "Site Web" }], "Global", {}, "Evolution");
  assert.deepEqual(journey.map(page => page.key), ["all", "evolution", "site_web"]);
  assert.equal(adjacentStatsPage(journey, "all", 1).key, "evolution");
  assert.equal(adjacentStatsPage(journey, "evolution", 1).key, "site_web");
});

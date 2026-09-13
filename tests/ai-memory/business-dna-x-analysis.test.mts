import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../lib/businessDnaChannelAnalysis.ts", import.meta.url),
  "utf8",
);

test("Business DNA reads a bounded one-year X timeline with the connected user token", () => {
  assert.match(source, /async function collectX\([\s\S]*?historyWindow: BusinessDnaRecentWindow,[\s\S]*?recentWindow: BusinessDnaRecentWindow/);
  assert.match(source, /getXAccessToken\(\{ userId \}\)/);
  assert.match(source, /max_results: "100"/);
  assert.match(source, /start_time: historyWindow\.start/);
  assert.match(source, /end_time: historyWindow\.end/);
  assert.match(source, /exclude: "retweets,replies"/);
  assert.match(source, /isBusinessDnaPublicationInWindow\(tweet\.publishedAt, historyWindow\)/);
  assert.match(source, /recentTweetCount/);
});

test("X participates in the shared DNA source collection and context budget", () => {
  assert.match(source, /key: "x",\s*label: "X"/);
  assert.match(source, /connected: states\.x\.connected/);
  assert.match(source, /requiresUpdate: states\.x\.requiresUpdate/);
  assert.match(source, /collect: async \(\) => collectX\(args\.userId, historyWindow, recentWindow\)/);
});

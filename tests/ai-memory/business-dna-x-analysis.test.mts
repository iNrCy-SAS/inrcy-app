import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../lib/businessDnaChannelAnalysis.ts", import.meta.url),
  "utf8",
);

test("Business DNA reads a bounded 30-day X timeline with the connected user token", () => {
  assert.match(source, /async function collectX\(userId: string, recentWindow: BusinessDnaRecentWindow\)/);
  assert.match(source, /getXAccessToken\(\{ userId \}\)/);
  assert.match(source, /max_results: "20"/);
  assert.match(source, /start_time: recentWindow\.start/);
  assert.match(source, /end_time: recentWindow\.end/);
  assert.match(source, /exclude: "retweets,replies"/);
  assert.match(source, /isBusinessDnaPublicationInWindow\(tweet\.publishedAt, recentWindow\)/);
});

test("X participates in the shared DNA source collection and context budget", () => {
  assert.match(source, /key: "x",\s*label: "X"/);
  assert.match(source, /connected: states\.x\.connected/);
  assert.match(source, /requiresUpdate: states\.x\.requiresUpdate/);
  assert.match(source, /collect: async \(\) => collectX\(args\.userId, recentWindow\)/);
});

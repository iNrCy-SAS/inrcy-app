import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBusinessDnaAnalysisSourcePayload,
  hasReadableBusinessDnaAnalysisSource,
} from "../../lib/businessDnaSourceBudget.ts";

const SOURCE_KEYS = [
  "website",
  "google_business",
  "inr_search",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "tiktok",
  "pinterest",
];

test("the serialized multichannel payload never exceeds its exact character budget", () => {
  const sources = SOURCE_KEYS.map((key, index) => ({
    key,
    label: `Canal ${index}`,
    status: "analyzed",
    content: `${key}\n${JSON.stringify({ description: "x".repeat(8_000) })}`,
  }));
  const payload = buildBusinessDnaAnalysisSourcePayload(sources, 24_000);

  assert.ok(JSON.stringify(payload).length <= 24_000);
  assert.equal(payload.length, SOURCE_KEYS.length);
  assert.ok(payload.every((source) => source.content.length > 100));
});

test("every readable connected channel receives context before priority expansion", () => {
  const sources = SOURCE_KEYS.map((key) => ({
    key,
    label: key,
    status: "analyzed",
    content: key.repeat(4_000),
  }));
  sources.push({ key: "ignored", label: "ignored", status: "failed", content: "secret" });
  const payload = buildBusinessDnaAnalysisSourcePayload(sources, 12_000);

  assert.equal(payload.length, SOURCE_KEYS.length);
  assert.ok(payload.every((source) => source.content.length > 0));
  assert.ok(!payload.some((source) => source.source === "ignored"));
  assert.ok(payload[0].content.length > payload.at(-1)!.content.length);
});

test("one readable channel lets the global analysis continue when others are empty or down", () => {
  const sources = [
    { key: "website", label: "Site", status: "failed", content: "" },
    { key: "instagram", label: "Instagram", status: "analyzed", content: "" },
    { key: "google_business", label: "Google Business", status: "analyzed", content: "Services et avis lisibles" },
    { key: "facebook", label: "Facebook", status: "needs_reconnect", content: "" },
  ];

  assert.equal(hasReadableBusinessDnaAnalysisSource(sources), true);
  assert.deepEqual(
    buildBusinessDnaAnalysisSourcePayload(sources, 4_000).map((source) => source.source),
    ["google_business"],
  );
});

test("global analysis stops only when no channel yielded usable content", () => {
  assert.equal(hasReadableBusinessDnaAnalysisSource([
    { key: "website", label: "Site", status: "failed", content: "" },
    { key: "instagram", label: "Instagram", status: "analyzed", content: "   " },
  ]), false);
});

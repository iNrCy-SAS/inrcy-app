import assert from "node:assert/strict";
import test from "node:test";
import { tikTokLocationPickerRows } from "../lib/adsTikTokLocationSelection.ts";
import { TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, type TikTokAdsGeoTarget } from "../lib/adsTikTokResources.ts";

const accountId = "1234567890123";
const lille: TikTokAdsGeoTarget = { id: "59123", name: "Lille", countryCode: "FR", level: "CITY", parentId: "32001", areaType: "ADMIN", path: ["Hauts-de-France", "France"] };
const france: TikTokAdsGeoTarget = { id: "250", name: "France", countryCode: "FR", level: "COUNTRY", parentId: "0", areaType: "ADMIN", path: [] };
function response(resolutions: unknown[]) {
  return { selectedAccountId: accountId, publicationEnabled: false, context: structuredClone(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT), resolutions };
}
function resolved(query = "Lille", target: unknown = lille, candidates: unknown[] = [lille]) {
  return { query, status: "resolved", target, candidates };
}

test("TikTok location selection binds the exact advertiser and manual Traffic context", () => {
  const valid = response([resolved()]);
  for (const invalid of [
    null, {}, { ...valid, selectedAccountId: "9876543210987" },
    { ...valid, publicationEnabled: true }, { ...valid, publicationEnabled: undefined },
    { ...valid, context: { ...valid.context, objectiveType: "CONVERSIONS" } },
    { ...valid, context: { ...valid.context, placements: ["PLACEMENT_PANGLE"] } },
    { ...valid, context: { ...valid.context, language: "en" } },
    { ...valid, context: { ...valid.context, levelRange: "TO_DISTRICT" } },
  ]) assert.throws(() => tikTokLocationPickerRows(invalid, accountId, ["Lille"]));
});

test("TikTok selects only a resolved exact native candidate and preserves requested row order", () => {
  const result = tikTokLocationPickerRows(response([resolved("France", france, [france]), resolved()]), accountId, ["Lille", "France"]);
  assert.deepEqual(result, [
    { query: "Lille", options: [lille], selected: lille },
    { query: "France", options: [france], selected: france },
  ]);
});

test("Ambiguous and partial native suggestions remain available without automatic selection", () => {
  const otherLille = { ...lille, id: "59222", parentId: "33001", path: ["Autre province", "France"] };
  const result = tikTokLocationPickerRows(response([
    { query: "Lille", status: "ambiguous", target: null, candidates: [lille, otherLille] },
    { query: "Lil", status: "not_found", target: null, candidates: [lille] },
    { query: "Zone inconnue", status: "not_found", target: null, candidates: [] },
  ]), accountId, ["Lille", "Lil", "Zone inconnue"]);
  assert.deepEqual(result.map((row) => row.selected), [null, null, null]);
  assert.equal(result[0].options.length, 2);
  assert.deepEqual(result[1].options, [lille]);
  assert.deepEqual(result[2].options, []);
});

test("A provider-selected target must match an entire native candidate, including its ancestors", () => {
  for (const target of [france, { ...lille, name: "Autre Lille" }, { ...lille, countryCode: "BE" }, { ...lille, parentId: "99999" }, { ...lille, path: ["Autre province", "France"] }]) {
    assert.throws(() => tikTokLocationPickerRows(response([resolved("Lille", target)]), accountId, ["Lille"]));
  }
  for (const status of ["ambiguous", "not_found"]) {
    assert.throws(() => tikTokLocationPickerRows(response([{ ...resolved(), status }]), accountId, ["Lille"]));
  }
});

test("Incomplete, unrelated or duplicated resolution rows cannot satisfy the original request", () => {
  for (const resolutions of [[], [resolved("Paris")], [resolved(), resolved()], [resolved(), resolved("Paris")], [{ ...resolved(), candidates: null }], [{ ...resolved(), status: "partial" }]]) {
    assert.throws(() => tikTokLocationPickerRows(response(resolutions), accountId, ["Lille"]));
  }
  assert.throws(() => tikTokLocationPickerRows(response([resolved(), resolved()]), accountId, ["Lille", "France"]));
  assert.throws(() => tikTokLocationPickerRows(response([resolved()]), accountId, ["Lille", "France"]));
});

test("Malformed native IDs and unvalidated target metadata are rejected, even when marked resolved", () => {
  for (const patch of [
    { id: 59123 }, { id: "0" }, { id: "0000" }, { id: "59123<script>" }, { id: "1".repeat(31) },
    { name: " " }, { name: "x".repeat(181) }, { countryCode: "fr" }, { countryCode: "FRA" },
    { parentId: "unsafe" }, { level: "DISTRICT" }, { areaType: "UNKNOWN" }, { path: "France" },
    { path: [""] }, { path: ["x".repeat(181)] }, { path: Array(13).fill("France") },
  ]) {
    const malformed = { ...lille, ...patch };
    assert.throws(() => tikTokLocationPickerRows(response([resolved("Lille", malformed, [malformed])]), accountId, ["Lille"]));
  }
});

test("Duplicate native candidate IDs are rejected rather than silently deduplicated or chosen", () => {
  for (const candidates of [[lille, lille], [lille, { ...lille, name: "Autre ville" }]]) {
    assert.throws(() => tikTokLocationPickerRows(response([resolved("Lille", lille, candidates)]), accountId, ["Lille"]));
  }
});

test("Selection rejects oversized responses and accepts an explicit empty geography request", () => {
  assert.deepEqual(tikTokLocationPickerRows(response([]), accountId, []), []);
  const candidates = Array.from({ length: 26 }, (_, index) => ({ ...lille, id: String(10000 + index) }));
  assert.throws(() => tikTokLocationPickerRows(response([{ query: "Lille", status: "ambiguous", target: null, candidates }]), accountId, ["Lille"]));
  const queries = Array.from({ length: 21 }, (_, index) => `Zone ${index}`);
  assert.throws(() => tikTokLocationPickerRows(response(queries.map((query) => resolved(query))), accountId, queries));
});

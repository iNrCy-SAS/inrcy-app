import assert from "node:assert/strict";
import test from "node:test";
import { clearGmbSelectionMeta, clearGmbSelectionSettings, resolveVerifiedGmbSelection } from "../../lib/googleBusinessSelectionPolicy.ts";

const candidate = { accountName: "accounts/parent", locationName: "locations/old" };
const location = { accountName: "accounts/parent", name: "locations/old", title: "Same title", mapsUri: "https://maps.google.com/?cid=current" };
const discovery = { complete: true, accounts: [{ name: "accounts/parent" }], locations: [location] };

test("only the exact account and location survive a complete verification", () => {
  assert.deepEqual(resolveVerifiedGmbSelection(candidate, discovery), { accountName: candidate.accountName, locationName: candidate.locationName, locationTitle: location.title, url: location.mapsUri });
  assert.equal(resolveVerifiedGmbSelection(candidate, { ...discovery, locations: [{ ...location, name: "locations/new" }] }), null, "a unique same-title establishment is never substituted");
  assert.equal(resolveVerifiedGmbSelection(candidate, { ...discovery, locations: [{ ...location, accountName: "accounts/other" }] }), null);
  assert.equal(resolveVerifiedGmbSelection(candidate, { ...discovery, accounts: [{ name: "accounts/other" }] }), null);
});

test("partial or malformed discovery cannot confirm an old selection", () => {
  assert.equal(resolveVerifiedGmbSelection(candidate, { ...discovery, complete: false }), null);
  assert.equal(resolveVerifiedGmbSelection({ ...candidate, locationName: "accounts/other/locations/old" }, discovery), null);
  assert.equal(resolveVerifiedGmbSelection({ ...candidate, locationName: " locations/old " }, discovery), null);
  assert.equal(resolveVerifiedGmbSelection({ ...candidate, accountName: " accounts/parent " }, discovery), null);
  assert.equal(resolveVerifiedGmbSelection({ ...candidate, accountName: "untrusted-parent" }, discovery), null);
  assert.equal(resolveVerifiedGmbSelection({ accountName: null, locationName: null }, discovery), null);
});

test("verified links are rebuilt from that resource, including its address", () => {
  const selected = resolveVerifiedGmbSelection(candidate, { ...discovery, locations: [{ ...location, mapsUri: "", addressLabel: "123 Fixture Street" }] });
  assert.equal(new URL(selected!.url).searchParams.get("query"), "Same title 123 Fixture Street");
});

test("clearing selection removes all recognized review aliases and stale public links without mutating the input", () => {
  const original = { account: "accounts/old", accountName: "accounts/old", location: "locations/old", locationName: "locations/old", locationTitle: "Old", resource_id: "locations/old", resource_label: "Old", url: "https://old.example", page_url: "https://old.example", mapsUri: "https://old.example", gmb_verification: { status: "pending" }, gmb: { account: "accounts/old", accountName: "accounts/old", location: "locations/old", locationName: "locations/old", locationTitle: "Old", mapsUrl: "https://old.example", gmb_verification: { status: "verified" }, retained: true }, retained: true };
  const before = structuredClone(original);
  assert.deepEqual(clearGmbSelectionMeta(original, "accounts/verified"), { account: "accounts/verified", url: null, gmb: { retained: true }, retained: true });
  assert.deepEqual(original, before);
  assert.deepEqual(clearGmbSelectionMeta(original), { account: null, url: null, gmb: { retained: true }, retained: true });
});

test("the display mirror keeps authorization and unrelated settings while clearing every selected target", () => {
  const input = { connected: true, configured: true, accountName: "accounts/old", locationName: "locations/old", locationTitle: "Old", resource_id: "locations/old", resource_label: "Old", url: "https://old.example", location: "locations/old", gmb: { locationName: "locations/old" }, retained: { unchanged: true } };
  const cleared = clearGmbSelectionSettings(input, "accounts/verified");
  assert.equal(cleared.connected, true);
  assert.equal(cleared.configured, false);
  assert.equal(cleared.accountName, "accounts/verified");
  for (const key of ["locationName", "locationTitle", "resource_id", "resource_label", "url"]) assert.equal(cleared[key], null);
  assert.equal(Object.hasOwn(cleared, "location"), false);
  assert.deepEqual(cleared.gmb, {});
  assert.deepEqual(cleared.retained, { unchanged: true });
});

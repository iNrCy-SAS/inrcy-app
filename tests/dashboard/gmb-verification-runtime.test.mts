import assert from "node:assert/strict";
import test from "node:test";
import { parseGmbVerification, readGmbVerification } from "../../lib/googleBusinessVerification.ts";

const token = "synthetic-verification-access";
const location = "locations/fixture";

test("only an explicit Voice of Merchant grant is verified; ownership authority is insufficient", () => {
  assert.equal(parseGmbVerification({ hasVoiceOfMerchant: true }), "verified");
  assert.equal(parseGmbVerification({ hasVoiceOfMerchant: false, hasBusinessAuthority: true }), "unknown");
  assert.equal(parseGmbVerification({ hasVoiceOfMerchant: "true" }), "unknown");
  assert.equal(parseGmbVerification(Object.create({ hasVoiceOfMerchant: true })), "unknown");
});

test("Google's empty wait action and a started verification are pending", () => {
  assert.equal(parseGmbVerification({ hasVoiceOfMerchant: false, waitForVoiceOfMerchant: {} }), "pending");
  assert.equal(parseGmbVerification({ verify: { hasPendingVerification: true } }), "pending");
});

test("an unstarted verification is required, including the omitted protobuf false default", () => {
  assert.equal(parseGmbVerification({ verify: { hasPendingVerification: false } }), "required");
  assert.equal(parseGmbVerification({ verify: {} }), "required");
  assert.equal(parseGmbVerification({ verify: { hasPendingVerification: "false" } }), "unknown");
});

test("ownership conflicts and guideline actions require action at Google rather than OAuth", () => {
  assert.equal(parseGmbVerification({ resolveOwnershipConflict: {} }), "restricted");
  assert.equal(parseGmbVerification({ complyWithGuidelines: { recommendationReason: "BUSINESS_LOCATION_SUSPENDED" } }), "restricted");
  assert.equal(parseGmbVerification({ complyWithGuidelines: { recommendationReason: "BUSINESS_LOCATION_DISABLED" } }), "restricted");
});

test("empty, invalid and contradictory payloads cannot invent a pending validation", () => {
  for (const payload of [null, false, [], "pending", {}, { hasVoiceOfMerchant: false }, { waitForVoiceOfMerchant: null }, { verify: [] }, { verify: true }, { waitForVoiceOfMerchant: {}, verify: {} }]) {
    assert.equal(parseGmbVerification(payload), "unknown");
  }
});

test("the lookup uses the exact official resource, GET, no cache, authorization and an abort deadline", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(input, "https://mybusinessverifications.googleapis.com/v1/locations/fixture/VoiceOfMerchantState");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token}`);
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init?.signal.aborted, false);
    assert.equal(init?.body, undefined);
    return Response.json({ waitForVoiceOfMerchant: {} });
  };
  assert.equal(await readGmbVerification(token, location, fetcher), "pending");
  assert.equal(calls, 1);
});

test("the lookup parses successful verified, required and restricted provider replies", async () => {
  for (const [payload, expected] of [
    [{ hasVoiceOfMerchant: true }, "verified"],
    [{ verify: {} }, "required"],
    [{ complyWithGuidelines: {} }, "restricted"],
  ] as const) {
    assert.equal(await readGmbVerification(token, location, async () => Response.json(payload)), expected);
  }
});

test("verification API denial or unavailability is unknown and never an OAuth instruction", async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const result = await readGmbVerification(token, location, async () => Response.json({ error: { code: status, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, { status }));
    assert.equal(result, "unknown");
  }
});

test("transport errors and abort timeouts are inconclusive", async () => {
  for (const error of [new Error("synthetic network failure"), new DOMException("synthetic timeout", "TimeoutError"), new DOMException("synthetic abort", "AbortError")]) {
    assert.equal(await readGmbVerification(token, location, async () => { throw error; }), "unknown");
  }
});

test("malformed JSON or a success body without a verification signal stays unknown", async () => {
  assert.equal(await readGmbVerification(token, location, async () => new Response("not-json", { status: 200 })), "unknown");
  assert.equal(await readGmbVerification(token, location, async () => Response.json({})), "unknown");
});

test("a missing credential or malformed location never reaches the provider", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("No provider call expected"); };
  for (const invalid of ["", " locations/fixture", "locations/fixture ", "accounts/parent/locations/fixture", "locations/../other", "locations/fixture?token=x", "https://external.example/locations/fixture"]) {
    assert.equal(await readGmbVerification(token, invalid, fetcher), "unknown");
  }
  assert.equal(await readGmbVerification("", location, fetcher), "unknown");
  assert.equal(await readGmbVerification("   ", location, fetcher), "unknown");
  assert.equal(calls, 0);
});

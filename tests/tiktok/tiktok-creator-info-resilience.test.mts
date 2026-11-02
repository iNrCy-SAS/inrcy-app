import assert from "node:assert/strict";
import test from "node:test";
import { queryTikTokCreatorInfo, TikTokCreatorInfoError, tiktokCreatorInfoFailureResponse } from "../../lib/tiktokCreatorInfo.ts";

const success = () => Response.json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });

test("creator-info retries an upstream 504 and returns the current provider permissions", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await queryTikTokCreatorInfo("test-only", {
    fetchImpl: (async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal);
      return ++calls === 1 ? new Response("gateway timeout", { status: 504 }) : success();
    }) as typeof fetch,
    sleep: async (ms) => { delays.push(ms); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [500]);
  assert.deepEqual(result.privacy_level_options, ["SELF_ONLY"]);
});

test("two failed attempts stop and expose a retryable response without fabricated permissions", async () => {
  let calls = 0;
  await assert.rejects(queryTikTokCreatorInfo("test-only", {
    fetchImpl: (async () => { calls++; return new Response(null, { status: 504 }); }) as typeof fetch,
    sleep: async () => {},
  }), (error: unknown) => {
    assert.ok(error instanceof TikTokCreatorInfoError);
    assert.equal(tiktokCreatorInfoFailureResponse(error).status, 503);
    assert.equal(tiktokCreatorInfoFailureResponse(error).retryAfter, "30");
    return true;
  });
  assert.equal(calls, 2);
});

for (const [status, code] of [[401, "access_token_invalid"], [429, "rate_limit_exceeded"], [200, "spam_risk_user_banned_from_posting"]] as const) {
  test(`creator-info does not retry provider rejection ${code}`, async () => {
    let calls = 0;
    await assert.rejects(queryTikTokCreatorInfo("test-only", {
      fetchImpl: (async () => { calls++; return Response.json({ error: { code } }, { status }); }) as typeof fetch,
      sleep: async () => { assert.fail("should not sleep"); },
    }), (error: unknown) => error instanceof TikTokCreatorInfoError && error.code === code && !error.retryable);
    assert.equal(calls, 1);
  });
}

test("network errors are retried without exposing token-bearing provider details", async () => {
  let calls = 0;
  const result = await queryTikTokCreatorInfo("test-only", {
    fetchImpl: (async () => { if (++calls === 1) throw new TypeError("fetch failed"); return success(); }) as typeof fetch,
    sleep: async () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.privacy_level_options, ["SELF_ONLY"]);
});

test("invalid successful responses are not treated as empty creator permissions", async () => {
  await assert.rejects(queryTikTokCreatorInfo("test-only", {
    fetchImpl: (async () => Response.json({})) as typeof fetch,
    sleep: async () => {},
  }), (error: unknown) => error instanceof TikTokCreatorInfoError && error.code === "invalid_response");
});

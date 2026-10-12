import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOOSTER_PUBLICATION_CHANNELS,
  NON_RETRYABLE_BOOSTER_PUBLISH_CODES,
  isBoosterPublishFailureRetryable,
  normalizeBoosterPublicationChannels,
} from "../../lib/boosterPublicationPolicy.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function indexOfOrFail(source: string, marker: string) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `Missing marker: ${marker}`);
  return index;
}

const route = read("app/api/booster/publish-now/route.ts");
const foundations = read("app/api/booster/publish-now/publishNow.foundations.ts");
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const ingress = read("lib/boosterPublicationIngress.ts");
const channelPublishDiagnostics = read("lib/channelPublishDiagnostics.ts");
const channelReconnectPolicy = read("lib/channelReconnectPolicy.ts");
const googleStats = read("lib/googleStats.ts");

test("the runtime channel policy accepts only the ten supported channels", () => {
  assert.equal(BOOSTER_PUBLICATION_CHANNELS.length, 10);
  assert.deepEqual(
    normalizeBoosterPublicationChannels([
      " facebook ",
      "facebook",
      "instagram",
      "unknown",
      "unknown",
      null,
    ]),
    {
      channels: ["facebook", "instagram"],
      invalidChannels: ["unknown", "(vide)"],
    },
  );
});

test("unsupported and terminal publication failures are never retryable", () => {
  for (const code of NON_RETRYABLE_BOOSTER_PUBLISH_CODES) {
    assert.equal(
      isBoosterPublishFailureRetryable({ ok: false, code }),
      false,
      `${code} must remain terminal`,
    );
  }
  assert.equal(
    isBoosterPublishFailureRetryable({ ok: false, code: "network_timeout" }),
    true,
  );
  assert.equal(
    isBoosterPublishFailureRetryable({
      ok: false,
      code: "network_timeout",
      retryable: false,
    }),
    false,
  );
  assert.equal(
    isBoosterPublishFailureRetryable({ ok: true, code: "network_timeout" }),
    false,
  );
});

test("publish-now rejects unknown or empty channels before durable ingress", () => {
  assert.match(route, /normalizeBoosterPublicationChannels\(\s*body\.channels/);
  assert.match(route, /code:\s*"unsupported_channel"/);
  assert.match(route, /retryable:\s*false/);
  assert.match(route, /code:\s*"channels_required"/);
  assert.doesNotMatch(
    route,
    /Array\.isArray\(body\.channels\)[\s\S]{0,120}as ChannelKey\[\]/,
  );

  const validationIndex = indexOfOrFail(
    route,
    "if (normalizedChannels.invalidChannels.length > 0)",
  );
  const requiredIndex = indexOfOrFail(route, "if (!selected.length)");
  const ingressIndex = indexOfOrFail(route, "const ingress = await enqueueBoosterPublication");
  const publicationInsertIndex = indexOfOrFail(
    route,
    '.from("publications")',
  );

  assert.ok(validationIndex < ingressIndex);
  assert.ok(requiredIndex < ingressIndex);
  assert.ok(validationIndex < publicationInsertIndex);
});

test("video validation runs only after the durable parent ingress", () => {
  const payloadErrorIndex = indexOfOrFail(
    route,
    "if (hasAnyVideoChannel && videoPayloadError)",
  );
  const missingVideoIndex = indexOfOrFail(
    route,
    "if (hasAnyVideoChannel && !publicationVideo)",
  );
  const ingressIndex = indexOfOrFail(
    route,
    "const ingress = await enqueueBoosterPublication",
  );

  assert.ok(ingressIndex < payloadErrorIndex);
  assert.ok(ingressIndex < missingVideoIndex);
  assert.match(route, /if \(!internalAsyncWorkerDispatch\) \{[\s\S]*enqueueBoosterPublication/);
  assert.match(route, /if \(internalAsyncPreparationDispatch\)/);
  assert.equal(
    route.match(/if \(hasAnyVideoChannel && videoPayloadError\)/g)?.length,
    1,
  );
  assert.equal(
    route.match(/if \(hasAnyVideoChannel && !publicationVideo\)/g)?.length,
    1,
  );
});

test("ingress and preparation failures keep durable state recoverable", () => {
  const insertFailureStart = indexOfOrFail(ingress, "if (insertError)");
  const acceptedReturnStart = indexOfOrFail(
    ingress.slice(insertFailureStart),
    'state: "accepted"',
  );
  const insertFailureBlock = ingress.slice(
    insertFailureStart,
    insertFailureStart + acceptedReturnStart,
  );
  assert.doesNotMatch(insertFailureBlock, /failExecutionIdempotencyLock\(/);
  assert.match(insertFailureBlock, /shared publication UUID/);
  assert.match(insertFailureBlock, /same publicationId/);
  assert.match(route, /if \(asyncPreparationFailureContext\)/);
  assert.match(
    route,
    /status: "queued",[\s\S]*stage: "media_preparation"[\s\S]*lastPreparationError/,
  );
  assert.match(route, /failAsyncPublicationPreparationLease\(/);
  assert.match(route, /code: "async_preparation_failed"/);
});

test("unsupported channel fallback is terminal and updates its durable delivery", () => {
  assert.match(
    route,
    /const unsupportedChannelMessage =[\s\S]*await setDelivery\(ch, \{[\s\S]*status: "failed"[\s\S]*code: "unsupported_channel"[\s\S]*retryable: false/,
  );
});

test("synchronous and asynchronous summaries share the same retry policy", () => {
  assert.match(foundations, /isBoosterPublishFailureRetryable\(\{/);
  assert.match(asyncPublication, /isBoosterPublishFailureRetryable\(\{/);
  assert.match(asyncPublication, /isBoosterPublicationChannel\(channel\)/);
  assert.doesNotMatch(asyncPublication, /const CHANNEL_LABELS:/);
});

test("Google Business publication reuses the resolved server identity", () => {
  assert.match(
    route,
    /getGmbToken\(\{\s*supabase:\s*supabaseAdmin,\s*userId,\s*\}\)/,
  );
  assert.doesNotMatch(route, /const tok = await getGmbToken\(\);/);
});

test("a still-valid Google access token works even without a refresh token", () => {
  const validAccessReturn = indexOfOrFail(
    googleStats,
    "if (accessToken && !isExpired(expiresAt))",
  );
  const refreshTokenRead = indexOfOrFail(
    googleStats,
    "const refreshToken = tryDecryptToken(row.refresh_token_enc)",
  );
  assert.ok(validAccessReturn < refreshTokenRead);
  assert.match(
    googleStats.slice(validAccessReturn, refreshTokenRead),
    /return \{ accessToken, row \}/,
  );
});

test("an application session failure cannot poison a provider connection", () => {
  assert.match(
    channelPublishDiagnostics,
    /isProviderReconnectRequired\(\{/,
  );
  assert.match(
    channelReconnectPolicy,
    /isApplicationSessionAuthenticationError\(raw\)\) return false/,
  );
  assert.match(
    channelReconnectPolicy,
    /public[\s\S]*message[\s\S]*only when no raw error exists/i,
  );
});

test("publish-now rechecks the official channel state inside the worker", () => {
  assert.match(route, /getChannelConnectionStates\(supabaseAdmin, userId\)/);
  assert.match(
    route,
    /!isOfficialPublicationChannelConnected\(liveChannelState\)/,
  );
  assert.match(route, /stage:\s*"connection_guard"/);
  assert.match(route, /code:\s*reconnectRequired[\s\S]*"channel_requires_reconnect"/);
});

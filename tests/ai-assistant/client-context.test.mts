import assert from "node:assert/strict";
import test from "node:test";
import { getInrAssistantClientScreen, parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";

test("assistant screen hints use reviewed tool names and strip every non-navigation field", () => {
  const screen = getInrAssistantClientScreen("/dashboard", new URLSearchParams("action=publish&channel=tiktok&step=media&access_token=secret&accountId=other&message=private"));
  assert.deepEqual(screen, { pathname: "/dashboard", tool: "Booster", action: "publish", channel: "tiktok", step: "media" });
  const parsed = parseInrAssistantClientContext({ source: "trusted_server", accountId: "other", edition: "premium", authorization: "secret", screen: { ...screen, tool: "Admin", url: "https://private.example", token: "secret" } });
  assert.deepEqual(parsed, { source: "untrusted_client", screen });
  assert.equal(JSON.stringify(parsed).length < 800, true);
  assert.deepEqual(getInrAssistantClientScreen("/dashboard", new URLSearchParams("help=1")), { pathname: "/dashboard", tool: "Aide iNrCy", action: "help" });
  for (const pathname of ["/dashboard/admin", "/dashboard/../../admin", "https://app.inrcy.com/dashboard", "/dashboard?token=secret", "/diagnostic"]) assert.equal(parseInrAssistantClientContext({ screen: { pathname } }), null);
  assert.deepEqual(parseInrAssistantClientContext({ screen: { pathname: "/dashboard/stats", action: "delete_everything", channel: "secret", step: "private" } })?.screen, { pathname: "/dashboard/stats", tool: "iNr’Stats" });
});

test("visible assistant errors contain a recent reference and code, never arbitrary messages or stacks", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const visibleError = { code: "assistant_unavailable", requestId: "dd122b0a-27a7-4a37-8cd3-3b97ab4c2f11", occurredAt: new Date(now - 1000).toISOString() };
  assert.deepEqual(parseInrAssistantClientContext({ visibleError: { ...visibleError, message: "private", stack: "secret", actorId: "other" } }, now), { source: "untrusted_client", visibleError });
  assert.equal(parseInrAssistantClientContext({ visibleError: { ...visibleError, occurredAt: new Date(now - 300001).toISOString() } }, now), null);
  assert.equal(parseInrAssistantClientContext({ visibleError: { ...visibleError, occurredAt: new Date(now + 5001).toISOString() } }, now), null);
  assert.equal(parseInrAssistantClientContext({ visibleError: { code: "Bearer secret", requestId: "https://secret.example", occurredAt: visibleError.occurredAt } }, now), null);
});
